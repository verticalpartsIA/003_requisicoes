import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Calcula, uma vez por semana:
//  - média mensal de vendas faturadas dos últimos 4 meses por produto (via
//    NF-e emitidas, ListarNF) -> Estoque Mínimo calculado = média x 3 (90
//    dias de cobertura);
//  - Curva ABC (por volume faturado) e Curva D (baixo giro, sem histórico
//    suficiente) -> mínimo fixo (2 un. se custo médio <= R$2500, senão 1 un.);
//  - quantidade pendente em pedidos de venda ainda não faturados (últimos 6
//    meses de criação) -> abate do Estoque Disponível na Sugestão de Compra.
// Assim como o sync-omie-stock, processa página a página (o Omie não aceita
// chamadas concorrentes do mesmo método) e se encadeia via EdgeRuntime até
// terminar, sem estourar o timeout de uma única invocação.

function omieKey() { return Deno.env.get('OMIE_APP_KEY') ?? '8463170967' }
function omieSecret() { return Deno.env.get('OMIE_APP_SECRET') ?? '69e22b773842044fdb218178521cac59' }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const REGISTROS_POR_PAGINA = 100
const TEMPO_MAXIMO_MS = 100_000
const CICLO_ORFAO_MS = 60 * 60_000
const MESES_FATURAMENTO = 4
const MESES_PENDENTES = 6
const LIMITE_CURVA_A = 0.8
const LIMITE_CURVA_B = 0.95
const CMC_LIMITE_CURVA_D = 2500
const MINIMO_CURVA_D_BARATO = 2
const MINIMO_CURVA_D_CARO = 1

async function omiePost<T>(endpoint: string, call: string, param: unknown[], attempt = 1): Promise<T> {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: omieKey(), app_secret: omieSecret(), param }),
  })
  const data = (await resp.json()) as { faultstring?: string } & T
  if (data.faultstring) {
    const isBusy = /redundante|redundant|too many requests|j[aá] existe uma requisi/i.test(data.faultstring)
    if (isBusy && attempt < 6) {
      await sleep(attempt * 3000)
      return omiePost<T>(endpoint, call, param, attempt + 1)
    }
    throw new Error(`Omie: ${data.faultstring}`)
  }
  return data as T
}

function supabaseAdmin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
}

function formatarData(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface Cursor {
  phase: 'faturamento' | 'pendentes' | 'finalizando' | 'idle'
  next_pagina: number
  total_paginas: number | null
  started_at: string
}

async function saveCursor(supabase: SupabaseClient, cursor: Cursor) {
  await supabase.from('omie_velocity_cursor').upsert({ id: true, ...cursor })
}

async function getOrResetCursor(supabase: SupabaseClient, isContinuation: boolean): Promise<Cursor> {
  const { data } = await supabase.from('omie_velocity_cursor').select('*').eq('id', true).maybeSingle()
  const existing = data as Cursor | null

  const emAndamentoRecente =
    existing && existing.phase !== 'idle' && Date.now() - new Date(existing.started_at).getTime() < CICLO_ORFAO_MS

  if ((isContinuation || emAndamentoRecente) && existing) return existing

  const fresh: Cursor = { phase: 'faturamento', next_pagina: 1, total_paginas: null, started_at: new Date().toISOString() }
  await supabase.from('omie_velocity_staging').delete().neq('codigo', '')
  await saveCursor(supabase, fresh)
  return fresh
}

async function incrementarStaging(supabase: SupabaseClient, coluna: 'qtd_faturada' | 'qtd_pendente', somasPorCodigo: Map<string, number>) {
  if (somasPorCodigo.size === 0) return
  const codigos = [...somasPorCodigo.keys()]
  const { data: existentes } = await supabase.from('omie_velocity_staging').select('codigo,qtd_faturada,qtd_pendente').in('codigo', codigos)
  const existentesMap = new Map((existentes ?? []).map((r) => [r.codigo as string, r as { qtd_faturada: number; qtd_pendente: number }]))

  const rows = codigos.map((codigo) => {
    const atual = existentesMap.get(codigo)
    const base = { codigo, qtd_faturada: atual?.qtd_faturada ?? 0, qtd_pendente: atual?.qtd_pendente ?? 0 }
    base[coluna] = (base[coluna] ?? 0) + (somasPorCodigo.get(codigo) ?? 0)
    return base
  })
  await supabase.from('omie_velocity_staging').upsert(rows, { onConflict: 'codigo' })
}

async function processarFaturamento(supabase: SupabaseClient, cursor: Cursor): Promise<Cursor> {
  type NfItem = { prod: { cProd: string; qCom: number } }
  type NfCadastro = { ide: { dCan: string }; det: NfItem[] }
  type ListarNfResp = { total_de_paginas: number; nfCadastro: NfCadastro[] }

  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setMonth(inicio.getMonth() - MESES_FATURAMENTO)

  const resp = await omiePost<ListarNfResp>('produtos/nfconsultar', 'ListarNF', [
    {
      pagina: cursor.next_pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      dEmiInicial: formatarData(inicio),
      dEmiFinal: formatarData(hoje),
    },
  ])

  const somas = new Map<string, number>()
  for (const nf of resp.nfCadastro ?? []) {
    if (nf.ide?.dCan) continue // NF cancelada não conta como venda
    for (const item of nf.det ?? []) {
      const codigo = item.prod?.cProd
      const qtd = item.prod?.qCom ?? 0
      if (!codigo || qtd <= 0) continue
      somas.set(codigo, (somas.get(codigo) ?? 0) + qtd)
    }
  }
  await incrementarStaging(supabase, 'qtd_faturada', somas)

  const totalPaginas = resp.total_de_paginas ?? 1
  const proximaPagina = cursor.next_pagina + 1
  return proximaPagina > totalPaginas
    ? { ...cursor, phase: 'pendentes', next_pagina: 1, total_paginas: null }
    : { ...cursor, next_pagina: proximaPagina, total_paginas: totalPaginas }
}

async function processarPendentes(supabase: SupabaseClient, cursor: Cursor): Promise<Cursor> {
  type ItemPedido = { produto: { codigo: string; quantidade: number } }
  type Pedido = {
    det: ItemPedido[]
    infoCadastro: { faturado: string; cancelado: string }
  }
  type ListarPedidosResp = { total_de_paginas: number; pedido_venda_produto: Pedido[] }

  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setMonth(inicio.getMonth() - MESES_PENDENTES)

  const resp = await omiePost<ListarPedidosResp>('produtos/pedido', 'ListarPedidos', [
    {
      pagina: cursor.next_pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      filtrar_por_data_de: formatarData(inicio),
      filtrar_por_data_ate: formatarData(hoje),
      filtrar_apenas_inclusao: 'S',
    },
  ])

  const somas = new Map<string, number>()
  for (const pedido of resp.pedido_venda_produto ?? []) {
    if (pedido.infoCadastro?.faturado === 'S' || pedido.infoCadastro?.cancelado === 'S') continue
    for (const item of pedido.det ?? []) {
      const codigo = item.produto?.codigo
      const qtd = item.produto?.quantidade ?? 0
      if (!codigo || qtd <= 0) continue
      somas.set(codigo, (somas.get(codigo) ?? 0) + qtd)
    }
  }
  await incrementarStaging(supabase, 'qtd_pendente', somas)

  const totalPaginas = resp.total_de_paginas ?? 1
  const proximaPagina = cursor.next_pagina + 1
  return proximaPagina > totalPaginas
    ? { ...cursor, phase: 'finalizando', next_pagina: 1, total_paginas: null }
    : { ...cursor, next_pagina: proximaPagina, total_paginas: totalPaginas }
}

// O PostgREST limita a 1000 linhas por padrão: sem paginação explícita,
// tabelas maiores (omie_stock_cache tem ~1800 produtos) seriam truncadas
// silenciosamente e o restante cairia no fallback errado da view.
async function buscarTodasAsLinhas<T>(supabase: SupabaseClient, tabela: string, colunas: string): Promise<T[]> {
  const PAGINA = 1000
  const linhas: T[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(offset, offset + PAGINA - 1)
    if (error) throw new Error(`Supabase select error (${tabela}): ${error.message}`)
    linhas.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGINA) break
    offset += PAGINA
  }
  return linhas
}

async function finalizar(supabase: SupabaseClient, cursor: Cursor): Promise<Cursor> {
  const staging = await buscarTodasAsLinhas<{ codigo: string; qtd_faturada: number; qtd_pendente: number }>(
    supabase,
    'omie_velocity_staging',
    'codigo,qtd_faturada,qtd_pendente',
  )
  const produtos = await buscarTodasAsLinhas<{ codigo: string; cmc: number; lead_time_dias: number }>(
    supabase,
    'omie_stock_cache',
    'codigo,cmc,lead_time_dias',
  )

  const stagingMap = new Map((staging ?? []).map((s) => [s.codigo as string, s as { qtd_faturada: number; qtd_pendente: number }]))

  // Curva ABC por volume faturado, só entre quem realmente vendeu no período.
  const vendedores = (produtos ?? [])
    .map((p) => ({ codigo: p.codigo as string, qtd: stagingMap.get(p.codigo as string)?.qtd_faturada ?? 0 }))
    .filter((p) => p.qtd > 0)
    .sort((a, b) => b.qtd - a.qtd)

  const totalFaturado = vendedores.reduce((acc, p) => acc + p.qtd, 0)
  const curvaPorCodigo = new Map<string, 'A' | 'B' | 'C'>()
  let acumulado = 0
  for (const p of vendedores) {
    acumulado += p.qtd
    const pct = totalFaturado > 0 ? acumulado / totalFaturado : 1
    curvaPorCodigo.set(p.codigo, pct <= LIMITE_CURVA_A ? 'A' : pct <= LIMITE_CURVA_B ? 'B' : 'C')
  }

  const agora = new Date().toISOString()
  const linhas = (produtos ?? []).map((p) => {
    const codigo = p.codigo as string
    const cmc = (p.cmc as number) ?? 0
    const leadTime = (p.lead_time_dias as number) ?? 0
    const stagingRow = stagingMap.get(codigo)
    const qtdFaturada = stagingRow?.qtd_faturada ?? 0
    const qtdPendente = stagingRow?.qtd_pendente ?? 0
    const curva = curvaPorCodigo.get(codigo) ?? 'D'
    const mediaMensal = qtdFaturada / MESES_FATURAMENTO
    const estoqueMinimoCalculado =
      curva === 'D' ? (cmc <= CMC_LIMITE_CURVA_D ? MINIMO_CURVA_D_BARATO : MINIMO_CURVA_D_CARO) : mediaMensal * 3

    return {
      codigo,
      media_mensal_vendas: mediaMensal,
      curva,
      estoque_minimo_calculado: estoqueMinimoCalculado,
      qtd_pendente: qtdPendente,
      cmc,
      lead_time_dias: leadTime,
      updated_at: agora,
    }
  })

  const BATCH = 500
  for (let i = 0; i < linhas.length; i += BATCH) {
    await supabase.from('omie_sales_velocity').upsert(linhas.slice(i, i + BATCH), { onConflict: 'codigo' })
  }

  await supabase.from('omie_sales_velocity').delete().lt('updated_at', agora)
  await supabase.from('omie_velocity_staging').delete().neq('codigo', '')

  return { ...cursor, phase: 'idle', next_pagina: 1, total_paginas: null }
}

async function continueSync(isContinuation: boolean): Promise<Cursor> {
  const supabase = supabaseAdmin()
  let cursor = await getOrResetCursor(supabase, isContinuation)
  const inicio = Date.now()

  while (cursor.phase !== 'idle' && Date.now() - inicio < TEMPO_MAXIMO_MS) {
    if (cursor.phase === 'faturamento') cursor = await processarFaturamento(supabase, cursor)
    else if (cursor.phase === 'pendentes') cursor = await processarPendentes(supabase, cursor)
    else cursor = await finalizar(supabase, cursor)
    await saveCursor(supabase, cursor)
  }

  return cursor
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  try {
    const url = new URL(req.url)
    const isContinuation = url.searchParams.get('continue') === '1'
    const cursor = await continueSync(isContinuation)

    if (cursor.phase !== 'idle') {
      const selfUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-omie-sales-velocity?continue=1`
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      const chain = fetch(selfUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
        body: '{}',
      }).catch((e) => console.error('chain error', e))

      // deno-lint-ignore no-explicit-any
      const runtime = globalThis as any
      if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(chain)
      else await chain
    }

    return new Response(JSON.stringify({ ok: true, phase: cursor.phase, next_pagina: cursor.next_pagina }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('sync-omie-sales-velocity error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

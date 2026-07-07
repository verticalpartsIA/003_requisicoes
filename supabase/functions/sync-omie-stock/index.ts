import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

function omieKey() { return Deno.env.get('OMIE_APP_KEY') ?? '8463170967' }
function omieSecret() { return Deno.env.get('OMIE_APP_SECRET') ?? '69e22b773842044fdb218178521cac59' }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const REGISTROS_POR_PAGINA = 100 // o Omie ignora valores maiores e sempre pagina de 100 em 100
const TEMPO_MAXIMO_MS = 100_000 // orçamento de tempo por invocação (limite da Edge Function é ~150s)
const CICLO_ORFAO_MS = 30 * 60_000 // um ciclo "em andamento" há mais que isso é considerado travado

// O Omie não aceita duas chamadas concorrentes do MESMO método (retorna
// "Já existe uma requisição desse método sendo executada"), além do rate
// limit normal ("Consumo redundante" / "Too many requests"). Por isso a
// busca de páginas é sequencial, e o catálogo inteiro (dezenas de páginas,
// ~9s cada) é processado aos poucos, encadeando invocações desta função
// (via EdgeRuntime.waitUntil) até terminar, para não estourar o timeout de
// uma única invocação.
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

interface Cursor {
  phase: 'produtos' | 'posestoque' | 'idle'
  next_pagina: number
  total_paginas: number | null
  started_at: string
}

async function saveCursor(supabase: SupabaseClient, cursor: Cursor) {
  await supabase.from('omie_sync_cursor').upsert({ id: true, ...cursor })
}

async function getOrResetCursor(supabase: SupabaseClient, isContinuation: boolean): Promise<Cursor> {
  const { data } = await supabase.from('omie_sync_cursor').select('*').eq('id', true).maybeSingle()
  const existing = data as Cursor | null

  const emAndamentoRecente =
    existing && existing.phase !== 'idle' && Date.now() - new Date(existing.started_at).getTime() < CICLO_ORFAO_MS

  if (isContinuation || emAndamentoRecente) {
    if (existing) return existing
  }

  const fresh: Cursor = { phase: 'produtos', next_pagina: 1, total_paginas: null, started_at: new Date().toISOString() }
  await supabase.from('omie_products_staging').delete().neq('codigo', '')
  await saveCursor(supabase, fresh)
  return fresh
}

async function processarProdutos(supabase: SupabaseClient, cursor: Cursor): Promise<Cursor> {
  type ProdutoItem = { codigo: string; descricao: string; inativo: string; lead_time?: number }
  type ListarProdutosResp = { total_de_paginas: number; produto_servico_cadastro: ProdutoItem[] }

  const resp = await omiePost<ListarProdutosResp>('geral/produtos', 'ListarProdutos', [
    { pagina: cursor.next_pagina, registros_por_pagina: REGISTROS_POR_PAGINA, apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N' },
  ])

  const ativos = (resp.produto_servico_cadastro ?? []).filter((p) => p.inativo !== 'S')
  if (ativos.length > 0) {
    await supabase
      .from('omie_products_staging')
      .upsert(
        ativos.map((p) => ({ codigo: p.codigo, descricao: p.descricao, lead_time_dias: p.lead_time ?? 0 })),
        { onConflict: 'codigo' },
      )
  }

  const totalPaginas = resp.total_de_paginas ?? 1
  const proximaPagina = cursor.next_pagina + 1
  return proximaPagina > totalPaginas
    ? { ...cursor, phase: 'posestoque', next_pagina: 1, total_paginas: null }
    : { ...cursor, next_pagina: proximaPagina, total_paginas: totalPaginas }
}

async function processarPosEstoque(supabase: SupabaseClient, cursor: Cursor): Promise<Cursor> {
  type PosEstoqueItem = {
    cCodigo: string
    cDescricao: string
    fisico: number
    reservado: number
    estoque_minimo: number
    nCMC?: number
  }
  type ListarPosEstoqueResp = { nTotPaginas: number; produtos: PosEstoqueItem[] }

  const resp = await omiePost<ListarPosEstoqueResp>('estoque/consulta', 'ListarPosEstoque', [
    { nPagina: cursor.next_pagina, nRegPorPagina: REGISTROS_POR_PAGINA, dDataPosicao: '' },
  ])

  const posicoes = resp.produtos ?? []
  if (posicoes.length > 0) {
    const { data: ativos } = await supabase
      .from('omie_products_staging')
      .select('codigo,descricao,lead_time_dias')
      .in('codigo', posicoes.map((p) => p.cCodigo))
    const ativosMap = new Map(
      (ativos ?? []).map((a) => [a.codigo as string, { descricao: a.descricao as string, leadTime: (a.lead_time_dias as number) ?? 0 }]),
    )

    const rows = posicoes
      .filter((p) => ativosMap.has(p.cCodigo))
      .map((p) => {
        const fisico = p.fisico ?? 0
        const reservado = p.reservado ?? 0
        const ativo = ativosMap.get(p.cCodigo)!
        return {
          codigo: p.cCodigo,
          descricao: p.cDescricao || ativo.descricao,
          estoque_fisico: fisico,
          estoque_reservado: reservado,
          estoque_disponivel: fisico - reservado,
          estoque_minimo: p.estoque_minimo ?? 0,
          cmc: p.nCMC ?? 0,
          lead_time_dias: ativo.leadTime,
          updated_at: new Date().toISOString(),
        }
      })

    if (rows.length > 0) {
      await supabase.from('omie_stock_cache').upsert(rows, { onConflict: 'codigo' })
    }
  }

  const totalPaginas = resp.nTotPaginas ?? 1
  const proximaPagina = cursor.next_pagina + 1
  if (proximaPagina > totalPaginas) {
    await supabase.from('omie_stock_cache').delete().lt('updated_at', cursor.started_at)
    await supabase.from('omie_products_staging').delete().neq('codigo', '')
    return { ...cursor, phase: 'idle', next_pagina: 1, total_paginas: null }
  }
  return { ...cursor, next_pagina: proximaPagina, total_paginas: totalPaginas }
}

async function continueSync(isContinuation: boolean): Promise<Cursor> {
  const supabase = supabaseAdmin()
  let cursor = await getOrResetCursor(supabase, isContinuation)
  const inicio = Date.now()

  while (cursor.phase !== 'idle' && Date.now() - inicio < TEMPO_MAXIMO_MS) {
    cursor = cursor.phase === 'produtos' ? await processarProdutos(supabase, cursor) : await processarPosEstoque(supabase, cursor)
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
      const selfUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-omie-stock?continue=1`
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
    console.error('sync-omie-stock error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

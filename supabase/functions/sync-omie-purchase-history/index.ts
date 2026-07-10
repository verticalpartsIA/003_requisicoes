import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Sincroniza o HISTÓRICO COMPLETO de Pedidos de Compra do Omie (todos os
// status, sem corte de data) e recalcula a sugestão de lote/múltiplo por
// produto com confiança estatística real.
//
// Por quê: a sugestão anterior usava a MENOR quantidade já pedida como
// "lote do fornecedor" — mas para itens contínuos sob projeto (corrimão,
// cabo de aço cortado por medida), isso confunde "consumo de uma obra
// pontual" com "embalagem padrão". Só há evidência real de lote/bobina
// quando a MESMA quantidade se repete em 2+ pedidos distintos (moda com
// frequência >= 2). Ver migration 021 para a análise completa.
//
// Esta função roda periodicamente (cron) para manter omie_purchase_order_
// history atualizada e recalcular omie_purchase_lot_config.sugerido_* — só
// para produtos ainda não confirmados manualmente pelo comprador.

function omieKey() { return Deno.env.get('OMIE_APP_KEY') ?? '8463170967' }
function omieSecret() { return Deno.env.get('OMIE_APP_SECRET') ?? '69e22b773842044fdb218178521cac59' }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const REGISTROS_POR_PAGINA = 100
const MAX_PAGINAS = 500 // trava de segurança

async function omiePost<T>(endpoint: string, call: string, param: unknown[], attempt = 1): Promise<T> {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: omieKey(), app_secret: omieSecret(), param }),
  })
  const data = (await resp.json()) as { faultstring?: string } & T
  if ((data as { faultstring?: string }).faultstring) {
    const fault = (data as { faultstring?: string }).faultstring as string
    const isBusy = /redundante|redundant|too many requests|j[aá] existe uma requisi/i.test(fault)
    if (isBusy && attempt < 6) {
      await sleep(attempt * 3000)
      return omiePost<T>(endpoint, call, param, attempt + 1)
    }
    throw new Error(`Omie: ${fault}`)
  }
  return data as T
}

function supabaseAdmin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
}

/** "DD/MM/YYYY" (formato do Omie) -> "YYYY-MM-DD". Vazio/invalido -> null. */
function toISODate(br: string | undefined | null): string | null {
  if (!br) return null
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

interface PedidoItem {
  cProduto?: string
  cUnidade?: string
  nQtde?: number
}
interface PedidoCabecalho {
  cNumero?: string
  cEtapa?: string
  dIncData?: string
  dDtPrevisao?: string
}
interface PedidoConsulta {
  cabecalho_consulta?: PedidoCabecalho
  produtos_consulta?: PedidoItem[]
}
interface PesquisaResp {
  nTotalPaginas?: number
  pedidos_pesquisa?: PedidoConsulta[]
}

interface HistoricoRow {
  codigo: string
  numero_pedido: string
  quantidade: number
  unidade: string | null
  etapa: string | null
  data_pedido: string | null
  previsao: string | null
}

/** Busca e grava página a página (upsert imediato) — resiliente a timeout:
 *  se a função for interrompida, o que já foi buscado fica salvo, e a
 *  próxima execução (cron semanal seguinte) continua de onde parou, sem
 *  duplicar (unique constraint em codigo+numero_pedido+quantidade). */
async function buscarEGravarHistorico(
  supabase: SupabaseClient,
  paginaInicial: number,
  deadline: number,
): Promise<{ paginas: number; linhas: number; completo: boolean }> {
  let pagina = paginaInicial
  let totalPaginas = 1
  let totalLinhas = 0

  do {
    if (Date.now() > deadline) return { paginas: pagina - 1, linhas: totalLinhas, completo: false }

    const resp = await omiePost<PesquisaResp>('produtos/pedidocompra', 'PesquisarPedCompra', [
      {
        nPagina: pagina,
        nRegsPorPagina: REGISTROS_POR_PAGINA,
        // Todos os status — para estatística de recorrência precisamos do
        // histórico completo, não só dos pedidos em aberto.
        lExibirPedidosPendentes: 'S',
        lExibirPedidosFaturados: 'S',
        lExibirPedidosRecParciais: 'S',
        lExibirPedidosFatParciais: 'S',
        lExibirPedidosRecebidos: 'S',
        lExibirPedidosEncerrados: 'S',
        lExibirPedidosCancelados: 'S',
      },
    ])

    totalPaginas = resp.nTotalPaginas ?? 1
    const linhas: HistoricoRow[] = []
    for (const ped of resp.pedidos_pesquisa ?? []) {
      const cab = ped.cabecalho_consulta ?? {}
      const numero = cab.cNumero ?? '—'
      for (const item of ped.produtos_consulta ?? []) {
        if (!item.cProduto || !item.nQtde || item.nQtde <= 0) continue
        linhas.push({
          codigo: item.cProduto,
          numero_pedido: numero,
          quantidade: item.nQtde,
          unidade: item.cUnidade ?? null,
          etapa: cab.cEtapa ?? null,
          data_pedido: toISODate(cab.dIncData),
          previsao: toISODate(cab.dDtPrevisao),
        })
      }
    }

    if (linhas.length > 0) {
      const { error } = await supabase
        .from('omie_purchase_order_history')
        .upsert(linhas, { onConflict: 'codigo,numero_pedido,quantidade', ignoreDuplicates: true })
      if (error) throw error
    }
    totalLinhas += linhas.length

    pagina += 1
    if (pagina <= totalPaginas) await sleep(250)
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS)

  return { paginas: pagina - 1, linhas: totalLinhas, completo: true }
}

// Margem de segurança abaixo do limite de 150s do runtime da Edge Function —
// pára de buscar novas páginas do Omie a tempo de ainda rodar o recálculo.
const ORCAMENTO_BUSCA_MS = 100_000
const SETTINGS_KEY_PROXIMA_PAGINA = 'omie_purchase_history_proxima_pagina'
const SETTINGS_KEY_HISTORICO_COMPLETO = 'omie_purchase_history_completo_em'

async function lerProximaPagina(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SETTINGS_KEY_PROXIMA_PAGINA)
    .maybeSingle()
  const n = data?.value ? parseInt(data.value, 10) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

async function gravarProximaPagina(supabase: SupabaseClient, pagina: number) {
  await supabase
    .from('settings')
    .upsert({ key: SETTINGS_KEY_PROXIMA_PAGINA, value: String(pagina) }, { onConflict: 'key' })
}

async function sincronizar(): Promise<{ paginas: number; linhas: number; completo: boolean }> {
  const supabase = supabaseAdmin()
  const deadline = Date.now() + ORCAMENTO_BUSCA_MS

  // Continua de onde a execução anterior parou — o histórico completo do
  // Omie tem centenas de páginas e uma única invocação (limite de ~150s)
  // não dá conta de todas; sem isso, reiniciar sempre da página 1 nunca
  // chegaria ao fim. Ao completar todas as páginas, volta para a página 1
  // (pedidos novos entram nas primeiras páginas; as já conhecidas são
  // puladas rápido por causa da unique constraint + ignoreDuplicates).
  const proximaPagina = await lerProximaPagina(supabase)
  const busca = await buscarEGravarHistorico(supabase, proximaPagina, deadline)
  await gravarProximaPagina(supabase, busca.completo ? 1 : busca.paginas + 1)

  if (busca.completo) {
    await supabase
      .from('settings')
      .upsert({ key: SETTINGS_KEY_HISTORICO_COMPLETO, value: new Date().toISOString() }, { onConflict: 'key' })
  }

  // Recalcula a sugestão de lote com confiança estatística — só depois que o
  // histórico completo já foi varrido ao menos uma vez (senão o cálculo usa
  // uma base parcial e pode sugerir errado/undercount temporariamente).
  const { data: jaCompleto } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SETTINGS_KEY_HISTORICO_COMPLETO)
    .maybeSingle()

  if (jaCompleto?.value) {
    const { error } = await supabase.rpc('recalcular_sugestao_lote')
    if (error) throw error
  }

  return busca
}

serve(async () => {
  try {
    const resultado = await sincronizar()
    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

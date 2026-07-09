import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Sincroniza o "Aguardando Entrega" (campo Comprado da tela de Estoque):
// por produto, a soma de (quantidade pedida − quantidade recebida) dos
// Pedidos de Compra do Omie ainda em aberto/parcial. Também guarda a próxima
// data prevista e o detalhe de cada pedido (para o popover da tela).
//
// Descoberta validada contra a API real: PesquisarPedCompra já devolve
// nQtde e nQtdeRec item a item em produtos_consulta — não é preciso um
// ConsultarPedCompra por pedido (sem N+1), então uma invocação dá conta.

function omieKey() { return Deno.env.get('OMIE_APP_KEY') ?? '8463170967' }
function omieSecret() { return Deno.env.get('OMIE_APP_SECRET') ?? '69e22b773842044fdb218178521cac59' }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const REGISTROS_POR_PAGINA = 50
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
  nQtdeRec?: number
}
interface PedidoCabecalho {
  cNumero?: string
  cCodParc?: string
  nCodFor?: number
  dDtPrevisao?: string
  cEtapa?: string
}
interface PedidoConsulta {
  cabecalho_consulta?: PedidoCabecalho
  produtos_consulta?: PedidoItem[]
}
interface PesquisaResp {
  nTotalPaginas?: number
  nTotalRegistros?: number
  pedidos_pesquisa?: PedidoConsulta[]
}

interface PedidoDetalhe {
  numero: string
  qtde: number
  recebida: number
  aguardando: number
  previsao: string | null
  fornecedor: string
  unidade: string
}
interface Agregado {
  qtd_aguardando: number
  proxima_previsao: string | null
  pedidos: PedidoDetalhe[]
}

async function sincronizar(): Promise<{ produtos: number; pedidos: number; paginas: number }> {
  const supabase = supabaseAdmin()
  const runIso = new Date().toISOString()

  const porProduto = new Map<string, Agregado>()
  let pedidosContados = 0
  let pagina = 1
  let totalPaginas = 1

  do {
    const resp = await omiePost<PesquisaResp>('produtos/pedidocompra', 'PesquisarPedCompra', [
      {
        nPagina: pagina,
        nRegsPorPagina: REGISTROS_POR_PAGINA,
        // "Em trânsito": pedido/faturado e seus parciais; recebidos, cancelados
        // e encerrados ficam de fora (default N). A conta por item abaixo é a
        // segunda trava (só conta o que ainda não foi recebido).
        lExibirPedidosPendentes: 'S',
        lExibirPedidosFaturados: 'S',
        lExibirPedidosRecParciais: 'S',
        lExibirPedidosFatParciais: 'S',
      },
    ])

    totalPaginas = resp.nTotalPaginas ?? 1
    const pedidos = resp.pedidos_pesquisa ?? []

    for (const ped of pedidos) {
      pedidosContados++
      const cab = ped.cabecalho_consulta ?? {}
      const numero = cab.cNumero ?? '—'
      const previsao = toISODate(cab.dDtPrevisao)
      const fornecedor = cab.cCodParc || (cab.nCodFor ? String(cab.nCodFor) : '—')

      for (const item of ped.produtos_consulta ?? []) {
        const codigo = item.cProduto
        if (!codigo) continue
        const aguardando = (item.nQtde ?? 0) - (item.nQtdeRec ?? 0)
        if (aguardando <= 0) continue

        const agg = porProduto.get(codigo) ?? { qtd_aguardando: 0, proxima_previsao: null, pedidos: [] }
        agg.qtd_aguardando += aguardando
        agg.pedidos.push({
          numero,
          qtde: item.nQtde ?? 0,
          recebida: item.nQtdeRec ?? 0,
          aguardando,
          previsao,
          fornecedor,
          unidade: item.cUnidade ?? '',
        })
        // próxima previsão = menor data entre os pedidos que têm data
        if (previsao && (!agg.proxima_previsao || previsao < agg.proxima_previsao)) {
          agg.proxima_previsao = previsao
        }
        porProduto.set(codigo, agg)
      }
    }

    pagina++
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS)

  // Grava. Ordena o detalhe por previsão (mais próxima primeiro) para o popover.
  const rows = [...porProduto.entries()].map(([codigo, agg]) => ({
    codigo,
    qtd_aguardando: agg.qtd_aguardando,
    proxima_previsao: agg.proxima_previsao,
    pedidos: agg.pedidos.sort((a, b) => (a.previsao ?? '9999').localeCompare(b.previsao ?? '9999')),
    updated_at: runIso,
  }))

  if (rows.length > 0) {
    // upsert em lotes para não estourar payload
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from('omie_purchase_pending').upsert(rows.slice(i, i + 500), { onConflict: 'codigo' })
    }
  }
  // Remove produtos que não têm mais pedido em aberto (não vieram nesta rodada)
  await supabase.from('omie_purchase_pending').delete().lt('updated_at', runIso)

  return { produtos: rows.length, pedidos: pedidosContados, paginas: totalPaginas }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  try {
    const resumo = await sincronizar()
    return new Response(JSON.stringify({ ok: true, ...resumo }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('sync-omie-purchase-orders error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

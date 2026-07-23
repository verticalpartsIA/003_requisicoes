import {
  validateOmieOrder,
  validateOmieProduct,
  listOmieActiveStock,
  getOmieStockPosition,
  criarRequisicaoCompraOmie,
} from "@/features/omie/api";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { OmieStockItem, CriarRequisicaoCompraItem } from "@/features/omie/api";

// O PostgREST limita a 1000 linhas por resposta por padrão — sem paginação
// explícita, tabelas maiores (omie_stock_cache/omie_purchase_suggestions têm
// ~1800 produtos) voltam truncadas silenciosamente, sem erro, e a tela some
// com o restante dos produtos. Busca página a página até esgotar os dados.
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function validateOmieOrderClient(numeroPedido: string) {
  return validateOmieOrder({ data: { numeroPedido } });
}

export async function validateOmieProductClient(codigoProduto: string) {
  return validateOmieProduct({ data: { codigoProduto } });
}

export async function listOmieActiveStockClient() {
  return listOmieActiveStock();
}

export async function getOmieStockPositionClient(codigoProduto: string) {
  return getOmieStockPosition({ data: { codigoProduto } });
}

/** Cria uma única Requisição de Compra no Omie com vários produtos de uma vez —
 *  usada para enviar em massa os itens selecionados na tela de Sugestão de Compra. */
export async function criarRequisicaoCompraOmieClient(itens: CriarRequisicaoCompraItem[]) {
  return criarRequisicaoCompraOmie({ data: { itens } });
}

export interface OmieStockCacheResult {
  items: OmieStockItem[];
  lastSyncedAt: string | null;
}

export async function listOmieStockFromCacheClient(): Promise<OmieStockCacheResult> {
  const rows = await fetchAllRows<{
    codigo: string;
    descricao: string;
    estoque_fisico: number;
    estoque_reservado: number;
    estoque_disponivel: number;
    estoque_minimo: number;
    updated_at: string;
  }>((from, to) =>
    supabaseBrowser
      .from("omie_stock_cache")
      .select("codigo,descricao,estoque_fisico,estoque_reservado,estoque_disponivel,estoque_minimo,updated_at")
      .order("descricao", { ascending: true })
      .range(from, to),
  );
  const items: OmieStockItem[] = rows.map((row) => ({
    codigo: row.codigo,
    descricao: row.descricao,
    estoqueFisico: row.estoque_fisico,
    estoqueReservado: row.estoque_reservado,
    estoqueDisponivel: row.estoque_disponivel,
    estoqueMinimo: row.estoque_minimo,
  }));

  const lastSyncedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.updated_at) return latest;
    if (!latest || row.updated_at > latest) return row.updated_at;
    return latest;
  }, null);

  return { items, lastSyncedAt };
}

export interface OmiePurchaseOrderDetail {
  numero: string;
  qtde: number;
  recebida: number;
  aguardando: number;
  previsao: string | null;
  fornecedor: string;
  unidade: string;
}

export interface OmiePurchaseSuggestionItem {
  codigo: string;
  descricao: string;
  unidade: string | null;
  estoqueFisico: number;
  estoqueReservado: number;
  estoqueDisponivel: number;
  estoqueMinimo: number;
  curva: "A" | "B" | "C" | "D";
  leadTimeDias: number;
  coberturaDias: number;
  qtdPendente: number;
  comprado: number;
  proximaPrevisao: string | null;
  pedidos: OmiePurchaseOrderDetail[];
  sugestaoBruta: number;
  sugestaoCompra: number;
  multiploCompra: number | null;
  loteMinimo: number | null;
  loteConfirmado: boolean;
  sugeridoMultiplo: number | null;
  sugeridoLoteMinimo: number | null;
  /** Quantos pedidos de compra distintos existem no histórico completo do Omie. */
  historicoTotalPedidos: number | null;
  /** Em quantos desses pedidos a quantidade sugerida se repetiu igual (só há sugestão quando >= 2). */
  historicoModaFrequencia: number | null;
  lotePendenteRevisao: boolean;
  estoqueAtualizadoEm: string | null;
  giroCalculadoEm: string | null;
}

export interface OmiePurchaseSuggestionsResult {
  items: OmiePurchaseSuggestionItem[];
  lastSyncedAt: string | null;
  lastVelocitySyncedAt: string | null;
}

interface OmiePurchaseSuggestionRow {
  codigo: string;
  descricao: string;
  unidade: string | null;
  estoque_fisico: number;
  estoque_reservado: number;
  estoque_disponivel: number;
  estoque_minimo: number;
  curva: string;
  lead_time_dias: number | null;
  cobertura_dias: number | null;
  qtd_pendente: number;
  comprado: number;
  proxima_previsao: string | null;
  pedidos: unknown;
  sugestao_bruta: number;
  sugestao_compra: number;
  multiplo_compra: number | null;
  lote_minimo: number | null;
  lote_confirmado: boolean | null;
  sugerido_multiplo: number | null;
  sugerido_lote_minimo: number | null;
  historico_total_pedidos: number | null;
  historico_moda_frequencia: number | null;
  lote_pendente_revisao: boolean | null;
  estoque_atualizado_em: string | null;
  giro_calculado_em: string | null;
}

export async function listOmiePurchaseSuggestionsClient(): Promise<OmiePurchaseSuggestionsResult> {
  const rows = await fetchAllRows<OmiePurchaseSuggestionRow>((from, to) =>
    supabaseBrowser
      .from("omie_purchase_suggestions")
      .select(
        "codigo,descricao,unidade,estoque_fisico,estoque_reservado,estoque_disponivel,estoque_minimo,curva,lead_time_dias,cobertura_dias,qtd_pendente,comprado,proxima_previsao,pedidos,sugestao_bruta,sugestao_compra,multiplo_compra,lote_minimo,lote_confirmado,sugerido_multiplo,sugerido_lote_minimo,historico_total_pedidos,historico_moda_frequencia,lote_pendente_revisao,estoque_atualizado_em,giro_calculado_em",
      )
      .order("descricao", { ascending: true })
      .range(from, to),
  );

  const items: OmiePurchaseSuggestionItem[] = rows.map((row) => ({
    codigo: row.codigo,
    descricao: row.descricao,
    unidade: row.unidade ?? null,
    estoqueFisico: row.estoque_fisico,
    estoqueReservado: row.estoque_reservado,
    estoqueDisponivel: row.estoque_disponivel,
    estoqueMinimo: row.estoque_minimo,
    curva: row.curva as "A" | "B" | "C" | "D",
    leadTimeDias: row.lead_time_dias ?? 0,
    coberturaDias: row.cobertura_dias ?? 90,
    qtdPendente: row.qtd_pendente,
    comprado: row.comprado,
    proximaPrevisao: row.proxima_previsao,
    pedidos: (row.pedidos ?? []) as OmiePurchaseOrderDetail[],
    sugestaoBruta: row.sugestao_bruta,
    sugestaoCompra: row.sugestao_compra,
    multiploCompra: row.multiplo_compra ?? null,
    loteMinimo: row.lote_minimo ?? null,
    loteConfirmado: row.lote_confirmado ?? false,
    sugeridoMultiplo: row.sugerido_multiplo ?? null,
    sugeridoLoteMinimo: row.sugerido_lote_minimo ?? null,
    historicoTotalPedidos: row.historico_total_pedidos ?? null,
    historicoModaFrequencia: row.historico_moda_frequencia ?? null,
    lotePendenteRevisao: row.lote_pendente_revisao ?? false,
    estoqueAtualizadoEm: row.estoque_atualizado_em,
    giroCalculadoEm: row.giro_calculado_em,
  }));

  const latestOf = (key: "estoqueAtualizadoEm" | "giroCalculadoEm") =>
    items.reduce<string | null>((latest, row) => {
      const value = row[key];
      if (!value) return latest;
      if (!latest || value > latest) return value;
      return latest;
    }, null);

  return { items, lastSyncedAt: latestOf("estoqueAtualizadoEm"), lastVelocitySyncedAt: latestOf("giroCalculadoEm") };
}

export interface SalvarLoteInput {
  codigo: string;
  multiploCompra: number | null;
  loteMinimo: number | null;
  updatedBy?: string;
  updatedByName?: string;
}

/** Comprador revisa/ajusta e confirma o lote mínimo/múltiplo do produto.
 *  Só após confirmar a view passa a aplicar o lote na sugestão de compra. */
export async function salvarLoteConfigClient(input: SalvarLoteInput) {
  const { error } = await supabaseBrowser.from("omie_purchase_lot_config").upsert(
    {
      codigo: input.codigo,
      multiplo_compra: input.multiploCompra,
      lote_minimo: input.loteMinimo,
      confirmado: true,
      updated_by: input.updatedBy ?? null,
      updated_by_name: input.updatedByName ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "codigo" },
  );
  if (error) throw new Error(error.message);
}

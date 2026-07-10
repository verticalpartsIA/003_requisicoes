import { validateOmieOrder, validateOmieProduct, listOmieActiveStock, getOmieStockPosition } from "@/features/omie/api";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { OmieStockItem } from "@/features/omie/api";

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

export interface OmieStockCacheResult {
  items: OmieStockItem[];
  lastSyncedAt: string | null;
}

export async function listOmieStockFromCacheClient(): Promise<OmieStockCacheResult> {
  const { data, error } = await supabaseBrowser
    .from("omie_stock_cache")
    .select("codigo,descricao,estoque_fisico,estoque_reservado,estoque_disponivel,estoque_minimo,updated_at")
    .order("descricao", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
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
  lotePendenteRevisao: boolean;
  estoqueAtualizadoEm: string | null;
  giroCalculadoEm: string | null;
}

export interface OmiePurchaseSuggestionsResult {
  items: OmiePurchaseSuggestionItem[];
  lastSyncedAt: string | null;
  lastVelocitySyncedAt: string | null;
}

export async function listOmiePurchaseSuggestionsClient(): Promise<OmiePurchaseSuggestionsResult> {
  const { data, error } = await supabaseBrowser
    .from("omie_purchase_suggestions")
    .select(
      "codigo,descricao,unidade,estoque_fisico,estoque_reservado,estoque_disponivel,estoque_minimo,curva,lead_time_dias,cobertura_dias,qtd_pendente,comprado,proxima_previsao,pedidos,sugestao_bruta,sugestao_compra,multiplo_compra,lote_minimo,lote_confirmado,sugerido_multiplo,sugerido_lote_minimo,lote_pendente_revisao,estoque_atualizado_em,giro_calculado_em",
    )
    .order("descricao", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
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

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
  estoqueFisico: number;
  estoqueReservado: number;
  estoqueDisponivel: number;
  estoqueMinimo: number;
  curva: "A" | "B" | "C" | "D";
  qtdPendente: number;
  comprado: number;
  proximaPrevisao: string | null;
  pedidos: OmiePurchaseOrderDetail[];
  sugestaoCompra: number;
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
      "codigo,descricao,estoque_fisico,estoque_reservado,estoque_disponivel,estoque_minimo,curva,qtd_pendente,comprado,proxima_previsao,pedidos,sugestao_compra,estoque_atualizado_em,giro_calculado_em",
    )
    .order("descricao", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const items: OmiePurchaseSuggestionItem[] = rows.map((row) => ({
    codigo: row.codigo,
    descricao: row.descricao,
    estoqueFisico: row.estoque_fisico,
    estoqueReservado: row.estoque_reservado,
    estoqueDisponivel: row.estoque_disponivel,
    estoqueMinimo: row.estoque_minimo,
    curva: row.curva as "A" | "B" | "C" | "D",
    qtdPendente: row.qtd_pendente,
    comprado: row.comprado,
    proximaPrevisao: row.proxima_previsao,
    pedidos: (row.pedidos ?? []) as OmiePurchaseOrderDetail[],
    sugestaoCompra: row.sugestao_compra,
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

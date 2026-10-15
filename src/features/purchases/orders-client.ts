import { supabaseBrowser } from "@/lib/supabase-browser";
import { toRpcOrders, type DraftOrder } from "@/features/purchases/allocation";

/**
 * A tela de Compra só oferece pedidos por fornecedor quando a migração 039
 * já foi aplicada; antes disso mantém o formulário antigo. Qualquer erro na
 * sondagem (tabela inexistente, sem permissão, rede) conta como "indisponível".
 */
export async function purchaseOrdersAvailableClient(): Promise<boolean> {
  const { error } = await supabaseBrowser.from("purchase_orders").select("id").limit(1);
  return !error;
}

export async function confirmPurchaseOrdersClient(input: {
  requisitionId: string;
  approvalId: string;
  orders: DraftOrder[];
  requiresReceipt: boolean;
}) {
  const { error } = await supabaseBrowser.rpc("confirm_purchase_orders", {
    p_requisition_id: input.requisitionId,
    p_approval_id: input.approvalId,
    p_orders: toRpcOrders(input.orders),
    p_requires_receipt: input.requiresReceipt,
  });
  // O RAISE EXCEPTION do banco já vem em português; repassa como está.
  if (error) throw new Error(error.message);
}

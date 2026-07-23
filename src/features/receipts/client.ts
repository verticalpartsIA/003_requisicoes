import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PendingReceiptItem } from "@/features/receipts/api";

function getCategory(module: string) {
  switch (module) {
    case "M1": return "produto";
    case "M2": return "viagem";
    case "M3": return "serviço";
    case "M4": return "manutenção";
    case "M5": return "frete";
    default: return "locação";
  }
}

export async function listPendingReceiptsClient() {
  const { data: requisitions, error: requisitionsError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,title,requester_name,module,status")
    .eq("status", "RECEBIMENTO")
    .order("updated_at", { ascending: true });
  if (requisitionsError) throw requisitionsError;
  if (!requisitions?.length) return [] satisfies PendingReceiptItem[];

  const requisitionIds = requisitions.map((item) => item.id);
  const { data: purchases, error: purchasesError } = await supabaseBrowser
    .from("purchases")
    .select("id,requisition_id,supplier_name,purchased_at,purchase_order_number,invoice_number")
    .in("requisition_id", requisitionIds);
  if (purchasesError) throw purchasesError;

  const purchaseByRequisition = new Map((purchases || []).map((purchase) => [purchase.requisition_id, purchase]));

  return requisitions
    .map((requisition) => {
      const purchase = purchaseByRequisition.get(requisition.id);
      if (!purchase) return null;

      return {
        receiptId: null,
        requisitionId: requisition.id,
        purchaseId: purchase.id,
        id: requisition.ticket_number,
        requisition: requisition.ticket_number,
        description: requisition.title,
        supplier: purchase.supplier_name,
        requester: requisition.requester_name,
        category: getCategory(requisition.module),
        moduleCode: requisition.module,
        purchaseDate: purchase.purchased_at ? new Date(purchase.purchased_at).toLocaleDateString("pt-BR") : "—",
        purchaseOrderNumber: purchase.purchase_order_number,
        invoiceNumber: purchase.invoice_number,
      };
    })
    .filter(Boolean) as PendingReceiptItem[];
}

export async function registerReceiptClient(input: {
  requisitionId: string;
  purchaseId: string;
  delivererName?: string;
  carrierCompany?: string;
  condition: "ok" | "damaged" | "mismatch";
  notes?: string;
}) {
  if ((input.condition === "damaged" || input.condition === "mismatch") && !input.notes?.trim()) {
    throw new Error("Descreva o problema ou divergência antes de finalizar.");
  }

  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", input.requisitionId)
    .single();
  if (requisitionError) throw requisitionError;

  const { error: receiptError } = await supabaseBrowser.from("receipts").upsert({
    requisition_id: input.requisitionId,
    purchase_id: input.purchaseId,
    deliverer_name: input.delivererName || null,
    carrier_company: input.carrierCompany || null,
    condition: input.condition,
    notes: input.notes || null,
    received_at: new Date().toISOString(),
  });
  if (receiptError) throw receiptError;

  const nextStatus = input.condition === "ok" ? "CONCLUÍDO" : "COMPRA";
  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({
      status: nextStatus,
      completed_at: input.condition === "ok" ? new Date().toISOString() : null,
    })
    .eq("id", input.requisitionId);
  if (requisitionUpdateError) throw requisitionUpdateError;

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: input.requisitionId,
    ticket_number: requisition.ticket_number,
    action: "RECEIPT_REGISTERED",
    old_status: requisition.status,
    new_status: nextStatus,
    details: {
      condition: input.condition,
      deliverer_name: input.delivererName || null,
      carrier_company: input.carrierCompany || null,
      notes: input.notes || null,
    },
  });
  if (logError) console.warn("[audit_logs] failed:", logError.message);

  return {
    condition: input.condition,
    redirectedToPurchase: input.condition !== "ok",
  };
}

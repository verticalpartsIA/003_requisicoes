import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";

type ReceiptCondition = "ok" | "damaged" | "mismatch";

interface RequisitionRow {
  id: string;
  ticket_number: string;
  title: string;
  requester_name: string;
  module: string;
  status: string;
}

interface PurchaseRow {
  id: string;
  requisition_id: string;
  supplier_name: string;
  purchased_at: string | null;
  purchase_order_number: string | null;
  invoice_number: string | null;
}

interface ReceiptRow {
  id: string;
  requisition_id: string;
  condition: "ok" | "damaged" | "mismatch";
}

export interface PendingReceiptItem {
  receiptId: string | null;
  requisitionId: string;
  purchaseId: string;
  id: string;
  requisition: string;
  description: string;
  supplier: string;
  requester: string;
  category: string;
  moduleCode: string;
  purchaseDate: string;
  purchaseOrderNumber: string | null;
  invoiceNumber: string | null;
}

const registerReceiptSchema = z.object({
  requisitionId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  delivererName: z.string().trim().optional(),
  carrierCompany: z.string().trim().optional(),
  condition: z.enum(["ok", "damaged", "mismatch"]),
  notes: z.string().trim().optional(),
});

function getCategory(module: string) {
  switch (module) {
    case "M1":
      return "produto";
    case "M2":
      return "viagem";
    case "M3":
      return "serviço";
    case "M4":
      return "manutenção";
    case "M5":
      return "frete";
    default:
      return "locação";
  }
}

function logReceiptEvent(
  requisitionId: string,
  ticketNumber: string,
  action: string,
  oldStatus: string,
  newStatus: string,
  details: Record<string, unknown>,
) {
  return supabaseRest("audit_logs", {
    method: "POST",
    body: [
      {
        requisition_id: requisitionId,
        ticket_number: ticketNumber,
        action,
        old_status: oldStatus,
        new_status: newStatus,
        details,
      },
    ],
  });
}

export const listPendingReceipts = createServerFn({ method: "GET" }).handler(async () => {
  const requisitionsResponse = await supabaseRest<RequisitionRow[]>(
    "requisitions?select=id,ticket_number,title,requester_name,module,status&status=eq.RECEBIMENTO&order=updated_at.asc",
  );

  const requisitions = requisitionsResponse.data;

  if (requisitions.length === 0) {
    return [] satisfies PendingReceiptItem[];
  }

  const requisitionIds = requisitions.map((item) => item.id);
  const purchasesResponse = await supabaseRest<PurchaseRow[]>(
    `purchases?select=id,requisition_id,supplier_name,purchased_at,purchase_order_number,invoice_number&requisition_id=in.(${requisitionIds.join(",")})`,
  );
  const receiptsResponse = await supabaseRest<ReceiptRow[]>(
    `receipts?select=id,requisition_id,condition&requisition_id=in.(${requisitionIds.join(",")})`,
  );

  const purchaseByRequisition = new Map(
    purchasesResponse.data.map((purchase) => [purchase.requisition_id, purchase]),
  );
  const receiptByRequisition = new Map(
    receiptsResponse.data.map((receipt) => [receipt.requisition_id, receipt]),
  );

  return requisitions
    .map((requisition) => {
      const purchase = purchaseByRequisition.get(requisition.id);

      if (!purchase) return null;

      return {
        receiptId: receiptByRequisition.get(requisition.id)?.id || null,
        requisitionId: requisition.id,
        purchaseId: purchase.id,
        id: requisition.ticket_number,
        requisition: requisition.ticket_number,
        description: requisition.title,
        supplier: purchase.supplier_name,
        requester: requisition.requester_name,
        category: getCategory(requisition.module),
        moduleCode: requisition.module,
        purchaseDate: purchase.purchased_at
          ? new Date(purchase.purchased_at).toLocaleDateString("pt-BR")
          : "—",
        purchaseOrderNumber: purchase.purchase_order_number,
        invoiceNumber: purchase.invoice_number,
      };
    })
    .filter(Boolean) as PendingReceiptItem[];
});

export const registerReceipt = createServerFn({ method: "POST" })
  .inputValidator(registerReceiptSchema)
  .handler(async ({ data }) => {
    if ((data.condition === "damaged" || data.condition === "mismatch") && !data.notes?.trim()) {
      throw new Error("Descreva o problema ou divergência antes de finalizar.");
    }

    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number,status&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada para recebimento.");
    }

    await supabaseRest("receipts?on_conflict=requisition_id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
      body: [
        {
          requisition_id: data.requisitionId,
          purchase_id: data.purchaseId,
          deliverer_name: data.delivererName || null,
          carrier_company: data.carrierCompany || null,
          condition: data.condition,
          notes: data.notes || null,
          received_at: new Date().toISOString(),
        },
      ],
    });

    const nextStatus = data.condition === "ok" ? "CONCLUÍDO" : "COMPRA";

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: nextStatus,
        completed_at: data.condition === "ok" ? new Date().toISOString() : null,
      },
    });

    await logReceiptEvent(
      data.requisitionId,
      requisition.ticket_number,
      "RECEIPT_REGISTERED",
      requisition.status,
      nextStatus,
      {
        condition: data.condition,
        deliverer_name: data.delivererName || null,
        carrier_company: data.carrierCompany || null,
        notes: data.notes || null,
      },
    );

    return {
      success: true,
      condition: data.condition as ReceiptCondition,
      redirectedToPurchase: data.condition !== "ok",
    };
  });

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PurchaseItem, PurchaseTravelItem } from "@/features/purchases/api";

function getCategory(module: string): PurchaseItem["category"] {
  switch (module) {
    case "M1": return "produto";
    case "M2": return "viagem";
    case "M3": return "servico";
    case "M4": return "manutencao";
    case "M5": return "frete";
    default: return "locacao";
  }
}

function getModuleLabel(module: string) {
  switch (module) {
    case "M1": return "M1 — Produtos";
    case "M2": return "M2 — Viagens";
    case "M3": return "M3 — Serviços";
    case "M4": return "M4 — Manutenção";
    case "M5": return "M5 — Frete";
    default: return "M6 — Locação";
  }
}

export async function listPendingPurchasesClient() {
  const { data: approvals, error: approvalsError } = await supabaseBrowser
    .from("approvals")
    .select("id,requisition_id,quotation_id,approval_level,total_value,decided_at")
    .eq("decision", "approved")
    .order("decided_at", { ascending: true });
  if (approvalsError) throw approvalsError;
  if (!approvals?.length) return [] satisfies PurchaseItem[];

  const requisitionIds = approvals.map((item) => item.requisition_id);
  const { data: requisitions, error: requisitionsError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,module,title,justification,requester_name,status")
    .in("id", requisitionIds)
    .eq("status", "COMPRA");
  if (requisitionsError) throw requisitionsError;

  const quotationIds = approvals.map((item) => item.quotation_id).filter(Boolean) as string[];
  const { data: quotations, error: quotationsError } = quotationIds.length === 0
    ? { data: [], error: null }
    : await supabaseBrowser.from("quotations").select("id,requisition_id,win_criteria").in("id", quotationIds);
  if (quotationsError) throw quotationsError;

  const { data: suppliers, error: suppliersError } = quotationIds.length === 0
    ? { data: [], error: null }
    : await supabaseBrowser
        .from("quotation_suppliers")
        .select("quotation_id,supplier_name,price,deadline,notes,is_winner")
        .in("quotation_id", quotationIds);
  if (suppliersError) throw suppliersError;

  const requisitionById = new Map((requisitions || []).map((item) => [item.id, item]));
  const quotationByRequisition = new Map((quotations || []).map((item) => [item.requisition_id, item]));
  const suppliersByQuotation = new Map<string, typeof suppliers>();

  (suppliers || []).forEach((supplier) => {
    const current = suppliersByQuotation.get(supplier.quotation_id) || [];
    current.push(supplier);
    suppliersByQuotation.set(supplier.quotation_id, current);
  });

  // Fetch approved approval_items for M2 approvals
  const m2ApprovalIds = approvals
    .filter((a) => (requisitionById.get(a.requisition_id))?.module === "M2")
    .map((a) => a.id);

  const approvedTravelItemsByApproval = new Map<string, PurchaseTravelItem[]>();
  if (m2ApprovalIds.length > 0) {
    const { data: approvalItemRows } = await supabaseBrowser
      .from("approval_items")
      .select("id,approval_id,item_id,item_type,supplier_name,price")
      .in("approval_id", m2ApprovalIds)
      .eq("decision", "approved");

    (approvalItemRows || []).forEach((row) => {
      const item: PurchaseTravelItem = {
        approvalItemId: row.id,
        itemId: row.item_id,
        itemType: row.item_type as PurchaseTravelItem["itemType"],
        supplierName: row.supplier_name || "",
        price: row.price || 0,
      };
      const current = approvedTravelItemsByApproval.get(row.approval_id) || [];
      current.push(item);
      approvedTravelItemsByApproval.set(row.approval_id, current);
    });
  }

  return approvals
    .map((approval) => {
      const requisition = requisitionById.get(approval.requisition_id);
      if (!requisition) return null;
      const quotation = quotationByRequisition.get(requisition.id);
      const quotationSuppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];
      const isM2 = requisition.module === "M2";

      return {
        requisitionId: requisition.id,
        approvalId: approval.id,
        quotationId: quotation?.id || null,
        purchaseId: null,
        id: requisition.ticket_number,
        title: requisition.title,
        module: getModuleLabel(requisition.module),
        moduleCode: requisition.module,
        category: getCategory(requisition.module),
        requesterName: requisition.requester_name,
        requesterNotes: requisition.justification,
        totalValue: approval.total_value || 0,
        approvalLevel: approval.approval_level as 1 | 2 | 3,
        winCriteria: (quotation?.win_criteria as PurchaseItem["winCriteria"] | null) || "price",
        approvedBy: "Aprovador",
        approvedAt: approval.decided_at ? new Date(approval.decided_at).toLocaleString("pt-BR") : "Aprovado recentemente",
        suppliers: quotationSuppliers.map((supplier) => ({
          name: supplier.supplier_name,
          price: supplier.price || 0,
          deadline: supplier.deadline || "—",
          notes: supplier.notes || "",
          isWinner: supplier.is_winner,
        })),
        status: "pendente" as const,
        approvedTravelItems: isM2 ? (approvedTravelItemsByApproval.get(approval.id) || []) : undefined,
      };
    })
    .filter(Boolean) as PurchaseItem[];
}

export async function confirmPurchaseClient(input: {
  requisitionId: string;
  approvalId: string;
  supplierName: string;
  supplierPrice: number;
  purchaseOrderNumber: string;
  invoiceNumber?: string;
  paymentMethod?: string;
  notes?: string;
  requiresReceipt: boolean;
}) {
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", input.requisitionId)
    .single();
  if (requisitionError) throw requisitionError;

  const { error: purchaseError } = await supabaseBrowser.from("purchases").upsert(
    {
      requisition_id: input.requisitionId,
      approval_id: input.approvalId,
      supplier_name: input.supplierName,
      supplier_price: input.supplierPrice,
      purchase_order_number: input.purchaseOrderNumber,
      invoice_number: input.invoiceNumber || null,
      payment_method: input.paymentMethod || null,
      notes: input.notes || null,
      requires_receipt: input.requiresReceipt,
      purchased_at: new Date().toISOString(),
    },
    { onConflict: "requisition_id" },
  );
  if (purchaseError) throw purchaseError;

  const nextStatus = input.requiresReceipt ? "RECEBIMENTO" : "CONCLUÍDO";
  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({
      status: nextStatus,
      completed_at: input.requiresReceipt ? null : new Date().toISOString(),
    })
    .eq("id", input.requisitionId);
  if (requisitionUpdateError) throw requisitionUpdateError;

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: input.requisitionId,
    ticket_number: requisition.ticket_number,
    action: "PURCHASE_CONFIRMED",
    old_status: requisition.status,
    new_status: nextStatus,
    details: {
      supplier_name: input.supplierName,
      supplier_price: input.supplierPrice,
      purchase_order_number: input.purchaseOrderNumber,
      invoice_number: input.invoiceNumber || null,
      payment_method: input.paymentMethod || null,
      notes: input.notes || null,
      requires_receipt: input.requiresReceipt,
    },
  });
  if (logError) console.warn("[audit_logs] failed:", logError.message);
}

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { ApprovalRequestItem, ApprovalTravelItem } from "@/features/approvals/api";

type WinCriteria = "price" | "deadline" | "price_deadline";

function moduleLabel(module: string) {
  if (module === "M1") return "M1 — Produtos";
  if (module === "M2") return "M2 — Viagens";
  if (module === "M3") return "M3 — Serviços";
  if (module === "M4") return "M4 — Manutenção";
  if (module === "M5") return "M5 — Frete";
  return "M6 — Locação";
}

export async function listPendingApprovalsClient() {
  const currentUser = (await supabaseBrowser.auth.getUser()).data.user;
  const { data: roleRows, error: roleRowsError } = await supabaseBrowser
    .from("user_roles")
    .select("role,approval_tier")
    .eq("user_id", currentUser?.id || "");
  if (roleRowsError) throw roleRowsError;

  const hasAdminRole = (roleRows || []).some((item) => item.role === "admin");
  const maxApprovalTier = Math.max(
    0,
    ...(roleRows || [])
      .filter((item) => item.role === "aprovador")
      .map((item) => item.approval_tier || 0),
  );

  const { data: approvals, error: approvalsError } = await supabaseBrowser
    .from("approvals")
    .select("id,requisition_id,quotation_id,approval_level,total_value,decision")
    .eq("decision", "pending")
    .order("created_at", { ascending: true });
  if (approvalsError) throw approvalsError;
  const filteredApprovals = (approvals || []).filter((item) => hasAdminRole || item.approval_level <= maxApprovalTier);
  if (!filteredApprovals.length) return [] satisfies ApprovalRequestItem[];

  const requisitionIds = filteredApprovals.map((item) => item.requisition_id);
  const { data: requisitions, error: requisitionsError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,module,title,justification,requester_name,status,created_at")
    .in("id", requisitionIds)
    .eq("status", "APROVAÇÃO");
  if (requisitionsError) throw requisitionsError;

  const quotationIds = filteredApprovals.map((item) => item.quotation_id).filter(Boolean) as string[];
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

  // Aprovações por item: nasceu no M2 (voo/hotel/carro), estendido ao M1
  // multi-itens ('produto') para permitir cortar itens individualmente.
  const itemApprovalIds = filteredApprovals
    .filter((a) => {
      const mod = requisitionById.get(a.requisition_id)?.module;
      return mod === "M2" || mod === "M1";
    })
    .map((a) => a.id);

  const travelItemsByApproval = new Map<string, ApprovalTravelItem[]>();
  if (itemApprovalIds.length > 0) {
    const { data: approvalItemRows } = await supabaseBrowser
      .from("approval_items")
      .select("id,approval_id,item_id,item_type,supplier_name,price,decision,notes")
      .in("approval_id", itemApprovalIds);

    const requisitionItemIds = (approvalItemRows || []).map((row) => row.item_id);
    const requisitionItemById = new Map<string, { product_code: string | null; description: string | null; quantity: number | null }>();
    if (requisitionItemIds.length > 0) {
      const { data: requisitionItemRows } = await supabaseBrowser
        .from("requisition_items")
        .select("id,product_code,description,quantity")
        .in("id", requisitionItemIds);
      (requisitionItemRows || []).forEach((row) => requisitionItemById.set(row.id, row));
    }

    (approvalItemRows || []).forEach((row) => {
      const requisitionItem = requisitionItemById.get(row.item_id);
      const item: ApprovalTravelItem = {
        approvalItemId: row.id,
        itemId: row.item_id,
        itemType: row.item_type as ApprovalTravelItem["itemType"],
        productCode: requisitionItem?.product_code ?? null,
        quantity: requisitionItem?.quantity ?? null,
        description: requisitionItem?.description ?? null,
        supplierName: row.supplier_name || "",
        price: row.price || 0,
        decision: row.decision as ApprovalTravelItem["decision"],
        notes: row.notes || "",
      };
      const current = travelItemsByApproval.get(row.approval_id) || [];
      current.push(item);
      travelItemsByApproval.set(row.approval_id, current);
    });
  }

  return filteredApprovals
    .map((approval) => {
      const requisition = requisitionById.get(approval.requisition_id);
      if (!requisition) return null;
      const quotation = quotationByRequisition.get(requisition.id);
      const approvalSuppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];
      const hasItemApprovals = requisition.module === "M2" || requisition.module === "M1";

      return {
        requisitionId: requisition.id,
        approvalId: approval.id,
        quotationId: quotation?.id || null,
        id: requisition.ticket_number,
        title: requisition.title,
        module: moduleLabel(requisition.module),
        moduleCode: requisition.module,
        requesterName: requisition.requester_name,
        requesterNotes: requisition.justification,
        totalValue: approval.total_value || 0,
        approvalLevel: approval.approval_level as 1 | 2 | 3,
        winCriteria: (quotation?.win_criteria as WinCriteria | null) || "price",
        suppliers: approvalSuppliers.map((supplier) => ({
          name: supplier.supplier_name,
          price: supplier.price || 0,
          deadline: supplier.deadline || "—",
          notes: supplier.notes || "",
          isWinner: supplier.is_winner,
        })),
        createdAt: new Date(requisition.created_at).toLocaleDateString("pt-BR"),
        travelItems: hasItemApprovals && (travelItemsByApproval.get(approval.id) || []).length > 0
          ? travelItemsByApproval.get(approval.id)
          : undefined,
      };
    })
    .filter(Boolean) as ApprovalRequestItem[];
}

export async function approveRequisitionClient(approvalId: string, requisitionId: string, justification: string) {
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw requisitionError;

  const { error: approvalError } = await supabaseBrowser
    .from("approvals")
    .update({
      decision: "approved",
      justification: justification || null,
      decided_at: new Date().toISOString(),
      approver_id: (await supabaseBrowser.auth.getUser()).data.user?.id ?? null,
    })
    .eq("id", approvalId);
  if (approvalError) throw approvalError;

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "COMPRA" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw requisitionUpdateError;

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "APPROVAL_GRANTED",
    old_status: requisition.status,
    new_status: "COMPRA",
    details: { justification },
  });
  if (logError) console.warn("[audit_logs] failed:", logError.message);
}

export async function rejectRequisitionClient(approvalId: string, requisitionId: string, justification: string) {
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw requisitionError;

  const { error: approvalError } = await supabaseBrowser
    .from("approvals")
    .update({
      decision: "rejected",
      justification: justification || null,
      decided_at: new Date().toISOString(),
      approver_id: (await supabaseBrowser.auth.getUser()).data.user?.id ?? null,
    })
    .eq("id", approvalId);
  if (approvalError) throw approvalError;

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "REJEITADO" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw requisitionUpdateError;

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "APPROVAL_REJECTED",
    old_status: requisition.status,
    new_status: "REJEITADO",
    details: { justification },
  });
  if (logError) console.warn("[audit_logs] failed:", logError.message);
}

export async function decideItemsClient(
  approvalId: string,
  requisitionId: string,
  decisions: { approvalItemId: string; itemId: string; decision: 'approved' | 'rejected'; notes: string }[],
) {
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw requisitionError;

  const decidedAt = new Date().toISOString();

  for (const d of decisions) {
    const { error } = await supabaseBrowser
      .from("approval_items")
      .update({ decision: d.decision, notes: d.notes || null, decided_at: decidedAt })
      .eq("id", d.approvalItemId);
    if (error) throw error;
  }

  const approvedIds = decisions.filter((d) => d.decision === "approved").map((d) => d.itemId);
  const rejectedIds = decisions.filter((d) => d.decision === "rejected").map((d) => d.itemId);

  if (approvedIds.length > 0) {
    await supabaseBrowser.from("requisition_items").update({ status: "approved" }).in("id", approvedIds);
  }
  if (rejectedIds.length > 0) {
    await supabaseBrowser.from("requisition_items").update({ status: "rejected" }).in("id", rejectedIds);
  }

  const allRejected = decisions.every((d) => d.decision === "rejected");
  const overallDecision = allRejected ? "rejected" : "approved";
  const nextStatus = allRejected ? "REJEITADO" : "COMPRA";
  const approverId = (await supabaseBrowser.auth.getUser()).data.user?.id ?? null;

  const { error: approvalError } = await supabaseBrowser
    .from("approvals")
    .update({ decision: overallDecision, decided_at: decidedAt, approver_id: approverId })
    .eq("id", approvalId);
  if (approvalError) throw approvalError;

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: nextStatus })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw requisitionUpdateError;

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: allRejected ? "APPROVAL_REJECTED" : "APPROVAL_GRANTED",
    old_status: requisition.status,
    new_status: nextStatus,
    details: {
      decisions: decisions.map((d) => ({ item_id: d.itemId, decision: d.decision })),
      approved_count: approvedIds.length,
      rejected_count: rejectedIds.length,
    },
  });
  if (logError) console.warn("[audit_logs] decideItemsClient failed:", logError.message);
}

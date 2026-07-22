import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";

type WinCriteria = "price" | "deadline" | "price_deadline";

interface ApprovalRow {
  id: string;
  requisition_id: string;
  quotation_id: string | null;
  approval_level: 1 | 2 | 3;
  total_value: number | null;
  decision: "pending" | "approved" | "rejected";
}

interface RequisitionRow {
  id: string;
  ticket_number: string;
  module: string;
  title: string;
  justification: string;
  requester_name: string;
  status: string;
  created_at: string;
}

interface QuotationRow {
  id: string;
  requisition_id: string;
  win_criteria: WinCriteria | null;
}

interface SupplierRow {
  id: string;
  quotation_id: string;
  supplier_name: string;
  price: number | null;
  deadline: string | null;
  notes: string | null;
  is_winner: boolean;
}

interface ApprovalSupplierQuote {
  name: string;
  price: number;
  deadline: string;
  notes: string;
  isWinner: boolean;
}

export interface ApprovalTravelItem {
  approvalItemId: string;
  itemId: string;
  itemType: 'voo' | 'hotel' | 'carro' | 'produto';
  productCode?: string | null;
  quantity?: number | null;
  description?: string | null;
  supplierName: string;
  price: number;
  decision: 'pending' | 'approved' | 'rejected';
  notes: string;
}

export interface ApprovalRequestItem {
  requisitionId: string;
  approvalId: string;
  quotationId: string | null;
  id: string;
  title: string;
  module: string;
  moduleCode?: string;
  requesterName: string;
  requesterNotes: string;
  totalValue: number;
  approvalLevel: 1 | 2 | 3;
  winCriteria: WinCriteria;
  suppliers: ApprovalSupplierQuote[];
  createdAt: string;
  travelItems?: ApprovalTravelItem[];
}

const decisionSchema = z.object({
  approvalId: z.string().uuid(),
  requisitionId: z.string().uuid(),
  justification: z.string().max(1000),
});

function mapApprovalRequest(
  requisition: RequisitionRow,
  approval: ApprovalRow,
  quotationByRequisition: Map<string, QuotationRow>,
  suppliersByQuotation: Map<string, SupplierRow[]>,
): ApprovalRequestItem {
  const quotation = quotationByRequisition.get(requisition.id);
  const suppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];

  return {
    requisitionId: requisition.id,
    approvalId: approval.id,
    quotationId: quotation?.id || null,
    id: requisition.ticket_number,
    title: requisition.title,
    module: `${requisition.module} — ${
      requisition.module === "M1" ? "Produtos"
      : requisition.module === "M2" ? "Viagens"
      : requisition.module === "M3" ? "Serviços"
      : requisition.module === "M4" ? "Manutenção"
      : requisition.module === "M5" ? "Frete"
      : "Locação"
    }`,
    moduleCode: requisition.module,
    requesterName: requisition.requester_name,
    requesterNotes: requisition.justification,
    totalValue: approval.total_value || 0,
    approvalLevel: approval.approval_level,
    winCriteria: quotation?.win_criteria || "price",
    suppliers: suppliers.map((supplier) => ({
      name: supplier.supplier_name,
      price: supplier.price || 0,
      deadline: supplier.deadline || "—",
      notes: supplier.notes || "",
      isWinner: supplier.is_winner,
    })),
    createdAt: new Date(requisition.created_at).toLocaleDateString("pt-BR"),
  };
}

async function logApprovalEvent(
  requisitionId: string,
  ticketNumber: string,
  action: string,
  oldStatus: string,
  newStatus: string,
  justification: string,
) {
  await supabaseRest("audit_logs", {
    method: "POST",
    body: [
      {
        requisition_id: requisitionId,
        ticket_number: ticketNumber,
        action,
        old_status: oldStatus,
        new_status: newStatus,
        details: {
          justification,
        },
      },
    ],
  });
}

export const listPendingApprovals = createServerFn({ method: "GET" }).handler(async () => {
  const approvalsResponse = await supabaseRest<ApprovalRow[]>(
    "approvals?select=id,requisition_id,quotation_id,approval_level,total_value,decision&decision=eq.pending&order=created_at.asc",
  );

  const approvals = approvalsResponse.data;

  if (approvals.length === 0) {
    return [] satisfies ApprovalRequestItem[];
  }

  const requisitionIds = approvals.map((item) => item.requisition_id);
  const requisitionsResponse = await supabaseRest<RequisitionRow[]>(
    `requisitions?select=id,ticket_number,module,title,justification,requester_name,status,created_at&id=in.(${requisitionIds.join(",")})&status=eq.APROVAÇÃO`,
  );
  const requisitions = requisitionsResponse.data;
  const quotationIds = approvals.map((item) => item.quotation_id).filter(Boolean) as string[];
  const quotationsResponse = quotationIds.length === 0
    ? { data: [] as QuotationRow[] }
    : await supabaseRest<QuotationRow[]>(
        `quotations?select=id,requisition_id,win_criteria&id=in.(${quotationIds.join(",")})`,
      );
  const suppliersResponse = quotationIds.length === 0
    ? { data: [] as SupplierRow[] }
    : await supabaseRest<SupplierRow[]>(
        `quotation_suppliers?select=id,quotation_id,supplier_name,price,deadline,notes,is_winner&` +
          `quotation_id=in.(${quotationIds.join(",")})`,
      );

  const requisitionById = new Map(requisitions.map((item) => [item.id, item]));
  const quotationByRequisition = new Map(
    quotationsResponse.data.map((quotation) => [quotation.requisition_id, quotation]),
  );
  const suppliersByQuotation = new Map<string, SupplierRow[]>();

  suppliersResponse.data.forEach((supplier) => {
    const current = suppliersByQuotation.get(supplier.quotation_id) || [];
    current.push(supplier);
    suppliersByQuotation.set(supplier.quotation_id, current);
  });

  return approvals
    .map((approval) => {
      const requisition = requisitionById.get(approval.requisition_id);
      return requisition
        ? mapApprovalRequest(requisition, approval, quotationByRequisition, suppliersByQuotation)
        : null;
    })
    .filter(Boolean) as ApprovalRequestItem[];
});

export const approveRequisition = createServerFn({ method: "POST" })
  .inputValidator(decisionSchema)
  .handler(async ({ data }) => {
    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number,status&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada para aprovação.");
    }

    await supabaseRest(`approvals?id=eq.${data.approvalId}`, {
      method: "PATCH",
      body: {
        decision: "approved",
        justification: data.justification || null,
        decided_at: new Date().toISOString(),
      },
    });

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: "COMPRA",
      },
    });

    await logApprovalEvent(
      data.requisitionId,
      requisition.ticket_number,
      "APPROVAL_GRANTED",
      requisition.status,
      "COMPRA",
      data.justification,
    );

    return { success: true };
  });

export const rejectRequisition = createServerFn({ method: "POST" })
  .inputValidator(decisionSchema)
  .handler(async ({ data }) => {
    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number,status&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada para reprovação.");
    }

    await supabaseRest(`approvals?id=eq.${data.approvalId}`, {
      method: "PATCH",
      body: {
        decision: "rejected",
        justification: data.justification || null,
        decided_at: new Date().toISOString(),
      },
    });

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: "REJEITADO",
      },
    });

    await logApprovalEvent(
      data.requisitionId,
      requisition.ticket_number,
      "APPROVAL_REJECTED",
      requisition.status,
      "REJEITADO",
      data.justification,
    );

    return { success: true };
  });

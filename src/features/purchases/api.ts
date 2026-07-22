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
  approver_id: string | null;
  decided_at: string | null;
}

interface RequisitionRow {
  id: string;
  ticket_number: string;
  module: string;
  title: string;
  justification: string;
  requester_name: string;
  status: string;
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

interface PurchaseRow {
  id: string;
  requisition_id: string;
  requires_receipt: boolean;
}

interface SupplierQuote {
  name: string;
  price: number;
  deadline: string;
  notes: string;
  isWinner: boolean;
}

export interface PurchaseTravelItem {
  approvalItemId: string;
  itemId: string;
  itemType: 'voo' | 'hotel' | 'carro' | 'produto';
  productCode?: string | null;
  quantity?: number | null;
  description?: string | null;
  supplierName: string;
  price: number;
}

export interface PurchaseItem {
  requisitionId: string;
  approvalId: string;
  quotationId: string | null;
  purchaseId: string | null;
  id: string;
  title: string;
  module: string;
  moduleCode?: string;
  category: "viagem" | "servico" | "frete" | "locacao" | "produto" | "manutencao";
  requesterName: string;
  requesterNotes: string;
  totalValue: number;
  approvalLevel: 1 | 2 | 3;
  winCriteria: WinCriteria;
  approvedBy: string;
  approvedAt: string;
  suppliers: SupplierQuote[];
  status: "pendente";
  approvedTravelItems?: PurchaseTravelItem[];
}

const confirmPurchaseSchema = z.object({
  requisitionId: z.string().uuid(),
  approvalId: z.string().uuid(),
  supplierName: z.string().min(1),
  supplierPrice: z.number().nonnegative(),
  purchaseOrderNumber: z.string().trim().min(1),
  invoiceNumber: z.string().trim().optional(),
  paymentMethod: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  requiresReceipt: z.boolean(),
});

function getCategory(module: string): PurchaseItem["category"] {
  switch (module) {
    case "M1":
      return "produto";
    case "M2":
      return "viagem";
    case "M3":
      return "servico";
    case "M4":
      return "manutencao";
    case "M5":
      return "frete";
    default:
      return "locacao";
  }
}

function getModuleLabel(module: string) {
  switch (module) {
    case "M1":
      return "M1 — Produtos";
    case "M2":
      return "M2 — Viagens";
    case "M3":
      return "M3 — Serviços";
    case "M4":
      return "M4 — Manutenção";
    case "M5":
      return "M5 — Frete";
    default:
      return "M6 — Locação";
  }
}

function mapPurchaseItem(
  requisition: RequisitionRow,
  approval: ApprovalRow,
  quotationByRequisition: Map<string, QuotationRow>,
  suppliersByQuotation: Map<string, SupplierRow[]>,
  purchaseByRequisition: Map<string, PurchaseRow>,
): PurchaseItem {
  const quotation = quotationByRequisition.get(requisition.id);
  const suppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];
  const purchase = purchaseByRequisition.get(requisition.id);

  return {
    requisitionId: requisition.id,
    approvalId: approval.id,
    quotationId: quotation?.id || null,
    purchaseId: purchase?.id || null,
    id: requisition.ticket_number,
    title: requisition.title,
    module: getModuleLabel(requisition.module),
    moduleCode: requisition.module,
    category: getCategory(requisition.module),
    requesterName: requisition.requester_name,
    requesterNotes: requisition.justification,
    totalValue: approval.total_value || 0,
    approvalLevel: approval.approval_level,
    winCriteria: quotation?.win_criteria || "price",
    approvedBy: "Aprovador",
    approvedAt: approval.decided_at
      ? new Date(approval.decided_at).toLocaleString("pt-BR")
      : "Aprovado recentemente",
    suppliers: suppliers.map((supplier) => ({
      name: supplier.supplier_name,
      price: supplier.price || 0,
      deadline: supplier.deadline || "—",
      notes: supplier.notes || "",
      isWinner: supplier.is_winner,
    })),
    status: "pendente",
  };
}

async function logPurchaseEvent(
  requisitionId: string,
  ticketNumber: string,
  action: string,
  oldStatus: string,
  newStatus: string,
  details: Record<string, unknown>,
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
        details,
      },
    ],
  });
}

export const listPendingPurchases = createServerFn({ method: "GET" }).handler(async () => {
  const approvalsResponse = await supabaseRest<ApprovalRow[]>(
    "approvals?select=id,requisition_id,quotation_id,approval_level,total_value,approver_id,decided_at&decision=eq.approved&order=decided_at.asc",
  );

  const approvals = approvalsResponse.data;

  if (approvals.length === 0) {
    return [] satisfies PurchaseItem[];
  }

  const requisitionIds = approvals.map((item) => item.requisition_id);
  const requisitionsResponse = await supabaseRest<RequisitionRow[]>(
    `requisitions?select=id,ticket_number,module,title,justification,requester_name,status&id=in.(${requisitionIds.join(",")})&status=eq.COMPRA`,
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
  const purchasesResponse = requisitionIds.length === 0
    ? { data: [] as PurchaseRow[] }
    : await supabaseRest<PurchaseRow[]>(
        `purchases?select=id,requisition_id,requires_receipt&requisition_id=in.(${requisitionIds.join(",")})`,
      );

  const requisitionById = new Map(requisitions.map((item) => [item.id, item]));
  const quotationByRequisition = new Map(
    quotationsResponse.data.map((quotation) => [quotation.requisition_id, quotation]),
  );
  const suppliersByQuotation = new Map<string, SupplierRow[]>();
  const purchaseByRequisition = new Map(
    purchasesResponse.data.map((purchase) => [purchase.requisition_id, purchase]),
  );

  suppliersResponse.data.forEach((supplier) => {
    const current = suppliersByQuotation.get(supplier.quotation_id) || [];
    current.push(supplier);
    suppliersByQuotation.set(supplier.quotation_id, current);
  });

  return approvals
    .map((approval) => {
      const requisition = requisitionById.get(approval.requisition_id);
      return requisition
        ? mapPurchaseItem(requisition, approval, quotationByRequisition, suppliersByQuotation, purchaseByRequisition)
        : null;
    })
    .filter(Boolean) as PurchaseItem[];
});

export const confirmPurchase = createServerFn({ method: "POST" })
  .inputValidator(confirmPurchaseSchema)
  .handler(async ({ data }) => {
    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number,status&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada para compra.");
    }

    await supabaseRest("purchases?on_conflict=requisition_id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
      body: [
        {
          requisition_id: data.requisitionId,
          approval_id: data.approvalId,
          supplier_name: data.supplierName,
          supplier_price: data.supplierPrice,
          purchase_order_number: data.purchaseOrderNumber,
          invoice_number: data.invoiceNumber || null,
          payment_method: data.paymentMethod || null,
          notes: data.notes || null,
          requires_receipt: data.requiresReceipt,
          purchased_at: new Date().toISOString(),
        },
      ],
    });

    const nextStatus = data.requiresReceipt ? "RECEBIMENTO" : "CONCLUÍDO";

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: nextStatus,
        completed_at: data.requiresReceipt ? null : new Date().toISOString(),
      },
    });

    await logPurchaseEvent(
      data.requisitionId,
      requisition.ticket_number,
      "PURCHASE_CONFIRMED",
      requisition.status,
      nextStatus,
      {
        supplier_name: data.supplierName,
        supplier_price: data.supplierPrice,
        purchase_order_number: data.purchaseOrderNumber,
        invoice_number: data.invoiceNumber || null,
        payment_method: data.paymentMethod || null,
        notes: data.notes || null,
        requires_receipt: data.requiresReceipt,
      },
    );

    return { success: true };
  });

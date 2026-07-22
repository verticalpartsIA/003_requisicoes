import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";
import { DEFAULT_TIER_THRESHOLDS, getApprovalLevelForValue, type TierThresholds } from "@/lib/approval";
import { parseBRLNumber } from "@/lib/number";

type WinCriteria = "price" | "deadline" | "price_deadline";
type QuotationStatus = "pending" | "quoting" | "awaiting_proposals" | "selecting_winner" | "completed";

interface RequisitionRow {
  id: string;
  ticket_number: string;
  module: string;
  title: string;
  justification: string;
  urgency: string;
  status: string;
}

interface QuotationRow {
  id: string;
  requisition_id: string;
  win_criteria: WinCriteria | null;
  status: QuotationStatus;
  winner_supplier_id: string | null;
}

interface SupplierRow {
  id: string;
  quotation_id: string;
  supplier_name: string;
  price: number | null;
  deadline: string | null;
  notes: string | null;
  proposal_received: boolean;
  is_winner: boolean;
}

/** Item cotável individualmente. Nasceu no M2 (voo/hotel/carro) e foi
 *  estendido ao M1 multi-itens ('produto') — cada produto pode ter seu
 *  próprio fornecedor/preço, permitindo fracionar a cotação. */
export interface TravelItem {
  id: string;
  itemType: 'voo' | 'hotel' | 'carro' | 'produto';
  description: string | null;
  status: string;
  sortOrder: number;
  productCode?: string | null;
  quantity?: number | null;
  supplierId?: string;
  supplierName?: string;
  supplierPrice?: string;
  supplierDeadline?: string;
  supplierNotes?: string;
}

export interface SupplierEntry {
  id?: string;
  name: string;
  price: string;
  deadline: string;
  notes: string;
  proposalReceived: boolean;
  isWinner?: boolean;
  itemId?: string;
}

export interface QuotationQueueItem {
  requisitionId: string;
  quotationId: string | null;
  ticketNumber: string;
  title: string;
  urgency: string;
  module: string;
  requesterNotes: string;
  status: QuotationStatus;
  suppliers: SupplierEntry[];
  winCriteria: WinCriteria;
  travelItems?: TravelItem[];
}

const supplierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  price: z.string(),
  deadline: z.string(),
  notes: z.string(),
  proposalReceived: z.boolean(),
});

const saveSuppliersSchema = z.object({
  requisitionId: z.string().uuid(),
  suppliers: z.array(supplierSchema).min(1).max(3),
});

const saveProposalsSchema = z.object({
  quotationId: z.string().uuid(),
  suppliers: z.array(supplierSchema).min(1).max(3),
});

const finalizeQuotationSchema = z.object({
  requisitionId: z.string().uuid(),
  quotationId: z.string().uuid(),
  supplierId: z.string().uuid(),
  winCriteria: z.enum(["price", "deadline", "price_deadline"]),
});

/** Limites de alçada configurados pelo Admin (tabela settings), com fallback
 *  nos padrões. Antes havia aqui uma cópia local com limites fixos (1500/3000)
 *  divergente do resto do sistema (1500/3500) — valores entre R$ 3.000,01 e
 *  R$ 3.500 eram encaminhados incorretamente para o Nível 3. */
async function fetchTierThresholds(): Promise<TierThresholds> {
  try {
    const response = await supabaseRest<{ key: string; value: string }[]>(
      "settings?select=key,value&key=in.(tier1_max,tier2_max)",
    );
    const map = Object.fromEntries(response.data.map((row) => [row.key, Number(row.value)]));
    return {
      tier1_max: Number.isFinite(map["tier1_max"]) ? map["tier1_max"] : DEFAULT_TIER_THRESHOLDS.tier1_max,
      tier2_max: Number.isFinite(map["tier2_max"]) ? map["tier2_max"] : DEFAULT_TIER_THRESHOLDS.tier2_max,
    };
  } catch {
    return DEFAULT_TIER_THRESHOLDS;
  }
}

function mapQuotationStatus(requisitionStatus: string, quotationStatus?: QuotationStatus | null): QuotationStatus {
  if (quotationStatus) return quotationStatus;
  if (requisitionStatus === "ABERTO") return "pending";
  if (requisitionStatus === "COTAÇÃO") return "quoting";
  return "completed";
}

function mapQueueItem(
  requisition: RequisitionRow,
  quotationByRequisition: Map<string, QuotationRow>,
  suppliersByQuotation: Map<string, SupplierRow[]>,
): QuotationQueueItem {
  const quotation = quotationByRequisition.get(requisition.id);
  const suppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];

  return {
    requisitionId: requisition.id,
    quotationId: quotation?.id || null,
    ticketNumber: requisition.ticket_number,
    title: requisition.title,
    urgency: requisition.urgency,
    module: requisition.module,
    requesterNotes: requisition.justification,
    status: mapQuotationStatus(requisition.status, quotation?.status || null),
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.supplier_name,
      price: supplier.price?.toString() || "",
      deadline: supplier.deadline || "",
      notes: supplier.notes || "",
      proposalReceived: supplier.proposal_received,
      isWinner: supplier.is_winner,
    })),
    winCriteria: quotation?.win_criteria || "price",
  };
}

async function ensureQuotation(requisitionId: string, status: QuotationStatus) {
  const existing = await supabaseRest<QuotationRow[]>(
    `quotations?select=id,requisition_id,win_criteria,status,winner_supplier_id&requisition_id=eq.${requisitionId}&limit=1`,
  );

  if (existing.data[0]) {
    const quotation = existing.data[0];

    await supabaseRest(`quotations?id=eq.${quotation.id}`, {
      method: "PATCH",
      body: {
        status,
        started_at: quotation.status === "pending" ? new Date().toISOString() : undefined,
      },
    });

    return quotation.id;
  }

  const created = await supabaseRest<QuotationRow[]>("quotations", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: [
      {
        requisition_id: requisitionId,
        status,
        started_at: new Date().toISOString(),
      },
    ],
  });

  const quotation = created.data[0];

  if (!quotation) {
    throw new Error("Não foi possível iniciar a cotação.");
  }

  return quotation.id;
}

async function syncSuppliers(quotationId: string, suppliers: SupplierEntry[]) {
  const existingResponse = await supabaseRest<SupplierRow[]>(
    `quotation_suppliers?select=id,quotation_id,supplier_name,price,deadline,notes,proposal_received,is_winner&` +
      `quotation_id=eq.${quotationId}`,
  );

  const existingIds = new Set(existingResponse.data.map((supplier) => supplier.id));
  const incomingIds = new Set(suppliers.map((supplier) => supplier.id).filter(Boolean) as string[]);
  const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));

  if (idsToDelete.length > 0) {
    await supabaseRest(
      `quotation_suppliers?id=in.(${idsToDelete.join(",")})`,
      {
        method: "DELETE",
      },
    );
  }

  const upsertPayload = suppliers.map((supplier) => ({
    id: supplier.id,
    quotation_id: quotationId,
    supplier_name: supplier.name.trim(),
    price: parseBRLNumber(supplier.price),
    deadline: supplier.deadline || null,
    notes: supplier.notes || null,
    proposal_received: supplier.proposalReceived,
    is_winner: false,
  }));

  const upsertResponse = await supabaseRest<SupplierRow[]>(
    "quotation_suppliers?on_conflict=id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: upsertPayload,
    },
  );

  return upsertResponse.data;
}

async function logQuotationEvent(requisitionId: string, ticketNumber: string, action: string, details: Record<string, unknown>) {
  await supabaseRest("audit_logs", {
    method: "POST",
    body: [
      {
        requisition_id: requisitionId,
        ticket_number: ticketNumber,
        action,
        details,
      },
    ],
  });
}

export const listQuotationQueue = createServerFn({ method: "GET" }).handler(async () => {
  const requisitionsResponse = await supabaseRest<RequisitionRow[]>(
    "requisitions?select=id,ticket_number,module,title,justification,urgency,status&status=in.(ABERTO,COTAÇÃO)&order=created_at.asc",
  );

  const requisitions = requisitionsResponse.data;

  if (requisitions.length === 0) {
    return [] satisfies QuotationQueueItem[];
  }

  const requisitionIds = requisitions.map((item) => item.id);
  const quotationsResponse = await supabaseRest<QuotationRow[]>(
    `quotations?select=id,requisition_id,win_criteria,status,winner_supplier_id&requisition_id=in.(${requisitionIds.join(",")})`,
  );
  const quotationIds = quotationsResponse.data.map((quotation) => quotation.id);
  const suppliersResponse = quotationIds.length === 0
    ? { data: [] as SupplierRow[] }
    : await supabaseRest<SupplierRow[]>(
        `quotation_suppliers?select=id,quotation_id,supplier_name,price,deadline,notes,proposal_received,is_winner&` +
          `quotation_id=in.(${quotationIds.join(",")})`,
      );

  const quotationByRequisition = new Map(
    quotationsResponse.data.map((quotation) => [quotation.requisition_id, quotation]),
  );
  const suppliersByQuotation = new Map<string, SupplierRow[]>();

  suppliersResponse.data.forEach((supplier) => {
    const current = suppliersByQuotation.get(supplier.quotation_id) || [];
    current.push(supplier);
    suppliersByQuotation.set(supplier.quotation_id, current);
  });

  return requisitions.map((item) => mapQueueItem(item, quotationByRequisition, suppliersByQuotation));
});

export const saveQuotationSuppliers = createServerFn({ method: "POST" })
  .inputValidator(saveSuppliersSchema)
  .handler(async ({ data }) => {
    const quotationId = await ensureQuotation(data.requisitionId, "awaiting_proposals");
    const savedSuppliers = await syncSuppliers(quotationId, data.suppliers);

    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number,status&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada para atualizar fornecedores.");
    }

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: "COTAÇÃO",
      },
    });

    await logQuotationEvent(data.requisitionId, requisition.ticket_number, "QUOTATION_STARTED", {
      suppliers_count: data.suppliers.length,
    });

    return {
      quotationId,
      suppliers: savedSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.supplier_name,
        price: supplier.price?.toString() || "",
        deadline: supplier.deadline || "",
        notes: supplier.notes || "",
        proposalReceived: supplier.proposal_received,
        isWinner: supplier.is_winner,
      })),
      status: "awaiting_proposals" as QuotationStatus,
    };
  });

export const saveQuotationProposals = createServerFn({ method: "POST" })
  .inputValidator(saveProposalsSchema)
  .handler(async ({ data }) => {
    const savedSuppliers = await syncSuppliers(data.quotationId, data.suppliers);
    await supabaseRest(`quotations?id=eq.${data.quotationId}`, {
      method: "PATCH",
      body: {
        status: "selecting_winner",
      },
    });

    return {
      success: true,
      suppliers: savedSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.supplier_name,
        price: supplier.price?.toString() || "",
        deadline: supplier.deadline || "",
        notes: supplier.notes || "",
        proposalReceived: supplier.proposal_received,
        isWinner: supplier.is_winner,
      })),
      status: "selecting_winner" as QuotationStatus,
    };
  });

export const finalizeQuotation = createServerFn({ method: "POST" })
  .inputValidator(finalizeQuotationSchema)
  .handler(async ({ data }) => {
    const suppliersResponse = await supabaseRest<SupplierRow[]>(
      `quotation_suppliers?select=id,quotation_id,supplier_name,price,deadline,notes,proposal_received,is_winner&` +
        `quotation_id=eq.${data.quotationId}`,
    );

    const winner = suppliersResponse.data.find((supplier) => supplier.id === data.supplierId);

    if (!winner || winner.price === null) {
      throw new Error("Fornecedor vencedor inválido para finalizar a cotação.");
    }

    await supabaseRest(`quotation_suppliers?quotation_id=eq.${data.quotationId}`, {
      method: "PATCH",
      body: {
        is_winner: false,
      },
    });

    await supabaseRest(`quotation_suppliers?id=eq.${data.supplierId}`, {
      method: "PATCH",
      body: {
        is_winner: true,
      },
    });

    await supabaseRest(`quotations?id=eq.${data.quotationId}`, {
      method: "PATCH",
      body: {
        winner_supplier_id: data.supplierId,
        win_criteria: data.winCriteria,
        status: "completed",
        completed_at: new Date().toISOString(),
      },
    });

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      body: {
        status: "APROVAÇÃO",
      },
    });

    const requisitionResponse = await supabaseRest<RequisitionRow[]>(
      `requisitions?select=id,ticket_number&id=eq.${data.requisitionId}&limit=1`,
    );
    const requisition = requisitionResponse.data[0];

    if (!requisition) {
      throw new Error("Requisição não encontrada ao finalizar a cotação.");
    }

    const approvalLevel = getApprovalLevelForValue(winner.price, await fetchTierThresholds());

    await supabaseRest(
      "approvals?on_conflict=requisition_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates",
        },
        body: [
          {
            requisition_id: data.requisitionId,
            quotation_id: data.quotationId,
            approval_level: approvalLevel,
            total_value: winner.price,
            decision: "pending",
          },
        ],
      },
    );

    await logQuotationEvent(data.requisitionId, requisition.ticket_number, "WINNER_SELECTED", {
      quotation_id: data.quotationId,
      supplier_id: data.supplierId,
      supplier_name: winner.supplier_name,
      total_value: winner.price,
      win_criteria: data.winCriteria,
    });

    await logQuotationEvent(data.requisitionId, requisition.ticket_number, "APPROVAL_REQUESTED", {
      approval_level: approvalLevel,
      total_value: winner.price,
    });

    return { success: true };
  });

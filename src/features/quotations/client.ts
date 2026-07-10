import { supabaseBrowser } from "@/lib/supabase-browser";
import type { QuotationQueueItem, SupplierEntry, TravelItem } from "@/features/quotations/api";
import { getApprovalLevelForValue } from "@/lib/approval";
import { parseBRLNumber } from "@/lib/number";
import { getTierThresholds } from "@/features/admin/api";
import { friendlySupabaseError } from "@/lib/supabase-error";

type WinCriteria = "price" | "deadline" | "price_deadline";
type QuotationStatus =
  | "pending"
  | "quoting"
  | "awaiting_proposals"
  | "selecting_winner"
  | "completed";

function mapQuotationStatus(
  requisitionStatus: string,
  quotationStatus?: QuotationStatus | null,
): QuotationStatus {
  if (quotationStatus) return quotationStatus;
  if (requisitionStatus === "ABERTO") return "pending";
  if (requisitionStatus === "COTAÇÃO") return "quoting";
  return "completed";
}

export async function listQuotationQueueClient() {
  const { data: requisitions, error: requisitionsError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,module,title,justification,urgency,status,module_data")
    .in("status", ["ABERTO", "COTAÇÃO"])
    .order("created_at", { ascending: true });

  if (requisitionsError) throw requisitionsError;
  if (!requisitions?.length) return [] satisfies QuotationQueueItem[];

  const requisitionIds = requisitions.map((item) => item.id);
  const { data: quotations, error: quotationsError } = await supabaseBrowser
    .from("quotations")
    .select("id,requisition_id,win_criteria,status,winner_supplier_id")
    .in("requisition_id", requisitionIds);

  if (quotationsError) throw quotationsError;

  const quotationIds = (quotations || []).map((quotation) => quotation.id);
  const { data: suppliers, error: suppliersError } =
    quotationIds.length === 0
      ? { data: [], error: null }
      : await supabaseBrowser
          .from("quotation_suppliers")
          .select("id,quotation_id,supplier_name,price,deadline,notes,proposal_received,is_winner")
          .in("quotation_id", quotationIds);

  if (suppliersError) throw new Error(friendlySupabaseError(suppliersError));

  const quotationByRequisition = new Map(
    (quotations || []).map((quotation) => [quotation.requisition_id, quotation]),
  );
  const suppliersByQuotation = new Map<
    string,
    Array<typeof suppliers extends Array<infer T> ? T : never>
  >();

  (suppliers || []).forEach((supplier) => {
    const current = suppliersByQuotation.get(supplier.quotation_id) || [];
    current.push(supplier);
    suppliersByQuotation.set(supplier.quotation_id, current);
  });

  // Fetch travel items for M2 requisitions (auto-create from module_data if missing)
  const m2Requisitions = requisitions.filter((r) => r.module === "M2");
  const m2RequisitionIds = m2Requisitions.map((r) => r.id);
  const travelItemsByRequisition = new Map<string, TravelItem[]>();

  if (m2RequisitionIds.length > 0) {
    const { data: fetchedItems } = await supabaseBrowser
      .from("requisition_items")
      .select("id,requisition_id,item_type,description,status,sort_order")
      .in("requisition_id", m2RequisitionIds)
      .order("sort_order", { ascending: true });

    const travelItemRows = [...(fetchedItems || [])];

    // Auto-heal: cria itens que ainda não existem, comparando tipo a tipo
    for (const req of m2Requisitions) {
      const md = (req.module_data as Record<string, unknown> | null) ?? {};
      const existingTypes = new Set(
        travelItemRows.filter((r) => r.requisition_id === req.id).map((r) => r.item_type),
      );
      const expected: { item_type: string; sort_order: number }[] = [
        { item_type: "voo", sort_order: 0 },
        ...(md.needs_hotel ? [{ item_type: "hotel", sort_order: 1 }] : []),
        ...(md.needs_local_car ? [{ item_type: "carro", sort_order: 2 }] : []),
      ];
      const toInsert = expected
        .filter((e) => !existingTypes.has(e.item_type))
        .map((e) => ({ requisition_id: req.id, ...e }));
      if (toInsert.length === 0) continue;
      const { data: inserted } = await supabaseBrowser
        .from("requisition_items")
        .insert(toInsert)
        .select("id,requisition_id,item_type,description,status,sort_order");
      if (inserted) travelItemRows.push(...inserted);
    }

    // Also fetch quotation_suppliers with item_id for M2
    const m2QuotationIds = (quotations || [])
      .filter((q) => m2RequisitionIds.includes(q.requisition_id))
      .map((q) => q.id);

    const m2SuppliersByItem = new Map<
      string,
      (typeof suppliers extends Array<infer T> ? T : never) & { item_id: string | null }
    >();
    if (m2QuotationIds.length > 0) {
      const { data: m2Suppliers } = await supabaseBrowser
        .from("quotation_suppliers")
        .select(
          "id,quotation_id,supplier_name,price,deadline,notes,proposal_received,item_id,is_winner",
        )
        .in("quotation_id", m2QuotationIds);

      (m2Suppliers || []).forEach((s) => {
        if (s.item_id) m2SuppliersByItem.set(s.item_id, s as typeof s & { item_id: string });
      });
    }

    (travelItemRows || []).forEach((row) => {
      const sup = m2SuppliersByItem.get(row.id);
      const item: TravelItem = {
        id: row.id,
        itemType: row.item_type as TravelItem["itemType"],
        description: row.description,
        status: row.status,
        sortOrder: row.sort_order,
        supplierId: sup?.id,
        supplierName: sup?.supplier_name,
        supplierPrice: sup?.price?.toString(),
        supplierDeadline: sup?.deadline ?? undefined,
        supplierNotes: sup?.notes ?? undefined,
      };
      const current = travelItemsByRequisition.get(row.requisition_id) || [];
      current.push(item);
      travelItemsByRequisition.set(row.requisition_id, current);
    });
  }

  return requisitions.map((requisition) => {
    const quotation = quotationByRequisition.get(requisition.id);
    const quotationSuppliers = quotation ? suppliersByQuotation.get(quotation.id) || [] : [];

    return {
      requisitionId: requisition.id,
      quotationId: quotation?.id || null,
      ticketNumber: requisition.ticket_number,
      title: requisition.title,
      urgency: requisition.urgency,
      module: requisition.module,
      requesterNotes: requisition.justification,
      status: mapQuotationStatus(requisition.status, quotation?.status as QuotationStatus | null),
      suppliers: quotationSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.supplier_name,
        price: supplier.price?.toString() || "",
        deadline: supplier.deadline || "",
        notes: supplier.notes || "",
        proposalReceived: supplier.proposal_received,
        isWinner: supplier.is_winner,
      })),
      winCriteria: (quotation?.win_criteria as WinCriteria | null) || "price",
      travelItems:
        requisition.module === "M2"
          ? travelItemsByRequisition.get(requisition.id) || []
          : undefined,
    };
  });
}

async function ensureQuotation(requisitionId: string, status: QuotationStatus) {
  const { data: existing, error: existingError } = await supabaseBrowser
    .from("quotations")
    .select("id,status")
    .eq("requisition_id", requisitionId)
    .maybeSingle();

  if (existingError) throw new Error(friendlySupabaseError(existingError));

  if (existing?.id) {
    const patch: Record<string, unknown> = { status };
    if (existing.status === "pending") patch.started_at = new Date().toISOString();

    const { error } = await supabaseBrowser.from("quotations").update(patch).eq("id", existing.id);
    if (error) throw new Error(friendlySupabaseError(error));
    return existing.id;
  }

  const { error } = await supabaseBrowser.from("quotations").insert({
    requisition_id: requisitionId,
    status,
    started_at: new Date().toISOString(),
  });

  if (error) throw new Error(friendlySupabaseError(error));

  // SELECT separado para não depender da policy de SELECT durante o INSERT
  const { data: created, error: fetchError } = await supabaseBrowser
    .from("quotations")
    .select("id")
    .eq("requisition_id", requisitionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) throw new Error(friendlySupabaseError(fetchError));
  return created!.id;
}

async function syncSuppliers(quotationId: string, suppliers: SupplierEntry[]) {
  const { data: existing, error: existingError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id")
    .eq("quotation_id", quotationId);

  if (existingError) throw new Error(friendlySupabaseError(existingError));

  const existingIds = new Set((existing || []).map((item) => item.id));
  const incomingIds = new Set(suppliers.map((supplier) => supplier.id).filter(Boolean) as string[]);
  const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));

  if (idsToDelete.length > 0) {
    const { error } = await supabaseBrowser
      .from("quotation_suppliers")
      .delete()
      .in("id", idsToDelete);
    if (error) throw new Error(friendlySupabaseError(error));
  }

  const payload = suppliers.map((supplier) => {
    const row: Record<string, unknown> = {
      quotation_id: quotationId,
      supplier_name: supplier.name.trim(),
      price: parseBRLNumber(supplier.price),
      deadline: supplier.deadline || null,
      notes: supplier.notes || null,
      proposal_received: supplier.proposalReceived,
      is_winner: supplier.isWinner ?? false,
    };
    // Só inclui id quando já existe (evita enviar null/undefined → violação NOT NULL)
    if (supplier.id) row.id = supplier.id;
    return row;
  });

  // Upsert sem SELECT para não depender de policy de SELECT encadeada
  const { error: upsertError } = await supabaseBrowser.from("quotation_suppliers").upsert(payload);

  if (upsertError) throw new Error(friendlySupabaseError(upsertError));

  // SELECT separado para buscar os fornecedores salvos com seus IDs
  const { data, error: fetchError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id,supplier_name,price,deadline,notes,proposal_received,is_winner")
    .eq("quotation_id", quotationId);

  if (fetchError) throw new Error(friendlySupabaseError(fetchError));
  return data || [];
}

export async function saveQuotationSuppliersClient(
  requisitionId: string,
  suppliers: SupplierEntry[],
) {
  const quotationId = await ensureQuotation(requisitionId, "awaiting_proposals");
  let savedSuppliers: Awaited<ReturnType<typeof syncSuppliers>>;
  try {
    savedSuppliers = await syncSuppliers(quotationId, suppliers);
  } catch (err) {
    // Rollback: volta status da cotação para "pending" para evitar registro órfão
    await supabaseBrowser.from("quotations").update({ status: "pending" }).eq("id", quotationId);
    throw err;
  }

  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw new Error(friendlySupabaseError(requisitionError));

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "COTAÇÃO" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw new Error(friendlySupabaseError(requisitionUpdateError));

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "QUOTATION_STARTED",
    old_status: "ABERTO",
    new_status: "COTAÇÃO",
    details: { suppliers_count: suppliers.length },
  });
  if (logError) console.warn("[audit_logs] QUOTATION_STARTED failed:", logError.message);

  return {
    quotationId,
    status: "awaiting_proposals" as QuotationStatus,
    suppliers: savedSuppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.supplier_name,
      price: supplier.price?.toString() || "",
      deadline: supplier.deadline || "",
      notes: supplier.notes || "",
      proposalReceived: supplier.proposal_received,
      isWinner: supplier.is_winner,
    })),
  };
}

export async function saveQuotationProposalsClient(
  quotationId: string,
  suppliers: SupplierEntry[],
) {
  const savedSuppliers = await syncSuppliers(quotationId, suppliers);
  const { error } = await supabaseBrowser
    .from("quotations")
    .update({ status: "selecting_winner" })
    .eq("id", quotationId);

  if (error) throw error;

  return {
    status: "selecting_winner" as QuotationStatus,
    suppliers: savedSuppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.supplier_name,
      price: supplier.price?.toString() || "",
      deadline: supplier.deadline || "",
      notes: supplier.notes || "",
      proposalReceived: supplier.proposal_received,
      isWinner: supplier.is_winner,
    })),
  };
}

export async function finalizeQuotationClient(
  requisitionId: string,
  quotationId: string,
  supplierId: string,
  winCriteria: WinCriteria,
) {
  const { data: suppliers, error: suppliersError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id,supplier_name,price")
    .eq("quotation_id", quotationId);
  if (suppliersError) throw new Error(friendlySupabaseError(suppliersError));

  const winner = (suppliers || []).find((supplier) => supplier.id === supplierId);
  if (!winner || winner.price === null) {
    throw new Error("Fornecedor vencedor inválido para finalizar a cotação.");
  }

  const thresholds = await getTierThresholds();
  const approvalLevel = getApprovalLevelForValue(winner.price, thresholds);

  const { error: resetError } = await supabaseBrowser
    .from("quotation_suppliers")
    .update({ is_winner: false })
    .eq("quotation_id", quotationId);
  if (resetError) throw new Error(friendlySupabaseError(resetError));

  const { error: winnerError } = await supabaseBrowser
    .from("quotation_suppliers")
    .update({ is_winner: true })
    .eq("id", supplierId);
  if (winnerError) throw new Error(friendlySupabaseError(winnerError));

  const { error: quotationError } = await supabaseBrowser
    .from("quotations")
    .update({
      winner_supplier_id: supplierId,
      win_criteria: winCriteria,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", quotationId);
  if (quotationError) throw new Error(friendlySupabaseError(quotationError));

  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw new Error(friendlySupabaseError(requisitionError));

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "APROVAÇÃO" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw new Error(friendlySupabaseError(requisitionUpdateError));

  // onConflict é obrigatório: requisition_id é UNIQUE em approvals e, sem ele,
  // re-finalizar a cotação (ex.: trocar o vencedor) viola a unicidade e trava
  // o fluxo — mesmo padrão já usado em saveM2QuoteClient e no server function.
  const { error: approvalError } = await supabaseBrowser
    .from("approvals")
    .upsert(
      {
        requisition_id: requisitionId,
        quotation_id: quotationId,
        approval_level: approvalLevel,
        total_value: winner.price,
        decision: "pending",
      },
      { onConflict: "requisition_id" },
    )
    .select("id");
  if (approvalError) throw new Error(friendlySupabaseError(approvalError));

  const { error: firstLogError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "WINNER_SELECTED",
    old_status: requisition.status,
    new_status: "APROVAÇÃO",
    details: {
      quotation_id: quotationId,
      supplier_id: supplierId,
      supplier_name: winner.supplier_name,
      total_value: winner.price,
      win_criteria: winCriteria,
    },
  });
  if (firstLogError) console.warn("[audit_logs] WINNER_SELECTED failed:", firstLogError.message);

  const { error: secondLogError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "APPROVAL_REQUESTED",
    old_status: requisition.status,
    new_status: "APROVAÇÃO",
    details: {
      approval_level: approvalLevel,
      total_value: winner.price,
    },
  });
  if (secondLogError)
    console.warn("[audit_logs] APPROVAL_REQUESTED failed:", secondLogError.message);
}

export interface M2ItemQuote {
  itemId: string;
  itemType: "voo" | "hotel" | "carro";
  supplierName: string;
  price: number;
  deadline: string;
  notes: string;
}

export async function saveM2QuoteClient(requisitionId: string, itemQuotes: M2ItemQuote[]) {
  // 1. Cria ou busca cotação
  const quotationId = await ensureQuotation(requisitionId, "completed");

  // 2. Upsert quotation_suppliers — um por item, já como vencedor
  const supplierPayload = itemQuotes.map((item) => ({
    quotation_id: quotationId,
    item_id: item.itemId,
    supplier_name: item.supplierName,
    price: item.price,
    deadline: item.deadline || null,
    notes: item.notes || null,
    proposal_received: true,
    is_winner: true,
  }));

  const { error: suppliersError } = await supabaseBrowser
    .from("quotation_suppliers")
    .upsert(supplierPayload, { onConflict: "quotation_id,item_id" });
  if (suppliersError) throw new Error(friendlySupabaseError(suppliersError));

  // 3. Total e nível de aprovação (respeita os limites configurados no Admin)
  const totalValue = itemQuotes.reduce((sum, item) => sum + item.price, 0);
  const approvalLevel = getApprovalLevelForValue(totalValue, await getTierThresholds());

  // 4. Upsert approval
  const { error: approvalUpsertError } = await supabaseBrowser.from("approvals").upsert(
    {
      requisition_id: requisitionId,
      quotation_id: quotationId,
      approval_level: approvalLevel,
      total_value: totalValue,
      decision: "pending",
    },
    { onConflict: "requisition_id" },
  );
  if (approvalUpsertError) throw new Error(friendlySupabaseError(approvalUpsertError));

  // 5. Busca o approval_id
  const { data: approvalRow, error: approvalFetchError } = await supabaseBrowser
    .from("approvals")
    .select("id")
    .eq("requisition_id", requisitionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (approvalFetchError) throw new Error(friendlySupabaseError(approvalFetchError));
  if (!approvalRow?.id) throw new Error("Não foi possível recuperar o ID de aprovação.");

  // 6. Upsert approval_items — um por item
  const approvalItemsPayload = itemQuotes.map((item) => ({
    approval_id: approvalRow.id,
    item_id: item.itemId,
    item_type: item.itemType,
    supplier_name: item.supplierName,
    price: item.price,
    decision: "pending",
  }));

  const { error: approvalItemsError } = await supabaseBrowser
    .from("approval_items")
    .upsert(approvalItemsPayload, { onConflict: "approval_id,item_id" });
  if (approvalItemsError) throw new Error(friendlySupabaseError(approvalItemsError));

  // 7. Atualiza status dos requisition_items para 'quoted'
  const itemIds = itemQuotes.map((item) => item.itemId);
  const { error: itemStatusError } = await supabaseBrowser
    .from("requisition_items")
    .update({ status: "quoted" })
    .in("id", itemIds);
  if (itemStatusError)
    console.warn("[requisition_items] status update failed:", itemStatusError.message);

  // 8. Atualiza requisição para APROVAÇÃO
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw new Error(friendlySupabaseError(requisitionError));

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "APROVAÇÃO" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw new Error(friendlySupabaseError(requisitionUpdateError));

  // 9. Audit log
  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "M2_QUOTE_COMPLETED",
    old_status: requisition.status,
    new_status: "APROVAÇÃO",
    details: {
      total_value: totalValue,
      approval_level: approvalLevel,
      items: itemQuotes.map((item) => ({
        item_type: item.itemType,
        supplier: item.supplierName,
        price: item.price,
      })),
    },
  });
  if (logError) console.warn("[audit_logs] M2_QUOTE_COMPLETED failed:", logError.message);
}

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { QuotationQueueItem, SupplierEntry, TravelItem } from "@/features/quotations/api";
import { getApprovalLevelForValue } from "@/lib/approval";
import { parseBRLNumber } from "@/lib/number";
import { getTierThresholds } from "@/features/admin/api";
import { friendlySupabaseError } from "@/lib/supabase-error";
import type { JsonValue } from "@/features/comando/types";

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

  // Itens cotáveis individualmente: M2 (voo/hotel/carro) e M1 multi-itens
  // ('produto' — cada produto do formulário vira um item com fornecedor
  // próprio, permitindo fracionar a cotação entre vários fornecedores).
  const m2Requisitions = requisitions.filter((r) => r.module === "M2");
  const m1MultiItens = (r: (typeof requisitions)[number]) => {
    const md = (r.module_data as Record<string, unknown> | null) ?? {};
    return Array.isArray(md.items) && md.items.length >= 2
      ? (md.items as Record<string, unknown>[])
      : null;
  };
  const m1Requisitions = requisitions.filter((r) => r.module === "M1" && m1MultiItens(r));
  const itemRequisitionIds = [...m2Requisitions, ...m1Requisitions].map((r) => r.id);
  const travelItemsByRequisition = new Map<string, TravelItem[]>();

  if (itemRequisitionIds.length > 0) {
    const { data: fetchedItems } = await supabaseBrowser
      .from("requisition_items")
      .select("id,requisition_id,item_type,description,status,sort_order,product_code,quantity")
      .in("requisition_id", itemRequisitionIds)
      .order("sort_order", { ascending: true });

    const travelItemRows = [...(fetchedItems || [])];

    // Auto-heal M2: cria itens que ainda não existem, comparando tipo a tipo
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
        .select("id,requisition_id,item_type,description,status,sort_order,product_code,quantity");
      if (inserted) travelItemRows.push(...inserted);
    }

    // Sync M1: espelha module_data.items em requisition_items. Insere os que
    // faltam e remove os PENDENTES que saíram da lista (ex.: gestor removeu
    // um item na 2ª edição) — itens já cotados/aprovados nunca são apagados.
    for (const req of m1Requisitions) {
      const mdItems = m1MultiItens(req)!;
      const keyOf = (code: unknown, desc: unknown, idx: number) =>
        `${String(code ?? "").trim() || `#${idx}`}::${String(desc ?? "").trim()}`;
      const expected = mdItems.map((it, idx) => ({
        key: keyOf(it.product_code, it.product_name, idx),
        product_code: (it.product_code as string | null) ?? null,
        description: (it.product_name as string | null) ?? null,
        quantity: typeof it.quantity === "number" ? it.quantity : Number(it.quantity) || 1,
        sort_order: idx,
      }));
      const existingRows = travelItemRows.filter(
        (r) => r.requisition_id === req.id && r.item_type === "produto",
      );
      const existingKeys = new Set(
        existingRows.map((r, idx) => keyOf(r.product_code, r.description, idx)),
      );
      const expectedKeys = new Set(expected.map((e) => e.key));

      const toInsert = expected
        .filter((e) => !existingKeys.has(e.key))
        .map((e) => ({
          requisition_id: req.id,
          item_type: "produto",
          description: e.description,
          product_code: e.product_code,
          quantity: e.quantity,
          sort_order: e.sort_order,
        }));
      if (toInsert.length > 0) {
        const { data: inserted } = await supabaseBrowser
          .from("requisition_items")
          .insert(toInsert)
          .select(
            "id,requisition_id,item_type,description,status,sort_order,product_code,quantity",
          );
        if (inserted) travelItemRows.push(...inserted);
      }

      const staleIds = existingRows
        .filter(
          (r, idx) =>
            r.status === "pending" && !expectedKeys.has(keyOf(r.product_code, r.description, idx)),
        )
        .map((r) => r.id);
      if (staleIds.length > 0) {
        await supabaseBrowser.from("requisition_items").delete().in("id", staleIds);
        for (const id of staleIds) {
          const pos = travelItemRows.findIndex((r) => r.id === id);
          if (pos >= 0) travelItemRows.splice(pos, 1);
        }
      }
    }

    // Also fetch quotation_suppliers with item_id — TODAS as linhas, não só
    // o vencedor: um item pode ter mais de uma proposta (até 3 fornecedores
    // comparados na cotação fracionada do M1).
    const itemQuotationIds = (quotations || [])
      .filter((q) => itemRequisitionIds.includes(q.requisition_id))
      .map((q) => q.id);

    const itemBidsByItem = new Map<string, NonNullable<TravelItem["bids"]>>();
    if (itemQuotationIds.length > 0) {
      const { data: itemSuppliers } = await supabaseBrowser
        .from("quotation_suppliers")
        .select(
          "id,quotation_id,supplier_name,price,deadline,notes,proposal_received,item_id,is_winner",
        )
        .in("quotation_id", itemQuotationIds);

      (itemSuppliers || []).forEach((s) => {
        if (!s.item_id) return;
        const current = itemBidsByItem.get(s.item_id) || [];
        current.push({
          id: s.id,
          supplierName: s.supplier_name,
          price: s.price?.toString() || "",
          deadline: s.deadline || "",
          notes: s.notes || "",
          isWinner: s.is_winner,
        });
        itemBidsByItem.set(s.item_id, current);
      });
    }

    (travelItemRows || []).forEach((row) => {
      const bids = itemBidsByItem.get(row.id) || [];
      // Campos supplier* refletem só o VENCEDOR (compatibilidade com M2, que
      // sempre tem 1 proposta só, e com o resumo do item na fila/PDF).
      const winner = bids.find((b) => b.isWinner) || bids[0];
      const item: TravelItem = {
        id: row.id,
        itemType: row.item_type as TravelItem["itemType"],
        description: row.description,
        status: row.status,
        sortOrder: row.sort_order,
        productCode: row.product_code ?? null,
        quantity: row.quantity ?? null,
        supplierId: winner?.id,
        supplierName: winner?.supplierName,
        supplierPrice: winner?.price,
        supplierDeadline: winner?.deadline || undefined,
        supplierNotes: winner?.notes || undefined,
        bids,
      };
      const current = travelItemsByRequisition.get(row.requisition_id) || [];
      current.push(item);
      travelItemsByRequisition.set(row.requisition_id, current);
    });
    for (const list of travelItemsByRequisition.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
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
      moduleData: (requisition.module_data as Record<string, JsonValue> | null) ?? {},
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
          : travelItemsByRequisition.has(requisition.id)
            ? travelItemsByRequisition.get(requisition.id)
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

/** Devolve a requisição ao solicitante por falta de informação — mesma
 *  transição usada em GESTOR_REJECTED/APPROVAL_REJECTED (status REJEITADO),
 *  só que registrada aqui como QUOTATION_RETURNED_FOR_INFO para a tela de
 *  Movimentações e o "reenviar" saberem que ela deve voltar pra Cotação.
 *  O log é gravado ANTES do status mudar (e propaga erro, sem warn-only):
 *  updateRequisition só sabe restaurar pra ABERTO encontrando esse marcador,
 *  então se ele falhasse silenciosamente a requisição ficaria presa em
 *  REJEITADO para sempre, sem chance de reenvio. */
export async function returnQuotationForInfoClient(requisitionId: string, reason: string) {
  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw new Error(friendlySupabaseError(requisitionError));

  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "QUOTATION_RETURNED_FOR_INFO",
    details: { reason },
  });
  if (logError) throw new Error(friendlySupabaseError(logError));

  const { error: updateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "REJEITADO" })
    .eq("id", requisitionId);
  if (updateError) throw new Error(friendlySupabaseError(updateError));
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
  itemType: "voo" | "hotel" | "carro" | "produto";
  supplierName: string;
  price: number;
  deadline: string;
  notes: string;
}

/** Cotação por item do M2 (voo/hotel/carro) — 1 fornecedor por item, sem
 *  comparação (não faz sentido cotar 2 fornecedores pro mesmo voo). */
export async function saveM2QuoteClient(requisitionId: string, itemQuotes: M2ItemQuote[]) {
  return saveItemQuotes(requisitionId, itemQuotes, "M2_QUOTE_COMPLETED");
}

export interface CorrectableQuotationWinner {
  supplierId: string;
  supplierName: string;
  price: number;
  itemId: string | null;
  itemDescription: string | null;
}

export interface CorrectableQuotationItem {
  requisitionId: string;
  quotationId: string;
  approvalId: string;
  ticketNumber: string;
  title: string;
  module: string;
  totalValue: number;
  approvalLevel: 1 | 2 | 3;
  decidedAt: string | null;
  winners: CorrectableQuotationWinner[];
}

/** Cotações já aprovadas (V3) e em Compra (V4) cujo preço vencedor pode ser
 *  corrigido — ex.: erro de digitação só percebido depois da aprovação (caso
 *  M1-000155: cotado errado, aprovado, e só depois descoberto em Compra). Só
 *  entram aqui requisições com `approvals.decision = 'approved'` — uma vez
 *  corrigidas, `correctQuotationPriceClient` devolve para 'pending' e elas
 *  saem desta lista até serem reaprovadas. */
export async function listCorrectableQuotationsClient(): Promise<CorrectableQuotationItem[]> {
  const { data: approvals, error: approvalsError } = await supabaseBrowser
    .from("approvals")
    .select("id,requisition_id,quotation_id,approval_level,total_value,decided_at")
    .eq("decision", "approved")
    .order("decided_at", { ascending: false });
  if (approvalsError) throw new Error(friendlySupabaseError(approvalsError));
  if (!approvals?.length) return [];

  const requisitionIds = approvals.map((a) => a.requisition_id);
  const { data: requisitions, error: requisitionsError } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,module,title,status")
    .in("id", requisitionIds)
    .eq("status", "COMPRA");
  if (requisitionsError) throw new Error(friendlySupabaseError(requisitionsError));
  if (!requisitions?.length) return [];

  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));

  const quotationIds = approvals.map((a) => a.quotation_id).filter(Boolean) as string[];
  const { data: suppliers, error: suppliersError } =
    quotationIds.length === 0
      ? { data: [], error: null }
      : await supabaseBrowser
          .from("quotation_suppliers")
          .select("id,quotation_id,supplier_name,price,item_id")
          .in("quotation_id", quotationIds)
          .eq("is_winner", true);
  if (suppliersError) throw new Error(friendlySupabaseError(suppliersError));

  const itemIds = (suppliers || []).map((s) => s.item_id).filter(Boolean) as string[];
  const { data: items, error: itemsError } =
    itemIds.length === 0
      ? { data: [], error: null }
      : await supabaseBrowser.from("requisition_items").select("id,description").in("id", itemIds);
  if (itemsError) throw new Error(friendlySupabaseError(itemsError));
  const descriptionByItemId = new Map((items || []).map((i) => [i.id, i.description]));

  const winnersByQuotation = new Map<string, CorrectableQuotationWinner[]>();
  (suppliers || []).forEach((supplier) => {
    const current = winnersByQuotation.get(supplier.quotation_id) || [];
    current.push({
      supplierId: supplier.id,
      supplierName: supplier.supplier_name,
      price: supplier.price || 0,
      itemId: supplier.item_id ?? null,
      itemDescription: supplier.item_id
        ? (descriptionByItemId.get(supplier.item_id) ?? null)
        : null,
    });
    winnersByQuotation.set(supplier.quotation_id, current);
  });

  return approvals
    .filter((a) => requisitionById.has(a.requisition_id) && a.quotation_id)
    .map((a) => {
      const requisition = requisitionById.get(a.requisition_id)!;
      return {
        requisitionId: a.requisition_id,
        quotationId: a.quotation_id!,
        approvalId: a.id,
        ticketNumber: requisition.ticket_number,
        title: requisition.title,
        module: requisition.module,
        totalValue: a.total_value || 0,
        approvalLevel: a.approval_level as 1 | 2 | 3,
        decidedAt: a.decided_at,
        winners: winnersByQuotation.get(a.quotation_id!) || [],
      };
    })
    .filter((item) => item.winners.length > 0);
}

/** Corrige o preço de um ou mais fornecedores vencedores de uma cotação já
 *  aprovada, recalcula o total/alçada e devolve a aprovação para 'pending' —
 *  a requisição some da fila de Compra até ser reaprovada em V3 com o valor
 *  correto. Não altera nem apaga nada em `purchases`: se o comprador já
 *  tinha preenchido PO/nota fiscal antes de notar o erro, esses dados ficam
 *  intactos e voltam a aparecer quando a reaprovação sair. */
export async function correctQuotationPriceClient(
  requisitionId: string,
  corrections: { supplierId: string; newPrice: number }[],
  reason: string,
) {
  if (corrections.length === 0) throw new Error("Informe ao menos um preço corrigido.");
  if (!reason.trim()) throw new Error("Informe o motivo da correção.");
  for (const c of corrections) {
    if (!Number.isFinite(c.newPrice) || c.newPrice <= 0) {
      throw new Error("Todo preço corrigido precisa ser um número maior que zero.");
    }
  }

  const { data: requisition, error: requisitionError } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,status")
    .eq("id", requisitionId)
    .single();
  if (requisitionError) throw new Error(friendlySupabaseError(requisitionError));
  if (requisition.status !== "COMPRA") {
    throw new Error("Só é possível corrigir o preço de requisições que já estão em Compra (V4).");
  }

  const { data: approval, error: approvalError } = await supabaseBrowser
    .from("approvals")
    .select("id,quotation_id,decision,total_value,approval_level")
    .eq("requisition_id", requisitionId)
    .single();
  if (approvalError) throw new Error(friendlySupabaseError(approvalError));
  if (approval.decision !== "approved" || !approval.quotation_id) {
    throw new Error("Esta requisição não tem uma aprovação concedida para reabrir.");
  }

  // Busca TODOS os vencedores da cotação (não só os corrigidos) — é a partir
  // desse conjunto que o novo total é calculado, então precisamos do preço
  // atual de quem não mudou também.
  const { data: allWinners, error: allWinnersError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id,supplier_name,price,item_id")
    .eq("quotation_id", approval.quotation_id)
    .eq("is_winner", true);
  if (allWinnersError) throw new Error(friendlySupabaseError(allWinnersError));

  const priceById = new Map(corrections.map((c) => [c.supplierId, c.newPrice]));
  const changes = (allWinners || []).map((s) => ({
    supplierId: s.id,
    supplierName: s.supplier_name,
    itemId: s.item_id as string | null,
    oldPrice: s.price || 0,
    newPrice: priceById.get(s.id) ?? (s.price || 0),
  }));
  const actualChanges = changes.filter((c) => c.newPrice !== c.oldPrice);
  if (actualChanges.length === 0) {
    throw new Error("Nenhum preço foi alterado.");
  }

  const newTotal = changes.reduce((sum, c) => sum + c.newPrice, 0);
  const thresholds = await getTierThresholds();
  const newApprovalLevel = getApprovalLevelForValue(newTotal, thresholds);

  for (const change of actualChanges) {
    const { error } = await supabaseBrowser
      .from("quotation_suppliers")
      .update({ price: change.newPrice })
      .eq("id", change.supplierId);
    if (error) throw new Error(friendlySupabaseError(error));
  }

  // M1 multi-item / M2: `approval_items` guarda preço e decisão POR ITEM,
  // separado de `quotation_suppliers` — a tela de Aprovação e a de Compra
  // leem de lá, não daqui. Sem sincronizar, a reabertura mostraria o preço e
  // a decisão antigos nessas telas mesmo com o preço já corrigido.
  const itemIdsChanged = actualChanges.map((c) => c.itemId).filter(Boolean) as string[];
  if (itemIdsChanged.length > 0) {
    for (const change of actualChanges) {
      if (!change.itemId) continue;
      const { error } = await supabaseBrowser
        .from("approval_items")
        .update({ price: change.newPrice, decision: "pending", decided_at: null })
        .eq("approval_id", approval.id)
        .eq("item_id", change.itemId);
      if (error) throw new Error(friendlySupabaseError(error));
    }

    const { error: itemStatusError } = await supabaseBrowser
      .from("requisition_items")
      .update({ status: "quoted" })
      .in("id", itemIdsChanged);
    if (itemStatusError) throw new Error(friendlySupabaseError(itemStatusError));
  }

  const { error: approvalUpdateError } = await supabaseBrowser
    .from("approvals")
    .update({
      total_value: newTotal,
      approval_level: newApprovalLevel,
      decision: "pending",
      decided_at: null,
      approver_id: null,
    })
    .eq("id", approval.id);
  if (approvalUpdateError) throw new Error(friendlySupabaseError(approvalUpdateError));

  const { error: requisitionUpdateError } = await supabaseBrowser
    .from("requisitions")
    .update({ status: "APROVAÇÃO" })
    .eq("id", requisitionId);
  if (requisitionUpdateError) throw new Error(friendlySupabaseError(requisitionUpdateError));

  const { error: firstLogError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "QUOTATION_PRICE_CORRECTED",
    old_status: "COMPRA",
    new_status: "APROVAÇÃO",
    details: {
      reason: reason.trim(),
      changes: actualChanges,
      previous_total_value: approval.total_value,
      new_total_value: newTotal,
      previous_approval_level: approval.approval_level,
      new_approval_level: newApprovalLevel,
    },
  });
  if (firstLogError)
    console.warn("[audit_logs] QUOTATION_PRICE_CORRECTED failed:", firstLogError.message);

  const { error: secondLogError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "APPROVAL_REQUESTED",
    old_status: "COMPRA",
    new_status: "APROVAÇÃO",
    details: { approval_level: newApprovalLevel, total_value: newTotal, reopened: true },
  });
  if (secondLogError)
    console.warn("[audit_logs] APPROVAL_REQUESTED failed:", secondLogError.message);
}

async function saveItemQuotes(
  requisitionId: string,
  itemQuotes: M2ItemQuote[],
  auditAction: string,
) {
  // 1. Cria ou busca cotação
  const quotationId = await ensureQuotation(requisitionId, "completed");

  // 2. Upsert quotation_suppliers — um por item, já como vencedor. Busca o id
  // existente por item antes (em vez de onConflict "quotation_id,item_id"):
  // essa dupla deixou de ser única no banco para permitir múltiplas propostas
  // por item na cotação fracionada do M1 — aqui (M2) continua 1 por item,
  // só que garantido pela própria consulta abaixo, não mais pela constraint.
  const { data: existingRows, error: existingRowsError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id,item_id")
    .eq("quotation_id", quotationId)
    .in(
      "item_id",
      itemQuotes.map((item) => item.itemId),
    );
  if (existingRowsError) throw new Error(friendlySupabaseError(existingRowsError));
  const existingIdByItem = new Map((existingRows || []).map((row) => [row.item_id, row.id]));

  // `id` é sempre incluído (existente ou gerado aqui) em toda linha do
  // batch — se algumas linhas tivessem `id` e outras não, o upsert em lote
  // do PostgREST preencheria o `id` ausente com null em vez de aplicar o
  // DEFAULT da coluna, e o insert falharia por violar a chave primária.
  const supplierPayload = itemQuotes.map((item) => ({
    id: existingIdByItem.get(item.itemId) || crypto.randomUUID(),
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
    .upsert(supplierPayload);
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
    action: auditAction,
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
  if (logError) console.warn(`[audit_logs] ${auditAction} failed:`, logError.message);
}

export interface ItemBidPayload {
  /** Presente quando esta proposta já existia (edição de cotação salva antes). */
  id?: string;
  itemId: string;
  itemType: "produto";
  supplierName: string;
  /** Valor da linha já calculado (unitário × quantidade) — não o unitário. */
  price: number;
  deadline: string;
  notes: string;
  isWinner: boolean;
}

/** Cotação fracionada do M1 multi-itens com comparação de até 3 fornecedores
 *  POR ITEM: cada item pode ter uma proposta diferente de cada fornecedor, e
 *  o comprador escolhe o vencedor item a item (um pode vencer em preço,
 *  outro em prazo) — fracionando a compra entre eles. Substitui o antigo
 *  modelo de atribuição direta (1 fornecedor por item, sem comparação).
 *  A aprovação é uma só — alçada pelo valor TOTAL dos itens vencedores — e o
 *  aprovador pode cortar itens individualmente. */
export async function saveM1ItemBidsClient(requisitionId: string, bids: ItemBidPayload[]) {
  if (bids.length === 0) throw new Error("Informe ao menos uma proposta.");

  // 1. Cria ou busca cotação
  const quotationId = await ensureQuotation(requisitionId, "completed");

  // 2. Remove propostas que existiam antes e não vieram mais nesta gravação
  // (ex.: comprador apagou o preço de um fornecedor para um item).
  const { data: existingRows, error: existingRowsError } = await supabaseBrowser
    .from("quotation_suppliers")
    .select("id")
    .eq("quotation_id", quotationId);
  if (existingRowsError) throw new Error(friendlySupabaseError(existingRowsError));
  const incomingIds = new Set(bids.map((bid) => bid.id).filter(Boolean) as string[]);
  const idsToDelete = (existingRows || [])
    .map((row) => row.id)
    .filter((id) => !incomingIds.has(id));
  if (idsToDelete.length > 0) {
    const { error } = await supabaseBrowser
      .from("quotation_suppliers")
      .delete()
      .in("id", idsToDelete);
    if (error) throw new Error(friendlySupabaseError(error));
  }

  // 3. Upsert de todas as propostas (vencedoras e não vencedoras) — mantém o
  // histórico de quem cotou o quê, com is_winner marcando a escolhida.
  // `id` vai sempre presente (existente ou gerado aqui): misturar, no mesmo
  // batch, linhas com `id` e linhas sem faria o PostgREST preencher o `id`
  // ausente com null em vez de aplicar o DEFAULT da coluna, quebrando o insert.
  const payload = bids.map((bid) => ({
    id: bid.id || crypto.randomUUID(),
    quotation_id: quotationId,
    item_id: bid.itemId,
    supplier_name: bid.supplierName,
    price: bid.price,
    deadline: bid.deadline || null,
    notes: bid.notes || null,
    proposal_received: true,
    is_winner: bid.isWinner,
  }));
  const { error: upsertError } = await supabaseBrowser.from("quotation_suppliers").upsert(payload);
  if (upsertError) throw new Error(friendlySupabaseError(upsertError));

  // 4. Total e nível de aprovação — só os vencedores contam
  const winners = bids.filter((bid) => bid.isWinner);
  if (winners.length === 0)
    throw new Error("Selecione o vencedor de cada item antes de finalizar.");
  const totalValue = winners.reduce((sum, bid) => sum + bid.price, 0);
  const approvalLevel = getApprovalLevelForValue(totalValue, await getTierThresholds());

  // 5. Upsert approval
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

  // 6. Busca o approval_id
  const { data: approvalRow, error: approvalFetchError } = await supabaseBrowser
    .from("approvals")
    .select("id")
    .eq("requisition_id", requisitionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (approvalFetchError) throw new Error(friendlySupabaseError(approvalFetchError));
  if (!approvalRow?.id) throw new Error("Não foi possível recuperar o ID de aprovação.");

  // 7. Upsert approval_items — só os vencedores (é o que Aprovação/Compra leem)
  const approvalItemsPayload = winners.map((bid) => ({
    approval_id: approvalRow.id,
    item_id: bid.itemId,
    item_type: bid.itemType,
    supplier_name: bid.supplierName,
    price: bid.price,
    decision: "pending",
  }));
  const { error: approvalItemsError } = await supabaseBrowser
    .from("approval_items")
    .upsert(approvalItemsPayload, { onConflict: "approval_id,item_id" });
  if (approvalItemsError) throw new Error(friendlySupabaseError(approvalItemsError));

  // 8. Atualiza status dos itens vencedores para 'quoted'
  const itemIds = winners.map((bid) => bid.itemId);
  const { error: itemStatusError } = await supabaseBrowser
    .from("requisition_items")
    .update({ status: "quoted" })
    .in("id", itemIds);
  if (itemStatusError)
    console.warn("[requisition_items] status update failed:", itemStatusError.message);

  // 9. Atualiza requisição para APROVAÇÃO
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

  // 10. Audit log
  const { error: logError } = await supabaseBrowser.from("audit_logs").insert({
    requisition_id: requisitionId,
    ticket_number: requisition.ticket_number,
    action: "M1_ITEMS_QUOTE_COMPLETED",
    old_status: requisition.status,
    new_status: "APROVAÇÃO",
    details: {
      total_value: totalValue,
      approval_level: approvalLevel,
      bids: bids.map((bid) => ({
        item_id: bid.itemId,
        supplier: bid.supplierName,
        price: bid.price,
        is_winner: bid.isWinner,
      })),
    },
  });
  if (logError) console.warn("[audit_logs] M1_ITEMS_QUOTE_COMPLETED failed:", logError.message);
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── Servidor MCP remoto do VPRequisições ──────────────────────────────────
// Expõe o sistema de requisições (Supabase) como ferramentas MCP para que o
// Claude (claude.ai / Claude Code) possa consultar e operar o fluxo de
// compras via um "conector personalizado" (Streamable HTTP transport).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "vprequisicoes-mcp", version: "1.0.0" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

// ─── Acesso a dados (PostgREST via service_role, mesmo padrão do app) ──────

async function supabaseRest<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD"; body?: unknown; headers?: Record<string, string> },
): Promise<{ data: T; count: number }> {
  const method = options?.method || "GET";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Supabase respondeu com status ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // texto simples, mantém message
    }
    throw new Error(message);
  }

  const contentRange = response.headers.get("content-range");
  const count = contentRange ? Number(contentRange.split("/")[1]) || 0 : 0;

  if (method === "HEAD" || response.status === 204) {
    return { data: null as T, count };
  }

  const text = await response.text();
  if (!text) return { data: null as T, count };
  return { data: JSON.parse(text) as T, count };
}

// ─── Autenticação por chave compartilhada (hash em mcp_api_keys) ──────────

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAuthorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1].trim();
  if (!token) return false;

  const tokenHash = await sha256Hex(token);
  const { data } = await supabaseRest<Array<{ id: string }>>(
    `mcp_api_keys?select=id&token_hash=eq.${tokenHash}&active=eq.true&limit=1`,
  );
  return Array.isArray(data) && data.length > 0;
}

// ─── Domínio: constantes do app ────────────────────────────────────────────

const MODULES = ["M1", "M2", "M3", "M4", "M5", "M6"] as const;
const URGENCIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const STATUSES = [
  "RASCUNHO", "GESTOR", "ABERTO", "COTAÇÃO", "APROVAÇÃO",
  "COMPRA", "RECEBIMENTO", "CONCLUÍDO", "CANCELADO", "REJEITADO",
] as const;
const OPEN_STATUSES = ["GESTOR", "ABERTO", "COTAÇÃO", "APROVAÇÃO", "COMPRA", "RECEBIMENTO"];
const MODULE_LABELS: Record<string, string> = {
  M1: "Produtos", M2: "Viagens", M3: "Serviços", M4: "Manutenção", M5: "Frete", M6: "Locação",
};

async function findRequisitionByTicket(ticketNumber: string) {
  const { data } = await supabaseRest<Array<{ id: string; ticket_number: string; status: string; module: string }>>(
    `requisitions?select=id,ticket_number,status,module&ticket_number=eq.${encodeURIComponent(ticketNumber)}&limit=1`,
  );
  const requisition = data?.[0];
  if (!requisition) throw new Error(`Requisição ${ticketNumber} não encontrada.`);
  return requisition;
}

async function logAuditEvent(params: {
  requisitionId: string;
  ticketNumber: string;
  action: string;
  oldStatus?: string;
  newStatus?: string;
  actorName?: string;
  details?: Record<string, unknown>;
}) {
  await supabaseRest("audit_logs", {
    method: "POST",
    body: [
      {
        requisition_id: params.requisitionId,
        ticket_number: params.ticketNumber,
        action: params.action,
        old_status: params.oldStatus ?? null,
        new_status: params.newStatus ?? null,
        actor_name: params.actorName ?? "Claude (MCP)",
        details: params.details ?? {},
      },
    ],
  });
}

// ─── Ferramentas MCP ────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_requisitions",
    description:
      "Lista requisições (tickets) do VPRequisições com filtros opcionais por status, módulo, urgência e busca por texto no título/número do ticket.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...STATUSES, "OPEN"], description: "Status exato, ou OPEN para todos os status em andamento (não concluídos/cancelados/rejeitados)." },
        module: { type: "string", enum: MODULES, description: "Módulo M1 (Produtos) a M6 (Locação)." },
        urgency: { type: "string", enum: URGENCIES },
        search: { type: "string", description: "Busca por título ou número do ticket." },
        limit: { type: "number", description: "Máximo de resultados (padrão 20, máx 100)." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const params = new URLSearchParams({
        select: "id,ticket_number,module,title,status,urgency,requester_name,requester_department,estimated_cost,desired_date,created_at,updated_at",
        order: "created_at.desc",
        limit: String(limit),
      });
      if (args.status && args.status !== "OPEN") params.set("status", `eq.${args.status}`);
      if (args.status === "OPEN") params.set("status", `in.(${OPEN_STATUSES.join(",")})`);
      if (args.module) params.set("module", `eq.${args.module}`);
      if (args.urgency) params.set("urgency", `eq.${args.urgency}`);
      if (args.search) {
        const term = String(args.search).replace(/[,()]/g, "");
        params.set("or", `(title.ilike.*${term}*,ticket_number.ilike.*${term}*)`);
      }
      const { data, count } = await supabaseRest(`requisitions?${params.toString()}`, {
        headers: { Prefer: "count=exact" },
      });
      return { total: count, requisitions: data };
    },
  },
  {
    name: "get_requisition",
    description:
      "Retorna o detalhe completo de uma requisição pelo número do ticket (ex: M1-000123): dados gerais, itens, cotação/fornecedores, aprovação, compra, recebimento e histórico de auditoria.",
    inputSchema: {
      type: "object",
      properties: { ticket_number: { type: "string" } },
      required: ["ticket_number"],
    },
    handler: async (args) => {
      const ticketNumber = String(args.ticket_number);
      const { data: reqData } = await supabaseRest<Array<Record<string, unknown>>>(
        `requisitions?select=*&ticket_number=eq.${encodeURIComponent(ticketNumber)}&limit=1`,
      );
      const requisition = reqData?.[0];
      if (!requisition) throw new Error(`Requisição ${ticketNumber} não encontrada.`);
      const id = requisition.id as string;

      const [items, quotations, approvals, purchases, receipts, auditLogs] = await Promise.all([
        supabaseRest(`requisition_items?select=*&requisition_id=eq.${id}&order=sort_order.asc`),
        supabaseRest(`quotations?select=*,quotation_suppliers(*)&requisition_id=eq.${id}`),
        supabaseRest(`approvals?select=*&requisition_id=eq.${id}`),
        supabaseRest(`purchases?select=*&requisition_id=eq.${id}`),
        supabaseRest(`receipts?select=*&requisition_id=eq.${id}`),
        supabaseRest(`audit_logs?select=action,old_status,new_status,actor_name,details,created_at&requisition_id=eq.${id}&order=created_at.desc&limit=30`),
      ]);

      return {
        requisition,
        items: items.data,
        quotations: quotations.data,
        approvals: approvals.data,
        purchases: purchases.data,
        receipts: receipts.data,
        audit_logs: auditLogs.data,
      };
    },
  },
  {
    name: "dashboard_summary",
    description: "Resumo executivo: contagem de tickets abertos, em cotação, em aprovação, concluídos no mês, abertos por módulo e os 5 tickets mais recentes.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const firstDayOfMonth = new Date();
      firstDayOfMonth.setDate(1);
      firstDayOfMonth.setHours(0, 0, 0, 0);

      const count = async (filters: Record<string, string>) => {
        const params = new URLSearchParams({ select: "id", ...filters });
        const { count } = await supabaseRest(`requisitions?${params.toString()}`, {
          method: "HEAD",
          headers: { Prefer: "count=exact" },
        });
        return count;
      };

      const openFilter = { status: `in.(${OPEN_STATUSES.join(",")})` };
      const [open, quoting, approval, completedThisMonth, recent, ...moduleCounts] = await Promise.all([
        count(openFilter),
        count({ status: "eq.COTAÇÃO" }),
        count({ status: "eq.APROVAÇÃO" }),
        count({ status: "eq.CONCLUÍDO", completed_at: `gte.${firstDayOfMonth.toISOString()}` }),
        supabaseRest("requisitions?select=id,ticket_number,module,title,urgency,status,created_at&order=created_at.desc&limit=5"),
        ...MODULES.map((m) => count({ module: `eq.${m}`, ...openFilter })),
      ]);

      const modules = MODULES.reduce<Record<string, { label: string; open: number }>>((acc, m, i) => {
        acc[m] = { label: MODULE_LABELS[m], open: moduleCounts[i] };
        return acc;
      }, {});

      return {
        tickets_abertos: open,
        em_cotacao: quoting,
        em_aprovacao: approval,
        concluidos_no_mes: completedThisMonth,
        modulos: modules,
        tickets_recentes: recent.data,
      };
    },
  },
  {
    name: "list_pending_approvals",
    description: "Lista requisições aguardando decisão de aprovação (fila V3), com valor total, nível de alçada e propostas de fornecedores.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data: approvals } = await supabaseRest<Array<Record<string, unknown>>>(
        "approvals?select=id,requisition_id,quotation_id,approval_level,total_value&decision=eq.pending&order=created_at.asc",
      );
      if (!approvals?.length) return { pending: [] };
      const reqIds = approvals.map((a) => a.requisition_id);
      const { data: requisitions } = await supabaseRest<Array<Record<string, unknown>>>(
        `requisitions?select=id,ticket_number,module,title,justification,requester_name,status&id=in.(${reqIds.join(",")})&status=eq.APROVAÇÃO`,
      );
      const requisitionById = new Map(requisitions.map((r) => [r.id, r]));
      return {
        pending: approvals
          .map((a) => ({ ...a, requisition: requisitionById.get(a.requisition_id) }))
          .filter((a) => a.requisition),
      };
    },
  },
  {
    name: "list_pending_purchases",
    description: "Lista requisições aprovadas aguardando fechamento de compra (fila V4).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data: approvals } = await supabaseRest<Array<Record<string, unknown>>>(
        "approvals?select=id,requisition_id,total_value,decided_at&decision=eq.approved&order=decided_at.asc",
      );
      if (!approvals?.length) return { pending: [] };
      const reqIds = approvals.map((a) => a.requisition_id);
      const { data: requisitions } = await supabaseRest<Array<Record<string, unknown>>>(
        `requisitions?select=id,ticket_number,module,title,requester_name,status&id=in.(${reqIds.join(",")})&status=eq.COMPRA`,
      );
      const requisitionById = new Map(requisitions.map((r) => [r.id, r]));
      return {
        pending: approvals
          .map((a) => ({ ...a, requisition: requisitionById.get(a.requisition_id) }))
          .filter((a) => a.requisition),
      };
    },
  },
  {
    name: "list_pending_receipts",
    description: "Lista requisições compradas aguardando registro de recebimento (fila V5).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data: requisitions } = await supabaseRest<Array<Record<string, unknown>>>(
        "requisitions?select=id,ticket_number,module,title,requester_name&status=eq.RECEBIMENTO&order=updated_at.asc",
      );
      if (!requisitions?.length) return { pending: [] };
      const reqIds = requisitions.map((r) => r.id);
      const { data: purchases } = await supabaseRest<Array<Record<string, unknown>>>(
        `purchases?select=id,requisition_id,supplier_name,purchase_order_number,purchased_at&requisition_id=in.(${reqIds.join(",")})`,
      );
      const purchaseByReq = new Map(purchases.map((p) => [p.requisition_id, p]));
      return {
        pending: requisitions.map((r) => ({ ...r, purchase: purchaseByReq.get(r.id) ?? null })),
      };
    },
  },
  {
    name: "create_product_requisition",
    description:
      "Cria uma nova requisição do módulo M1 (Produtos). Vai para status GESTOR (revisão inicial) antes de entrar na fila de cotação.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              productName: { type: "string" },
              description: { type: "string" },
              quantity: { type: "number" },
              productCode: { type: "string" },
              technicalSpecs: { type: "string" },
              brandPreference: { type: "string" },
              modelReference: { type: "string" },
              referenceLinks: { type: "array", items: { type: "string" } },
            },
            required: ["productName", "description", "quantity"],
          },
        },
        deliveryDeadline: { type: "string", description: "Data desejada (YYYY-MM-DD)." },
        deliveryLocation: { type: "string" },
        urgencyLevel: { type: "string", enum: URGENCIES },
        justification: { type: "string" },
        requesterName: { type: "string" },
        requesterEmail: { type: "string" },
        requesterDepartment: { type: "string" },
      },
      required: ["items", "deliveryDeadline", "deliveryLocation", "urgencyLevel", "justification", "requesterName", "requesterEmail", "requesterDepartment"],
    },
    handler: async (args) => {
      const items = args.items as Array<Record<string, unknown>>;
      if (!Array.isArray(items) || items.length === 0) throw new Error("Informe ao menos um item.");

      const title =
        items.length === 1
          ? String(items[0].productName)
          : `${items.length} itens — ${items[0].productName} e outros`;

      const moduleData = {
        items: items.map((item) => ({
          product_code: item.productCode ?? null,
          product_name: item.productName,
          quantity: item.quantity,
          description: item.description,
          technical_specs: item.technicalSpecs ?? "",
          brand_preference: item.brandPreference ?? "",
          model_reference: item.modelReference ?? "",
          reference_links: item.referenceLinks ?? [],
        })),
        delivery_location: args.deliveryLocation,
      };

      const { data } = await supabaseRest<Array<{ id: string; ticket_number: string }>>("requisitions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [
          {
            module: "M1",
            title,
            description: items.map((i) => `${i.productName}: ${i.description}`).join(" | "),
            justification: args.justification,
            urgency: args.urgencyLevel,
            status: "GESTOR",
            desired_date: args.deliveryDeadline,
            requester_name: args.requesterName,
            requester_email: args.requesterEmail,
            requester_department: args.requesterDepartment,
            module_data: moduleData,
          },
        ],
      });

      const created = data?.[0];
      if (!created) throw new Error("A requisição foi enviada, mas o Supabase não retornou o registro criado.");

      await logAuditEvent({
        requisitionId: created.id,
        ticketNumber: created.ticket_number,
        action: "REQUISITION_CREATED",
        newStatus: "GESTOR",
        actorName: String(args.requesterName),
        details: { module: "M1", urgency: args.urgencyLevel, total_itens: items.length, origem: "mcp" },
      });

      return { ticket_number: created.ticket_number, status: "GESTOR" };
    },
  },
  {
    name: "approve_requisition",
    description: "Aprova a requisição que está com aprovação pendente (fila V3). Move o status para COMPRA.",
    inputSchema: {
      type: "object",
      properties: { ticket_number: { type: "string" }, justification: { type: "string" } },
      required: ["ticket_number"],
    },
    handler: async (args) => decideApproval(String(args.ticket_number), "approved", args.justification ? String(args.justification) : ""),
  },
  {
    name: "reject_requisition",
    description: "Rejeita a requisição que está com aprovação pendente (fila V3). Move o status para REJEITADO.",
    inputSchema: {
      type: "object",
      properties: { ticket_number: { type: "string" }, justification: { type: "string" } },
      required: ["ticket_number", "justification"],
    },
    handler: async (args) => decideApproval(String(args.ticket_number), "rejected", String(args.justification)),
  },
  {
    name: "confirm_purchase",
    description: "Confirma a compra de uma requisição aprovada (fila V4). Move o status para RECEBIMENTO (ou CONCLUÍDO se não exigir recebimento).",
    inputSchema: {
      type: "object",
      properties: {
        ticket_number: { type: "string" },
        supplierName: { type: "string" },
        supplierPrice: { type: "number" },
        purchaseOrderNumber: { type: "string" },
        invoiceNumber: { type: "string" },
        paymentMethod: { type: "string" },
        notes: { type: "string" },
        requiresReceipt: { type: "boolean", description: "Padrão true." },
      },
      required: ["ticket_number", "supplierName", "supplierPrice", "purchaseOrderNumber"],
    },
    handler: async (args) => {
      const requisition = await findRequisitionByTicket(String(args.ticket_number));
      const { data: approvals } = await supabaseRest<Array<{ id: string }>>(
        `approvals?select=id&requisition_id=eq.${requisition.id}&decision=eq.approved&order=decided_at.desc&limit=1`,
      );
      const approvalId = approvals?.[0]?.id ?? null;
      const requiresReceipt = args.requiresReceipt === undefined ? true : Boolean(args.requiresReceipt);

      await supabaseRest("purchases?on_conflict=requisition_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: [
          {
            requisition_id: requisition.id,
            approval_id: approvalId,
            supplier_name: args.supplierName,
            supplier_price: args.supplierPrice,
            purchase_order_number: args.purchaseOrderNumber,
            invoice_number: args.invoiceNumber ?? null,
            payment_method: args.paymentMethod ?? null,
            notes: args.notes ?? null,
            requires_receipt: requiresReceipt,
            purchased_at: new Date().toISOString(),
          },
        ],
      });

      const nextStatus = requiresReceipt ? "RECEBIMENTO" : "CONCLUÍDO";
      await supabaseRest(`requisitions?id=eq.${requisition.id}`, {
        method: "PATCH",
        body: { status: nextStatus, completed_at: requiresReceipt ? null : new Date().toISOString() },
      });

      await logAuditEvent({
        requisitionId: requisition.id,
        ticketNumber: requisition.ticket_number,
        action: "PURCHASE_CONFIRMED",
        oldStatus: requisition.status,
        newStatus: nextStatus,
        details: { supplier_name: args.supplierName, supplier_price: args.supplierPrice, purchase_order_number: args.purchaseOrderNumber, origem: "mcp" },
      });

      return { ticket_number: requisition.ticket_number, status: nextStatus };
    },
  },
  {
    name: "register_receipt",
    description: "Registra o recebimento de uma requisição comprada (fila V5). Condição 'ok' conclui o ticket; 'damaged'/'mismatch' devolve para COMPRA e exige observações.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_number: { type: "string" },
        condition: { type: "string", enum: ["ok", "damaged", "mismatch"] },
        delivererName: { type: "string" },
        carrierCompany: { type: "string" },
        notes: { type: "string" },
      },
      required: ["ticket_number", "condition"],
    },
    handler: async (args) => {
      const condition = String(args.condition);
      if (condition !== "ok" && !String(args.notes ?? "").trim()) {
        throw new Error("Descreva o problema ou divergência em 'notes' antes de finalizar.");
      }

      const requisition = await findRequisitionByTicket(String(args.ticket_number));
      const { data: purchases } = await supabaseRest<Array<{ id: string }>>(
        `purchases?select=id&requisition_id=eq.${requisition.id}&limit=1`,
      );
      const purchaseId = purchases?.[0]?.id;
      if (!purchaseId) throw new Error(`Nenhuma compra registrada para ${requisition.ticket_number}.`);

      await supabaseRest("receipts?on_conflict=requisition_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: [
          {
            requisition_id: requisition.id,
            purchase_id: purchaseId,
            deliverer_name: args.delivererName ?? null,
            carrier_company: args.carrierCompany ?? null,
            condition,
            notes: args.notes ?? null,
            received_at: new Date().toISOString(),
          },
        ],
      });

      const nextStatus = condition === "ok" ? "CONCLUÍDO" : "COMPRA";
      await supabaseRest(`requisitions?id=eq.${requisition.id}`, {
        method: "PATCH",
        body: { status: nextStatus, completed_at: condition === "ok" ? new Date().toISOString() : null },
      });

      await logAuditEvent({
        requisitionId: requisition.id,
        ticketNumber: requisition.ticket_number,
        action: "RECEIPT_REGISTERED",
        oldStatus: requisition.status,
        newStatus: nextStatus,
        details: { condition, deliverer_name: args.delivererName ?? null, carrier_company: args.carrierCompany ?? null, notes: args.notes ?? null, origem: "mcp" },
      });

      return { ticket_number: requisition.ticket_number, status: nextStatus };
    },
  },
];

async function decideApproval(ticketNumber: string, decision: "approved" | "rejected", justification: string) {
  const requisition = await findRequisitionByTicket(ticketNumber);
  const { data: approvals } = await supabaseRest<Array<{ id: string }>>(
    `approvals?select=id&requisition_id=eq.${requisition.id}&decision=eq.pending&limit=1`,
  );
  const approvalId = approvals?.[0]?.id;
  if (!approvalId) throw new Error(`Nenhuma aprovação pendente para ${requisition.ticket_number}.`);

  await supabaseRest(`approvals?id=eq.${approvalId}`, {
    method: "PATCH",
    body: { decision, justification: justification || null, decided_at: new Date().toISOString() },
  });

  const nextStatus = decision === "approved" ? "COMPRA" : "REJEITADO";
  await supabaseRest(`requisitions?id=eq.${requisition.id}`, { method: "PATCH", body: { status: nextStatus } });

  await logAuditEvent({
    requisitionId: requisition.id,
    ticketNumber: requisition.ticket_number,
    action: decision === "approved" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
    oldStatus: requisition.status,
    newStatus: nextStatus,
    details: { justification, origem: "mcp" },
  });

  return { ticket_number: requisition.ticket_number, status: nextStatus };
}

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC / MCP plumbing (Streamable HTTP, sem estado de sessão) ──────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg: Record<string, unknown>) {
  const { method, id, params } = msg as { method?: string; id?: unknown; params?: Record<string, unknown> };

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) {
      return rpcResult(id, { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true });
    }
    try {
      const result = await tool.handler((params?.arguments as Record<string, unknown>) ?? {});
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, { content: [{ type: "text", text: `Erro: ${message}` }], isError: true });
    }
  }

  if (id === undefined) return null; // notificação desconhecida: ignora
  return rpcError(id, -32601, `Método não suportado: ${method}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST para o endpoint MCP." }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mcp"', ...CORS_HEADERS },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (Array.isArray(body)) {
    const results = (await Promise.all(body.map((m) => handleMessage(m as Record<string, unknown>)))).filter(
      (r) => r !== null,
    );
    if (results.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const result = await handleMessage(body as Record<string, unknown>);
  if (result === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
});

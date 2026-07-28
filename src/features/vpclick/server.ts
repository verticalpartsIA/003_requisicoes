/**
 * VP Click Integration — server-side only (createServerFn)
 *
 * Responsabilidade: ouvir VPRequisições e criar/atualizar tarefas no vpclick
 * para cada usuário receber suas atividades no gestor de tarefas.
 *
 * NUNCA lança exceções para o chamador — qualquer erro é apenas logado.
 * O fluxo principal de VPRequisições nunca pode quebrar por causa daqui.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── Acesso às variáveis de ambiente (server-side) ───────────────────────────

function vpclickUrl() { return process.env.VPCLICK_URL ?? "https://sfpnjwllcmentoocylow.supabase.co"; }
function vpclickKey() { return process.env.VPCLICK_SERVICE_KEY ?? ""; }
function vpclickListId() { return process.env.VPCLICK_LIST_ID ?? "f20b0470-efe0-450d-ae2e-1d941564a006"; }
function vpreqBaseUrl() { return process.env.VPREQ_BASE_URL ?? "https://maroon-dove-178367.hostingersite.com"; }
function vpreqUrl() { return process.env.VITE_SUPABASE_URL ?? "https://vvgcrhtmzvssfdazkkzk.supabase.co"; }
function vpreqKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; }

// ─── Status no grupo "Compras" do vpclick ────────────────────────────────────

const STATUS = {
  PENDENTE:              "PENDENTE",
  EM_PROGRESSO:          "EM PROGRESSO",
  AGUARDANDO_APROVACAO:  "AGUARDANDO APROVAÇÃO",
  APROVADO:              "APROVADO",
  CONCLUIDO:             "CONCLUÍDO",
  REPROVADO:             "REPROVADO",
} as const;

// ─── Cache do list_id do workspace "VP REQUISICOES" ─────────────────────────

let _cachedListId: string | null = null;

async function resolveListId(): Promise<string> {
  if (_cachedListId) return _cachedListId;
  try {
    const workspaces = await vpRest<Array<{ id: string; name: string }>>("workspaces?select=id,name&limit=50");
    const ws = (workspaces ?? []).find(
      (w) => w.name?.toUpperCase().replace(/\s/g, "").includes("VPREQUISIC"),
    );
    if (ws) {
      const lists = await vpRest<Array<{ id: string }>>(
        `lists?select=id&workspace_id=eq.${ws.id}&limit=1`,
      );
      const id = lists?.[0]?.id;
      if (id) { _cachedListId = id; return id; }
    }
  } catch { /* fall through */ }
  return vpclickListId();
}

// ─── REST helper — vpclick ───────────────────────────────────────────────────

async function vpRest<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T | null> {
  const key = vpclickKey();
  if (!key) return null;
  try {
    const resp = await fetch(`${vpclickUrl()}/rest/v1/${path}`, {
      method: options?.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!resp.ok) return null;
    if (resp.status === 204) return null;
    return resp.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─── REST helper — VPRequisições (service role, bypassa RLS) ─────────────────

async function vpreqRest<T>(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T | null> {
  const key = vpreqKey();
  if (!key) return null;
  try {
    const resp = await fetch(`${vpreqUrl()}/rest/v1/${path}`, {
      method: options?.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options?.headers,
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!resp.ok) return null;
    if (resp.status === 204) return null;
    return resp.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─── Helpers de usuários ─────────────────────────────────────────────────────

/** Busca IDs de todos os usuários com determinado papel em VPRequisições */
async function getUserIdsByRole(role: string): Promise<string[]> {
  const rows = await vpreqRest<Array<{ user_id: string }>>(
    `user_roles?select=user_id&role=eq.${encodeURIComponent(role)}`,
  );
  return (rows ?? []).map((r) => r.user_id);
}

/** Busca emails de uma lista de user_ids em VPRequisições */
async function getEmailsByUserIds(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const ids = userIds.map((id) => `"${id}"`).join(",");
  const rows = await vpreqRest<Array<{ email: string }>>(
    `profiles?select=email&id=in.(${ids})`,
  );
  return (rows ?? []).map((r) => r.email).filter(Boolean);
}

/** Busca o ID de um perfil no vpclick pelo e-mail */
async function getVpClickUserIdByEmail(email: string): Promise<string | null> {
  const rows = await vpRest<Array<{ id: string }>>(
    `profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
  );
  return rows?.[0]?.id ?? null;
}

/** Resolve IDs no vpclick a partir de uma lista de user_ids em VPRequisições */
async function getVpClickIdsForUserIds(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const emails = await getEmailsByUserIds(userIds);
  const vpIds = await Promise.all(emails.map((e) => getVpClickUserIdByEmail(e)));
  return vpIds.filter((id): id is string => !!id);
}

/** Retorna lista de IDs no vpclick para todos os usuários com dado papel em VPRequisições */
async function getAssigneesByRole(role: string): Promise<string[]> {
  const userIds = await getUserIdsByRole(role);
  return getVpClickIdsForUserIds(userIds);
}

/** Resolve quem deve decidir a etapa GESTOR de um requisitante: o aprovador
 *  designado dele (profiles.approver_id) ou, na falta desse, os gestores do
 *  departamento (department_managers) — mesma regra usada em
 *  features/gestor/api.ts (assertCanDecide). */
async function resolveGestorUserIds(requesterId: string | undefined, department: string | undefined): Promise<string[]> {
  if (requesterId) {
    const rows = await vpreqRest<Array<{ approver_id: string | null }>>(
      `profiles?select=approver_id&id=eq.${requesterId}&limit=1`,
    );
    const approverId = rows?.[0]?.approver_id;
    if (approverId) return [approverId];
  }
  if (department) {
    const rows = await vpreqRest<Array<{ manager_user_id: string }>>(
      `department_managers?select=manager_user_id&department=eq.${encodeURIComponent(department)}`,
    );
    const ids = (rows ?? []).map((r) => r.manager_user_id);
    if (ids.length) return ids;
  }
  return [];
}

// ─── Helpers de tarefas ──────────────────────────────────────────────────────

/** Cria uma tarefa no vpclick e retorna o ID gerado */
async function createTask(input: {
  title: string;
  description: string;
  status: string;
  assigneeIds: string[];
}): Promise<string | null> {
  const [main, ...secondary] = input.assigneeIds;
  const listId = await resolveListId();
  const rows = await vpRest<Array<{ id: string }>>("tasks", {
    method: "POST",
    body: [
      {
        title: input.title,
        description: input.description,
        status: input.status,
        list_id: listId,
        main_assignee_id: main ?? null,
        secondary_assignee_ids: secondary,
        priority: "Média",
      },
    ],
  });
  return rows?.[0]?.id ?? null;
}

/** Atualiza o status de uma tarefa no vpclick */
async function updateTaskStatus(taskId: string, status: string): Promise<void> {
  await vpRest(`tasks?id=eq.${taskId}`, {
    method: "PATCH",
    body: { status },
  });
}

/** Persiste o ID da tarefa vpclick no audit_log de VPRequisições */
async function saveTaskId(
  requisitionId: string,
  ticketNumber: string,
  stage: string,
  vpclickTaskId: string,
): Promise<void> {
  await vpreqRest("audit_logs", {
    method: "POST",
    body: [
      {
        requisition_id: requisitionId,
        ticket_number: ticketNumber,
        action: "VPCLICK_TASK_CREATED",
        details: { stage, vpclick_task_id: vpclickTaskId },
      },
    ],
  });
}

/** Recupera o ID de uma tarefa vpclick registrada para uma etapa anterior */
async function getTaskId(requisitionId: string, stage: string): Promise<string | null> {
  type Row = { details: { stage?: string; vpclick_task_id?: string } };
  const rows = await vpreqRest<Row[]>(
    `audit_logs?select=details&requisition_id=eq.${requisitionId}&action=eq.VPCLICK_TASK_CREATED&order=created_at.desc&limit=20`,
  );
  const match = (rows ?? []).find((r) => r.details?.stage === stage);
  return match?.details?.vpclick_task_id ?? null;
}

// ─── Mapeamento de módulos ────────────────────────────────────────────────────

function moduleLabel(module: string): string {
  const map: Record<string, string> = {
    // Códigos
    M1: "Produto", M2: "Viagem", M3: "Serviço",
    M4: "Manutenção", M5: "Frete", M6: "Locação",
    // Categorias (receipts/purchases)
    produto: "Produto", viagem: "Viagem", servico: "Serviço",
    manutencao: "Manutenção", frete: "Frete", locacao: "Locação",
  };
  // Labels completos como "M1 — Produtos"
  for (const [key, label] of Object.entries(map)) {
    if (module.startsWith(key)) return label;
  }
  return module;
}

// ─── Schema de entrada ───────────────────────────────────────────────────────

const notifySchema = z.object({
  /** Etapa do fluxo que foi concluída */
  stage: z.enum(["V1", "V2", "V3_approved", "V3_rejected", "V4", "V5", "GESTOR_URGENT", "GESTOR_APPROVED", "GESTOR_REJECTED"]),
  /** UUID da requisição em VPRequisições */
  requisitionId: z.string(),
  /** Ex: "M1-45685" */
  ticketNumber: z.string(),
  /** Título da requisição */
  title: z.string(),
  /** "M1", "M2" ... "M6" */
  module: z.string(),
  /** Nome do requisitante */
  requesterName: z.string(),
  /** V4 only: se a compra exige recebimento (V5) */
  requiresReceipt: z.boolean().optional().default(false),
  /** GESTOR_URGENT only: quem pediu (resolve o aprovador designado) e o departamento (fallback) */
  requesterId: z.string().optional(),
  requesterDepartment: z.string().optional(),
});

// ─── Server function principal ───────────────────────────────────────────────

export const notifyVpClickStage = createServerFn({ method: "POST" })
  .inputValidator(notifySchema)
  .handler(async ({ data }) => {
    const base = vpreqBaseUrl();
    const mod  = moduleLabel(data.module);
    const { stage, requisitionId, ticketNumber, title, requesterName } = data;

    try {
      // ── V1: Requisição criada → tarefa para comprador cotar ────────────────
      if (stage === "V1") {
        const assignees = await getAssigneesByRole("comprador");
        const taskId = await createTask({
          title: `${ticketNumber} — ${title}`,
          description:
            `**Ticket:** ${ticketNumber}\n` +
            `**Descrição:** ${title}\n` +
            `**Módulo:** ${mod}\n` +
            `**Requisitante:** ${requesterName}\n\n` +
            `🔗 Cotar agora: ${base}/quoting`,
          status: STATUS.PENDENTE,
          assigneeIds: assignees,
        });
        if (taskId) await saveTaskId(requisitionId, ticketNumber, "V1", taskId);
      }

      // ── V2: Cotação finalizada → conclui V1 + tarefa para aprovador ────────
      else if (stage === "V2") {
        const v1Id = await getTaskId(requisitionId, "V1");
        if (v1Id) await updateTaskStatus(v1Id, STATUS.CONCLUIDO);

        const assignees = await getAssigneesByRole("aprovador");
        const taskId = await createTask({
          title: `${ticketNumber} — Cotação: ${title}`,
          description:
            `**Ticket:** ${ticketNumber}\n` +
            `**Descrição:** ${title}\n` +
            `**Módulo:** ${mod}\n` +
            `**Requisitante:** ${requesterName}\n\n` +
            `🔗 Aprovar agora: ${base}/approval`,
          status: STATUS.AGUARDANDO_APROVACAO,
          assigneeIds: assignees,
        });
        if (taskId) await saveTaskId(requisitionId, ticketNumber, "V2", taskId);
      }

      // ── V3 Aprovado → conclui V2 + tarefa para comprador finalizar compra ──
      else if (stage === "V3_approved") {
        const v2Id = await getTaskId(requisitionId, "V2");
        if (v2Id) await updateTaskStatus(v2Id, STATUS.CONCLUIDO);

        const assignees = await getAssigneesByRole("comprador");
        const taskId = await createTask({
          title: `${ticketNumber} — Aprovado: ${title}`,
          description:
            `**Ticket:** ${ticketNumber}\n` +
            `**Descrição:** ${title}\n` +
            `**Módulo:** ${mod}\n` +
            `**Requisitante:** ${requesterName}\n\n` +
            `🔗 Finalizar compra: ${base}/purchasing`,
          status: STATUS.APROVADO,
          assigneeIds: assignees,
        });
        if (taskId) await saveTaskId(requisitionId, ticketNumber, "V3", taskId);
      }

      // ── V3 Reprovado → marca V2 como REPROVADO, sem nova tarefa ────────────
      else if (stage === "V3_rejected") {
        const v2Id = await getTaskId(requisitionId, "V2");
        if (v2Id) await updateTaskStatus(v2Id, STATUS.REPROVADO);
      }

      // ── V4: Compra confirmada → conclui V3 + (se V5) tarefa para almoxarife
      else if (stage === "V4") {
        const v3Id = await getTaskId(requisitionId, "V3");
        if (v3Id) await updateTaskStatus(v3Id, STATUS.CONCLUIDO);

        if (data.requiresReceipt) {
          const assignees = await getAssigneesByRole("almoxarife");
          const taskId = await createTask({
            title: `${ticketNumber} — Receber: ${title}`,
            description:
              `**Ticket:** ${ticketNumber}\n` +
              `**Descrição:** ${title}\n` +
              `**Módulo:** ${mod}\n` +
              `**Requisitante:** ${requesterName}\n\n` +
              `🔗 Registrar recebimento: ${base}/receipt`,
            status: STATUS.EM_PROGRESSO,
            assigneeIds: assignees,
          });
          if (taskId) await saveTaskId(requisitionId, ticketNumber, "V4", taskId);
        }
      }

      // ── V5: Recebimento registrado → conclui V4 ───────────────────────────
      else if (stage === "V5") {
        const v4Id = await getTaskId(requisitionId, "V4");
        if (v4Id) await updateTaskStatus(v4Id, STATUS.CONCLUIDO);
      }

      // ── GESTOR_URGENT: requisição urgente (pouca antecedência) criada →
      //    escalona para o aprovador designado (ou gestor do departamento),
      //    em vez de esperar ele abrir a fila manualmente ────────────────────
      else if (stage === "GESTOR_URGENT") {
        let assignees = await resolveGestorUserIds(data.requesterId, data.requesterDepartment);
        assignees = await getVpClickIdsForUserIds(assignees);
        if (!assignees.length) assignees = await getAssigneesByRole("aprovador");

        const taskId = await createTask({
          title: `🚨 URGENTE — ${ticketNumber} — ${title}`,
          description:
            `**Ticket:** ${ticketNumber}\n` +
            `**Descrição:** ${title}\n` +
            `**Módulo:** ${mod}\n` +
            `**Requisitante:** ${requesterName}\n\n` +
            `⚠️ Pouca antecedência — aprovar o quanto antes para não atrasar cotação e compra.\n\n` +
            `🔗 Aprovar agora: ${base}/approval`,
          status: STATUS.AGUARDANDO_APROVACAO,
          assigneeIds: assignees,
        });
        if (taskId) await saveTaskId(requisitionId, ticketNumber, "GESTOR_URGENT", taskId);
      }

      // ── GESTOR_APPROVED / GESTOR_REJECTED: conclui a tarefa de escalonamento
      //    (só existe se a requisição realmente tinha entrado como urgente) ──
      else if (stage === "GESTOR_APPROVED" || stage === "GESTOR_REJECTED") {
        const gestorTaskId = await getTaskId(requisitionId, "GESTOR_URGENT");
        if (gestorTaskId) {
          await updateTaskStatus(gestorTaskId, stage === "GESTOR_APPROVED" ? STATUS.APROVADO : STATUS.REPROVADO);
        }
      }
    } catch (err) {
      // Nunca propaga — vpclick é efeito colateral
      console.warn("[vpclick]", stage, ticketNumber, err instanceof Error ? err.message : err);
    }

    return { ok: true };
  });

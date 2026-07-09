import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";
import { STAGE_TARGETS } from "@/features/analytics/api";

/* Estágios e rótulos únicos, compartilhados com o Analytics via STAGE_TARGETS */
const STAGE_LABELS: Record<string, string> = {
  GESTOR: "Gestor",
  COTAÇÃO: "Cotação",
  APROVAÇÃO: "Aprovação",
  COMPRA: "Compra",
  RECEBIMENTO: "Recebimento",
};

const ACTION_STAGE: Record<string, string> = {
  GESTOR_APPROVED: "GESTOR",
  GESTOR_REJECTED: "GESTOR",
  REQUISITION_EDITED: "GESTOR",
  QUOTATION_STARTED: "COTAÇÃO",
  WINNER_SELECTED: "COTAÇÃO",
  M2_QUOTE_COMPLETED: "COTAÇÃO",
  APPROVAL_REQUESTED: "COTAÇÃO",
  APPROVAL_GRANTED: "APROVAÇÃO",
  APPROVAL_REJECTED: "APROVAÇÃO",
  PURCHASE_CONFIRMED: "COMPRA",
  RECEIPT_REGISTERED: "RECEBIMENTO",
};

const ACTION_DESCRIPTION: Record<string, string> = {
  GESTOR_APPROVED: "Aprovada pelo gestor",
  GESTOR_REJECTED: "Reprovada pelo gestor",
  REQUISITION_EDITED: "Requisição editada",
  QUOTATION_STARTED: "Cotação iniciada",
  WINNER_SELECTED: "Fornecedor vencedor selecionado",
  M2_QUOTE_COMPLETED: "Cotação de viagem concluída",
  APPROVAL_REQUESTED: "Enviada para aprovação",
  APPROVAL_GRANTED: "Aprovada",
  APPROVAL_REJECTED: "Reprovada",
  PURCHASE_CONFIRMED: "Compra confirmada",
  RECEIPT_REGISTERED: "Recebimento registrado",
};

const STAGE_RECOMMENDATION: Record<string, string> = {
  GESTOR: "Enviar lembrete ao gestor aprovador do colaborador",
  COTAÇÃO: "Cobrar propostas dos fornecedores ou concluir a cotação",
  APROVAÇÃO: "Enviar lembrete ao aprovador da alçada responsável",
  COMPRA: "Concluir o pedido de compra com o fornecedor vencedor",
  RECEBIMENTO: "Confirmar prazo de entrega com o fornecedor",
};

type Requisition = {
  id: string;
  ticket_number: string;
  module: string;
  status: string;
  title: string;
  requester_name: string;
  requester_department: string | null;
  approver_id: string | null;
  created_at: string;
};

type AuditLog = {
  id: string;
  requisition_id: string | null;
  ticket_number: string | null;
  action: string;
  actor_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  department: string | null;
};
type UserRole = { user_id: string; role: string };
type Quotation = { requisition_id: string; buyer_id: string | null };

export interface LogsEntry {
  id: string;
  ticket: string;
  module: string;
  action: string;
  description: string;
  stage: string;
  actor: string;
  actorRole: string;
  actorDept: string;
  createdAt: string;
  elapsedHours: number;
  slaStatus: "ok" | "warning" | "breach";
}

export interface LogsPayload {
  stageMetrics: {
    stage: string;
    label: string;
    avg: number;
    target: number;
    count: number;
    status: "ok" | "warning" | "breach";
  }[];
  bottlenecks: {
    ticket: string;
    module: string;
    stage: string;
    stageLabel: string;
    hours: number;
    target: number;
    since: string;
    requester: string;
    title: string;
    responsible: string;
    responsibleRole: string;
    recommendation: string;
    escalation: boolean;
  }[];
  activeTickets: {
    ticket: string;
    module: string;
    title: string;
    requester: string;
    stage: string;
    stageLabel: string;
    createdAt: string;
    hoursElapsed: number;
    slaTargetHours: number;
    slaPct: number;
    slaStatus: "on_track" | "at_risk" | "breached";
    stageHours: number;
    stageTarget: number;
    stageBottleneck: boolean;
    responsible: string;
  }[];
  entries: LogsEntry[];
  ticketMeta: Record<string, { title: string; requester: string; status: string; module: string }>;
  totalEntries: number;
  generatedAt: string;
}

const hoursBetween = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/* Metas de SLA total (soma das etapas) para % de ciclo dos tickets ativos */
const TOTAL_TARGET = Object.values(STAGE_TARGETS).reduce((a, b) => a + b, 0);

const ROLE_PRIORITY = ["admin", "aprovador", "comprador", "almoxarife", "solicitante"];
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  aprovador: "Aprovador",
  comprador: "Comprador",
  almoxarife: "Almoxarife",
  solicitante: "Solicitante",
};

export const getLogsOverview = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      entriesLimit: z.number().int().min(1).max(2000).default(200),
    }),
  )
  .handler(async ({ data }): Promise<LogsPayload> => {
    const now = new Date();

    const [reqsResp, logsResp, profilesResp, rolesResp, quotsResp] = await Promise.all([
      supabaseRest<Requisition[]>(
        `requisitions?select=id,ticket_number,module,status,title,requester_name,requester_department,approver_id,created_at&order=created_at.desc&limit=10000`,
      ),
      supabaseRest<AuditLog[]>(
        `audit_logs?select=id,requisition_id,ticket_number,action,actor_name,details,created_at&order=created_at.desc&limit=5000`,
      ),
      supabaseRest<Profile[]>(`profiles?select=id,full_name,email,department&limit=1000`),
      supabaseRest<UserRole[]>(`user_roles?select=user_id,role&limit=5000`),
      supabaseRest<Quotation[]>(`quotations?select=requisition_id,buyer_id&limit=10000`),
    ]);

    const reqs = reqsResp.data ?? [];
    const logs = logsResp.data ?? [];
    const profiles = profilesResp.data ?? [];
    const roles = rolesResp.data ?? [];
    const quotations = quotsResp.data ?? [];

    const reqById = new Map(reqs.map((r) => [r.id, r]));
    const reqByTicket = new Map(reqs.map((r) => [r.ticket_number, r]));
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const profileByName = new Map(
      profiles.filter((p) => p.full_name).map((p) => [p.full_name!.trim().toLowerCase(), p]),
    );
    const buyerByReq = new Map(quotations.map((q) => [q.requisition_id, q.buyer_id]));

    const rolesByUser = new Map<string, string[]>();
    for (const r of roles) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }
    const primaryRole = (userId: string | undefined) => {
      if (!userId) return "—";
      const list = rolesByUser.get(userId) ?? [];
      const top = ROLE_PRIORITY.find((r) => list.includes(r));
      return top ? ROLE_LABELS[top] : "—";
    };

    // Logs por requisição em ordem cronológica (para durações)
    const logsByReq = new Map<string, AuditLog[]>();
    for (const l of logs) {
      if (!l.requisition_id) continue;
      const arr = logsByReq.get(l.requisition_id) ?? [];
      arr.push(l);
      logsByReq.set(l.requisition_id, arr);
    }
    for (const arr of logsByReq.values()) arr.reverse();

    /* ── Médias por estágio (instâncias concluídas — mesma regra do Analytics) ── */
    const findIn = (arr: AuditLog[], action: string) =>
      arr.find((l) => l.action === action)?.created_at ?? null;
    const stageHoursMap: Record<string, number[]> = {
      GESTOR: [],
      COTAÇÃO: [],
      APROVAÇÃO: [],
      COMPRA: [],
      RECEBIMENTO: [],
    };
    for (const r of reqs) {
      const rl = logsByReq.get(r.id) ?? [];
      const gestorEnd = findIn(rl, "GESTOR_APPROVED");
      const apprStart = findIn(rl, "APPROVAL_REQUESTED");
      const apprEnd = findIn(rl, "APPROVAL_GRANTED") ?? findIn(rl, "APPROVAL_REJECTED");
      const granted = findIn(rl, "APPROVAL_GRANTED");
      const purchEnd = findIn(rl, "PURCHASE_CONFIRMED");
      const recEnd = findIn(rl, "RECEIPT_REGISTERED");
      if (gestorEnd) stageHoursMap.GESTOR.push(hoursBetween(r.created_at, gestorEnd));
      if (gestorEnd && apprStart) stageHoursMap["COTAÇÃO"].push(hoursBetween(gestorEnd, apprStart));
      if (apprStart && apprEnd) stageHoursMap["APROVAÇÃO"].push(hoursBetween(apprStart, apprEnd));
      if (granted && purchEnd) stageHoursMap.COMPRA.push(hoursBetween(granted, purchEnd));
      if (purchEnd && recEnd) stageHoursMap.RECEBIMENTO.push(hoursBetween(purchEnd, recEnd));
    }
    const stageMetrics = Object.keys(STAGE_TARGETS).map((stage) => {
      const list = stageHoursMap[stage];
      const avg = list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : 0;
      const target = STAGE_TARGETS[stage];
      const status: "ok" | "warning" | "breach" =
        list.length === 0
          ? "ok"
          : avg >= target
            ? "breach"
            : avg >= target * 0.75
              ? "warning"
              : "ok";
      return { stage, label: STAGE_LABELS[stage], avg, target, count: list.length, status };
    });

    /* ── Tickets ativos + gargalos ── */
    const OPEN = new Set(["GESTOR", "ABERTO", "COTAÇÃO", "APROVAÇÃO", "COMPRA", "RECEBIMENTO"]);
    const currentStageOf = (r: Requisition, rl: AuditLog[]) => {
      if (r.status === "GESTOR") return { stage: "GESTOR", start: r.created_at };
      if (r.status === "ABERTO" || r.status === "COTAÇÃO")
        return { stage: "COTAÇÃO", start: findIn(rl, "GESTOR_APPROVED") ?? r.created_at };
      if (r.status === "APROVAÇÃO")
        return { stage: "APROVAÇÃO", start: findIn(rl, "APPROVAL_REQUESTED") ?? r.created_at };
      if (r.status === "COMPRA")
        return { stage: "COMPRA", start: findIn(rl, "APPROVAL_GRANTED") ?? r.created_at };
      return { stage: "RECEBIMENTO", start: findIn(rl, "PURCHASE_CONFIRMED") ?? r.created_at };
    };

    const responsibleFor = (r: Requisition, stage: string): { name: string; role: string } => {
      if (stage === "GESTOR") {
        const p = r.approver_id ? profileById.get(r.approver_id) : null;
        return {
          name: p?.full_name ?? p?.email ?? "Gestor não designado",
          role: "Gestor aprovador",
        };
      }
      if (stage === "COTAÇÃO" || stage === "COMPRA") {
        const buyerId = buyerByReq.get(r.id);
        const p = buyerId ? profileById.get(buyerId) : null;
        return { name: p?.full_name ?? "Equipe de Compras", role: "Comprador" };
      }
      if (stage === "APROVAÇÃO") return { name: "Aprovador da alçada", role: "Aprovador" };
      return { name: "Almoxarifado", role: "Almoxarife" };
    };

    const activeTickets: LogsPayload["activeTickets"] = [];
    const bottlenecks: LogsPayload["bottlenecks"] = [];
    for (const r of reqs.filter((x) => OPEN.has(x.status))) {
      const rl = logsByReq.get(r.id) ?? [];
      const { stage, start } = currentStageOf(r, rl);
      const stageTarget = STAGE_TARGETS[stage];
      const stageHours = hoursBetween(start, now.toISOString());
      const hoursElapsed = hoursBetween(r.created_at, now.toISOString());
      const slaPct = (hoursElapsed / TOTAL_TARGET) * 100;
      const stageBottleneck = stageHours > stageTarget;
      const resp = responsibleFor(r, stage);
      const slaStatus: "on_track" | "at_risk" | "breached" =
        stageBottleneck || slaPct >= 100
          ? "breached"
          : stageHours > stageTarget * 0.75 || slaPct >= 75
            ? "at_risk"
            : "on_track";

      activeTickets.push({
        ticket: r.ticket_number,
        module: r.module,
        title: r.title,
        requester: r.requester_name,
        stage,
        stageLabel: STAGE_LABELS[stage],
        createdAt: r.created_at,
        hoursElapsed: Math.round(hoursElapsed),
        slaTargetHours: TOTAL_TARGET,
        slaPct: round1(slaPct),
        slaStatus,
        stageHours: Math.round(stageHours),
        stageTarget,
        stageBottleneck,
        responsible: resp.name,
      });

      if (stageBottleneck) {
        bottlenecks.push({
          ticket: r.ticket_number,
          module: r.module,
          stage,
          stageLabel: STAGE_LABELS[stage],
          hours: Math.round(stageHours),
          target: stageTarget,
          since: start,
          requester: r.requester_name,
          title: r.title,
          responsible: resp.name,
          responsibleRole: resp.role,
          recommendation: STAGE_RECOMMENDATION[stage],
          escalation: stageHours > stageTarget * 2,
        });
      }
    }
    activeTickets.sort((a, b) => b.stageHours / b.stageTarget - a.stageHours / a.stageTarget);
    bottlenecks.sort((a, b) => b.hours / b.target - a.hours / a.target);

    /* ── Timeline enriquecida ── */
    const visibleLogs = logs.filter((l) => l.action !== "VPCLICK_TASK_CREATED");
    const entries: LogsEntry[] = visibleLogs.slice(0, data.entriesLimit).map((l) => {
      const req = l.requisition_id
        ? reqById.get(l.requisition_id)
        : reqByTicket.get(l.ticket_number ?? "");
      const rl = l.requisition_id ? (logsByReq.get(l.requisition_id) ?? []) : [];
      const idx = rl.findIndex((x) => x.id === l.id);
      const prevAt = idx > 0 ? rl[idx - 1].created_at : (req?.created_at ?? l.created_at);
      const elapsed = Math.max(0, hoursBetween(prevAt, l.created_at));
      const stage = ACTION_STAGE[l.action] ?? "GESTOR";
      const target = STAGE_TARGETS[stage];
      const slaStatus: "ok" | "warning" | "breach" =
        elapsed >= target ? "breach" : elapsed >= target * 0.75 ? "warning" : "ok";

      const actorProfile = l.actor_name
        ? profileByName.get(l.actor_name.trim().toLowerCase())
        : undefined;
      const det = (l.details ?? {}) as Record<string, unknown>;
      const suppliersCount =
        typeof det.suppliers_count === "number" ? ` — ${det.suppliers_count} fornecedores` : "";

      return {
        id: l.id,
        ticket: l.ticket_number ?? req?.ticket_number ?? "—",
        module: req?.module ?? (l.ticket_number ?? "??").slice(0, 2),
        action: l.action,
        description:
          (ACTION_DESCRIPTION[l.action] ?? l.action.replace(/_/g, " ").toLowerCase()) +
          suppliersCount,
        stage,
        actor: l.actor_name ?? "Sistema",
        actorRole: primaryRole(actorProfile?.id),
        actorDept: actorProfile?.department ?? "—",
        createdAt: l.created_at,
        elapsedHours: round1(elapsed),
        slaStatus,
      };
    });

    const ticketMeta: LogsPayload["ticketMeta"] = {};
    for (const r of reqs) {
      ticketMeta[r.ticket_number] = {
        title: r.title,
        requester: r.requester_name,
        status: r.status,
        module: r.module,
      };
    }

    return {
      stageMetrics,
      bottlenecks: bottlenecks.slice(0, 10),
      activeTickets,
      entries,
      ticketMeta,
      totalEntries: visibleLogs.length,
      generatedAt: now.toISOString(),
    };
  });

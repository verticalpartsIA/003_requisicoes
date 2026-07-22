import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";

/* ────────────────────────────────────────────────
 * Metas de SLA por estágio (horas). Config de negócio,
 * ajustável aqui num único lugar.
 * ──────────────────────────────────────────────── */
export const STAGE_TARGETS: Record<string, number> = {
  GESTOR: 24,
  COTAÇÃO: 72,
  APROVAÇÃO: 72,
  COMPRA: 48,
  RECEBIMENTO: 168,
};

const MODULE_META = [
  { key: "M1", name: "Produtos", fill: "#3B82F6" },
  { key: "M2", name: "Viagens", fill: "#10B981" },
  { key: "M3", name: "Serviços", fill: "#8B5CF6" },
  { key: "M4", name: "Manutenção", fill: "#F59E0B" },
  { key: "M5", name: "Frete", fill: "#EF4444" },
  { key: "M6", name: "Locação", fill: "#06B6D4" },
] as const;

type Requisition = {
  id: string;
  ticket_number: string;
  module: string;
  status: string;
  urgency: string;
  requester_name: string;
  created_at: string;
  completed_at: string | null;
};

type Approval = {
  requisition_id: string;
  approval_level: number;
  total_value: number | null;
  decision: string;
  decided_at: string | null;
  created_at: string;
};

type Quotation = { id: string; requisition_id: string; started_at: string | null; completed_at: string | null };
type QuotationSupplier = { quotation_id: string; supplier_name: string; price: number | null; is_winner: boolean };
type Purchase = { requisition_id: string; supplier_name: string; supplier_price: number | null; buyer_id: string | null; created_at: string };
type AuditLog = { requisition_id: string | null; ticket_number: string | null; action: string; actor_name: string | null; created_at: string; new_status: string | null };
type Profile = { id: string; full_name: string | null; email: string | null };

export interface AnalyticsPayload {
  kpis: {
    totalReqs: number;
    totalReqsDelta: number | null;
    avgCycleHours: number | null;
    avgCycleDeltaHours: number | null;
    slaCompliance: number | null;
    slaComplianceDelta: number | null;
    approvalRate: number | null;
    approvalRateDelta: number | null;
  };
  volumeTrend: Record<string, string | number>[];
  moduleDist: { name: string; value: number; fill: string }[];
  stageDuration: { stage: string; label: string; avg: number; median: number; p95: number; target: number; count: number }[];
  slaByModule: { module: string; label: string; compliance: number | null }[];
  slaBreakdown: { onTime: number; atRisk: number; exceeded: number };
  slaTrend: { month: string; compliance_rate: number | null }[];
  approvalsByLevel: { level: number; count: number; totalValue: number }[];
  quality: { approvalRate: number | null; rejectedCount: number; cancelledCount: number; editedCount: number };
  efficiency: { purchasesCount: number; quotationsCompleted: number; avgQuotationHours: number | null };
  topBuyers: { name: string; purchases: number; totalValue: number }[];
  financial: {
    approvedTotal: number;
    purchasedTotal: number;
    savings: number;
    savingsPct: number | null;
    monthlySavings: { month: string; original: number; final: number; savings: number }[];
    spendByModule: { module: string; label: string; value: number; pct: number; count: number }[];
    topSuppliers: { name: string; value: number; count: number }[];
  };
  bottlenecks: { ticket: string; module: string; stage: string; hours: number; target: number; requester: string }[];
  feed: { id: string; action: string; ticket: string | null; actor: string | null; createdAt: string }[];
  live: { reqsToday: number; valueApprovedToday: number; activeBottlenecks: number; slaCompliance: number | null };
  generatedAt: string;
}

/* helpers */
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const monthLabel = (d: Date) => `${MONTHS_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
const dayLabel = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const round1 = (n: number) => Math.round(n * 10) / 10;

function periodStart(period: string, now: Date): Date {
  const d = new Date(now);
  if (period === "30d") d.setDate(d.getDate() - 30);
  else if (period === "3m") d.setMonth(d.getMonth() - 3);
  else if (period === "6m") d.setMonth(d.getMonth() - 6);
  else d.setMonth(d.getMonth() - 12);
  return d;
}

/** Instâncias de estágio concluídas de uma requisição, a partir do audit trail. */
function stageInstances(req: Requisition, logs: AuditLog[]) {
  const find = (action: string) => logs.find((l) => l.action === action)?.created_at ?? null;
  const gestorEnd = find("GESTOR_APPROVED");
  const approvalStart = find("APPROVAL_REQUESTED");
  const approvalEnd = find("APPROVAL_GRANTED") ?? find("APPROVAL_REJECTED");
  const purchaseEnd = find("PURCHASE_CONFIRMED");
  const receiptEnd = find("RECEIPT_REGISTERED");

  const out: { stage: string; hours: number; endedAt: string }[] = [];
  if (gestorEnd) out.push({ stage: "GESTOR", hours: hoursBetween(req.created_at, gestorEnd), endedAt: gestorEnd });
  if (gestorEnd && approvalStart) out.push({ stage: "COTAÇÃO", hours: hoursBetween(gestorEnd, approvalStart), endedAt: approvalStart });
  if (approvalStart && approvalEnd) out.push({ stage: "APROVAÇÃO", hours: hoursBetween(approvalStart, approvalEnd), endedAt: approvalEnd });
  const granted = find("APPROVAL_GRANTED");
  if (granted && purchaseEnd) out.push({ stage: "COMPRA", hours: hoursBetween(granted, purchaseEnd), endedAt: purchaseEnd });
  if (purchaseEnd && receiptEnd) out.push({ stage: "RECEBIMENTO", hours: hoursBetween(purchaseEnd, receiptEnd), endedAt: receiptEnd });
  return out;
}

/** Início e meta do estágio atual de uma requisição em aberto. */
function currentStageInfo(req: Requisition, logs: AuditLog[]) {
  const find = (action: string) => logs.find((l) => l.action === action)?.created_at ?? null;
  const status = req.status;
  if (status === "GESTOR") return { start: req.created_at, target: STAGE_TARGETS.GESTOR, stage: "GESTOR" };
  if (status === "ABERTO" || status === "COTAÇÃO")
    return { start: find("GESTOR_APPROVED") ?? req.created_at, target: STAGE_TARGETS["COTAÇÃO"], stage: "COTAÇÃO" };
  if (status === "APROVAÇÃO")
    return { start: find("APPROVAL_REQUESTED") ?? req.created_at, target: STAGE_TARGETS["APROVAÇÃO"], stage: "APROVAÇÃO" };
  if (status === "COMPRA")
    return { start: find("APPROVAL_GRANTED") ?? req.created_at, target: STAGE_TARGETS.COMPRA, stage: "COMPRA" };
  if (status === "RECEBIMENTO")
    return { start: find("PURCHASE_CONFIRMED") ?? req.created_at, target: STAGE_TARGETS.RECEBIMENTO, stage: "RECEBIMENTO" };
  return null;
}

export const getAnalytics = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    period: z.enum(["30d", "3m", "6m", "12m"]),
    module: z.string().default("Todos"),
    compare: z.enum(["none", "previous_period", "same_period_last_year"]).default("none"),
  }))
  .handler(async ({ data }): Promise<AnalyticsPayload> => {
    const now = new Date();
    const start = periodStart(data.period, now);
    const windowMs = now.getTime() - start.getTime();

    let cmpStart: Date | null = null;
    let cmpEnd: Date | null = null;
    if (data.compare === "previous_period") {
      cmpEnd = start;
      cmpStart = new Date(start.getTime() - windowMs);
    } else if (data.compare === "same_period_last_year") {
      cmpStart = new Date(start); cmpStart.setFullYear(cmpStart.getFullYear() - 1);
      cmpEnd = new Date(now); cmpEnd.setFullYear(cmpEnd.getFullYear() - 1);
    }

    const moduleFilter = data.module !== "Todos" ? `&module=eq.${data.module}` : "";

    // requisitions/approvals/purchases NÃO são filtradas por created_at aqui —
    // um ticket criado antes do período pode ter sido aprovado, comprado ou
    // editado DENTRO do período selecionado, e essas ações é que precisam
    // cair na janela (via inWindow abaixo), não a criação do ticket. Filtrar
    // a busca por created_at>=fetchFrom fazia esse histórico "sumir" (tudo
    // zerado/vazio) sempre que o ticket era mais antigo que o período — a
    // base de tickets é pequena, então buscar tudo não pesa.
    const [reqsResp, approvalsResp, quotationsResp, suppliersResp, purchasesResp, logsResp, profilesResp] = await Promise.all([
      supabaseRest<Requisition[]>(
        `requisitions?select=id,ticket_number,module,status,urgency,requester_name,created_at,completed_at${moduleFilter}&order=created_at.asc&limit=10000`,
      ),
      supabaseRest<Approval[]>(
        `approvals?select=requisition_id,approval_level,total_value,decision,decided_at,created_at&limit=10000`,
      ),
      supabaseRest<Quotation[]>(`quotations?select=id,requisition_id,started_at,completed_at&limit=10000`),
      supabaseRest<QuotationSupplier[]>(`quotation_suppliers?select=quotation_id,supplier_name,price,is_winner&limit=10000`),
      supabaseRest<Purchase[]>(
        `purchases?select=requisition_id,supplier_name,supplier_price,buyer_id,created_at&limit=10000`,
      ),
      supabaseRest<AuditLog[]>(
        `audit_logs?select=requisition_id,ticket_number,action,actor_name,created_at,new_status&order=created_at.desc&limit=5000`,
      ),
      supabaseRest<Profile[]>(`profiles?select=id,full_name,email&limit=1000`),
    ]);

    const allReqs = reqsResp.data ?? [];
    const allApprovals = approvalsResp.data ?? [];
    const quotations = quotationsResp.data ?? [];
    const suppliers = suppliersResp.data ?? [];
    const allPurchases = purchasesResp.data ?? [];
    const logs = logsResp.data ?? [];
    const profiles = profilesResp.data ?? [];

    const inWindow = (iso: string, s: Date, e: Date) => {
      const t = new Date(iso).getTime();
      return t >= s.getTime() && t <= e.getTime();
    };

    const reqs = allReqs.filter((r) => inWindow(r.created_at, start, now));
    const cmpReqs = cmpStart && cmpEnd ? allReqs.filter((r) => inWindow(r.created_at, cmpStart, cmpEnd)) : null;

    const reqById = new Map(allReqs.map((r) => [r.id, r]));
    const logsByReq = new Map<string, AuditLog[]>();
    for (const l of logs) {
      if (!l.requisition_id) continue;
      const arr = logsByReq.get(l.requisition_id) ?? [];
      arr.push(l);
      logsByReq.set(l.requisition_id, arr);
    }
    // logs vieram desc; para os cálculos usamos o primeiro match — inverte para asc
    for (const arr of logsByReq.values()) arr.reverse();

    const moduleAllowed = (mod: string) => data.module === "Todos" || mod === data.module;

    /* ── Instâncias de estágio (para SLA) ── */
    type Inst = { stage: string; hours: number; endedAt: string; module: string };
    const instancesAll: Inst[] = [];
    for (const r of allReqs) {
      const rl = logsByReq.get(r.id) ?? [];
      for (const inst of stageInstances(r, rl)) instancesAll.push({ ...inst, module: r.module });
    }
    const instWindow = instancesAll.filter((i) => inWindow(i.endedAt, start, now) && moduleAllowed(i.module));
    const instCmp = cmpStart && cmpEnd
      ? instancesAll.filter((i) => inWindow(i.endedAt, cmpStart, cmpEnd) && moduleAllowed(i.module))
      : null;

    const complianceOf = (list: Inst[]): number | null => {
      if (list.length === 0) return null;
      const ok = list.filter((i) => i.hours <= (STAGE_TARGETS[i.stage] ?? Infinity)).length;
      return round1((ok / list.length) * 100);
    };

    /* ── KPIs ── */
    const cycleHoursList = reqs
      .filter((r) => r.completed_at)
      .map((r) => hoursBetween(r.created_at, r.completed_at!));
    const avgCycle = cycleHoursList.length
      ? Math.round(cycleHoursList.reduce((a, b) => a + b, 0) / cycleHoursList.length)
      : null;
    const cmpCycleList = cmpReqs
      ?.filter((r) => r.completed_at)
      .map((r) => hoursBetween(r.created_at, r.completed_at!));
    const cmpAvgCycle = cmpCycleList && cmpCycleList.length
      ? Math.round(cmpCycleList.reduce((a, b) => a + b, 0) / cmpCycleList.length)
      : null;

    const decidedIn = (list: Approval[], s: Date, e: Date) =>
      list.filter((a) => a.decided_at && inWindow(a.decided_at, s, e) && moduleAllowed(reqById.get(a.requisition_id)?.module ?? ""));
    const approvalRateOf = (list: Approval[]): number | null => {
      const approved = list.filter((a) => a.decision === "approved").length;
      const rejected = list.filter((a) => a.decision === "rejected").length;
      const total = approved + rejected;
      return total > 0 ? round1((approved / total) * 100) : null;
    };
    const decidedNow = decidedIn(allApprovals, start, now);
    const decidedCmp = cmpStart && cmpEnd ? decidedIn(allApprovals, cmpStart, cmpEnd) : null;

    const slaNow = complianceOf(instWindow);
    const slaCmp = instCmp ? complianceOf(instCmp) : null;
    const approvalRateNow = approvalRateOf(decidedNow);
    const approvalRateCmp = decidedCmp ? approvalRateOf(decidedCmp) : null;

    const pctDelta = (cur: number, prev: number | null | undefined) =>
      prev != null && prev > 0 ? round1(((cur - prev) / prev) * 100) : null;

    /* ── Volume trend (buckets reais) ── */
    const buckets: { key: string; label: string; from: Date; to: Date }[] = [];
    if (data.period === "30d") {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        buckets.push({ key: d.toISOString(), label: dayLabel(d), from: d, to: next });
      }
    } else {
      const n = data.period === "3m" ? 3 : data.period === "6m" ? 6 : 12;
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ key: d.toISOString(), label: monthLabel(d), from: d, to: next });
      }
    }
    const volumeTrend = buckets.map((b) => {
      const row: Record<string, string | number> = { month: b.label };
      for (const m of MODULE_META) row[m.key] = 0;
      for (const r of reqs) {
        const t = new Date(r.created_at).getTime();
        if (t >= b.from.getTime() && t < b.to.getTime() && row[r.module] !== undefined) {
          row[r.module] = (row[r.module] as number) + 1;
        }
      }
      return row;
    });

    /* ── Distribuição por módulo ── */
    const moduleDist = MODULE_META.filter((m) => moduleAllowed(m.key)).map((m) => ({
      name: m.name,
      value: reqs.filter((r) => r.module === m.key).length,
      fill: m.fill,
    }));

    /* ── Duração por estágio ── */
    const STAGE_LABELS: Record<string, string> = {
      GESTOR: "Gestor", COTAÇÃO: "Cotação", APROVAÇÃO: "Aprovação", COMPRA: "Compra", RECEBIMENTO: "Recebimento",
    };
    const stageDuration = Object.keys(STAGE_TARGETS).map((stage) => {
      const hours = instWindow.filter((i) => i.stage === stage).map((i) => i.hours).sort((a, b) => a - b);
      const avg = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0;
      return {
        stage,
        label: STAGE_LABELS[stage],
        avg: round1(avg),
        median: round1(percentile(hours, 50)),
        p95: round1(percentile(hours, 95)),
        target: STAGE_TARGETS[stage],
        count: hours.length,
      };
    });

    /* ── SLA por módulo ── */
    const slaByModule = MODULE_META.map((m) => ({
      module: m.key,
      label: m.name,
      compliance: complianceOf(instWindow.filter((i) => i.module === m.key)),
    }));

    /* ── Requisições abertas: no prazo / risco / excedido + gargalos ── */
    const OPEN = new Set(["GESTOR", "ABERTO", "COTAÇÃO", "APROVAÇÃO", "COMPRA", "RECEBIMENTO"]);
    let onTime = 0, atRisk = 0, exceeded = 0;
    const bottlenecks: AnalyticsPayload["bottlenecks"] = [];
    for (const r of allReqs.filter((x) => OPEN.has(x.status) && moduleAllowed(x.module))) {
      const info = currentStageInfo(r, logsByReq.get(r.id) ?? []);
      if (!info) continue;
      const h = hoursBetween(info.start, now.toISOString());
      if (h > info.target) {
        exceeded++;
        bottlenecks.push({
          ticket: r.ticket_number, module: r.module, stage: info.stage,
          hours: Math.round(h), target: info.target, requester: r.requester_name,
        });
      } else if (h > info.target * 0.75) atRisk++;
      else onTime++;
    }
    bottlenecks.sort((a, b) => b.hours / b.target - a.hours / a.target);

    /* ── Tendência de SLA (6 meses) ── */
    const slaTrend: AnalyticsPayload["slaTrend"] = [];
    for (let i = 5; i >= 0; i--) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthInst = instancesAll.filter((x) => inWindow(x.endedAt, from, to) && moduleAllowed(x.module));
      slaTrend.push({ month: monthLabel(from), compliance_rate: complianceOf(monthInst) });
    }

    /* ── Aprovações por alçada ── */
    const approvalsByLevel = [1, 2, 3].map((level) => {
      const list = decidedNow.filter((a) => a.approval_level === level);
      return {
        level,
        count: list.length,
        totalValue: Math.round(list.reduce((s, a) => s + (a.total_value ?? 0), 0)),
      };
    });

    /* ── Qualidade ── */
    const editedCount = logs.filter(
      (l) => l.action === "REQUISITION_EDITED" && inWindow(l.created_at, start, now)
        && moduleAllowed(reqById.get(l.requisition_id ?? "")?.module ?? ""),
    ).length;
    const quality = {
      approvalRate: approvalRateNow,
      rejectedCount: reqs.filter((r) => r.status === "REJEITADO").length,
      cancelledCount: reqs.filter((r) => r.status === "CANCELADO").length,
      editedCount,
    };

    /* ── Eficiência / cotações ── */
    const reqIdsInWindow = new Set(reqs.map((r) => r.id));
    const purchases = allPurchases.filter((p) =>
      inWindow(p.created_at, start, now) && moduleAllowed(reqById.get(p.requisition_id)?.module ?? ""),
    );
    const quotsCompleted = quotations.filter((q) =>
      q.completed_at && inWindow(q.completed_at, start, now) && moduleAllowed(reqById.get(q.requisition_id)?.module ?? ""),
    );
    const quotHours = quotsCompleted
      .filter((q) => q.started_at)
      .map((q) => hoursBetween(q.started_at!, q.completed_at!));
    const efficiency = {
      purchasesCount: purchases.length,
      quotationsCompleted: quotsCompleted.length,
      avgQuotationHours: quotHours.length ? round1(quotHours.reduce((a, b) => a + b, 0) / quotHours.length) : null,
    };

    /* ── Top compradores (reais, via purchases.buyer_id) ── */
    const profileName = (id: string | null) => {
      if (!id) return "—";
      const p = profiles.find((x) => x.id === id);
      return p?.full_name ?? p?.email ?? "—";
    };
    const buyerAgg = new Map<string, { purchases: number; totalValue: number }>();
    for (const p of purchases) {
      const name = profileName(p.buyer_id);
      const cur = buyerAgg.get(name) ?? { purchases: 0, totalValue: 0 };
      cur.purchases += 1;
      cur.totalValue += p.supplier_price ?? 0;
      buyerAgg.set(name, cur);
    }
    const topBuyers = [...buyerAgg.entries()]
      .map(([name, v]) => ({ name, purchases: v.purchases, totalValue: Math.round(v.totalValue) }))
      .sort((a, b) => b.purchases - a.purchases)
      .slice(0, 5);

    /* ── Financeiro ── */
    const approvedNow = decidedNow.filter((a) => a.decision === "approved");
    const approvedTotal = Math.round(approvedNow.reduce((s, a) => s + (a.total_value ?? 0), 0));
    const purchasedTotal = Math.round(purchases.reduce((s, p) => s + (p.supplier_price ?? 0), 0));

    // Economia real: vencedor vs proposta mais cara em cada cotação concluída no período
    const suppliersByQuot = new Map<string, QuotationSupplier[]>();
    for (const s of suppliers) {
      const arr = suppliersByQuot.get(s.quotation_id) ?? [];
      arr.push(s);
      suppliersByQuot.set(s.quotation_id, arr);
    }
    let savings = 0;
    let winnersTotal = 0;
    const savingsByMonth = new Map<string, { original: number; final: number }>();
    for (const q of quotsCompleted) {
      const list = (suppliersByQuot.get(q.id) ?? []).filter((s) => s.price != null);
      const winner = list.find((s) => s.is_winner);
      if (!winner || list.length < 2) continue;
      const maxPrice = Math.max(...list.map((s) => s.price!));
      const diff = Math.max(0, maxPrice - (winner.price ?? 0));
      savings += diff;
      winnersTotal += winner.price ?? 0;
      const mk = monthLabel(new Date(q.completed_at!));
      const cur = savingsByMonth.get(mk) ?? { original: 0, final: 0 };
      cur.original += maxPrice;
      cur.final += winner.price ?? 0;
      savingsByMonth.set(mk, cur);
    }
    const monthlySavings = buckets
      .filter((b) => data.period !== "30d")
      .map((b) => {
        const v = savingsByMonth.get(b.label) ?? { original: 0, final: 0 };
        return { month: b.label, original: Math.round(v.original), final: Math.round(v.final), savings: Math.round(v.original - v.final) };
      });

    const spendByModuleRaw = MODULE_META.map((m) => {
      const list = purchases.filter((p) => reqById.get(p.requisition_id)?.module === m.key);
      return { module: m.key, label: m.name, value: Math.round(list.reduce((s, p) => s + (p.supplier_price ?? 0), 0)), count: list.length };
    }).filter((x) => x.count > 0);
    const spendTotal = spendByModuleRaw.reduce((s, x) => s + x.value, 0);
    const spendByModule = spendByModuleRaw
      .map((x) => ({ ...x, pct: spendTotal > 0 ? Math.round((x.value / spendTotal) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);

    const supplierAgg = new Map<string, { value: number; count: number }>();
    for (const p of purchases) {
      const cur = supplierAgg.get(p.supplier_name) ?? { value: 0, count: 0 };
      cur.value += p.supplier_price ?? 0;
      cur.count += 1;
      supplierAgg.set(p.supplier_name, cur);
    }
    const topSuppliers = [...supplierAgg.entries()]
      .map(([name, v]) => ({ name, value: Math.round(v.value), count: v.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    /* ── Feed de eventos reais ── */
    const feed = logs
      .filter((l) => {
        if (l.action === "VPCLICK_TASK_CREATED") return false;
        if (data.module === "Todos") return true;
        const mod = reqById.get(l.requisition_id ?? "")?.module ?? l.ticket_number?.split("-")[0];
        return mod === data.module;
      })
      .slice(0, 20)
      .map((l, i) => ({
        id: `${l.created_at}-${i}`,
        action: l.action,
        ticket: l.ticket_number,
        actor: l.actor_name,
        createdAt: l.created_at,
      }));

    /* ── Métricas de hoje ── */
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const live = {
      reqsToday: allReqs.filter((r) => inWindow(r.created_at, todayStart, now) && moduleAllowed(r.module)).length,
      valueApprovedToday: Math.round(
        allApprovals
          .filter((a) => a.decision === "approved" && a.decided_at && inWindow(a.decided_at, todayStart, now))
          .reduce((s, a) => s + (a.total_value ?? 0), 0),
      ),
      activeBottlenecks: exceeded,
      slaCompliance: slaNow,
    };

    void reqIdsInWindow;

    return {
      kpis: {
        totalReqs: reqs.length,
        totalReqsDelta: cmpReqs ? pctDelta(reqs.length, cmpReqs.length) : null,
        avgCycleHours: avgCycle,
        avgCycleDeltaHours: avgCycle != null && cmpAvgCycle != null ? avgCycle - cmpAvgCycle : null,
        slaCompliance: slaNow,
        slaComplianceDelta: slaNow != null && slaCmp != null ? round1(slaNow - slaCmp) : null,
        approvalRate: approvalRateNow,
        approvalRateDelta: approvalRateNow != null && approvalRateCmp != null ? round1(approvalRateNow - approvalRateCmp) : null,
      },
      volumeTrend,
      moduleDist,
      stageDuration,
      slaByModule,
      slaBreakdown: { onTime, atRisk, exceeded },
      slaTrend,
      approvalsByLevel,
      quality,
      efficiency,
      topBuyers,
      financial: {
        approvedTotal,
        purchasedTotal,
        savings: Math.round(savings),
        savingsPct: winnersTotal + savings > 0 ? round1((savings / (winnersTotal + savings)) * 100) : null,
        monthlySavings,
        spendByModule,
        topSuppliers,
      },
      bottlenecks: bottlenecks.slice(0, 8),
      feed,
      live,
      generatedAt: now.toISOString(),
    };
  });

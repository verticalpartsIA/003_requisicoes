/** Linha de `approvals` com os campos usados no resumo por nível. */
export interface ApprovalDecisionRow {
  requisition_id: string;
  approval_level: number;
  total_value: number | null;
  decision: string;
  decided_at: string | null;
}

export interface LevelSummary {
  level: 1 | 2 | 3;
  approvedCount: number;
  approvedValue: number;
  rejectedCount: number;
  rejectedValue: number;
}

export interface ApprovalsByLevelResult {
  levels: LevelSummary[];
  totals: Omit<LevelSummary, "level">;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Janela [from, to] (datas "yyyy-mm-dd", inclusivas) no fuso de Brasília (UTC-3). */
export function brtRange(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: new Date(`${from}T00:00:00.000-03:00`).toISOString(),
    endIso: new Date(`${to}T23:59:59.999-03:00`).toISOString(),
  };
}

/**
 * Quantas requisições cada nível (alçada) aprovou/reprovou, e quanto valem.
 *
 * - Só entram decisões tomadas dentro da janela ([startIso, endIso]).
 * - Cada requisição conta uma vez: vale a decisão mais recente dela na janela
 *   (uma requisição reprovada e depois reaprovada conta como aprovada).
 * - O nível é o `approval_level` da linha decidida — a alçada exigida pelo valor.
 * - `moduleOf` devolve o módulo da requisição (para o filtro de módulo).
 */
export function aggregateApprovalsByLevel(
  rows: ApprovalDecisionRow[],
  opts: {
    startIso: string;
    endIso: string;
    module: string;
    moduleOf: (requisitionId: string) => string | undefined;
  },
): ApprovalsByLevelResult {
  const start = new Date(opts.startIso).getTime();
  const end = new Date(opts.endIso).getTime();

  const latestByReq = new Map<string, ApprovalDecisionRow>();
  for (const row of rows) {
    if (row.decision !== "approved" && row.decision !== "rejected") continue;
    if (!row.decided_at) continue;
    const t = new Date(row.decided_at).getTime();
    if (Number.isNaN(t) || t < start || t > end) continue;
    if (opts.module !== "Todos" && opts.moduleOf(row.requisition_id) !== opts.module) continue;
    const prev = latestByReq.get(row.requisition_id);
    if (!prev || t > new Date(prev.decided_at as string).getTime()) {
      latestByReq.set(row.requisition_id, row);
    }
  }

  const levels: LevelSummary[] = ([1, 2, 3] as const).map((level) => ({
    level,
    approvedCount: 0,
    approvedValue: 0,
    rejectedCount: 0,
    rejectedValue: 0,
  }));

  for (const row of latestByReq.values()) {
    const summary = levels.find((l) => l.level === row.approval_level);
    if (!summary) continue;
    const value = row.total_value ?? 0;
    if (row.decision === "approved") {
      summary.approvedCount += 1;
      summary.approvedValue += value;
    } else {
      summary.rejectedCount += 1;
      summary.rejectedValue += value;
    }
  }

  for (const l of levels) {
    l.approvedValue = round2(l.approvedValue);
    l.rejectedValue = round2(l.rejectedValue);
  }

  const totals = levels.reduce(
    (acc, l) => ({
      approvedCount: acc.approvedCount + l.approvedCount,
      approvedValue: round2(acc.approvedValue + l.approvedValue),
      rejectedCount: acc.rejectedCount + l.rejectedCount,
      rejectedValue: round2(acc.rejectedValue + l.rejectedValue),
    }),
    { approvedCount: 0, approvedValue: 0, rejectedCount: 0, rejectedValue: 0 },
  );

  return { levels, totals };
}

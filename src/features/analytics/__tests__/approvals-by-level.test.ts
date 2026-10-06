import { describe, expect, it } from "vitest";
import {
  aggregateApprovalsByLevel,
  brtRange,
  type ApprovalDecisionRow,
} from "../approvals-by-level";

const row = (
  req: string,
  level: number,
  value: number | null,
  decision: string,
  decidedAt: string | null,
): ApprovalDecisionRow => ({
  requisition_id: req,
  approval_level: level,
  total_value: value,
  decision,
  decided_at: decidedAt,
});

const window = { startIso: "2026-10-01T03:00:00.000Z", endIso: "2026-11-01T02:59:59.999Z" };
const modules: Record<string, string> = { a: "M1", b: "M1", c: "M2", d: "M3", e: "M1" };
const base = { ...window, module: "Todos", moduleOf: (id: string) => modules[id] };

describe("brtRange", () => {
  it("cobre o dia inteiro no fuso de Brasília (UTC-3)", () => {
    expect(brtRange("2026-10-01", "2026-10-31")).toEqual({
      startIso: "2026-10-01T03:00:00.000Z",
      endIso: "2026-11-01T02:59:59.999Z",
    });
  });
});

describe("aggregateApprovalsByLevel", () => {
  it("conta aprovadas e soma valores por nível", () => {
    const res = aggregateApprovalsByLevel(
      [
        row("a", 1, 1000, "approved", "2026-10-05T12:00:00Z"),
        row("b", 1, 500.5, "approved", "2026-10-06T12:00:00Z"),
        row("c", 2, 3000, "approved", "2026-10-07T12:00:00Z"),
        row("d", 3, 9000, "approved", "2026-10-08T12:00:00Z"),
      ],
      base,
    );
    expect(res.levels.map((l) => [l.level, l.approvedCount, l.approvedValue])).toEqual([
      [1, 2, 1500.5],
      [2, 1, 3000],
      [3, 1, 9000],
    ]);
    expect(res.totals.approvedCount).toBe(4);
    expect(res.totals.approvedValue).toBe(13500.5);
  });

  it("separa reprovadas das aprovadas e ignora pendentes", () => {
    const res = aggregateApprovalsByLevel(
      [
        row("a", 1, 100, "approved", "2026-10-05T12:00:00Z"),
        row("b", 1, 200, "rejected", "2026-10-05T12:00:00Z"),
        row("c", 2, 300, "pending", null),
      ],
      base,
    );
    expect(res.levels[0]).toMatchObject({
      approvedCount: 1,
      approvedValue: 100,
      rejectedCount: 1,
      rejectedValue: 200,
    });
    expect(res.levels[1].approvedCount).toBe(0);
  });

  it("respeita a janela de datas, inclusive nas bordas em horário de Brasília", () => {
    const res = aggregateApprovalsByLevel(
      [
        // 30/09 23:59 BRT → fora; 01/10 00:00 BRT → dentro; 31/10 23:59 BRT → dentro; 01/11 00:00 BRT → fora
        row("a", 1, 10, "approved", "2026-10-01T02:59:00Z"),
        row("b", 1, 20, "approved", "2026-10-01T03:00:00Z"),
        row("c", 1, 40, "approved", "2026-11-01T02:59:00Z"),
        row("d", 1, 80, "approved", "2026-11-01T03:00:00Z"),
      ],
      base,
    );
    expect(res.levels[0].approvedCount).toBe(2);
    expect(res.levels[0].approvedValue).toBe(60);
  });

  it("conta cada requisição uma vez, pela decisão mais recente (reprovada e depois aprovada = aprovada)", () => {
    const res = aggregateApprovalsByLevel(
      [
        row("a", 1, 100, "rejected", "2026-10-05T12:00:00Z"),
        row("a", 1, 100, "approved", "2026-10-09T12:00:00Z"),
      ],
      base,
    );
    expect(res.levels[0]).toMatchObject({ approvedCount: 1, rejectedCount: 0 });
  });

  it("aplica o filtro de módulo", () => {
    const res = aggregateApprovalsByLevel(
      [
        row("a", 1, 100, "approved", "2026-10-05T12:00:00Z"),
        row("c", 1, 200, "approved", "2026-10-05T12:00:00Z"),
      ],
      { ...base, module: "M2" },
    );
    expect(res.totals.approvedCount).toBe(1);
    expect(res.totals.approvedValue).toBe(200);
  });

  it("trata total_value nulo como zero e devolve zeros sem dados", () => {
    expect(
      aggregateApprovalsByLevel([row("a", 2, null, "approved", "2026-10-05T12:00:00Z")], base)
        .levels[1],
    ).toMatchObject({ approvedCount: 1, approvedValue: 0 });
    expect(aggregateApprovalsByLevel([], base).totals).toEqual({
      approvedCount: 0,
      approvedValue: 0,
      rejectedCount: 0,
      rejectedValue: 0,
    });
  });

  it("ignora níveis fora de 1–3", () => {
    const res = aggregateApprovalsByLevel(
      [row("a", 4, 100, "approved", "2026-10-05T12:00:00Z")],
      base,
    );
    expect(res.totals.approvedCount).toBe(0);
  });
});

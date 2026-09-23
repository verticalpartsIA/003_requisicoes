import { describe, expect, it } from "vitest";
import {
  applyDecision,
  distinctSuppliers,
  summarizeDecisions,
  type DecidableItem,
} from "@/features/approvals/item-decisions";

const items: DecidableItem[] = [
  { approvalItemId: "a", supplierName: "Mercado Livre", price: 10 },
  { approvalItemId: "b", supplierName: "Dutra Máquinas", price: 20 },
  { approvalItemId: "c", supplierName: "Mercado Livre", price: 30 },
];

describe("applyDecision", () => {
  it("aprova todos de uma vez", () => {
    expect(applyDecision({}, ["a", "b", "c"], "approved")).toEqual({
      a: "approved",
      b: "approved",
      c: "approved",
    });
  });

  it("muda só os itens informados e preserva o resto (aprovar todos, menos um)", () => {
    const all = applyDecision({}, ["a", "b", "c"], "approved");
    expect(applyDecision(all, ["b"], "rejected")).toEqual({
      a: "approved",
      b: "rejected",
      c: "approved",
    });
  });

  it("não altera o mapa original", () => {
    const original = { a: "approved" as const };
    applyDecision(original, ["a"], "rejected");
    expect(original).toEqual({ a: "approved" });
  });
});

describe("summarizeDecisions", () => {
  it("conta pendentes enquanto houver item sem decisão", () => {
    const s = summarizeDecisions(items, { a: "approved" });
    expect(s).toMatchObject({ approved: 1, rejected: 0, pending: 2, allDecided: false });
  });

  it("soma valores aprovados e reprovados", () => {
    const s = summarizeDecisions(items, { a: "approved", b: "rejected", c: "approved" });
    expect(s).toEqual({
      total: 3,
      approved: 2,
      rejected: 1,
      pending: 0,
      approvedValue: 40,
      rejectedValue: 20,
      allDecided: true,
    });
  });

  it("lista vazia nunca conta como decidida", () => {
    expect(summarizeDecisions([], {}).allDecided).toBe(false);
  });
});

describe("distinctSuppliers", () => {
  it("devolve fornecedores únicos em ordem alfabética", () => {
    expect(distinctSuppliers(items)).toEqual(["Dutra Máquinas", "Mercado Livre"]);
  });
});

// Lógica (pura) da decisão por item na Aprovação V3 — M1 multi-itens e M2.
// Separada da tela pra ser testável: "Aprovar todos", decisão em lote sobre
// os itens selecionados e o resumo (contagem/valores) mostrado antes de
// confirmar.

export type ItemDecision = "approved" | "rejected";
export type ItemDecisionMap = Record<string, ItemDecision>;

export interface DecidableItem {
  approvalItemId: string;
  supplierName: string;
  price: number;
}

/** Aplica a mesma decisão a vários itens de uma vez, preservando os demais. */
export function applyDecision(
  current: ItemDecisionMap,
  approvalItemIds: Iterable<string>,
  decision: ItemDecision,
): ItemDecisionMap {
  const next = { ...current };
  for (const id of approvalItemIds) next[id] = decision;
  return next;
}

export interface DecisionSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  approvedValue: number;
  rejectedValue: number;
  allDecided: boolean;
}

export function summarizeDecisions(
  items: DecidableItem[],
  decisions: ItemDecisionMap,
): DecisionSummary {
  let approved = 0;
  let rejected = 0;
  let approvedValue = 0;
  let rejectedValue = 0;
  for (const it of items) {
    const d = decisions[it.approvalItemId];
    if (d === "approved") {
      approved += 1;
      approvedValue += it.price;
    } else if (d === "rejected") {
      rejected += 1;
      rejectedValue += it.price;
    }
  }
  const pending = items.length - approved - rejected;
  return {
    total: items.length,
    approved,
    rejected,
    pending,
    approvedValue,
    rejectedValue,
    allDecided: items.length > 0 && pending === 0,
  };
}

/** Fornecedores distintos dos itens, em ordem alfabética (filtro da tela). */
export function distinctSuppliers(items: DecidableItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.supplierName).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

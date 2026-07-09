/** Limites-padrão das alçadas, usados como fallback quando o `settings` não
 *  retorna valores configurados pelo Admin. */
export const DEFAULT_TIER_THRESHOLDS = { tier1_max: 1500, tier2_max: 3500 } as const;

export interface TierThresholds {
  tier1_max: number;
  tier2_max: number;
}

export const APPROVAL_LEVEL_LABELS: Record<1 | 2 | 3, string> = {
  1: "Nível 1 — até R$ 1.500,00",
  2: "Nível 2 — R$ 1.500,01 a R$ 3.500,00",
  3: "Nível 3 — acima de R$ 3.500,00",
};

export const APPROVAL_LEVEL_SHORT_LABELS: Record<1 | 2 | 3, string> = {
  1: "Nível 1 (até R$ 1.500)",
  2: "Nível 2 (R$ 1.500–3.500)",
  3: "Nível 3 (acima R$ 3.500)",
};

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Rótulos das alçadas a partir dos limites configurados (para exibição). */
export function approvalLevelLabels(t: TierThresholds): Record<1 | 2 | 3, string> {
  return {
    1: `Nível 1 — até ${fmtBRL(t.tier1_max)}`,
    2: `Nível 2 — ${fmtBRL(t.tier1_max + 0.01)} a ${fmtBRL(t.tier2_max)}`,
    3: `Nível 3 — acima de ${fmtBRL(t.tier2_max)}`,
  };
}

/** Nível de alçada para um valor, respeitando os limites configurados no Admin
 *  (aba "Alçadas de Aprovação"). Sem thresholds, cai nos padrões. */
export function getApprovalLevelForValue(
  totalValue: number,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS,
): 1 | 2 | 3 {
  if (totalValue <= thresholds.tier1_max) return 1;
  if (totalValue <= thresholds.tier2_max) return 2;
  return 3;
}

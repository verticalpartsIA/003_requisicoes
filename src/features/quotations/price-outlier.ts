/**
 * Detecção de preço unitário fora do padrão entre as propostas de um mesmo
 * item (ex.: R$ 299 digitado onde era R$ 2,99). Com 3+ propostas compara cada
 * uma com a mediana de todas (robusta a um valor absurdo); com 2 compara uma
 * com a outra; com 1 não há base de comparação.
 */

export const PRICE_OUTLIER_FACTOR = 3;

export interface PriceOutlier {
  index: number;
  /** Razão entre o preço e a referência (mediana, ou a outra proposta); >1 = acima. */
  ratio: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `prices` são valores unitários na ordem dos fornecedores; zero, negativo ou
 * NaN significam "não cotou" e são ignorados. Devolve só as propostas que
 * fogem mais de `factor`x da mediana das outras, para cima ou para baixo.
 */
export function findPriceOutliers(
  prices: number[],
  factor: number = PRICE_OUTLIER_FACTOR,
): PriceOutlier[] {
  const valid = prices
    .map((price, index) => ({ price, index }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (valid.length < 2) return [];

  const outliers: PriceOutlier[] = [];
  for (const current of valid) {
    const reference =
      valid.length === 2
        ? valid.find((p) => p !== current)!.price
        : median(valid.map((p) => p.price));
    const ratio = current.price / reference;
    if (ratio > factor || ratio < 1 / factor) outliers.push({ index: current.index, ratio });
  }
  return outliers;
}

export function describeOutlier(ratio: number): string {
  const times = ratio >= 1 ? ratio : 1 / ratio;
  const rounded = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
  return `${rounded.toLocaleString("pt-BR")}x ${ratio >= 1 ? "acima" : "abaixo"} das outras propostas`;
}

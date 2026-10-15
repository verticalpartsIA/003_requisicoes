import { describe, expect, it } from "vitest";
import { describeOutlier, findPriceOutliers } from "@/features/quotations/price-outlier";

describe("findPriceOutliers", () => {
  it("não compara quando só há uma proposta", () => {
    expect(findPriceOutliers([299])).toEqual([]);
    expect(findPriceOutliers([0, 299, NaN])).toEqual([]);
  });

  it("aponta o preço 100x acima (caso M1-000221: 2,99 vs 299)", () => {
    const outliers = findPriceOutliers([299, 4.37, 2.99]);
    expect(outliers.map((o) => o.index)).toEqual([0]);
    expect(outliers[0].ratio).toBeGreaterThan(50);
  });

  it("com duas propostas muito distantes, sinaliza as duas", () => {
    expect(findPriceOutliers([299, 2.99]).map((o) => o.index)).toEqual([0, 1]);
  });

  it("aponta preço muito abaixo", () => {
    expect(findPriceOutliers([10, 11, 1]).map((o) => o.index)).toEqual([2]);
  });

  it("aceita variação normal de mercado", () => {
    expect(findPriceOutliers([10, 12, 14.5])).toEqual([]);
  });

  it("ignora quem não cotou e mantém o índice original", () => {
    expect(findPriceOutliers([0, 10, 11, 500]).map((o) => o.index)).toEqual([3]);
  });
});

describe("describeOutlier", () => {
  it("descreve acima e abaixo", () => {
    expect(describeOutlier(100)).toBe("100x acima das outras propostas");
    expect(describeOutlier(0.2)).toBe("5x abaixo das outras propostas");
  });
});

import { describe, expect, it } from "vitest";
import { extractProductCodes } from "@/features/logs/api";

describe("extractProductCodes", () => {
  it("lista os códigos dos itens na ordem, sem vazios nem duplicados", () => {
    expect(
      extractProductCodes({
        items: [
          { product_code: "VP-001" },
          { product_code: "" },
          { product_code: null },
          { product_code: " VP-002 " },
          { product_code: "VP-001" },
        ],
        legacy_code: null,
      }),
    ).toEqual(["VP-001", "VP-002"]);
  });

  it("usa o código da raiz no formato antigo de item único", () => {
    expect(extractProductCodes({ items: null, legacy_code: "VP-123" })).toEqual(["VP-123"]);
  });

  it("devolve vazio quando não há código", () => {
    expect(extractProductCodes({ items: null, legacy_code: null })).toEqual([]);
  });
});

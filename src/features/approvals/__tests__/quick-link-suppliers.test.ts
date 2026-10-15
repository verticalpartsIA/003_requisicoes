import { describe, expect, it } from "vitest";
import { buildQuickApprovalSuppliers } from "@/features/approvals/quick-link";

const items = [{ id: "i1", description: "CABO 3 X 0,75MM", quantity: 100 }];

describe("buildQuickApprovalSuppliers", () => {
  it("traz item, quantidade e valor unitário só dos vencedores", () => {
    const result = buildQuickApprovalSuppliers(
      [
        { supplier_name: "NORTE", price: 299, item_id: "i1", is_winner: true },
        { supplier_name: "SANTIL", price: 437, item_id: "i1", is_winner: false },
      ],
      items,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "NORTE",
      price: 299,
      itemDescription: "CABO 3 X 0,75MM",
      quantity: 100,
      unitPrice: 2.99,
      priceWarning: null,
    });
  });

  it("avisa quando o vencedor foge das demais propostas do item", () => {
    const result = buildQuickApprovalSuppliers(
      [
        { supplier_name: "NORTE", price: 29900, item_id: "i1", is_winner: true },
        { supplier_name: "SANTIL", price: 437, item_id: "i1", is_winner: false },
        { supplier_name: "CONDUS", price: 310, item_id: "i1", is_winner: false },
      ],
      items,
    );
    expect(result[0].priceWarning).toMatch(/acima/);
  });

  it("sem item cadastrado mantém só fornecedor e valor", () => {
    const [row] = buildQuickApprovalSuppliers(
      [{ supplier_name: "X", price: 10, item_id: null, is_winner: true }],
      [],
    );
    expect(row).toMatchObject({ itemDescription: null, quantity: null, unitPrice: null });
  });
});

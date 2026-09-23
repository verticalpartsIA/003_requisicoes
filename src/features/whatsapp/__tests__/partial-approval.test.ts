import { describe, expect, it } from "vitest";
import {
  buildPartialApprovalMessage,
  MAX_LISTED_ITEMS,
  partialApprovalItemLabel,
} from "@/features/whatsapp/partial-approval";

describe("buildPartialApprovalMessage", () => {
  it("lista os itens reprovados, a contagem e o motivo", () => {
    const text = buildPartialApprovalMessage({
      ticketNumber: "M1-000182",
      title: "4 itens — MOUSE SEM FIO e outros",
      approvedCount: 3,
      rejectedItems: ["[VP-1] TECLADO — qtd. 2"],
      rejectionReason: "Já temos em estoque",
    });
    expect(text).toContain("*M1-000182* foi aprovada *parcialmente*");
    expect(text).toContain("3 de 4 itens seguem para compra");
    expect(text).toContain("❌ Itens reprovados (1):\n• [VP-1] TECLADO — qtd. 2");
    expect(text).toContain("Motivo: Já temos em estoque");
  });

  it("resume o excesso de itens em '+N outro(s)'", () => {
    const rejected = Array.from({ length: MAX_LISTED_ITEMS + 3 }, (_, i) => `Item ${i + 1}`);
    const text = buildPartialApprovalMessage({
      ticketNumber: "M1-000138",
      title: "t",
      approvedCount: 1,
      rejectedItems: rejected,
    });
    expect(text).toContain(`• Item ${MAX_LISTED_ITEMS}\n• +3 outro(s)`);
    expect(text).not.toContain(`• Item ${MAX_LISTED_ITEMS + 1}`);
    expect(text).toContain("Motivo: não informado");
  });
});

describe("partialApprovalItemLabel", () => {
  it("produto: código, descrição e quantidade", () => {
    expect(
      partialApprovalItemLabel({
        productCode: "VPCON-975",
        description: 'BROCA 1/4"',
        quantity: 3,
        fallbackLabel: "Produto",
      }),
    ).toBe('[VPCON-975] BROCA 1/4" — qtd. 3');
  });

  it("viagem: tipo do item e fornecedor", () => {
    expect(
      partialApprovalItemLabel({
        fallbackLabel: "Hospedagem",
        supplierName: "Hotel Ibis",
      }),
    ).toBe("Hospedagem (Hotel Ibis)");
  });
});

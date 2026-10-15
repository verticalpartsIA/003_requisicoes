import { describe, expect, it } from "vitest";
import { buildReturnedForInfoMessage } from "@/features/whatsapp/returned-for-info";

describe("buildReturnedForInfoMessage", () => {
  it("traz ticket, título, motivo e o link para corrigir e reenviar", () => {
    const text = buildReturnedForInfoMessage({
      ticketNumber: "M1-000250",
      title: "Pneu aro 17",
      reason: "  Faltou informar a medida  ",
      baseUrl: "https://vprequisicoes.vpsistema.com",
    });
    expect(text).toContain("*M1-000250* foi devolvida pelo comprador");
    expect(text).toContain("Pneu aro 17");
    expect(text).toContain("Motivo: Faltou informar a medida\n");
    expect(text).toContain("https://vprequisicoes.vpsistema.com/movimentacoes");
  });

  it("sem motivo informado não deixa o campo em branco", () => {
    const text = buildReturnedForInfoMessage({
      ticketNumber: "M2-000001",
      title: "t",
      reason: "   ",
      baseUrl: "https://x.test",
    });
    expect(text).toContain("Motivo: não informado");
  });
});

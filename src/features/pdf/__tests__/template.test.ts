import { describe, it, expect } from "vitest";
import { buildHtml } from "@/features/pdf/template";

function baseInput(moduleData: Record<string, unknown>) {
  return {
    req: {
      module: "M2",
      ticket_number: "M2-000139",
      status: "COMPLETED",
      title: "Viagem SÃO PAULO → SALVADOR",
      module_data: moduleData,
    },
    suppliers: [],
    winCriteria: null,
    approval: null,
    purchase: null,
    receipt: null,
    auditLogs: [],
    imageUrls: {},
  };
}

describe("buildHtml — M2 (Viagem)", () => {
  it("imprime os dados da viagem (origem, destino, datas, transporte, hospedagem, motivo)", () => {
    const html = buildHtml(
      baseInput({
        origin_city: "São Paulo",
        destination_city: "Salvador",
        departure_date: "2026-08-20",
        return_date: "2026-08-24",
        duration_days: 4,
        transport_mode: "AVIAO",
        flight_class: "ECONOMICA",
        flight_time_preference: "MANHA",
        flight_baggage: ["EQUIPAMENTO"],
        needs_hotel: true,
        hotel_nights: "3",
        needs_local_car: false,
        car_rental_days: null,
        purposes: ["OBRA"],
        project_number: "OBRA-42",
        short_notice_justification: null,
        travelers: [
          {
            id: "1",
            full_name: "Alessandre Franciscretto",
            doc_type: "CNH",
            doc_number: "123456",
            doc_photo_path: null,
          },
        ],
      }),
    );

    expect(html).toContain("São Paulo");
    expect(html).toContain("Salvador");
    expect(html).toContain("20/08/2026");
    expect(html).toContain("24/08/2026");
    expect(html).toContain("4 dia(s)");
    expect(html).toContain("Avião");
    expect(html).toContain("Econômica");
    expect(html).toContain("Manhã (até 12h)");
    expect(html).toContain("Equipamento");
    expect(html).toContain("3 noite(s)");
    expect(html).toContain("Obra");
    expect(html).toContain("OBRA-42");
    expect(html).toContain("Viagem — Dados da Viagem");
    // Regressão do bug reportado: o bloco usava t.fullName/t.docType (camelCase)
    // em vez de t.full_name/t.doc_type (o formato real salvo pelo formulário),
    // então o nome e o tipo de documento do viajante saíam sempre em branco.
    expect(html).toContain("Alessandre Franciscretto");
    expect(html).toContain("CNH");
  });

  it("nao quebra quando os campos da viagem estao ausentes", () => {
    const html = buildHtml(baseInput({ travelers: [] }));
    expect(html).toContain("Viagem — Dados da Viagem");
  });
});

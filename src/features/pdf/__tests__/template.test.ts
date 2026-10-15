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

function m5Input(moduleData: Record<string, unknown>) {
  return {
    req: {
      module: "M5",
      ticket_number: "M5-000185",
      status: "ABERTO",
      title: "Frete Porto de Santos → Bertioga",
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

describe("buildHtml — M5 (Frete)", () => {
  it("imprime os dados estruturados de frete/Munck que o bloco antigo omitia", () => {
    // Regressão: o bloco M5 antigo só imprimia local de descarga e foto —
    // origem, destino, veículo, cliente e nº do projeto nunca apareciam no PDF.
    const html = buildHtml(
      m5Input({
        client_name: "VIP Gails",
        site_supervisor: "Arilene Avila",
        origin_address: "Porto de Santos",
        destination_address: "Rua Passeio dos Coqueiros, 600 - Bertioga",
        project_number: "28778/776 - SF",
        vehicle_type: "TRUCK",
        cargo_type: "ELEVADOR",
        receiver_name: "Silvio",
        receiver_phone: "11 91844-7390",
        weight_kg: 4342,
        needs_transport: true,
        vehicle_capacity_ton: 8,
        needs_munck: true,
        munck_quantity: 1,
        munck_size: "20_25",
        munck_boom_length_m: 20,
        munck_usage_hours: 4,
        elevator_items: [
          {
            model: "SMR",
            capacity_kg: 630,
            passengers: 8,
            stops: 3,
            boxes_qty: 19,
            total_weight_kg: 4342,
            volume_m3: 11.917,
            has_machine_room: false,
          },
        ],
        additional_equipment: [
          { type: "paleteira", label: "Paleteira", quantity: 2, spec: null },
          { type: "ajudante", label: "Ajudante", quantity: 2, spec: null },
        ],
      }),
    );

    expect(html).toContain("VIP Gails");
    expect(html).toContain("Porto de Santos");
    expect(html).toContain("Bertioga");
    expect(html).toContain("28778/776 - SF");
    expect(html).toContain("Caminhão Truck");
    expect(html).toContain("Elevador");
    expect(html).toContain("Silvio");
    expect(html).toContain("SMR");
    expect(html).toContain("630 kg");
    expect(html).toContain("20 a 25 toneladas");
    expect(html).toContain("Paleteira × 2");
    expect(html).toContain("Ajudante × 2");
    expect(html).toContain("Frete — Dados do Formulário");
  });

  it("nao quebra quando os campos de frete estao ausentes", () => {
    const html = buildHtml(m5Input({}));
    expect(html).toContain("Frete — Dados do Formulário");
  });
});

describe("buildHtml — V4 com pedidos por fornecedor", () => {
  const order = (supplier: string, extra: Record<string, unknown> = {}) => ({
    supplier_name: supplier,
    order_number: "PC-1",
    invoice_number: null,
    payment_method: "Boleto",
    payment_terms: "28 dias",
    expected_delivery: "2026-10-30",
    freight_value: 10,
    discount_value: 0,
    total_value: 478.8,
    notes: "entregar na doca 2",
    purchase_order_items: [
      {
        quantity: 400,
        unit_price: 1.172,
        line_total: 468.8,
        requisition_items: { description: "Fio 2x0,75", product_code: "VPMP-304" },
      },
    ],
    ...extra,
  });

  it("imprime um quadro por pedido com pagamento, itens e observações", () => {
    const html = buildHtml({
      ...baseInput({}),
      purchase: { supplier_name: "A, B", supplier_price: 478.8 },
      purchaseOrders: [
        order("SANTIL"),
        order("NORTE", { order_number: "PC-2", payment_method: "PIX" }),
      ],
    });
    expect(html).toContain("2 pedido(s)");
    expect(html).toContain("SANTIL");
    expect(html).toContain("NORTE");
    expect(html).toContain("PC-2");
    expect(html).toContain("Boleto");
    expect(html).toContain("PIX");
    expect(html).toContain("28 dias");
    expect(html).toContain("[VPMP-304] Fio 2x0,75");
    expect(html).toContain("entregar na doca 2");
  });

  it("escapa HTML digitado nos campos do pedido", () => {
    const html = buildHtml({
      ...baseInput({}),
      purchase: { supplier_name: "X" },
      purchaseOrders: [order("<b>EVIL</b>")],
    });
    expect(html).not.toContain("<b>EVIL</b>");
    expect(html).toContain("&lt;b&gt;EVIL&lt;/b&gt;");
  });

  it("sem pedidos mantém o resumo antigo de purchases", () => {
    const html = buildHtml({
      ...baseInput({}),
      purchase: { supplier_name: "FORNECEDOR UNICO", purchase_order_number: "PC-9" },
    });
    expect(html).toContain("FORNECEDOR UNICO");
    expect(html).not.toContain("pedido(s)");
  });
});

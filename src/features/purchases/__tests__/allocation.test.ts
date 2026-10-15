import { describe, expect, it } from "vitest";
import {
  addToOrder,
  allocateRemaining,
  buildDefaultOrders,
  emptyOrder,
  itemBalances,
  moveLine,
  ordersSubtotal,
  removeLine,
  toRpcOrders,
  updateLine,
  validateOrders,
  type ApprovedProduct,
} from "@/features/purchases/allocation";

const items: ApprovedProduct[] = [
  {
    itemId: "a",
    description: "Fio 2x0,75",
    productCode: "P1",
    quantity: 400,
    price: 468.8,
    supplierName: "SANTIL",
  },
  {
    itemId: "b",
    description: "Cabo 4x6",
    productCode: "P2",
    quantity: 7,
    price: 1843.38,
    supplierName: "SANTIL",
  },
  {
    itemId: "c",
    description: "Rolo",
    productCode: "P3",
    quantity: 5,
    price: 100,
    supplierName: "NORTE",
  },
];

const filled = () =>
  buildDefaultOrders(items).map((o, i) => ({ ...o, orderNumber: `PC-${i + 1}` }));

describe("buildDefaultOrders", () => {
  it("agrupa por fornecedor com preço unitário da cotação", () => {
    const orders = buildDefaultOrders(items);
    expect(orders.map((o) => [o.supplierName, o.lines.length])).toEqual([
      ["SANTIL", 2],
      ["NORTE", 1],
    ]);
    expect(orders[0].lines[0].unitPrice).toBeCloseTo(1.172, 4);
    expect(ordersSubtotal(orders)).toBe(2412.18);
  });

  it("agrupa fornecedores que só diferem em caixa/espaços", () => {
    const orders = buildDefaultOrders([items[0], { ...items[1], supplierName: " santil " }]);
    expect(orders).toHaveLength(1);
  });
});

describe("validateOrders", () => {
  it("sem erros quando tudo está alocado e preenchido", () => {
    expect(validateOrders(items, filled())).toEqual([]);
  });

  it("exige número do pedido e fornecedor", () => {
    const orders = buildDefaultOrders(items);
    expect(validateOrders(items, orders).join()).toMatch(/número do pedido/);
    orders[0].supplierName = "";
    expect(validateOrders(items, orders).join()).toMatch(/informe o fornecedor/);
  });

  it("aponta item não alocado e item alocado a mais", () => {
    const orders = removeLine(filled(), "po-2", "c");
    expect(validateOrders(items, orders).join()).toMatch(/Rolo.*faltam 5/);
    const over = updateLine(filled(), "po-2", "c", { quantity: 6 });
    expect(validateOrders(items, over).join()).toMatch(/Rolo.*1 acima/);
  });

  it("bloqueia total acima do aprovado", () => {
    const orders = updateLine(filled(), "po-2", "c", { unitPrice: 30 });
    expect(validateOrders(items, orders).join()).toMatch(/acima do aprovado/);
  });

  it("aceita preço menor que o aprovado", () => {
    const orders = updateLine(filled(), "po-2", "c", { unitPrice: 10 });
    expect(validateOrders(items, orders)).toEqual([]);
  });

  it("recusa pedido vazio e pedido duplicado", () => {
    const orders = [...filled(), { ...emptyOrder("po-9", "ZETA"), orderNumber: "X" }];
    expect(validateOrders(items, orders).join()).toMatch(/sem itens/);
    const dup = filled();
    dup[1] = { ...dup[1], supplierName: "SANTIL", orderNumber: "PC-1" };
    expect(validateOrders(items, dup).join()).toMatch(/repetidos/);
  });
});

describe("dividir e mover itens", () => {
  it("move linha inteira entre fornecedores, somando se o item já existir", () => {
    const moved = moveLine(filled(), "po-1", "b", "po-2");
    expect(moved[0].lines.map((l) => l.itemId)).toEqual(["a"]);
    expect(moved[1].lines.map((l) => l.itemId)).toEqual(["c", "b"]);
  });

  it("divide um item: reduz a quantidade e aloca o saldo em outro fornecedor", () => {
    let orders = updateLine(filled(), "po-2", "c", { quantity: 3 });
    expect(itemBalances(items, orders).find((b) => b.itemId === "c")?.remaining).toBe(2);
    orders = [...orders, emptyOrder("po-3", "ZETA")];
    orders = allocateRemaining(items, orders, "c", "po-3");
    expect(orders[2].lines[0]).toMatchObject({ itemId: "c", quantity: 2, unitPrice: 20 });
    expect(itemBalances(items, orders).every((b) => b.remaining === 0)).toBe(true);
  });

  it("allocateRemaining não faz nada sem saldo", () => {
    const orders = filled();
    expect(allocateRemaining(items, orders, "c", "po-1")).toBe(orders);
  });

  it("addToOrder soma quantidade em linha existente", () => {
    const orders = addToOrder(filled(), "po-2", { ...filled()[1].lines[0], quantity: 2 });
    expect(orders[1].lines[0].quantity).toBe(7);
  });
});

describe("toRpcOrders", () => {
  it("converte para o payload do banco", () => {
    const orders = filled();
    orders[0].freightValue = "12,50";
    const [first] = toRpcOrders(orders);
    expect(first).toMatchObject({
      supplier_name: "SANTIL",
      order_number: "PC-1",
      freight_value: 12.5,
      discount_value: 0,
    });
    expect(first.items[0]).toEqual({ requisition_item_id: "a", quantity: 400, unit_price: 1.172 });
  });
});

/**
 * Alocação de itens aprovados do M1 entre pedidos de compra (um por
 * fornecedor). Lógica pura da tela de Compra: monta a sugestão inicial a
 * partir dos vencedores da cotação, move/divide itens entre fornecedores e
 * valida o resultado antes de chamar `confirm_purchase_orders` (que repete as
 * regras no banco).
 */

export interface ApprovedProduct {
  /** requisition_items.id */
  itemId: string;
  description: string;
  productCode: string | null;
  quantity: number;
  /** Total aprovado da linha (valor unitário × quantidade). */
  price: number;
  supplierName: string;
}

export interface OrderLine {
  itemId: string;
  description: string;
  productCode: string | null;
  quantity: number;
  unitPrice: number;
}

export interface DraftOrder {
  key: string;
  supplierName: string;
  orderNumber: string;
  invoiceNumber: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDelivery: string;
  freightValue: string;
  discountValue: string;
  notes: string;
  lines: OrderLine[];
}

export interface ItemBalance {
  itemId: string;
  description: string;
  quantity: number;
  allocated: number;
  remaining: number;
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function approvedUnitPrice(item: ApprovedProduct): number {
  return item.quantity > 0 ? round4(item.price / item.quantity) : 0;
}

export function approvedTotal(items: ApprovedProduct[]): number {
  return round2(items.reduce((sum, item) => sum + item.price, 0));
}

export function emptyOrder(key: string, supplierName = ""): DraftOrder {
  return {
    key,
    supplierName,
    orderNumber: "",
    invoiceNumber: "",
    paymentMethod: "",
    paymentTerms: "",
    expectedDelivery: "",
    freightValue: "",
    discountValue: "",
    notes: "",
    lines: [],
  };
}

/** Um pedido por fornecedor vencedor, com os itens e preços da cotação. */
export function buildDefaultOrders(items: ApprovedProduct[]): DraftOrder[] {
  const bySupplier = new Map<string, DraftOrder>();
  for (const item of items) {
    const supplier = item.supplierName.trim();
    const id = supplier.toLowerCase();
    let order = bySupplier.get(id);
    if (!order) {
      order = emptyOrder(`po-${bySupplier.size + 1}`, supplier);
      bySupplier.set(id, order);
    }
    order.lines.push({
      itemId: item.itemId,
      description: item.description,
      productCode: item.productCode,
      quantity: item.quantity,
      unitPrice: approvedUnitPrice(item),
    });
  }
  return [...bySupplier.values()];
}

export function lineTotal(line: OrderLine): number {
  return round2(line.quantity * line.unitPrice);
}

export function orderSubtotal(order: DraftOrder): number {
  return round2(order.lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

export function ordersSubtotal(orders: DraftOrder[]): number {
  return round2(orders.reduce((sum, order) => sum + orderSubtotal(order), 0));
}

export function itemBalances(items: ApprovedProduct[], orders: DraftOrder[]): ItemBalance[] {
  return items.map((item) => {
    const allocated = orders.reduce(
      (sum, order) =>
        sum +
        order.lines.filter((l) => l.itemId === item.itemId).reduce((s, l) => s + l.quantity, 0),
      0,
    );
    return {
      itemId: item.itemId,
      description: item.description,
      quantity: item.quantity,
      allocated,
      remaining: item.quantity - allocated,
    };
  });
}

/** Coloca `quantity` do item no pedido; se já houver linha do item, soma. */
export function addToOrder(orders: DraftOrder[], orderKey: string, line: OrderLine): DraftOrder[] {
  return orders.map((order) => {
    if (order.key !== orderKey) return order;
    const existing = order.lines.find((l) => l.itemId === line.itemId);
    if (!existing) return { ...order, lines: [...order.lines, line] };
    return {
      ...order,
      lines: order.lines.map((l) =>
        l.itemId === line.itemId ? { ...l, quantity: l.quantity + line.quantity } : l,
      ),
    };
  });
}

export function removeLine(orders: DraftOrder[], orderKey: string, itemId: string): DraftOrder[] {
  return orders.map((order) =>
    order.key === orderKey
      ? { ...order, lines: order.lines.filter((l) => l.itemId !== itemId) }
      : order,
  );
}

/** Move a linha inteira (quantidade e preço unitário) para outro pedido. */
export function moveLine(
  orders: DraftOrder[],
  fromKey: string,
  itemId: string,
  toKey: string,
): DraftOrder[] {
  if (fromKey === toKey) return orders;
  const line = orders.find((o) => o.key === fromKey)?.lines.find((l) => l.itemId === itemId);
  if (!line) return orders;
  return addToOrder(removeLine(orders, fromKey, itemId), toKey, line);
}

export function updateLine(
  orders: DraftOrder[],
  orderKey: string,
  itemId: string,
  patch: Partial<Pick<OrderLine, "quantity" | "unitPrice">>,
): DraftOrder[] {
  return orders.map((order) =>
    order.key === orderKey
      ? { ...order, lines: order.lines.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)) }
      : order,
  );
}

/** Aloca o saldo de um item (quantidade e preço da cotação) em um pedido. */
export function allocateRemaining(
  items: ApprovedProduct[],
  orders: DraftOrder[],
  itemId: string,
  orderKey: string,
): DraftOrder[] {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) return orders;
  const balance = itemBalances(items, orders).find((b) => b.itemId === itemId);
  if (!balance || balance.remaining <= EPS) return orders;
  return addToOrder(orders, orderKey, {
    itemId,
    description: item.description,
    productCode: item.productCode,
    quantity: balance.remaining,
    unitPrice: approvedUnitPrice(item),
  });
}

export const parseMoney = (value: string): number => {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Erros que impedem confirmar. Lista vazia = pode enviar. Espelha as regras
 * de `confirm_purchase_orders` (database/039_purchase_orders.sql).
 */
export function validateOrders(items: ApprovedProduct[], orders: DraftOrder[]): string[] {
  const errors: string[] = [];
  if (orders.length === 0) return ["Inclua ao menos um pedido de compra."];

  const seen = new Set<string>();
  orders.forEach((order, i) => {
    const label = order.supplierName.trim() || `Pedido ${i + 1}`;
    if (!order.supplierName.trim()) errors.push(`${label}: informe o fornecedor.`);
    if (!order.orderNumber.trim()) errors.push(`${label}: informe o número do pedido.`);
    if (order.lines.length === 0) errors.push(`${label}: pedido sem itens (remova ou adicione).`);
    const id = `${order.supplierName.trim().toLowerCase()}|${order.orderNumber.trim().toLowerCase()}`;
    if (order.supplierName.trim() && order.orderNumber.trim()) {
      if (seen.has(id)) errors.push(`${label}: fornecedor e número de pedido repetidos.`);
      seen.add(id);
    }
    order.lines.forEach((line) => {
      if (!(line.quantity > 0))
        errors.push(`${label}: quantidade inválida em "${line.description}".`);
      if (!(line.unitPrice >= 0)) errors.push(`${label}: preço inválido em "${line.description}".`);
    });
  });

  for (const b of itemBalances(items, orders)) {
    if (b.remaining > EPS) errors.push(`"${b.description}": faltam ${b.remaining} para alocar.`);
    else if (b.remaining < -EPS)
      errors.push(`"${b.description}": ${-b.remaining} acima da quantidade aprovada.`);
  }

  const lines = orders.reduce((n, o) => n + o.lines.length, 0);
  const subtotal = ordersSubtotal(orders);
  const approved = approvedTotal(items);
  if (subtotal > approved + 0.01 * Math.max(lines, 1)) {
    errors.push(
      `Total dos itens (${brl(subtotal)}) acima do aprovado (${brl(approved)}). Corrija o preço na Cotação para reabrir a aprovação.`,
    );
  }
  return errors;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Payload de `confirm_purchase_orders`. */
export function toRpcOrders(orders: DraftOrder[]) {
  return orders.map((order) => ({
    supplier_name: order.supplierName.trim(),
    order_number: order.orderNumber.trim(),
    invoice_number: order.invoiceNumber.trim(),
    payment_method: order.paymentMethod.trim(),
    payment_terms: order.paymentTerms.trim(),
    expected_delivery: order.expectedDelivery,
    freight_value: parseMoney(order.freightValue),
    discount_value: parseMoney(order.discountValue),
    notes: order.notes.trim(),
    items: order.lines.map((line) => ({
      requisition_item_id: line.itemId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })),
  }));
}

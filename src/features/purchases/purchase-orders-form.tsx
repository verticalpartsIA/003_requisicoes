import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  allocateRemaining,
  approvedTotal,
  emptyOrder,
  itemBalances,
  lineTotal,
  moveLine,
  orderSubtotal,
  ordersSubtotal,
  parseMoney,
  removeLine,
  updateLine,
  type ApprovedProduct,
  type DraftOrder,
} from "@/features/purchases/allocation";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  items: ApprovedProduct[];
  orders: DraftOrder[];
  onChange: (orders: DraftOrder[]) => void;
}

/**
 * Compra fracionada do M1: um bloco por fornecedor, cada um com número do
 * pedido, pagamento, entrega, frete, desconto e observações próprias. O
 * comprador move itens entre fornecedores ou divide a quantidade; o rodapé
 * mostra o que falta alocar e o total contra o aprovado.
 */
export function PurchaseOrdersForm({ items, orders, onChange }: Props) {
  const patchOrder = (key: string, patch: Partial<DraftOrder>) =>
    onChange(orders.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  const addOrder = () => {
    const next = orders.reduce((max, o) => Math.max(max, Number(o.key.replace("po-", "")) || 0), 0);
    onChange([...orders, emptyOrder(`po-${next + 1}`)]);
  };

  const balances = itemBalances(items, orders);
  const pending = balances.filter((b) => b.remaining > 1e-9);
  const approved = approvedTotal(items);
  const subtotal = ordersSubtotal(orders);
  const overApproved =
    subtotal >
    approved +
      0.01 *
        Math.max(
          orders.reduce((n, o) => n + o.lines.length, 0),
          1,
        );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Pedidos de compra ({orders.length})</p>
        <Button type="button" variant="outline" size="sm" onClick={addOrder}>
          <Plus className="h-4 w-4 mr-1" /> Novo fornecedor
        </Button>
      </div>

      {orders.map((order, idx) => {
        const others = orders.filter((o) => o.key !== order.key);
        return (
          <Card key={order.key} className="border border-vp-yellow/40">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Fornecedor *</Label>
                  <Input
                    placeholder="Nome do fornecedor"
                    value={order.supplierName}
                    onChange={(e) => patchOrder(order.key, { supplierName: e.target.value })}
                  />
                </div>
                <Badge variant="outline" className="mb-2 shrink-0">
                  {brl(orderSubtotal(order))}
                </Badge>
                {orders.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover pedido ${idx + 1}`}
                    onClick={() => onChange(orders.filter((o) => o.key !== order.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nº do pedido *</Label>
                  <Input
                    placeholder="PC-2026-0012"
                    value={order.orderNumber}
                    onChange={(e) => patchOrder(order.key, { orderNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nº da NF</Label>
                  <Input
                    placeholder="Opcional"
                    value={order.invoiceNumber}
                    onChange={(e) => patchOrder(order.key, { invoiceNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Forma de pagamento</Label>
                  <Input
                    placeholder="Boleto, PIX, cartão..."
                    value={order.paymentMethod}
                    onChange={(e) => patchOrder(order.key, { paymentMethod: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Condição</Label>
                  <Input
                    placeholder="28 dias, à vista..."
                    value={order.paymentTerms}
                    onChange={(e) => patchOrder(order.key, { paymentTerms: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Entrega prevista</Label>
                  <Input
                    type="date"
                    value={order.expectedDelivery}
                    onChange={(e) => patchOrder(order.key, { expectedDelivery: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frete (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={order.freightValue}
                    onChange={(e) => patchOrder(order.key, { freightValue: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Desconto (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={order.discountValue}
                    onChange={(e) => patchOrder(order.key, { discountValue: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                {order.lines.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum item neste pedido. Aloque os itens que faltam abaixo.
                  </p>
                )}
                {order.lines.map((line) => (
                  <div
                    key={line.itemId}
                    className="grid grid-cols-12 items-center gap-2 rounded-md border border-border p-2"
                  >
                    <div className="col-span-12 sm:col-span-4 text-xs">
                      {line.productCode && (
                        <span className="font-mono text-muted-foreground mr-1">
                          [{line.productCode}]
                        </span>
                      )}
                      <span className="font-semibold text-foreground">{line.description}</span>
                    </div>
                    <Input
                      className="col-span-4 sm:col-span-2 h-8 text-xs"
                      type="number"
                      min="0"
                      step="any"
                      aria-label={`Quantidade de ${line.description}`}
                      value={line.quantity}
                      onChange={(e) =>
                        onChange(
                          updateLine(orders, order.key, line.itemId, {
                            quantity: Number(e.target.value),
                          }),
                        )
                      }
                    />
                    <Input
                      className="col-span-4 sm:col-span-2 h-8 text-xs"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`Valor unitário de ${line.description}`}
                      value={line.unitPrice}
                      onChange={(e) =>
                        onChange(
                          updateLine(orders, order.key, line.itemId, {
                            unitPrice: Number(e.target.value),
                          }),
                        )
                      }
                    />
                    <span className="col-span-4 sm:col-span-2 text-right text-xs font-mono font-semibold">
                      {brl(lineTotal(line))}
                    </span>
                    <div className="col-span-12 sm:col-span-2 flex items-center justify-end gap-1">
                      {others.length > 0 && (
                        <Select
                          value=""
                          onValueChange={(to) =>
                            onChange(moveLine(orders, order.key, line.itemId, to))
                          }
                        >
                          <SelectTrigger className="h-8 w-[88px] text-xs" aria-label="Mover item">
                            <SelectValue placeholder="Mover" />
                          </SelectTrigger>
                          <SelectContent>
                            {others.map((o) => (
                              <SelectItem key={o.key} value={o.key}>
                                {o.supplierName.trim() || `Pedido ${orders.indexOf(o) + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Tirar ${line.description} do pedido`}
                        onClick={() => onChange(removeLine(orders, order.key, line.itemId))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações deste fornecedor</Label>
                <Textarea
                  rows={2}
                  placeholder="Condições comerciais, instruções de entrega..."
                  value={order.notes}
                  onChange={(e) => patchOrder(order.key, { notes: e.target.value })}
                />
              </div>

              {(parseMoney(order.freightValue) > 0 || parseMoney(order.discountValue) > 0) && (
                <p className="text-xs text-muted-foreground text-right">
                  Total do pedido com frete e desconto:{" "}
                  <strong className="text-foreground">
                    {brl(
                      orderSubtotal(order) +
                        parseMoney(order.freightValue) -
                        parseMoney(order.discountValue),
                    )}
                  </strong>
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {pending.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="p-3 space-y-2">
            <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Itens sem fornecedor
            </p>
            {pending.map((b) => (
              <div
                key={b.itemId}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span>
                  {b.description} — faltam <strong>{b.remaining}</strong> de {b.quantity}
                </span>
                {orders.length > 0 && (
                  <Select
                    value=""
                    onValueChange={(to) => onChange(allocateRemaining(items, orders, b.itemId, to))}
                  >
                    <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Alocar saldo">
                      <SelectValue placeholder="Alocar no fornecedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {orders.map((o, i) => (
                        <SelectItem key={o.key} value={o.key}>
                          {o.supplierName.trim() || `Pedido ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div
        className={`rounded-lg p-3 text-sm flex items-center justify-between ${overApproved ? "bg-red-50 border border-red-200" : "bg-accent/50"}`}
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          {!overApproved && pending.length === 0 && (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          Itens: {brl(subtotal)} · aprovado: {brl(approved)}
        </span>
        <span className="font-bold text-foreground">
          Total com frete/desconto:{" "}
          {brl(
            orders.reduce(
              (sum, o) =>
                sum + orderSubtotal(o) + parseMoney(o.freightValue) - parseMoney(o.discountValue),
              0,
            ),
          )}
        </span>
      </div>
    </div>
  );
}

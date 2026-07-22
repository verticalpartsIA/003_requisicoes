import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ShoppingCart,
  Trophy,
  Clock,
  DollarSign,
  Scale,
  Eye,
  CheckCircle2,
  ArrowRight,
  Package,
  Plane,
  Wrench,
  Truck,
  Building2,
  AlertTriangle,
  XCircle,
  Hotel,
  Car,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { type PurchaseItem } from "@/features/purchases/api";
import { toast } from "sonner";
import { AccessGuard } from "@/components/access-guard";
import { confirmPurchaseClient, listPendingPurchasesClient } from "@/features/purchases/client";
import { useAuth } from "@/features/auth/auth-context";
import { notifyVpClickClient } from "@/features/vpclick/client";

export const Route = createFileRoute("/purchasing")({
  head: () => ({
    meta: [
      { title: "V4 Compra — VPRequisições" },
      { name: "description", content: "Emissão de ordens de compra e gestão de pedidos" },
    ],
  }),
  component: PurchasingPage,
});

const categoryConfig: Record<string, { label: string; icon: React.ReactNode; defaultV5: boolean }> = {
  viagem: { label: "Viagem", icon: <Plane className="h-4 w-4" />, defaultV5: false },
  servico: { label: "Serviço", icon: <Wrench className="h-4 w-4" />, defaultV5: false },
  frete: { label: "Frete", icon: <Truck className="h-4 w-4" />, defaultV5: false },
  locacao: { label: "Locação", icon: <Building2 className="h-4 w-4" />, defaultV5: false },
  produto: { label: "Bens Materiais", icon: <Package className="h-4 w-4" />, defaultV5: true },
  manutencao: { label: "Manutenção", icon: <Wrench className="h-4 w-4" />, defaultV5: false },
};

const winCriteriaLabel: Record<string, string> = {
  price: "Menor Preço",
  deadline: "Menor Prazo",
  price_deadline: "Melhor Preço / Prazo",
};

const winCriteriaIcon: Record<string, React.ReactNode> = {
  price: <DollarSign className="h-4 w-4" />,
  deadline: <Clock className="h-4 w-4" />,
  price_deadline: <Scale className="h-4 w-4" />,
};

const approvalLevelBadge: Record<number, string> = {
  1: "bg-green-100 text-green-700 border-green-200",
  2: "bg-yellow-100 text-yellow-700 border-yellow-200",
  3: "bg-red-100 text-red-700 border-red-200",
};

function PurchasingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [selected, setSelected] = useState<PurchaseItem | null>(null);
  const [sendToV5, setSendToV5] = useState(false);
  const [v5Reason, setV5Reason] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [dialogError, setDialogError] = useState<{ message: string; action: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    void listPendingPurchasesClient().then(setItems);
  }, [session]);

  const openDetail = (item: PurchaseItem) => {
    setSelected(item);
    setSendToV5(categoryConfig[item.category]?.defaultV5 ?? false);
    setV5Reason("");
    setPurchaseOrderNumber("");
    setInvoiceNumber("");
    setPaymentMethod("");
    setNotes("");
    setDialogError(null);
  };

  const closeDialog = () => {
    setSelected(null);
    setSendToV5(false);
    setV5Reason("");
    setPurchaseOrderNumber("");
    setInvoiceNumber("");
    setPaymentMethod("");
    setNotes("");
    setDialogError(null);
  };

  /** Extrai mensagem legível de qualquer tipo de erro (Error ou PostgrestError) */
  function extractError(error: unknown): { message: string; action: string } {
    if (error && typeof error === "object") {
      const e = error as { message?: string; code?: string; hint?: string };
      const code = e.code ?? "";
      const msg = e.message ?? "";

      if (code === "42501" || msg.includes("permission") || msg.includes("policy")) {
        return {
          message: "Sem permissão para registrar esta compra.",
          action: "Verifique se você tem o papel de comprador e que sua sessão não expirou. Tente sair e entrar novamente.",
        };
      }
      if (code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
        return {
          message: "Já existe um registro de compra para esta requisição.",
          action: "Esta compra já foi finalizada anteriormente. Atualize a página — ela deve ter saído da fila.",
        };
      }
      if (code === "23503" || msg.includes("foreign key")) {
        return {
          message: "Referência inválida: aprovação ou requisição não encontrada.",
          action: "Recarregue a página e tente novamente. Se persistir, contate o administrador.",
        };
      }
      if (msg) {
        return { message: msg, action: "Corrija o problema e tente novamente." };
      }
    }
    if (error instanceof Error) {
      return { message: error.message, action: "Corrija o problema e tente novamente." };
    }
    return {
      message: "Erro desconhecido ao finalizar a compra.",
      action: "Recarregue a página e tente novamente. Se persistir, contate o administrador.",
    };
  }

  const handleFinalize = async () => {
    if (!selected) return;
    setDialogError(null);

    // Compras por item (M2 viagem, M1 fracionado) usam os itens aprovados
    // como referência de fornecedor/valor, em vez de um único vencedor.
    const approvedItems = selected.approvedTravelItems || [];
    const hasApprovedItems = approvedItems.length > 0;

    // ── Validações antes de chamar o backend ──────────────────────────
    const winner = hasApprovedItems ? null : selected.suppliers.find((supplier) => supplier.isWinner);
    if (!hasApprovedItems && !winner) {
      setDialogError({
        message: "Nenhum fornecedor vencedor definido nesta cotação.",
        action: "Volte à etapa V2 — Cotação, abra este ticket e marque o fornecedor vencedor antes de finalizar a compra.",
      });
      return;
    }

    if (!purchaseOrderNumber.trim()) {
      setDialogError({
        message: "O campo Número do Pedido é obrigatório.",
        action: "Preencha o número do pedido de compra (ex.: PC-2026-0012) e tente novamente.",
      });
      return;
    }

    if (sendToV5 && !v5Reason.trim()) {
      setDialogError({
        message: "Você marcou encaminhar para V5 mas não informou o motivo.",
        action: "Preencha o campo 'Motivo do encaminhamento' explicando por que a entrega precisa ser conferida.",
      });
      return;
    }

    // Consolida supplier/price quando a compra foi fracionada por item
    const supplierNameFinal = hasApprovedItems
      ? Array.from(new Set(approvedItems.map((i) => i.supplierName).filter(Boolean))).join(", ")
      : winner!.name;
    const supplierPriceFinal = hasApprovedItems
      ? approvedItems.reduce((sum, i) => sum + i.price, 0)
      : winner!.price;

    setIsSaving(true);
    try {
      await confirmPurchaseClient({
        requisitionId: selected.requisitionId,
        approvalId: selected.approvalId,
        supplierName: supplierNameFinal,
        supplierPrice: supplierPriceFinal,
        purchaseOrderNumber,
        invoiceNumber,
        paymentMethod,
        notes: sendToV5 && v5Reason.trim()
          ? [notes.trim(), `Motivo V5: ${v5Reason.trim()}`].filter(Boolean).join("\n")
          : notes,
        requiresReceipt: sendToV5,
      });

      toast.success(
        sendToV5
          ? "Compra finalizada e encaminhada para recebimento (V5)."
          : "Compra finalizada com sucesso.",
      );
      void notifyVpClickClient({
        stage: "V4",
        requisitionId: selected.requisitionId,
        ticketNumber: selected.id,
        title: selected.title,
        module: selected.module,
        requesterName: selected.requesterName,
        requiresReceipt: sendToV5,
      }).catch(console.warn);
      closeDialog();
      setItems(await listPendingPurchasesClient());
      await router.invalidate();
    } catch (error) {
      setDialogError(extractError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const pending = items;

  return (
    <AccessGuard roles={["admin", "comprador"]}>
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <ShoppingCart className="h-5 w-5 text-vp-yellow-dark" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">V4 — Compra</h1>
          <p className="text-sm text-muted-foreground">Execução e fechamento de aquisições aprovadas</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="card-hover-yellow">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{pending.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Pendentes</p>
          </CardContent>
        </Card>
        <Card className="card-hover-yellow">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {pending.filter((item) => categoryConfig[item.category]?.defaultV5).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Tendem a ir para V5</p>
          </CardContent>
        </Card>
        <Card className="card-hover-yellow">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {pending.filter((item) => !categoryConfig[item.category]?.defaultV5).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Podem encerrar em V4</p>
          </CardContent>
        </Card>
      </div>

      {pending.length === 0 && (
        <Card className="card-hover-yellow">
          <CardContent className="p-12 text-center">
            <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nenhuma compra aprovada pendente.</p>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">Compras Pendentes</p>
          {pending.map((item) => {
            const hasApprovedItems = (item.approvedTravelItems || []).length > 0;
            const winner = hasApprovedItems ? null : item.suppliers.find((s) => s.isWinner);
            const cat = categoryConfig[item.category];

            return (
              <Card key={item.approvalId} className="card-hover-yellow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">{item.id}</Badge>
                      <div>
                        <p className="font-semibold text-foreground text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.module} • {item.requesterName} • {item.approvedAt}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-accent/50 text-foreground">
                        {cat?.icon} {cat?.label}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${approvalLevelBadge[item.approvalLevel]}`}>
                        Nível {item.approvalLevel}
                      </span>
                      <Button variant="vp" size="sm" onClick={() => openDetail(item)}>
                        <Eye className="h-4 w-4 mr-1" /> Detalhar
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    {hasApprovedItems ? (
                      <>
                        {item.moduleCode === "M1" ? <Package className="h-3.5 w-3.5 text-vp-yellow-dark" /> : <Plane className="h-3.5 w-3.5 text-vp-yellow-dark" />}
                        <span className="font-medium text-foreground">
                          {(item.approvedTravelItems || []).length} item(s) aprovado(s)
                        </span>
                        <span>•</span>
                        <span>R$ {(item.approvedTravelItems || []).reduce((s, i) => s + i.price, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                      </>
                    ) : (
                      <>
                        <Trophy className="h-3.5 w-3.5 text-vp-yellow-dark" />
                        <span className="font-medium text-foreground">{winner?.name}</span>
                        <span>•</span>
                        <span>R$ {winner?.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        <span>•</span>
                        <span>Critério: {winCriteriaLabel[item.winCriteria]}</span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selected && (() => {
            const approvedItems = selected.approvedTravelItems || [];
            const hasApprovedItems = approvedItems.length > 0;
            const winner = hasApprovedItems ? null : selected.suppliers.find((s) => s.isWinner);
            const cat = categoryConfig[selected.category];

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-lg flex items-center gap-2">
                    Compra — {selected.id}
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-accent/50 text-foreground">
                      {cat?.icon} {cat?.label}
                    </span>
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    {selected.title} • {selected.module}
                  </p>
                </DialogHeader>

                <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700">
                    Aprovado em V3. Os dados abaixo devem seguir o aprovado sem alterações.
                  </span>
                </div>

                <Card className="border-dashed border-vp-yellow/50">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      Observações do Requisitante — {selected.requesterName}
                    </p>
                    <p className="text-sm text-foreground">{selected.requesterNotes}</p>
                  </CardContent>
                </Card>

                {!hasApprovedItems && (
                  <div className="flex items-center gap-2 rounded-lg bg-accent/50 p-3">
                    {winCriteriaIcon[selected.winCriteria]}
                    <span className="text-sm font-semibold text-foreground">
                      Critério de vitória: {winCriteriaLabel[selected.winCriteria]}
                    </span>
                  </div>
                )}

                {hasApprovedItems ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">
                      {selected.moduleCode === "M1" ? "Itens Aprovados" : "Itens de Viagem Aprovados"} ({approvedItems.length})
                    </p>
                    {approvedItems.map((item, i) => {
                      const travelIcon =
                        item.itemType === "voo" ? <Plane className="h-4 w-4" />
                        : item.itemType === "hotel" ? <Hotel className="h-4 w-4" />
                        : item.itemType === "carro" ? <Car className="h-4 w-4" />
                        : <Package className="h-4 w-4" />;
                      const travelLabel =
                        item.itemType === "voo" ? "Passagem Aérea"
                        : item.itemType === "hotel" ? "Hospedagem"
                        : item.itemType === "carro" ? "Locação de Carro"
                        : item.description || "Produto";
                      return (
                        <Card key={i} className="border border-green-300 bg-green-50/30">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {travelIcon}
                                <span className="text-sm font-semibold text-foreground">
                                  {travelLabel}
                                  {item.itemType === "produto" && item.quantity != null && (
                                    <span className="text-muted-foreground font-normal"> — qtd. {item.quantity}</span>
                                  )}
                                </span>
                                <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px]">Aprovado</Badge>
                              </div>
                              <span className="font-mono text-sm font-bold text-foreground">
                                R$ {item.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.itemType === "produto" && item.productCode ? `[${item.productCode}] ` : ""}
                              {item.supplierName}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })}
                    <div className="rounded-lg bg-accent/50 p-3 text-sm flex items-center justify-between">
                      <span className="text-muted-foreground">Total aprovado</span>
                      <span className="font-bold text-foreground">
                        R$ {approvedItems.reduce((s, i) => s + i.price, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">
                      Fornecedores Cotados ({selected.suppliers.length})
                    </p>
                    {selected.suppliers.map((sup, i) => (
                      <Card
                        key={`${selected.approvalId}-${i}`}
                        className={`border ${sup.isWinner ? "border-vp-yellow bg-vp-yellow/5 ring-1 ring-vp-yellow/30" : "border-border"}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{sup.name}</span>
                              {sup.isWinner && (
                                <Badge className="bg-vp-yellow/20 text-vp-yellow-dark border-vp-yellow/40 text-[10px]">
                                  <Trophy className="h-3 w-3 mr-1" /> Vencedor
                                </Badge>
                              )}
                            </div>
                            <span className="font-mono text-sm font-bold text-foreground">
                              R$ {sup.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Prazo: {sup.deadline}
                            </div>
                            <div>Obs: {sup.notes || "—"}</div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Número do Pedido *</Label>
                    <Input
                      placeholder="Ex.: PC-2026-0012"
                      value={purchaseOrderNumber}
                      onChange={(e) => setPurchaseOrderNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Número da NF</Label>
                    <Input
                      placeholder="Opcional"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-sm font-medium">Forma de Pagamento</Label>
                    <Input
                      placeholder="Ex.: boleto 28 dias"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                  </div>
                </div>

                <Card className="border border-dashed">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="send-v5"
                        checked={sendToV5}
                        onCheckedChange={(v) => setSendToV5(!!v)}
                      />
                      <div>
                        <Label htmlFor="send-v5" className="text-sm font-semibold text-foreground cursor-pointer">
                          Encaminhar para Recebimento (V5)?
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {cat?.defaultV5
                            ? "Esta categoria requer recebimento por padrão."
                            : "Itens desta categoria normalmente finalizam em V4. Marque se precisar de comprovação de entrega."}
                        </p>
                      </div>
                    </div>

                    {sendToV5 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Motivo do encaminhamento</Label>
                        <Textarea
                          placeholder="Ex.: necessita conferência física, entrada em estoque ou comprovação de entrega."
                          value={v5Reason}
                          onChange={(e) => setV5Reason(e.target.value)}
                          rows={2}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Observações da compra</Label>
                      <Textarea
                        placeholder="Condições comerciais, observações internas, instruções adicionais..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>

                {sendToV5 && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-xs text-amber-700">
                      Ao finalizar, esta compra será roteada para o módulo V5 — Recebimento.
                    </span>
                  </div>
                )}

                {/* Banner de erro acionável — aparece apenas quando há problema */}
                {dialogError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-red-700">{dialogError.message}</p>
                        <p className="text-xs text-red-600">{dialogError.action}</p>
                      </div>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button variant="ghost" onClick={closeDialog}>
                    Cancelar
                  </Button>
                  <Button variant="vp" onClick={handleFinalize} className="gap-1" disabled={isSaving}>
                    {isSaving ? (
                      <><ArrowRight className="h-4 w-4 animate-pulse" /> Salvando...</>
                    ) : sendToV5 ? (
                      <><ArrowRight className="h-4 w-4" /> Finalizar e Encaminhar V5</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4" /> Finalizar Compra</>
                    )}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
    </AccessGuard>
  );
}

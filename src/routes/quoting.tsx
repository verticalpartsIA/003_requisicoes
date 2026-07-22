import { createFileRoute, useRouter } from "@tanstack/react-router";
import { FileSearch, Plus, Trash2, Trophy, DollarSign, Clock, Scale, CheckCircle2, ArrowRight, Plane, Hotel, Car, Package, CopyPlus } from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  finalizeQuotation,
  saveQuotationProposals,
  saveQuotationSuppliers,
  type QuotationQueueItem,
  type SupplierEntry,
  type TravelItem,
} from "@/features/quotations/api";
import { toast } from "sonner";
import { AccessGuard } from "@/components/access-guard";
import { notifyVpClickClient } from "@/features/vpclick/client";
import {
  finalizeQuotationClient,
  listQuotationQueueClient,
  saveQuotationProposalsClient,
  saveQuotationSuppliersClient,
  saveM2QuoteClient,
  saveM1ItemQuotesClient,
  type M2ItemQuote,
} from "@/features/quotations/client";
import { useAuth } from "@/features/auth/auth-context";

type QuotationStatus = "pending" | "quoting" | "awaiting_proposals" | "selecting_winner" | "completed";
type WinCriteria = "price" | "deadline" | "price_deadline";
type Phase = "suppliers" | "proposals" | "winner";

export const Route = createFileRoute("/quoting")({
  head: () => ({
    meta: [
      { title: "V2 Cotação — VPRequisições" },
      { name: "description", content: "Gerenciamento de cotações e propostas de fornecedores" },
    ],
  }),
  component: QuotingPage,
});

const urgLabel: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  URGENT: "Urgente",
};

const statusLabel: Record<QuotationStatus, string> = {
  pending: "Pendente",
  quoting: "Em Cotação",
  awaiting_proposals: "Aguardando Propostas",
  selecting_winner: "Seleção de Vencedor",
  completed: "Concluída",
};

function urgBadge(u: string) {
  if (u === "URGENT") return "bg-red-100 text-red-700 border-red-200";
  if (u === "HIGH") return "bg-orange-100 text-orange-700 border-orange-200";
  if (u === "MEDIUM") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function statusBadge(s: QuotationStatus) {
  if (s === "pending") return "bg-muted text-muted-foreground border-border";
  if (s === "quoting" || s === "awaiting_proposals") return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "selecting_winner") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-green-50 text-green-700 border-green-200";
}

const criteriaLabels: Record<WinCriteria, { label: string; icon: React.ReactNode }> = {
  price: { label: "Menor Preço", icon: <DollarSign className="h-4 w-4" /> },
  deadline: { label: "Melhor Prazo", icon: <Clock className="h-4 w-4" /> },
  price_deadline: { label: "Preço + Prazo", icon: <Scale className="h-4 w-4" /> },
};

const travelItemLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  voo: { label: "Passagem Aérea", icon: <Plane className="h-4 w-4" /> },
  hotel: { label: "Hospedagem", icon: <Hotel className="h-4 w-4" /> },
  carro: { label: "Locação de Carro", icon: <Car className="h-4 w-4" /> },
};

function getInitialPhase(item: QuotationQueueItem): Phase {
  if (item.status === "selecting_winner") return "winner";
  if (item.status === "awaiting_proposals" || item.status === "quoting") return "proposals";
  return "suppliers";
}

function createEmptySupplier(): SupplierEntry {
  return { name: "", price: "", deadline: "", notes: "", proposalReceived: false };
}

function QuotingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [queue, setQueue] = useState<QuotationQueueItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<QuotationQueueItem | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("suppliers");
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [winCriteria, setWinCriteria] = useState<WinCriteria>("price");
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // M2 state
  const [m2Item, setM2Item] = useState<QuotationQueueItem | null>(null);
  const [m2Quotes, setM2Quotes] = useState<Record<string, Omit<M2ItemQuote, "itemId" | "itemType">>>({});
  const [isM2Saving, setIsM2Saving] = useState(false);

  useEffect(() => {
    if (!session) return;
    void listQuotationQueueClient().then(setQueue);
  }, [session]);

  const openQuotation = (item: QuotationQueueItem) => {
    // M2 (voo/hotel/carro) e M1 multi-itens (2+ produtos) cotam por item —
    // cada um com seu próprio fornecedor, permitindo fracionar entre vários.
    if (item.module === "M2" || (item.travelItems && item.travelItems.length > 0)) {
      // Inicializa campos com dados já salvos, se houver
      const initial: Record<string, Omit<M2ItemQuote, "itemId" | "itemType">> = {};
      (item.travelItems || []).forEach((ti) => {
        initial[ti.id] = {
          supplierName: ti.supplierName || "",
          price: ti.supplierPrice ? Number(ti.supplierPrice) : 0,
          deadline: ti.supplierDeadline || "",
          notes: ti.supplierNotes || "",
        };
      });
      setM2Quotes(initial);
      setM2Item(item);
      return;
    }
    setSelectedItem(item);
    setSuppliers(item.suppliers.length > 0 ? item.suppliers : [createEmptySupplier()]);
    setPhase(getInitialPhase(item));
    const selectedWinnerIndex = item.suppliers.findIndex((supplier) => supplier.isWinner);
    setWinnerIndex(selectedWinnerIndex >= 0 ? selectedWinnerIndex : null);
    setWinCriteria(item.winCriteria);
  };

  const addSupplier = () => {
    if (suppliers.length >= 3) return;
    setSuppliers((prev) => [...prev, createEmptySupplier()]);
  };

  const removeSupplier = (index: number) => {
    setSuppliers((prev) => prev.filter((_, i) => i !== index));
    if (winnerIndex === index) setWinnerIndex(null);
    else if (winnerIndex !== null && winnerIndex > index) setWinnerIndex(winnerIndex - 1);
  };

  const updateSupplier = (index: number, field: keyof SupplierEntry, value: string | boolean) => {
    setSuppliers((prev) => prev.map((supplier, i) => (i === index ? { ...supplier, [field]: value } : supplier)));
  };

  const canAdvanceToProposals = suppliers.length > 0 && suppliers.every((supplier) => supplier.name.trim() !== "");
  const allProposalsReceived = suppliers.every((supplier) => supplier.proposalReceived && supplier.price.trim() !== "");

  const closeDialog = () => {
    setSelectedItem(null);
    setConfirmDialog(false);
    setSuppliers([]);
    setWinnerIndex(null);
    setPhase("suppliers");
    setWinCriteria("price");
  };

  const closeM2Dialog = () => {
    setM2Item(null);
    setM2Quotes({});
  };

  const advanceToProposals = async () => {
    if (!selectedItem || !canAdvanceToProposals) return;

    setIsSaving(true);

    try {
      const result = await saveQuotationSuppliersClient(selectedItem.requisitionId, suppliers);

      setSuppliers(result.suppliers);
      setSelectedItem((current) => (
        current
          ? {
              ...current,
              quotationId: result.quotationId,
              status: result.status,
              suppliers: result.suppliers,
            }
          : current
      ));
      setPhase("proposals");
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
      toast.success("Fornecedores salvos com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar os fornecedores.");
    } finally {
      setIsSaving(false);
    }
  };

  const advanceToWinner = async () => {
    if (!selectedItem?.quotationId) {
      toast.error("A cotação ainda não foi inicializada corretamente.");
      return;
    }

    if (!allProposalsReceived) return;

    setIsSaving(true);

    try {
      const result = await saveQuotationProposalsClient(selectedItem.quotationId, suppliers);

      setSuppliers(result.suppliers);
      setSelectedItem((current) => (
        current
          ? {
              ...current,
              status: result.status,
              suppliers: result.suppliers,
            }
          : current
      ));
      setPhase("winner");
      // Auto-seleciona vencedor quando há apenas 1 fornecedor (caso mais comum)
      if (result.suppliers.length === 1) setWinnerIndex(0);
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
      toast.success("Propostas registradas com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar as propostas.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmWinner = async () => {
    if (!selectedItem?.quotationId || winnerIndex === null) return;

    const winner = suppliers[winnerIndex];

    if (!winner?.id) {
      toast.error("Selecione um fornecedor já salvo para finalizar a cotação.");
      return;
    }

    setIsSaving(true);

    try {
      await finalizeQuotationClient(
        selectedItem.requisitionId,
        selectedItem.quotationId,
        winner.id,
        winCriteria,
      );

      toast.success("Cotação finalizada e enviada para aprovação.");
      void notifyVpClickClient({
        stage: "V2",
        requisitionId: selectedItem.requisitionId,
        ticketNumber: selectedItem.ticketNumber,
        title: selectedItem.title,
        module: selectedItem.module,
        requesterName: "",
      }).catch(console.warn);
      closeDialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível finalizar a cotação.");
    } finally {
      setIsSaving(false);
    }
  };

  const isM1Fractioned = m2Item?.module !== "M2";

  const itemLabel = (ti: TravelItem) =>
    ti.itemType === "produto"
      ? ti.description || ti.productCode || "Item"
      : travelItemLabels[ti.itemType]?.label ?? ti.itemType;

  // Copia o fornecedor/valor de um item para todos os demais ainda sem
  // fornecedor definido — atalho para quando o mesmo fornecedor cobre
  // vários produtos, sem impedir que os demais sejam fracionados depois.
  const applySupplierToAll = (sourceId: string) => {
    const source = m2Quotes[sourceId];
    if (!source?.supplierName?.trim()) return;
    const travelItems = m2Item?.travelItems || [];
    setM2Quotes((prev) => {
      const next = { ...prev };
      travelItems.forEach((ti) => {
        if (ti.id === sourceId) return;
        if (next[ti.id]?.supplierName?.trim()) return;
        next[ti.id] = { ...source };
      });
      return next;
    });
  };

  const handleM2Submit = async () => {
    if (!m2Item) return;

    const travelItems = m2Item.travelItems || [];
    if (travelItems.length === 0) {
      toast.error("Nenhum item encontrado para esta requisição.");
      return;
    }

    // Valida campos obrigatórios
    for (const ti of travelItems) {
      const q = m2Quotes[ti.id];
      if (!q?.supplierName?.trim()) {
        toast.error(`Informe o fornecedor para: ${itemLabel(ti)}`);
        return;
      }
      if (!q.price || q.price <= 0) {
        toast.error(`Informe o valor para: ${itemLabel(ti)}`);
        return;
      }
    }

    setIsM2Saving(true);
    try {
      const itemQuotes: M2ItemQuote[] = travelItems.map((ti) => ({
        itemId: ti.id,
        itemType: ti.itemType,
        supplierName: m2Quotes[ti.id]?.supplierName?.trim() || "",
        price: m2Quotes[ti.id]?.price || 0,
        deadline: m2Quotes[ti.id]?.deadline || "",
        notes: m2Quotes[ti.id]?.notes || "",
      }));

      if (isM1Fractioned) {
        await saveM1ItemQuotesClient(m2Item.requisitionId, itemQuotes);
      } else {
        await saveM2QuoteClient(m2Item.requisitionId, itemQuotes);
      }
      toast.success(
        isM1Fractioned
          ? "Cotação fracionada finalizada e enviada para aprovação."
          : "Cotação de viagem finalizada e enviada para aprovação.",
      );
      void notifyVpClickClient({
        stage: "V2",
        requisitionId: m2Item.requisitionId,
        ticketNumber: m2Item.ticketNumber,
        title: m2Item.title,
        module: m2Item.module,
        requesterName: "",
      }).catch(console.warn);
      closeM2Dialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível finalizar a cotação.");
    } finally {
      setIsM2Saving(false);
    }
  };

  const summaryStatuses: QuotationStatus[] = ["pending", "awaiting_proposals", "selecting_winner", "completed"];

  return (
    <AccessGuard roles={["admin", "comprador"]}>
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <FileSearch className="h-5 w-5 text-vp-yellow-dark" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">V2 — Cotação</h1>
          <p className="text-sm text-muted-foreground">Gestão de cotações multi-fornecedor</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryStatuses.map((status) => (
          <Card key={status} className="card-hover-yellow">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{queue.filter((item) => item.status === status).length}</p>
              <p className="text-xs text-muted-foreground">{statusLabel[status]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {queue.map((item) => (
          <Card key={item.requisitionId} className="card-hover-yellow">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Badge variant="outline" className="font-mono text-xs">{item.ticketNumber}</Badge>
                <div>
                  <p className="font-semibold text-foreground text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">Módulo: {item.module}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${statusBadge(item.status)}`}>
                  {statusLabel[item.status]}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${urgBadge(item.urgency)}`}>
                  {urgLabel[item.urgency] || item.urgency}
                </span>
                <Button variant="vp" size="sm" onClick={() => openQuotation(item)}>
                  {item.status === "pending" ? "Cotar" : "Continuar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {queue.length === 0 && (
          <Card className="card-hover-yellow">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma requisição aguardando cotação neste momento.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog padrão (não-M2) */}
      <Dialog open={!!selectedItem && !confirmDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              Cotação — {selectedItem?.ticketNumber}
            </DialogTitle>
            <DialogDescription>
              {selectedItem?.title}
            </DialogDescription>
          </DialogHeader>

          {selectedItem?.requesterNotes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Observações do Requisitante</p>
              <p className="text-sm text-amber-900">{selectedItem.requesterNotes}</p>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs">
            <span className={`rounded-full px-3 py-1 font-medium ${phase === "suppliers" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}>1. Fornecedores</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className={`rounded-full px-3 py-1 font-medium ${phase === "proposals" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}>2. Propostas</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className={`rounded-full px-3 py-1 font-medium ${phase === "winner" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}>3. Vencedor</span>
          </div>

          {phase === "suppliers" && (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">Selecione até <strong>3 fornecedores</strong> para esta cotação.</p>
              {suppliers.map((supplier, index) => (
                <Card key={supplier.id || index} className="border border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">Fornecedor {index + 1}</span>
                      {suppliers.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeSupplier(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nome do Fornecedor</Label>
                      <Input placeholder="Ex: ABC Ltda" value={supplier.name} onChange={(e) => updateSupplier(index, "name", e.target.value)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
              {suppliers.length < 3 && (
                <Button variant="outline" size="sm" className="w-full" onClick={addSupplier}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Fornecedor ({suppliers.length}/3)
                </Button>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={closeDialog}>Cancelar</Button>
                <Button variant="vp" disabled={!canAdvanceToProposals || isSaving} onClick={advanceToProposals}>
                  Enviar para Cotação <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {phase === "proposals" && (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">Registre as propostas recebidas de cada fornecedor.</p>
              {suppliers.map((supplier, index) => (
                <Card key={supplier.id || index} className={`border ${supplier.proposalReceived ? "border-green-300 bg-green-50/30" : "border-border"}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">{supplier.name}</span>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={supplier.proposalReceived}
                          onChange={(e) => updateSupplier(index, "proposalReceived", e.target.checked)}
                          className="rounded border-border"
                        />
                        Proposta recebida
                      </label>
                    </div>
                    {supplier.proposalReceived && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Preço (R$)</Label>
                          <Input placeholder="0,00" value={supplier.price} onChange={(e) => updateSupplier(index, "price", e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Prazo de Entrega</Label>
                          <Input type="date" value={supplier.deadline} onChange={(e) => updateSupplier(index, "deadline", e.target.value)} />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Observações</Label>
                          <Textarea placeholder="Condições, frete, garantia..." value={supplier.notes} onChange={(e) => updateSupplier(index, "notes", e.target.value)} className="min-h-[60px]" />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPhase("suppliers")}>Voltar</Button>
                <Button variant="vp" disabled={!allProposalsReceived || isSaving} onClick={advanceToWinner}>
                  Selecionar Vencedor <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {phase === "winner" && (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">Compare as propostas e selecione o fornecedor vencedor.</p>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Critério de Vitória</Label>
                <div className="flex gap-2">
                  {(Object.keys(criteriaLabels) as WinCriteria[]).map((criteria) => (
                    <Button
                      key={criteria}
                      variant={winCriteria === criteria ? "vp" : "outline"}
                      size="sm"
                      onClick={() => setWinCriteria(criteria)}
                      className="text-xs"
                    >
                      {criteriaLabels[criteria].icon}
                      <span className="ml-1">{criteriaLabels[criteria].label}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {suppliers.map((supplier, index) => (
                  <Card
                    key={supplier.id || index}
                    className={`border-2 cursor-pointer transition-all ${winnerIndex === index ? "border-vp-yellow bg-amber-50/50 shadow-md" : "border-border hover:border-vp-yellow/50"}`}
                    onClick={() => setWinnerIndex(index)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {winnerIndex === index
                            ? <Trophy className="h-5 w-5 text-vp-yellow-dark shrink-0" />
                            : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40 shrink-0" />}
                          <div>
                            <p className="font-semibold text-sm text-foreground">{supplier.name}</p>
                            <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> R$ {supplier.price || "0,00"}</span>
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {supplier.deadline || "—"}</span>
                            </div>
                            {supplier.notes && <p className="text-xs text-muted-foreground mt-1">{supplier.notes}</p>}
                          </div>
                        </div>
                        {winnerIndex === index
                          ? <Badge className="bg-vp-yellow text-vp-dark border-vp-yellow-dark">Vencedor ✓</Badge>
                          : <Badge variant="outline" className="text-muted-foreground text-xs">Selecionar</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setPhase("proposals")}>Voltar</Button>
                <Button variant="vp" disabled={winnerIndex === null || isSaving} onClick={() => setConfirmDialog(true)}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Finalizar Cotação
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Vencedor</DialogTitle>
            <DialogDescription>
              Esta ação enviará os dados ao Módulo V3 — Aprovação.
            </DialogDescription>
          </DialogHeader>
          {winnerIndex !== null && suppliers[winnerIndex] && (
            <div className="rounded-lg border border-vp-yellow bg-amber-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-vp-yellow-dark" />
                <span className="font-semibold text-foreground">{suppliers[winnerIndex].name}</span>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Valor: <strong className="text-foreground">R$ {suppliers[winnerIndex].price}</strong></p>
                <p>Prazo: <strong className="text-foreground">{suppliers[winnerIndex].deadline || "—"}</strong></p>
                <p>Critério: <strong className="text-foreground">{criteriaLabels[winCriteria].label}</strong></p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(false)}>Cancelar</Button>
            <Button variant="vp" onClick={handleConfirmWinner} disabled={isSaving}>
              Confirmar e Enviar ao V3
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog M2 — cotação por item de viagem */}
      <Dialog open={!!m2Item} onOpenChange={(open) => !open && closeM2Dialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              {isM1Fractioned ? <Package className="h-5 w-5 text-vp-yellow-dark" /> : <Plane className="h-5 w-5 text-vp-yellow-dark" />}
              {isM1Fractioned ? "Cotação Fracionada" : "Cotação de Viagem"} — {m2Item?.ticketNumber}
            </DialogTitle>
            <DialogDescription>{m2Item?.title}</DialogDescription>
          </DialogHeader>

          {m2Item?.requesterNotes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Observações do Requisitante</p>
              <p className="text-sm text-amber-900">{m2Item.requesterNotes}</p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {isM1Fractioned
              ? "Atribua um fornecedor e valor para cada produto. Você pode usar fornecedores diferentes por item para fracionar a compra."
              : "Atribua um fornecedor para cada item de viagem abaixo."}
          </p>

          <div className={isM1Fractioned ? "space-y-2" : "space-y-4"}>
            {(m2Item?.travelItems || []).map((ti) => {
              const cfg = travelItemLabels[ti.itemType] ?? { label: ti.itemType, icon: null };
              const q = m2Quotes[ti.id] ?? { supplierName: "", price: 0, deadline: "", notes: "" };
              const update = (field: string, value: string | number) =>
                setM2Quotes((prev) => ({ ...prev, [ti.id]: { ...prev[ti.id], [field]: value } }));

              if (isM1Fractioned) {
                return (
                  <div key={ti.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs">
                        {ti.productCode && (
                          <span className="font-mono text-muted-foreground mr-1">[{ti.productCode}]</span>
                        )}
                        <span className="font-semibold text-foreground">{ti.description || "Item"}</span>
                        {ti.quantity != null && (
                          <span className="text-muted-foreground"> — qtd. {ti.quantity}</span>
                        )}
                      </div>
                      {q.supplierName?.trim() && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-muted-foreground shrink-0"
                          title="Aplicar este fornecedor aos itens ainda sem fornecedor"
                          onClick={() => applySupplierToAll(ti.id)}
                        >
                          <CopyPlus className="h-3 w-3 mr-1" />
                          Aplicar a todos
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Fornecedor *</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="Fornecedor"
                          value={q.supplierName}
                          onChange={(e) => update("supplierName", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valor (R$) *</Label>
                        <Input
                          className="h-8 text-sm"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0,00"
                          value={q.price || ""}
                          onChange={(e) => update("price", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Prazo</Label>
                        <Input
                          className="h-8 text-sm"
                          type="date"
                          value={q.deadline}
                          onChange={(e) => update("deadline", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <Card key={ti.id} className="border border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {cfg.icon}
                      {cfg.label}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Fornecedor / Empresa *</Label>
                        <Input
                          placeholder="Ex.: LATAM Airlines, Hoteis.com, Localiza..."
                          value={q.supplierName}
                          onChange={(e) => update("supplierName", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valor (R$) *</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0,00"
                          value={q.price || ""}
                          onChange={(e) => update("price", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Data / Prazo</Label>
                        <Input
                          type="date"
                          value={q.deadline}
                          onChange={(e) => update("deadline", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Observações</Label>
                        <Textarea
                          placeholder="Número do voo, condições, categoria do hotel..."
                          value={q.notes}
                          onChange={(e) => update("notes", e.target.value)}
                          className="min-h-[56px]"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {(m2Item?.travelItems || []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum item encontrado. A requisição pode ter sido criada antes desta funcionalidade.
              </p>
            )}
          </div>

          {isM1Fractioned && (m2Item?.travelItems?.length ?? 0) > 0 && (
            <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
              Fornecedores distintos nesta cotação:{" "}
              <strong className="text-foreground">
                {new Set(Object.values(m2Quotes).map((q) => q.supplierName?.trim()).filter(Boolean)).size || 0}
              </strong>
            </div>
          )}

          <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
            Valor total estimado:{" "}
            <strong className="text-foreground">
              R$ {Object.values(m2Quotes).reduce((sum, q) => sum + (q.price || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </strong>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeM2Dialog}>Cancelar</Button>
            <Button
              variant="vp"
              disabled={isM2Saving || (m2Item?.travelItems || []).length === 0}
              onClick={handleM2Submit}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {isM2Saving ? "Salvando..." : isM1Fractioned ? "Finalizar Cotação Fracionada" : "Finalizar Cotação de Viagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AccessGuard>
  );
}

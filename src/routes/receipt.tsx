import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PackageCheck, Truck, User, Building2, ClipboardCheck, AlertTriangle, CheckCircle2, Eye, Search, Filter, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { type PendingReceiptItem } from "@/features/receipts/api";
import { toast } from "sonner";
import { AccessGuard } from "@/components/access-guard";
import { listPendingReceiptsClient, registerReceiptClient } from "@/features/receipts/client";
import { useAuth } from "@/features/auth/auth-context";
import { notifyVpClickClient } from "@/features/vpclick/client";

export const Route = createFileRoute("/receipt")({
  head: () => ({
    meta: [
      { title: "V5 Recebimento — VPRequisições" },
      { name: "description", content: "Registro de recebimento e conferência de materiais e serviços" },
    ],
  }),
  component: ReceiptPage,
});

type Condition = "ok" | "damaged" | "mismatch" | "";

function ReceiptPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [pendingItems, setPendingItems] = useState<PendingReceiptItem[]>([]);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  const [selectedItem, setSelectedItem] = useState<PendingReceiptItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [delivererName, setDelivererName] = useState("");
  const [carrierCompany, setCarrierCompany] = useState("");
  const [condition, setCondition] = useState<Condition>("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    void listPendingReceiptsClient().then(setPendingItems);
  }, [session]);

  const needsNotes = condition === "damaged" || condition === "mismatch";

  const openReceiptForm = (item: PendingReceiptItem) => {
    setSelectedItem(item);
    setDelivererName("");
    setCarrierCompany("");
    setCondition("");
    setNotes("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setSelectedItem(null);
    setDialogOpen(false);
    setDelivererName("");
    setCarrierCompany("");
    setCondition("");
    setNotes("");
  };

  const handleSubmit = async () => {
    if (!condition) {
      toast.error("Selecione a conformidade do produto.");
      return;
    }
    if (needsNotes && !notes.trim()) {
      toast.error("Preencha o motivo da divergência antes de enviar.");
      return;
    }
    if (!selectedItem) return;

    setIsSaving(true);

    try {
      const result = await registerReceiptClient({
        requisitionId: selectedItem.requisitionId,
        purchaseId: selectedItem.purchaseId,
        delivererName,
        carrierCompany,
        condition: condition as "ok" | "damaged" | "mismatch",
        notes,
      });

      void notifyVpClickClient({
        stage: "V5",
        requisitionId: selectedItem.requisitionId,
        ticketNumber: selectedItem.id,
        title: selectedItem.description,
        module: selectedItem.category,
        requesterName: selectedItem.requester,
      }).catch(console.warn);
      closeDialog();
      setPendingItems(await listPendingReceiptsClient());
      await router.invalidate();

      if (result.condition === "ok") {
        toast.success("Recebimento registrado com sucesso. Fluxo concluído.");
      } else {
        toast.success("Recebimento registrado com não conformidade.");
        toast.info("O item foi devolvido ao fluxo de compra para tratativa.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar o recebimento.");
    } finally {
      setIsSaving(false);
    }
  };

  const conditionLabel = (c: Condition) => {
    if (c === "ok") return "Em ordem";
    if (c === "damaged") return "Com avarias";
    if (c === "mismatch") return "Fora da especificação";
    return "";
  };

  const filteredItems = pendingItems.filter((item) => {
    if (moduleFilter !== "Todos" && item.moduleCode !== moduleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        item.id.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.requester.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <AccessGuard roles={["admin", "almoxarife"]}>
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <PackageCheck className="h-5 w-5 text-vp-yellow-dark" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">V5 — Recebimento de Materiais</h1>
          <p className="text-sm text-muted-foreground">Conferência e registro de entrega de materiais</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="card-hover-yellow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
              <Truck className="h-5 w-5 text-vp-yellow-dark" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingItems.length}</p>
              <p className="text-xs text-muted-foreground">Aguardando Recebimento</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-yellow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">Fluxo final</p>
              <p className="text-xs text-muted-foreground">Recepção física e conferência</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-yellow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">Tratativa</p>
              <p className="text-xs text-muted-foreground">Avarias voltam para compra</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {pendingItems.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ticket, título ou solicitante..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Módulo" />
                </SelectTrigger>
                <SelectContent>
                  {["Todos", "M1", "M2", "M3", "M4", "M5", "M6"].map((m) => (
                    <SelectItem key={m} value={m}>{m === "Todos" ? "Módulo" : m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Entregas Pendentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingItems.length === 0 ? (
            <div className="p-8 text-center">
              <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">Nenhum recebimento pendente.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground text-sm">Nenhum resultado para os filtros atuais.</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.purchaseId}
                className="flex items-center justify-between p-4 rounded-lg border hover:border-vp-yellow transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{item.id}</span>
                    <Badge variant="outline" className="text-xs">{item.requisition}</Badge>
                    {item.purchaseOrderNumber && (
                      <Badge variant="secondary" className="text-xs">Pedido {item.purchaseOrderNumber}</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{item.supplier}</span>
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{item.requester}</span>
                    <span>{item.purchaseDate}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/movimentacoes"
                    search={{ ticket: item.id, module: undefined }}
                    target="_blank"
                    title="Ver histórico completo do ticket"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-vp-yellow transition-colors"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                  </Link>
                  <Button variant="vp" size="sm" onClick={() => openReceiptForm(item)}>
                    <ClipboardCheck className="h-4 w-4 mr-1" /> Receber
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recebimento de Materiais</DialogTitle>
            <DialogDescription>
              {selectedItem?.description} — {selectedItem?.id}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Requisitante Original</span>
                <span className="font-medium text-right">{selectedItem?.requester}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Fornecedor</span>
                <span className="font-medium text-right">{selectedItem?.supplier}</span>
              </div>
              {selectedItem?.invoiceNumber && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">NF</span>
                  <span className="font-medium text-right">{selectedItem.invoiceNumber}</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome do Entregador (opcional)</label>
              <Input
                placeholder="Nome do motorista / entregador"
                value={delivererName}
                onChange={(e) => setDelivererName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Empresa que Entregou (opcional)</label>
              <Input
                placeholder="Transportadora / empresa"
                value={carrierCompany}
                onChange={(e) => setCarrierCompany(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Conformidade do Produto</label>
              <div className="grid grid-cols-3 gap-2">
                {(["ok", "damaged", "mismatch"] as Condition[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondition(c)}
                    className={`rounded-lg border-2 p-3 text-center text-xs font-medium transition-all ${
                      condition === c
                        ? c === "ok"
                          ? "border-green-500 bg-green-50 text-green-700"
                          : c === "damaged"
                            ? "border-amber-500 bg-amber-50 text-amber-700"
                            : "border-red-500 bg-red-50 text-red-700"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    {c === "ok" && <CheckCircle2 className="h-5 w-5 mx-auto mb-1" />}
                    {c === "damaged" && <AlertTriangle className="h-5 w-5 mx-auto mb-1" />}
                    {c === "mismatch" && <Eye className="h-5 w-5 mx-auto mb-1" />}
                    {conditionLabel(c)}
                  </button>
                ))}
              </div>
            </div>

            {needsNotes && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-red-600">
                  Descreva o problema ou divergência *
                </label>
                <Textarea
                  placeholder="Ex.: Embalagem rompida, quantidade divergente, modelo incorreto..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button variant="vp" onClick={handleSubmit} disabled={isSaving}>
              <PackageCheck className="h-4 w-4 mr-1" /> Finalizar Recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AccessGuard>
  );
}

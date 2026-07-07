import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Package, Plus, ChevronRight, ChevronLeft, Truck,
  Link2, X, CalendarIcon, ImageIcon, Upload, Pencil, Trash2,
  CheckCircle2, ChevronDown, ChevronUp, Loader2, Tag,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TicketsTable } from "@/components/tickets-table";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { toast } from "sonner";
import { createProductRequisitionClient, listProductRequisitionsClient, updateRequisitionClient } from "@/features/requisitions/client";
import { validateOmieOrderClient, validateOmieProductClient } from "@/features/omie/client";
import { useAuth } from "@/features/auth/auth-context";
import { notifyVpClickClient } from "@/features/vpclick/client";
import type { TicketRow } from "@/components/tickets-table";

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Produtos", icon: Package },
  { label: "Logística", icon: Truck },
];

interface ItemDraft {
  product_code: string;
  product_name: string;
  description: string;
  quantity: string;
  technical_specs: string;
  brand_preference: string;
  model_reference: string;
  reference_links: string[];
  online_purchase_suggestion: string;
  photo_file: File | null;
  photo_preview: string | null;
  photo_path: string | null;
}

export const Route = createFileRoute("/products")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M1 Produtos — VPRequisições" },
      { name: "description", content: "Requisição de produtos, materiais e equipamentos" },
    ],
  }),
  component: ProductsPage,
});

const DIALOG_KEY = "vpreq_m1_v2";

function emptyDraft(): ItemDraft {
  return {
    product_code: "",
    product_name: "",
    description: "",
    quantity: "",
    technical_specs: "",
    brand_preference: "",
    model_reference: "",
    reference_links: [""],
    online_purchase_suggestion: "",
    photo_file: null,
    photo_preview: null,
    photo_path: null,
  };
}

function ProductsPage() {
  const router = useRouter();
  const { edit: editTicketNumber } = Route.useSearch();
  const { session, profile, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editReqId, setEditReqId] = useState<string | null>(null);
  const [editEdition, setEditEdition] = useState(1);

  // Lista de itens
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  // Draft do formulário de item
  const [draftCode, setDraftCode] = useState("");
  const [draftCodeValidated, setDraftCodeValidated] = useState(false);
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftQty, setDraftQty] = useState("");
  const [draftSpecs, setDraftSpecs] = useState("");
  const [draftBrand, setDraftBrand] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [draftLinks, setDraftLinks] = useState<string[]>([""]);
  const [draftSuggestion, setDraftSuggestion] = useState("");
  const [draftPhotoFile, setDraftPhotoFile] = useState<File | null>(null);
  const [draftPhotoPreview, setDraftPhotoPreview] = useState<string | null>(null);
  const [showDraftTechnical, setShowDraftTechnical] = useState(false);

  // Triagem (tela inicial antes do stepper)
  const [triageCompleted, setTriageCompleted] = useState(false);

  // Revenda
  const [isRevenda, setIsRevenda] = useState<boolean | null>(null);
  const [pedidoNum, setPedidoNum] = useState("");
  const [omieResult, setOmieResult] = useState<{ vendedor: string; numero: string } | null>(null);
  const [isValidatingOmie, setIsValidatingOmie] = useState(false);

  // Logística
  const [deliveryDeadline, setDeliveryDeadline] = useState<Date | undefined>();
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DIALOG_KEY);
      if (!saved) return;
      const s = JSON.parse(saved) as Record<string, unknown>;
      if (!s.open) return;
      setDialogOpen(true);
      if (typeof s.step === "number") setStep(s.step);
      if (Array.isArray(s.items)) {
        setItems((s.items as ItemDraft[]).map((i) => ({ ...i, photo_file: null, photo_preview: null })));
      }
      if (typeof s.triageCompleted === "boolean") setTriageCompleted(s.triageCompleted);
      if (typeof s.isRevenda === "boolean") setIsRevenda(s.isRevenda);
      if (s.isRevenda === null) setIsRevenda(null);
      if (typeof s.pedidoNum === "string") setPedidoNum(s.pedidoNum);
      if (typeof s.deliveryDeadline === "string") setDeliveryDeadline(new Date(s.deliveryDeadline));
      if (typeof s.deliveryLocation === "string") setDeliveryLocation(s.deliveryLocation);
      if (typeof s.urgencyLevel === "string") setUrgencyLevel(s.urgencyLevel);
      if (typeof s.justification === "string") setJustification(s.justification);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    void listProductRequisitionsClient().then(setTickets);
  }, [session]);

  useEffect(() => {
    if (!editTicketNumber || !session) return;
    void (async () => {
      const { data } = await supabaseBrowser
        .from("requisitions")
        .select("id,title,description,justification,urgency,desired_date,module_data,edition")
        .eq("ticket_number", editTicketNumber)
        .maybeSingle();
      if (!data) { toast.error("Requisição não encontrada."); return; }
      const md = (data.module_data ?? {}) as Record<string, unknown>;
      setEditMode(true);
      setEditReqId(data.id as string);
      setEditEdition((data.edition as number | undefined) ?? 1);

      if (Array.isArray(md.items)) {
        const legacyItems = (md.items as Array<Record<string, unknown>>).map((i) => ({
          product_code: String(i.product_code ?? ""),
          product_name: String(i.product_name ?? ""),
          description: String(i.description ?? ""),
          quantity: String(i.quantity ?? "1"),
          technical_specs: String(i.technical_specs ?? ""),
          brand_preference: String(i.brand_preference ?? ""),
          model_reference: String(i.model_reference ?? ""),
          reference_links: Array.isArray(i.reference_links) ? (i.reference_links as string[]) : [""],
          online_purchase_suggestion: String(i.online_purchase_suggestion ?? ""),
          photo_file: null,
          photo_preview: null,
          photo_path: (i.photo_path as string | null) ?? null,
        }));
        setItems(legacyItems);
      } else if (md.product_name) {
        toast.info("Requisição no formato antigo — convertida para o novo formato de itens.");
        setItems([{
          product_code: String(md.product_code ?? ""),
          product_name: String(md.product_name ?? ""),
          description: String(data.description ?? ""),
          quantity: String(md.quantity ?? "1"),
          technical_specs: String(md.technical_specs ?? ""),
          brand_preference: String(md.brand_preference ?? ""),
          model_reference: String(md.model_reference ?? ""),
          reference_links: Array.isArray(md.reference_links) ? (md.reference_links as string[]) : [""],
          online_purchase_suggestion: String(md.online_purchase_suggestion ?? ""),
          photo_file: null,
          photo_preview: null,
          photo_path: (md.photo_path as string | null) ?? null,
        }]);
      }

      if (typeof md.revenda === "boolean") setIsRevenda(md.revenda);
      if (md.pedido_venda_numero) {
        setPedidoNum(String(md.pedido_venda_numero));
        if (md.pedido_venda_vendedor) {
          setOmieResult({ numero: String(md.pedido_venda_numero), vendedor: String(md.pedido_venda_vendedor) });
        }
      }
      setDeliveryLocation(String(md.delivery_location ?? ""));
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      if (data.desired_date) setDeliveryDeadline(new Date(data.desired_date as string));
      setTriageCompleted(true); // edição pula triagem
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      const serializableItems = items.map((i) => ({ ...i, photo_file: null, photo_preview: null }));
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, triageCompleted, items: serializableItems, isRevenda, pedidoNum,
        deliveryDeadline: deliveryDeadline?.toISOString(),
        deliveryLocation, urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, items, isRevenda, pedidoNum, deliveryDeadline, deliveryLocation, urgencyLevel, justification]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setTriageCompleted(false);
    setItems([]);
    setShowAddForm(false);
    setEditingIdx(null);
    clearDraft();
    setIsRevenda(null);
    setPedidoNum("");
    setOmieResult(null);
    setDeliveryDeadline(undefined);
    setDeliveryLocation("");
    setUrgencyLevel("");
    setJustification("");
  };

  const clearDraft = () => {
    setDraftCode(""); setDraftCodeValidated(false); setIsValidatingCode(false);
    setDraftName(""); setDraftDesc(""); setDraftQty("");
    setDraftSpecs(""); setDraftBrand(""); setDraftModel("");
    setDraftLinks([""]); setDraftSuggestion("");
    if (draftPhotoPreview) URL.revokeObjectURL(draftPhotoPreview);
    setDraftPhotoFile(null); setDraftPhotoPreview(null);
    setShowDraftTechnical(false);
  };

  const openAddForm = () => {
    clearDraft();
    setEditingIdx(null);
    setShowAddForm(true);
  };

  const openEditItem = (idx: number) => {
    const item = items[idx];
    setDraftCode(item.product_code || "");
    setDraftCodeValidated(isRevenda === false ? !!item.product_code : false);
    setDraftName(item.product_name);
    setDraftDesc(item.description);
    setDraftQty(item.quantity);
    setDraftSpecs(item.technical_specs);
    setDraftBrand(item.brand_preference);
    setDraftModel(item.model_reference);
    setDraftLinks(item.reference_links.length ? item.reference_links : [""]);
    setDraftSuggestion(item.online_purchase_suggestion);
    setDraftPhotoFile(null);
    setDraftPhotoPreview(item.photo_preview);
    setShowDraftTechnical(false);
    setShowAddForm(false);
    setEditingIdx(idx);
  };

  const handleValidateProductCode = async () => {
    if (!draftCode.trim()) { toast.error("Informe o código do produto."); return; }
    setIsValidatingCode(true);
    try {
      const result = await validateOmieProductClient(draftCode.trim());
      setDraftName(result.descricao);
      setDraftCodeValidated(true);
      toast.success(`Código ${result.codigo} confirmado — ${result.descricao}`);
    } catch (err) {
      setDraftCodeValidated(false);
      setDraftName("");
      toast.error(err instanceof Error ? err.message : "Erro ao consultar o código no Omie.");
    } finally {
      setIsValidatingCode(false);
    }
  };

  const saveDraft = () => {
    if (isRevenda === false && !draftCodeValidated) {
      toast.error("Verifique o código do produto (VPCON) antes de adicionar.");
      return;
    }
    if (!draftName.trim()) { toast.error("Informe o nome do produto."); return; }
    if (!draftQty || parseFloat(draftQty) <= 0) { toast.error("Informe uma quantidade válida."); return; }
    if (draftDesc.trim().length < 5) { toast.error("Descrição deve ter pelo menos 5 caracteres."); return; }

    const draft: ItemDraft = {
      product_code: isRevenda === false ? draftCode.trim() : "",
      product_name: draftName.trim(),
      description: draftDesc.trim(),
      quantity: draftQty,
      technical_specs: draftSpecs,
      brand_preference: draftBrand,
      model_reference: draftModel,
      reference_links: draftLinks.filter(Boolean),
      online_purchase_suggestion: draftSuggestion,
      photo_file: draftPhotoFile,
      photo_preview: draftPhotoPreview,
      photo_path: editingIdx !== null ? items[editingIdx].photo_path : null,
    };

    if (editingIdx !== null) {
      setItems((prev) => prev.map((it, i) => i === editingIdx ? draft : it));
      setEditingIdx(null);
    } else {
      setItems((prev) => [...prev, draft]);
      setShowAddForm(false);
    }
    clearDraft();
  };

  const cancelDraft = () => {
    clearDraft();
    setShowAddForm(false);
    setEditingIdx(null);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleValidateOmie = async () => {
    if (!pedidoNum.trim()) { toast.error("Informe o número do pedido."); return; }
    setIsValidatingOmie(true);
    setOmieResult(null);
    try {
      const result = await validateOmieOrderClient(pedidoNum.trim());
      setOmieResult({ numero: result.numeroPedido, vendedor: result.vendedor });
      toast.success(`Pedido ${result.numeroPedido} confirmado — Vendedor: ${result.vendedor}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao consultar o Omie.");
    } finally {
      setIsValidatingOmie(false);
    }
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (items.length === 0) { toast.error("Adicione pelo menos um produto."); return false; }
      if (showAddForm || editingIdx !== null) {
        toast.error("Salve ou cancele o produto atual antes de avançar."); return false;
      }
    }
    if (step === 1) {
      if (!deliveryDeadline) { toast.error("Informe a data limite para entrega."); return false; }
      if (!deliveryLocation.trim()) { toast.error("Informe o local de entrega."); return false; }
      if (!urgencyLevel) { toast.error("Selecione o nível de urgência."); return false; }
      if (justification.length < 10) { toast.error("Justificativa deve ter pelo menos 10 caracteres."); return false; }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    toast.dismiss();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleSubmit = async () => {
    if (!validateStep() || !deliveryDeadline) return;
    setIsSubmitting(true);

    try {
      // Upload de fotos
      const itemsWithPaths = await Promise.all(
        items.map(async (item) => {
          let photoPath = item.photo_path;
          if (item.photo_file) {
            const ext = item.photo_file.name.split(".").pop()?.toLowerCase() || "jpg";
            const path = `m1/${user?.id ?? "anon"}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
            const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
              .from("travel-docs")
              .upload(path, item.photo_file, { upsert: true });
            if (uploadError) console.warn("[photo upload]", uploadError.message);
            else photoPath = uploadData.path;
          }
          return {
            productCode: item.product_code || null,
            productName: item.product_name,
            description: item.description,
            quantity: parseFloat(item.quantity),
            technicalSpecs: item.technical_specs,
            brandPreference: item.brand_preference,
            modelReference: item.model_reference,
            referenceLinks: item.reference_links.filter(Boolean),
            onlinePurchaseSuggestion: item.online_purchase_suggestion,
            photoPath: photoPath ?? null,
          };
        }),
      );

      const title =
        itemsWithPaths.length === 1
          ? itemsWithPaths[0].productName
          : `${itemsWithPaths.length} itens — ${itemsWithPaths[0].productName} e outros`;

      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title,
          description: itemsWithPaths.map((i) => `${i.productName}: ${i.description}`).join(" | "),
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: deliveryDeadline.toISOString().slice(0, 10),
          moduleData: {
            items: itemsWithPaths.map((i) => ({
              product_code: i.productCode,
              product_name: i.productName,
              quantity: i.quantity,
              description: i.description,
              technical_specs: i.technicalSpecs,
              brand_preference: i.brandPreference,
              model_reference: i.modelReference,
              reference_links: i.referenceLinks,
              online_purchase_suggestion: i.onlinePurchaseSuggestion,
              photo_path: i.photoPath ?? null,
            })),
            delivery_location: deliveryLocation,
            revenda: isRevenda ?? false,
            pedido_venda_numero: omieResult?.numero ?? null,
            pedido_venda_vendedor: omieResult?.vendedor ?? null,
          },
          editorName: profile?.full_name || user?.email || "Usuário VP",
        });
        const ordinals = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª", "8ª", "9ª", "10ª"];
        const ordinal = ordinals[(result.edition ?? 2) - 1] ?? `${result.edition}ª`;
        toast.success(`Requisição editada — ${ordinal} Edição`, { description: editTicketNumber ?? "" });
        setDialogOpen(false);
        resetForm();
        setEditMode(false); setEditReqId(null); setEditEdition(1);
        void router.navigate({ to: "/logs" });
        return;
      }

      const result = await createProductRequisitionClient({
        items: itemsWithPaths,
        deliveryDeadline: deliveryDeadline.toISOString(),
        deliveryLocation,
        urgencyLevel: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
        justification,
        revenda: isRevenda ?? false,
        pedidoVendaNumero: omieResult?.numero ?? null,
        pedidoVendaVendedor: omieResult?.vendedor ?? null,
        requesterName: profile?.full_name || user?.email || "Usuário VerticalParts",
        requesterEmail: profile?.email || user?.email || "",
        requesterDepartment: profile?.department || "Não informado",
        requesterProfileId: user?.id,
      });

      toast.success("Requisição criada com sucesso!", { description: `${result.ticketNumber} — ${title}` });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: result.id,
        ticketNumber: result.ticketNumber,
        title,
        module: "M1",
        requesterName: profile?.full_name || user?.email || "Usuário VP",
      }).catch(console.warn);
      setDialogOpen(false);
      resetForm();
      setTickets(await listProductRequisitionsClient());
      await router.invalidate();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Não foi possível criar a requisição agora.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const minDate = addDays(new Date(), 3);
  const formActive = showAddForm || editingIdx !== null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Package className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M1 — Produtos</h1>
            <p className="text-sm text-muted-foreground">Materiais, insumos e equipamentos</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de produto ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>
              {editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Produto"}
            </DialogTitle>
            <DialogDescription>
              {editMode ? "Altere os campos desejados e salve para registrar nova versão." : "Preencha os dados para abrir a requisição."}
            </DialogDescription>
          </DialogHeader>

          {/* ── Triagem (apenas nova requisição, antes do stepper) ── */}
          {!editMode && !triageCompleted && (
            <>
              <div className="space-y-5 py-2">
                <p className="text-sm text-muted-foreground text-center">Selecione o tipo de requisição para começar:</p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => { setIsRevenda(false); setOmieResult(null); setPedidoNum(""); setTriageCompleted(true); }}
                    className={cn(
                      "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all text-center",
                      isRevenda === false ? "border-vp-yellow bg-amber-50/60" : "border-border hover:border-vp-yellow/50 hover:bg-amber-50/20",
                    )}
                  >
                    <Package className="h-10 w-10 text-vp-yellow-dark" />
                    <div>
                      <p className="font-semibold text-foreground">Uso e Consumo</p>
                      <p className="text-xs text-muted-foreground mt-1">Compra interna, materiais e equipamentos</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsRevenda(true); setOmieResult(null); }}
                    className={cn(
                      "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all text-center",
                      isRevenda === true ? "border-vp-yellow bg-amber-50/60" : "border-border hover:border-vp-yellow/50 hover:bg-amber-50/20",
                    )}
                  >
                    <Tag className="h-10 w-10 text-vp-yellow-dark" />
                    <div>
                      <p className="font-semibold text-foreground">Revenda</p>
                      <p className="text-xs text-muted-foreground mt-1">Produtos vinculados a um pedido de venda</p>
                    </div>
                  </button>
                </div>

                {isRevenda === true && (
                  <div className="space-y-3 pt-1">
                    <Separator />
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Número do Pedido de Venda *</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Ex.: 29088"
                          value={pedidoNum}
                          onChange={(e) => { setPedidoNum(e.target.value); setOmieResult(null); }}
                          className="max-w-[180px]"
                          onKeyDown={(e) => { if (e.key === "Enter") void handleValidateOmie(); }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleValidateOmie}
                          disabled={isValidatingOmie || !pedidoNum.trim()}
                        >
                          {isValidatingOmie ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar no Omie"}
                        </Button>
                      </div>
                      {omieResult && (
                        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-sm text-green-800">
                            Pedido <span className="font-semibold">{omieResult.numero}</span> confirmado — Vendedor: <span className="font-semibold">{omieResult.vendedor}</span>
                          </p>
                        </div>
                      )}
                      {omieResult && (
                        <Button variant="vp" className="w-full" onClick={() => setTriageCompleted(true)}>
                          Confirmar e iniciar requisição <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
              </DialogFooter>
            </>
          )}

          {/* ── Stepper (após triagem ou em modo edição) ── */}
          {(editMode || triageCompleted) && (
            <>
          {/* Stepper */}
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = i === step;
              const done = i < step;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => { if (i < step) setStep(i); }}
                  className={cn(
                    "flex flex-col items-center gap-1 text-[10px] font-medium transition-colors flex-1",
                    active ? "text-vp-yellow-dark" : done ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  <div className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                    active ? "border-vp-yellow bg-amber-50" : done ? "border-green-500 bg-green-50" : "border-border",
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* ── Step 0: Produtos ── */}
          {step === 0 && (
            <div className="space-y-3">
              {/* Cards dos itens adicionados */}
              {items.length === 0 && !formActive && (
                <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
                  <Package className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum produto adicionado ainda. Clique em <span className="font-medium">Adicionar produto</span> para começar.
                  </p>
                </div>
              )}

              {items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.product_name}</span>
                      {item.product_code && <Badge variant="outline">{item.product_code}</Badge>}
                      <Badge variant="secondary">Qtd: {item.quantity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {item.description.length > 80 ? `${item.description.slice(0, 80)}…` : item.description}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditItem(idx)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Formulário inline de item */}
              {formActive && (
                <div className="rounded-lg border-2 border-vp-yellow/40 bg-amber-50/30 p-4 space-y-3">
                  <p className="text-xs font-semibold text-vp-yellow-dark uppercase tracking-wide">
                    {editingIdx !== null ? `Editando item ${editingIdx + 1}` : "Novo produto"}
                  </p>
                  {isRevenda === false && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Código do Produto (VPCON) *</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Ex.: VPCON-677"
                          value={draftCode}
                          onChange={(e) => { setDraftCode(e.target.value); setDraftCodeValidated(false); setDraftName(""); }}
                          className="max-w-[200px]"
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleValidateProductCode(); } }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleValidateProductCode}
                          disabled={isValidatingCode || !draftCode.trim()}
                        >
                          {isValidatingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
                        </Button>
                      </div>
                      {draftCodeValidated && draftName && (
                        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-sm text-green-800">
                            Código <span className="font-semibold">{draftCode}</span> confirmado — <span className="font-semibold">{draftName}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Nome do Produto *</label>
                    <Input
                      placeholder={isRevenda === false ? "Verifique o código acima" : "Ex.: Rolamento SKF 6205 ZZ"}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={200}
                      disabled={isRevenda === false}
                      readOnly={isRevenda === false}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-sm font-medium">Descrição *</label>
                      <Textarea placeholder="Descreva o material e contexto de uso..." value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} rows={2} maxLength={1000} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Quantidade *</label>
                      <Input type="number" min="0" step="0.01" placeholder="0" value={draftQty} onChange={(e) => setDraftQty(e.target.value)} />
                    </div>
                  </div>

                  {/* Detalhes técnicos expansíveis */}
                  <button
                    type="button"
                    onClick={() => setShowDraftTechnical((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showDraftTechnical ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    Detalhes técnicos (opcional)
                  </button>

                  {showDraftTechnical && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Especificações Técnicas</label>
                        <Textarea placeholder="Dimensões, material, potência, compatibilidade..." value={draftSpecs} onChange={(e) => setDraftSpecs(e.target.value)} rows={2} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Marca Preferencial</label>
                          <Input placeholder="Ex.: SKF, Bosch" value={draftBrand} onChange={(e) => setDraftBrand(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Modelo/Referência</label>
                          <Input placeholder="Ex.: 6205-2RS" value={draftModel} onChange={(e) => setDraftModel(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium flex items-center gap-1">
                          <Link2 className="h-3.5 w-3.5" /> Links de Referência
                        </label>
                        {draftLinks.map((link, idx) => (
                          <div key={idx} className="flex gap-2">
                            <Input
                              placeholder="Cole aqui o link"
                              value={link}
                              onChange={(e) => {
                                const copy = [...draftLinks];
                                copy[idx] = e.target.value;
                                setDraftLinks(copy);
                              }}
                            />
                            {draftLinks.length > 1 && (
                              <Button variant="ghost" size="icon" onClick={() => setDraftLinks(draftLinks.filter((_, i) => i !== idx))}>
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {draftLinks.length < 5 && (
                          <Button variant="ghost" size="sm" onClick={() => setDraftLinks([...draftLinks, ""])}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar link
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Sugestão de Compra Online</label>
                        <Textarea placeholder="URL da loja, produto específico..." value={draftSuggestion} onChange={(e) => setDraftSuggestion(e.target.value)} rows={2} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium flex items-center gap-1">
                          <ImageIcon className="h-3.5 w-3.5" /> Foto do Produto
                          <span className="text-muted-foreground font-normal text-[11px]">(opcional)</span>
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          id={`draft-photo-${editingIdx ?? "new"}`}
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            if (draftPhotoPreview) URL.revokeObjectURL(draftPhotoPreview);
                            setDraftPhotoFile(file);
                            setDraftPhotoPreview(file ? URL.createObjectURL(file) : null);
                          }}
                        />
                        <label
                          htmlFor={`draft-photo-${editingIdx ?? "new"}`}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors",
                            draftPhotoFile ? "border-green-400 bg-green-50" : "border-border hover:border-muted-foreground/50",
                          )}
                        >
                          {draftPhotoPreview ? (
                            <>
                              <img src={draftPhotoPreview} alt="Produto" className="h-12 w-12 rounded object-cover border" />
                              <p className="text-xs font-medium text-green-700 truncate">{draftPhotoFile?.name ?? "Foto atual"}</p>
                            </>
                          ) : (
                            <>
                              <div className="flex h-12 w-12 items-center justify-center rounded bg-muted shrink-0">
                                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="text-xs font-medium flex items-center gap-1">
                                  <Upload className="h-3.5 w-3.5" /> Enviar foto
                                </p>
                                <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP — máx. 5 MB</p>
                              </div>
                            </>
                          )}
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={cancelDraft}>Cancelar</Button>
                    <Button variant="vp" size="sm" onClick={saveDraft}>
                      {editingIdx !== null ? "Salvar" : "Adicionar"}
                    </Button>
                  </div>
                </div>
              )}

              {!formActive && (
                <Button variant="outline" size="sm" onClick={openAddForm} className="w-full border-dashed">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar produto
                </Button>
              )}

            </div>
          )}

          {/* ── Step 1: Logística ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data Limite para Entrega *</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !deliveryDeadline && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {deliveryDeadline ? format(deliveryDeadline, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={deliveryDeadline}
                      onSelect={setDeliveryDeadline}
                      disabled={(d) => d < minDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Local de Entrega *</label>
                <Input placeholder="Endereço, andar, sala, setor" value={deliveryLocation} onChange={(e) => setDeliveryLocation(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Urgência *</label>
                <div className="grid grid-cols-4 gap-2">
                  {URGENCY.map((u) => (
                    <button
                      key={u.value}
                      type="button"
                      onClick={() => setUrgencyLevel(u.value)}
                      className={cn(
                        "rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        urgencyLevel === u.value
                          ? u.value === "LOW" ? "border-green-500 bg-green-50 text-green-700"
                          : u.value === "MEDIUM" ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                          : u.value === "HIGH" ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-red-500 bg-red-50 text-red-700"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Justificativa da Compra *</label>
                <Textarea placeholder="Por que é necessário? Qual o impacto se não for comprado?" value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} maxLength={500} />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="outline" onClick={() => step === 0 ? setDialogOpen(false) : setStep(step - 1)}>
              {step === 0 ? "Cancelar" : <><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</>}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="vp" onClick={handleNext}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button variant="vp" onClick={handleSubmit} disabled={isSubmitting}>
                <Package className="h-4 w-4 mr-1" />{editMode ? "Salvar Edição" : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

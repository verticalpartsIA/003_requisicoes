import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Package, Plus, ChevronRight, ChevronLeft, FileText, Truck,
  Link2, X, CalendarIcon, ImageIcon, Upload,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TicketsTable } from "@/components/tickets-table";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { toast } from "sonner";
import { createProductRequisitionClient, listProductRequisitionsClient, updateRequisitionClient } from "@/features/requisitions/client";
import { friendlySupabaseError } from "@/lib/supabase-error";
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
  { label: "Produto", icon: Package },
  { label: "Técnico", icon: FileText },
  { label: "Logística", icon: Truck },
];

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

const DIALOG_KEY = 'vpreq_m1';

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
  const [editPhotoPath, setEditPhotoPath] = useState<string | null>(null);

  // Step 1 — Product
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");

  // Step 2 — Technical
  const [technicalSpecs, setTechnicalSpecs] = useState("");
  const [brandPreference, setBrandPreference] = useState("");
  const [modelReference, setModelReference] = useState("");
  const [referenceLinks, setReferenceLinks] = useState<string[]>([""]);
  const [onlinePurchaseSuggestion, setOnlinePurchaseSuggestion] = useState("");

  // Step 2 — photo (optional)
  const [productPhotoFile, setProductPhotoFile] = useState<File | null>(null);
  const [productPhotoPreview, setProductPhotoPreview] = useState<string | null>(null);

  // Step 3 — Logistics
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
      if (typeof s.step === 'number') setStep(s.step);
      if (typeof s.productName === 'string') setProductName(s.productName);
      if (typeof s.description === 'string') setDescription(s.description);
      if (typeof s.quantity === 'string') setQuantity(s.quantity);
      if (typeof s.technicalSpecs === 'string') setTechnicalSpecs(s.technicalSpecs);
      if (typeof s.brandPreference === 'string') setBrandPreference(s.brandPreference);
      if (typeof s.modelReference === 'string') setModelReference(s.modelReference);
      if (Array.isArray(s.referenceLinks)) setReferenceLinks(s.referenceLinks as string[]);
      if (typeof s.onlinePurchaseSuggestion === 'string') setOnlinePurchaseSuggestion(s.onlinePurchaseSuggestion);
      if (typeof s.deliveryDeadline === 'string') setDeliveryDeadline(new Date(s.deliveryDeadline));
      if (typeof s.deliveryLocation === 'string') setDeliveryLocation(s.deliveryLocation);
      if (typeof s.urgencyLevel === 'string') setUrgencyLevel(s.urgencyLevel);
      if (typeof s.justification === 'string') setJustification(s.justification);
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
      setEditPhotoPath((md.photo_path as string | null) ?? null);
      setProductName((md.product_name as string | undefined) ?? (data.title as string) ?? "");
      setDescription((data.description as string) ?? "");
      setQuantity(String((md.quantity as number | undefined) ?? 1));
      setTechnicalSpecs((md.technical_specs as string | undefined) ?? "");
      setBrandPreference((md.brand_preference as string | undefined) ?? "");
      setModelReference((md.model_reference as string | undefined) ?? "");
      setReferenceLinks((md.reference_links as string[] | undefined) ?? [""]);
      setOnlinePurchaseSuggestion((md.online_purchase_suggestion as string | undefined) ?? "");
      setDeliveryLocation((md.delivery_location as string | undefined) ?? "");
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      if (data.desired_date) setDeliveryDeadline(new Date(data.desired_date as string));
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, productName, description, quantity,
        technicalSpecs, brandPreference, modelReference, referenceLinks,
        onlinePurchaseSuggestion,
        deliveryDeadline: deliveryDeadline?.toISOString(),
        deliveryLocation, urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, productName, description, quantity, technicalSpecs,
      brandPreference, modelReference, referenceLinks, onlinePurchaseSuggestion,
      deliveryDeadline, deliveryLocation, urgencyLevel, justification]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setProductName(""); setDescription(""); setQuantity("");
    setTechnicalSpecs(""); setBrandPreference("");
    setModelReference(""); setReferenceLinks([""]); setOnlinePurchaseSuggestion("");
    if (productPhotoPreview) URL.revokeObjectURL(productPhotoPreview);
    setProductPhotoFile(null); setProductPhotoPreview(null);
    setDeliveryDeadline(undefined); setDeliveryLocation(""); setUrgencyLevel("");
    setJustification("");
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (productName.length < 5) { toast.error("Nome do produto deve ter pelo menos 5 caracteres."); return false; }
      if (description.length < 20) { toast.error("Descrição deve ter pelo menos 20 caracteres."); return false; }
      if (!quantity || parseFloat(quantity) <= 0) { toast.error("Quantidade deve ser maior que 0."); return false; }
    }
    if (step === 2) {
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

    const cleanedReferenceLinks = referenceLinks
      .map((link) => link.trim())
      .filter(Boolean);

    setIsSubmitting(true);

    try {
      let photoPath: string | undefined = editPhotoPath ?? undefined;
      if (productPhotoFile) {
        const ext = productPhotoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `m1/${user?.id ?? "anon"}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
          .from("travel-docs")
          .upload(path, productPhotoFile, { upsert: true });
        if (uploadError) console.warn("[photo upload]", uploadError.message);
        else photoPath = uploadData.path;
      }

      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: productName,
          description,
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: deliveryDeadline.toISOString().slice(0, 10),
          moduleData: {
            product_name: productName,
            quantity: parseFloat(quantity),
            technical_specs: technicalSpecs,
            brand_preference: brandPreference,
            model_reference: modelReference,
            reference_links: cleanedReferenceLinks,
            online_purchase_suggestion: onlinePurchaseSuggestion,
            photo_path: photoPath ?? null,
            delivery_location: deliveryLocation,
          },
          editorName: profile?.full_name || user?.email || "Usuário VP",
        });
        const ordinals = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª", "8ª", "9ª", "10ª"];
        const ordinal = ordinals[(result.edition ?? 2) - 1] ?? `${result.edition}ª`;
        toast.success(`Requisição editada — ${ordinal} Edição`, { description: editTicketNumber ?? "" });
        setDialogOpen(false);
        resetForm();
        setEditMode(false); setEditReqId(null); setEditEdition(1); setEditPhotoPath(null);
        void router.navigate({ to: "/logs" });
        return;
      }

      const result = await createProductRequisitionClient({
        productName,
        description,
        quantity: parseFloat(quantity),
        technicalSpecs,
        brandPreference,
        modelReference,
        referenceLinks: cleanedReferenceLinks,
        onlinePurchaseSuggestion,
        photoPath,
        deliveryDeadline: deliveryDeadline.toISOString(),
        deliveryLocation,
        urgencyLevel: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
        justification,
        requesterName: profile?.full_name || user?.email || "Usuário VerticalParts",
        requesterEmail: profile?.email || user?.email || "",
        requesterDepartment: profile?.department || "Não informado",
        requesterProfileId: user?.id,
      });

      toast.success("Requisição criada com sucesso!", {
        description: `${result.ticketNumber} — ${productName}`,
      });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: result.id,
        ticketNumber: result.ticketNumber,
        title: productName,
        module: "M1",
        requesterName: profile?.full_name || user?.email || "Usuário VP",
      }).catch(console.warn);
      setDialogOpen(false);
      resetForm();
      setTickets(await listProductRequisitionsClient());
      await router.invalidate();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : (error as { message?: string })?.message ?? "Não foi possível criar a requisição agora.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addReferenceLink = () => {
    if (referenceLinks.length < 5) setReferenceLinks([...referenceLinks, ""]);
  };

  const updateReferenceLink = (idx: number, val: string) => {
    const copy = [...referenceLinks];
    copy[idx] = val;
    setReferenceLinks(copy);
  };

  const removeReferenceLink = (idx: number) => {
    setReferenceLinks(referenceLinks.filter((_, i) => i !== idx));
  };

  const minDate = addDays(new Date(), 3);

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

      {/* ---- Requisition Form Dialog ---- */}
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
                    active ? "text-vp-yellow-dark" : done ? "text-green-600" : "text-muted-foreground"
                  )}
                >
                  <div className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                    active ? "border-vp-yellow bg-amber-50" : done ? "border-green-500 bg-green-50" : "border-border"
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* ---------- Step 0: Produto ---------- */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome do Produto/Material *</label>
                <Input placeholder="Ex.: Rolamento SKF 6205 ZZ" value={productName} onChange={(e) => setProductName(e.target.value)} maxLength={200} />
                <p className="text-[11px] text-muted-foreground">{productName.length}/200</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição Detalhada *</label>
                <Textarea placeholder="Descreva o material, aplicação e contexto de uso..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
                <p className="text-[11px] text-muted-foreground">{description.length}/1000</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Quantidade *</label>
                <Input type="number" min="0" step="0.01" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>
          )}

          {/* ---------- Step 1: Técnico ---------- */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Especificações Técnicas</label>
                <Textarea placeholder="Dimensões, material, potência, compatibilidade..." value={technicalSpecs} onChange={(e) => setTechnicalSpecs(e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Marca Preferencial (opcional)</label>
                  <Input placeholder="Ex.: SKF, Bosch" value={brandPreference} onChange={(e) => setBrandPreference(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Modelo/Referência</label>
                  <Input placeholder="Ex.: 6205-2RS" value={modelReference} onChange={(e) => setModelReference(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Link2 className="h-3.5 w-3.5" /> Links de Referência
                </label>
                {referenceLinks.map((link, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      placeholder="Cole aqui o Link"
                      value={link}
                      onChange={(e) => updateReferenceLink(idx, e.target.value)}
                    />
                    {referenceLinks.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeReferenceLink(idx)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {referenceLinks.length < 5 && (
                  <Button variant="ghost" size="sm" onClick={addReferenceLink}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar link
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Sugestão de Compra Online</label>
                <Textarea placeholder="URL da loja, produto específico, justificativa..." value={onlinePurchaseSuggestion} onChange={(e) => setOnlinePurchaseSuggestion(e.target.value)} rows={2} />
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
                  id="product-photo"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (productPhotoPreview) URL.revokeObjectURL(productPhotoPreview);
                    setProductPhotoFile(file);
                    setProductPhotoPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                <label
                  htmlFor="product-photo"
                  className={cn(
                    "flex items-center gap-3 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors",
                    productPhotoFile ? "border-green-400 bg-green-50" : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  {productPhotoPreview ? (
                    <>
                      <img src={productPhotoPreview} alt="Produto" className="h-14 w-14 rounded object-cover border" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-green-700 truncate">{productPhotoFile?.name}</p>
                        <p className="text-[11px] text-muted-foreground">Clique para trocar</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded bg-muted shrink-0">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs font-medium flex items-center gap-1">
                          <Upload className="h-3.5 w-3.5" /> Enviar foto do produto
                        </p>
                        <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP — máx. 5 MB</p>
                      </div>
                    </>
                  )}
                </label>
              </div>
            </div>
          )}

          {/* ---------- Step 2: Logística ---------- */}
          {step === 2 && (
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
                          : "border-border hover:border-muted-foreground/40"
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

          {/* Navigation */}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

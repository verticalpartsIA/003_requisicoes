import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  Key, Plus, ChevronRight, ChevronLeft, CalendarIcon, Cog, ClipboardList, AlertTriangle, Eye,
} from "lucide-react";
import { format, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Stepper } from "@/components/ui/stepper";
import { FIELD_ERROR_CLASS } from "@/lib/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TicketsTable, type TicketRow } from "@/components/tickets-table";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { friendlySupabaseError } from "@/lib/supabase-error";
import { useAuth } from "@/features/auth/auth-context";
import { toast } from "sonner";
import { notifyVpClickClient } from "@/features/vpclick/client";
import { updateRequisitionClient } from "@/features/requisitions/client";

const EQUIPMENT_CATEGORIES = [
  { value: "GUINDASTE", label: "Guindaste" },
  { value: "PLATAFORMA", label: "Plataforma Elevatória" },
  { value: "ANDAIME", label: "Andaime Tubular" },
  { value: "BETONEIRA", label: "Betoneira" },
  { value: "ESCAVADEIRA", label: "Escavadeira / Retroescavadeira" },
  { value: "GERADOR", label: "Gerador" },
  { value: "COMPRESSOR", label: "Compressor" },
  { value: "EMPILHADEIRA", label: "Empilhadeira" },
  { value: "PALETEIRA_HIDRAULICA", label: "Paleteira Hidráulica" },
  { value: "PALETEIRA_ELETRICA", label: "Paleteira Elétrica" },
  { value: "CAMINHAO_MUNCK", label: "Caminhão Munck" },
  { value: "CHAPA", label: "Chapa (Ajudante)" },
  { value: "VEICULO", label: "Veículo Leve" },
  { value: "OUTRO", label: "Outro" },
];

// Equipamentos que tipicamente exigem ART (Anotação de Responsabilidade
// Técnica) para operação/instalação. Ajustável conforme a política interna.
const ART_REQUIRED_CATEGORIES = ["GUINDASTE", "PLATAFORMA", "ANDAIME", "ESCAVADEIRA", "CAMINHAO_MUNCK"];

const ART_STATUS_OPTIONS = [
  { value: "EMITIR", label: "Não, precisamos emitir" },
  { value: "TEMOS", label: "Sim, já temos" },
  { value: "NAO_SEI", label: "Não sei informar" },
];

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Equipamento", icon: Cog },
  { label: "Período", icon: CalendarIcon },
  { label: "Justificativa", icon: ClipboardList },
  { label: "Revisão", icon: Eye },
];

const DIALOG_KEY = 'vpreq_m6';
const LONG_RENTAL_DAYS = 30;

export const Route = createFileRoute("/rental")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M6 Locação — VPRequisições" },
      { name: "description", content: "Requisição de locação de equipamentos e veículos" },
    ],
  }),
  component: RentalPage,
});

function RentalPage() {
  const { edit: editTicketNumber } = Route.useSearch();
  const router = useRouter();
  const { session, profile, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [stepAttempted, setStepAttempted] = useState(false);
  useEffect(() => { setStepAttempted(false); }, [step]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editReqId, setEditReqId] = useState<string | null>(null);
  const [editEdition, setEditEdition] = useState(1);

  const [categories, setCategories] = useState<string[]>([]);
  const [specs, setSpecs] = useState("");
  const [quantity, setQuantity] = useState("1");

  const [artStatus, setArtStatus] = useState("EMITIR");
  const [needsSecurityInduction, setNeedsSecurityInduction] = useState(false);
  const [clientNormFile, setClientNormFile] = useState<File | null>(null);
  const [editClientNormPath, setEditClientNormPath] = useState<string | null>(null);

  const needsArt = useMemo(
    () => categories.some((c) => ART_REQUIRED_CATEGORIES.includes(c)),
    [categories],
  );

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [deliveryLocation, setDeliveryLocation] = useState("");

  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  const rentalDays = useMemo(() => {
    if (startDate && endDate) return differenceInCalendarDays(endDate, startDate);
    return 0;
  }, [startDate, endDate]);

  const isLongRental = rentalDays > LONG_RENTAL_DAYS;

  const categoryLabel = useMemo(
    () => categories.map((v) => EQUIPMENT_CATEGORIES.find((c) => c.value === v)?.label ?? v).join(' + ') || 'Locação',
    [categories],
  );

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M6")
      .order("created_at", { ascending: false })
      .limit(20);
    setTickets((data ?? []).map((item) => ({
      id: item.ticket_number,
      title: item.title,
      requester: item.requester_name,
      urgency: item.urgency as TicketRow["urgency"],
      status: item.status as TicketRow["status"],
      date: new Date(item.created_at).toLocaleDateString("pt-BR"),
    })));
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DIALOG_KEY);
      if (!saved) return;
      const s = JSON.parse(saved) as Record<string, unknown>;
      if (!s.open) return;
      setDialogOpen(true);
      if (typeof s.step === 'number') setStep(s.step);
      if (Array.isArray(s.categories)) setCategories(s.categories as string[]);
      else if (typeof s.category === 'string' && s.category) setCategories([s.category as string]);
      if (typeof s.specs === 'string') setSpecs(s.specs);
      if (typeof s.quantity === 'string') setQuantity(s.quantity);
      if (typeof s.artStatus === 'string') setArtStatus(s.artStatus);
      if (typeof s.needsSecurityInduction === 'boolean') setNeedsSecurityInduction(s.needsSecurityInduction);
      if (typeof s.startDate === 'string') setStartDate(new Date(s.startDate));
      if (typeof s.endDate === 'string') setEndDate(new Date(s.endDate));
      if (typeof s.deliveryLocation === 'string') setDeliveryLocation(s.deliveryLocation);
      if (typeof s.urgencyLevel === 'string') setUrgencyLevel(s.urgencyLevel);
      if (typeof s.justification === 'string') setJustification(s.justification);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadTickets(); }, [session]);

  useEffect(() => {
    if (!editTicketNumber || !session) return;
    const load = async () => {
      const { data } = await supabaseBrowser
        .from("requisitions")
        .select("id,edition,urgency,justification,desired_date,module_data")
        .eq("ticket_number", editTicketNumber)
        .eq("module", "M6")
        .maybeSingle();
      if (!data) { toast.error("Requisição não encontrada."); return; }
      const md = (data.module_data ?? {}) as Record<string, unknown>;
      setEditMode(true);
      setEditReqId(data.id as string);
      setEditEdition((data.edition as number | undefined) ?? 1);
      if (Array.isArray(md.categories)) setCategories(md.categories as string[]);
      else if (typeof md.category === "string" && md.category) setCategories([md.category as string]);
      if (typeof md.specs === "string") setSpecs(md.specs);
      if (typeof md.quantity === "number") setQuantity(String(md.quantity));
      if (typeof md.art_status === "string") setArtStatus(md.art_status);
      if (typeof md.needs_security_induction === "boolean") setNeedsSecurityInduction(md.needs_security_induction);
      setEditClientNormPath((md.client_norm_path as string | null) ?? null);
      if (typeof md.start_date === "string") setStartDate(new Date(md.start_date));
      if (typeof md.end_date === "string") setEndDate(new Date(md.end_date));
      if (typeof md.delivery_location === "string") setDeliveryLocation(md.delivery_location);
      if (typeof data.urgency === "string") setUrgencyLevel(data.urgency);
      if (typeof data.justification === "string") setJustification(data.justification);
      sessionStorage.removeItem(DIALOG_KEY);
      setDialogOpen(true);
    };
    void load();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, categories, specs, quantity,
        artStatus, needsSecurityInduction,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        deliveryLocation, urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, categories, specs, quantity, artStatus, needsSecurityInduction,
      startDate, endDate, deliveryLocation, urgencyLevel, justification]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setCategories([]); setSpecs(""); setQuantity("1");
    setArtStatus("EMITIR"); setNeedsSecurityInduction(false);
    setClientNormFile(null); setEditClientNormPath(null);
    setStartDate(undefined); setEndDate(undefined); setDeliveryLocation("");
    setUrgencyLevel(""); setJustification("");
    setEditMode(false); setEditReqId(null); setEditEdition(1);
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (categories.length === 0) { toast.error("Selecione pelo menos uma categoria."); return false; }
      if (!quantity || parseInt(quantity) <= 0) { toast.error("Quantidade deve ser maior que 0."); return false; }
    }
    if (step === 1) {
      if (!startDate) { toast.error("Informe a data de início."); return false; }
      if (!endDate) { toast.error("Informe a data de término."); return false; }
      if (endDate < startDate) { toast.error("Data de término deve ser igual ou posterior ao início."); return false; }
      if (!deliveryLocation.trim()) { toast.error("Informe o local de entrega."); return false; }
    }
    if (step === 2) {
      if (!urgencyLevel) { toast.error("Selecione o nível de urgência."); return false; }
      if (justification.length < 10) { toast.error("Justificativa deve ter pelo menos 10 caracteres."); return false; }
      if (isLongRental && justification.length < 50) {
        toast.error("Locação acima de 30 dias requer justificativa detalhada (mín. 50 caracteres)."); return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) { toast.dismiss(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
    else setStepAttempted(true);
  };

  const handleSubmit = async () => {
    if (!validateStep()) { setStepAttempted(true); return; }
    setIsSubmitting(true);
    try {
      let clientNormPath: string | null = editClientNormPath;
      if (clientNormFile) {
        const ext = clientNormFile.name.split(".").pop()?.toLowerCase() || "pdf";
        const path = `m6/${user?.id ?? "anon"}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
          .from("travel-docs")
          .upload(path, clientNormFile, { upsert: true });
        if (uploadError) console.warn("[client norm upload]", uploadError.message);
        else clientNormPath = uploadData.path;
      }

      const moduleData = {
        categories,
        category: categories[0] ?? "",
        specs,
        quantity: parseInt(quantity),
        needs_art: needsArt,
        art_status: needsArt ? artStatus : null,
        needs_security_induction: needsArt ? needsSecurityInduction : false,
        client_norm_path: needsArt ? clientNormPath : null,
        start_date: startDate?.toISOString().slice(0, 10),
        end_date: endDate?.toISOString().slice(0, 10),
        rental_days: rentalDays,
        delivery_location: deliveryLocation,
        long_rental: isLongRental,
      };

      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: `Locação: ${categoryLabel} — ${rentalDays} dia(s)`,
          description: justification,
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: startDate?.toISOString().slice(0, 10) ?? null,
          moduleData,
          editorName: profile?.full_name || user?.email || "Usuário VP",
        });
        const ordinals = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª", "8ª", "9ª", "10ª"];
        const ordinal = ordinals[(result.edition ?? 2) - 1] ?? `${result.edition}ª`;
        toast.success(`Requisição editada — ${ordinal} Edição`, { description: editTicketNumber ?? "" });
        setDialogOpen(false);
        resetForm();
        void router.navigate({ to: "/logs" });
        return;
      }

      const { error } = await supabaseBrowser
        .from("requisitions")
        .insert({
          module: "M6",
          title: `Locação: ${categoryLabel} — ${rentalDays} dia(s)`,
          description: justification,
          justification,
          urgency: urgencyLevel,
          desired_date: startDate?.toISOString().slice(0, 10) ?? null,
          requester_name: profile?.full_name || user?.email || "Usuário VP",
          requester_email: profile?.email || user?.email || "",
          requester_department: profile?.department || "Não informado",
          requester_profile_id: user?.id ?? null,
          module_data: moduleData,
          status: "GESTOR",
        });

      if (error) throw error;

      // SELECT separado para não acionar policy de SELECT durante INSERT
      const { data: created } = await supabaseBrowser
        .from("requisitions")
        .select("id,ticket_number")
        .eq("module", "M6")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      toast.success("Requisição de locação criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `Locação: ${categoryLabel} — ${rentalDays} dia(s)`,
        module: "M6",
        requesterName: profile?.full_name || user?.email || "Usuário VP",
      }).catch(console.warn);
      setDialogOpen(false);
      resetForm();
      await loadTickets();
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Key className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M6 — Locação</h1>
            <p className="text-sm text-muted-foreground">Equipamentos e veículos temporários</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Key className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de locação ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Locação"}</DialogTitle>
            <DialogDescription>Informe o equipamento e período de locação.</DialogDescription>
          </DialogHeader>

          <Stepper steps={STEPS} currentStep={step} onStepClick={setStep} />

          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Categoria * (selecione uma ou mais)</label>
                <div className={cn("grid grid-cols-2 gap-2 rounded-lg", stepAttempted && categories.length === 0 && "ring-2 ring-destructive ring-offset-2")}>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() =>
                        setCategories((prev) =>
                          prev.includes(c.value) ? prev.filter((v) => v !== c.value) : [...prev, c.value],
                        )
                      }
                      className={cn(
                        "rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        categories.includes(c.value)
                          ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {needsArt && (
                <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    📋 Segurança e Documentação
                  </p>
                  <div className="border-t" />
                  <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Você solicitou equipamentos que precisam de ART.
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">A ART (Anotação de Responsabilidade Técnica) já existe?</label>
                    <div className="flex flex-col gap-1.5">
                      {ART_STATUS_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="art-status"
                            checked={artStatus === opt.value}
                            onChange={() => setArtStatus(opt.value)}
                            className="h-4 w-4 accent-vp-yellow"
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={needsSecurityInduction}
                        onChange={(e) => setNeedsSecurityInduction(e.target.checked)}
                        className="h-4 w-4 rounded border-border accent-vp-yellow"
                      />
                      A obra exige indução de segurança?
                    </label>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Tem alguma norma específica do cliente?</label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,image/*"
                      className="hidden"
                      id="client-norm-file"
                      onChange={(e) => setClientNormFile(e.target.files?.[0] ?? null)}
                    />
                    <label
                      htmlFor="client-norm-file"
                      className="flex items-center gap-2 rounded-lg border-2 border-dashed p-2.5 cursor-pointer transition-colors border-border hover:border-muted-foreground/50 w-fit"
                    >
                      <span className="text-xs font-medium">📎 {clientNormFile ? clientNormFile.name : editClientNormPath ? "Trocar documento" : "Anexar documento"}</span>
                    </label>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Esta seção é opcional.</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Especificações Técnicas</label>
                <Textarea placeholder="Capacidade, potência, dimensões, requisitos especiais..." value={specs} onChange={(e) => setSpecs(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Quantidade *</label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={cn(stepAttempted && (!quantity || parseInt(quantity) <= 0) && FIELD_ERROR_CLASS)}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Início *</label>
                  <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn(
                        "w-full justify-start text-left font-normal",
                        !startDate && "text-muted-foreground",
                        stepAttempted && !startDate && FIELD_ERROR_CLASS,
                      )}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={startDate} onSelect={(d) => { setStartDate(d); setStartDateOpen(false); }}
                        disabled={(d) => d < startOfDay(new Date())} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Término *</label>
                  <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn(
                        "w-full justify-start text-left font-normal",
                        !endDate && "text-muted-foreground",
                        stepAttempted && !endDate && FIELD_ERROR_CLASS,
                      )}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={endDate} onSelect={(d) => { setEndDate(d); setEndDateOpen(false); }}
                        disabled={(d) => d < startOfDay(startDate || new Date())} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {startDate && endDate && rentalDays > 0 && (
                <div className={cn(
                  "rounded-lg border p-3 text-sm",
                  isLongRental ? "border-orange-300 bg-orange-50 text-orange-700" : "border-border bg-muted/30 text-muted-foreground"
                )}>
                  {isLongRental ? (
                    <p className="flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Locação longa: <strong>{rentalDays} dias</strong> — requer contrato especial e justificativa detalhada
                    </p>
                  ) : (
                    <p>Período: <span className="font-semibold text-foreground">{rentalDays} dia(s)</span></p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Local de Entrega *</label>
                <Input
                  placeholder="Endereço, obra, setor"
                  value={deliveryLocation}
                  onChange={(e) => setDeliveryLocation(e.target.value)}
                  className={cn(stepAttempted && !deliveryLocation.trim() && FIELD_ERROR_CLASS)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Urgência *</label>
                <div className={cn("grid grid-cols-4 gap-2 rounded-lg", stepAttempted && !urgencyLevel && "ring-2 ring-destructive ring-offset-2")}>
                  {URGENCY.map((u) => (
                    <button key={u.value} type="button" onClick={() => setUrgencyLevel(u.value)}
                      className={cn("rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        urgencyLevel === u.value
                          ? u.value === "LOW" ? "border-green-500 bg-green-50 text-green-700"
                          : u.value === "MEDIUM" ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                          : u.value === "HIGH" ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-red-500 bg-red-50 text-red-700"
                          : "border-border hover:border-muted-foreground/40")}>
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Justificativa *
                  {isLongRental && <span className="text-orange-600 ml-1">(mín. 50 caracteres — locação longa)</span>}
                </label>
                <Textarea
                  placeholder={isLongRental
                    ? "Locação longa: justifique a necessidade, alternativas consideradas e aprovação gerencial..."
                    : "Por que a locação é necessária? Alternativas consideradas..."
                  }
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className={cn(stepAttempted && (justification.length < 10 || (isLongRental && justification.length < 50)) && FIELD_ERROR_CLASS)}
                />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500{isLongRental && " (mín. 50)"}</p>
              </div>
            </div>
          )}

          {/* ── Step 3: Revisão ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-vp-yellow/40 bg-amber-50/30 p-3">
                <p className="text-xs text-vp-yellow-dark font-medium">
                  Confira os dados abaixo antes de {editMode ? "salvar" : "enviar"}. Use "Voltar" para corrigir qualquer campo.
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Categorias</p>
                <p className="text-sm font-medium">
                  {categories.length > 0 ? categories.map((c) => EQUIPMENT_CATEGORIES.find((e) => e.value === c)?.label ?? c).join(", ") : "—"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Quantidade</p>
                  <p className="text-sm font-medium">{quantity || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Nível de Urgência</p>
                  <p className="text-sm font-medium">{URGENCY.find((u) => u.value === urgencyLevel)?.label ?? "—"}</p>
                </div>
              </div>
              {specs && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Especificações</p>
                  <p className="text-sm">{specs}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Início</p>
                  <p className="text-sm font-medium">{startDate ? format(startDate, "dd/MM/yyyy", { locale: ptBR }) : "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Término</p>
                  <p className="text-sm font-medium">{endDate ? format(endDate, "dd/MM/yyyy", { locale: ptBR }) : "—"}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Local de Entrega</p>
                <p className="text-sm font-medium">{deliveryLocation || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Justificativa</p>
                <p className="text-sm">{justification}</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button variant="outline" onClick={() => step === 0 ? setDialogOpen(false) : setStep(step - 1)}>
              {step === 0 ? "Cancelar" : <><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</>}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="vp" onClick={handleNext}>Próximo <ChevronRight className="h-4 w-4 ml-1" /></Button>
            ) : (
              <Button variant="vp" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                <Key className="h-4 w-4 mr-1" /> {isSubmitting ? (editMode ? "Salvando..." : "Enviando...") : (editMode ? "Salvar Edição" : "Enviar Requisição")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

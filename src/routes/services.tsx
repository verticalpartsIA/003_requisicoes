import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Wrench, Plus, ChevronRight, ChevronLeft, FileText, CalendarIcon, ClipboardList, Trash2,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { parseBRLNumber } from "@/lib/number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { useRouter } from "@tanstack/react-router";

const SERVICE_TYPES = [
  { value: "CONSULTORIA", label: "Consultoria" },
  { value: "MANUTENCAO", label: "Manutenção" },
  { value: "PROJETO", label: "Projeto" },
  { value: "AUDITORIA", label: "Auditoria" },
  { value: "LIMPEZA", label: "Limpeza" },
  { value: "TI", label: "TI / Tecnologia" },
  { value: "JURIDICO", label: "Jurídico" },
  { value: "OUTRO", label: "Outro" },
];

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Serviço", icon: Wrench },
  { label: "Escopo", icon: FileText },
  { label: "Prazo", icon: ClipboardList },
];

interface Milestone {
  description: string;
  percentage: number;
}

const DIALOG_KEY = 'vpreq_m3';

export const Route = createFileRoute("/services")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M3 Serviços — VPRequisições" },
      { name: "description", content: "Requisição de serviços terceirizados" },
    ],
  }),
  component: ServicesPage,
});

function ServicesPage() {
  const { edit: editTicketNumber } = Route.useSearch();
  const router = useRouter();
  const { session, profile, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editReqId, setEditReqId] = useState<string | null>(null);
  const [editEdition, setEditEdition] = useState(1);

  // Step 0 — Serviço
  const [serviceName, setServiceName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [description, setDescription] = useState("");
  const [preNegotiatedPrice, setPreNegotiatedPrice] = useState("");

  // Step 1 — Escopo
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [executionLocation, setExecutionLocation] = useState("");
  const [measurementCriteria, setMeasurementCriteria] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>([{ description: "", percentage: 100 }]);

  // Step 2 — Prazo
  const [deadline, setDeadline] = useState<Date | undefined>();
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M3")
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
      if (typeof s.serviceName === 'string') setServiceName(s.serviceName);
      if (typeof s.serviceType === 'string') setServiceType(s.serviceType);
      if (typeof s.description === 'string') setDescription(s.description);
      if (typeof s.preNegotiatedPrice === 'string') setPreNegotiatedPrice(s.preNegotiatedPrice);
      if (typeof s.scopeOfWork === 'string') setScopeOfWork(s.scopeOfWork);
      if (typeof s.deliverables === 'string') setDeliverables(s.deliverables);
      if (typeof s.executionLocation === 'string') setExecutionLocation(s.executionLocation);
      if (typeof s.measurementCriteria === 'string') setMeasurementCriteria(s.measurementCriteria);
      if (Array.isArray(s.milestones)) setMilestones(s.milestones as Milestone[]);
      if (typeof s.deadline === 'string') setDeadline(new Date(s.deadline));
      if (typeof s.urgencyLevel === 'string') setUrgencyLevel(s.urgencyLevel);
      if (typeof s.justification === 'string') setJustification(s.justification);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadTickets(); }, [session]);

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
      const rawTitle = data.title as string ?? "";
      const parenIdx = rawTitle.lastIndexOf(" (");
      setServiceName(parenIdx > 0 ? rawTitle.slice(0, parenIdx) : rawTitle);
      setServiceType((md.service_type as string | undefined) ?? "");
      setDescription((data.description as string) ?? "");
      setPreNegotiatedPrice(String((md.pre_negotiated_price as number | undefined) ?? ""));
      setScopeOfWork((md.scope_of_work as string | undefined) ?? "");
      setDeliverables((md.deliverables as string | undefined) ?? "");
      setExecutionLocation((md.execution_location as string | undefined) ?? "");
      setMeasurementCriteria((md.measurement_criteria as string | undefined) ?? "");
      if (Array.isArray(md.milestones)) setMilestones(md.milestones as Milestone[]);
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      if (data.desired_date) setDeadline(new Date(data.desired_date as string));
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, serviceName, serviceType, description, preNegotiatedPrice,
        scopeOfWork, deliverables, executionLocation, measurementCriteria, milestones,
        deadline: deadline?.toISOString(),
        urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, serviceName, serviceType, description, preNegotiatedPrice,
      scopeOfWork, deliverables, executionLocation, measurementCriteria, milestones,
      deadline, urgencyLevel, justification]);

  const totalPercentage = milestones.reduce((sum, m) => sum + (Number(m.percentage) || 0), 0);

  const addMilestone = () => {
    setMilestones((prev) => [...prev, { description: "", percentage: 0 }]);
  };

  const removeMilestone = (idx: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMilestone = (idx: number, field: keyof Milestone, value: string | number) => {
    setMilestones((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setServiceName(""); setServiceType(""); setDescription(""); setPreNegotiatedPrice("");
    setScopeOfWork(""); setDeliverables(""); setExecutionLocation(""); setMeasurementCriteria("");
    setMilestones([{ description: "", percentage: 100 }]);
    setDeadline(undefined); setUrgencyLevel(""); setJustification("");
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (serviceName.length < 5) { toast.error("Nome do serviço deve ter pelo menos 5 caracteres."); return false; }
      if (!serviceType) { toast.error("Selecione o tipo de serviço."); return false; }
      if (description.length < 20) { toast.error("Descrição deve ter pelo menos 20 caracteres."); return false; }
    }
    if (step === 1) {
      if (scopeOfWork.length < 10) { toast.error("Escopo deve ter pelo menos 10 caracteres."); return false; }
      const hasEmptyMilestone = milestones.some((m) => !m.description.trim());
      if (hasEmptyMilestone) { toast.error("Preencha a descrição de todos os marcos."); return false; }
      if (milestones.length > 0 && totalPercentage !== 100) {
        toast.error(`A soma dos percentuais dos marcos deve ser 100% (atual: ${totalPercentage}%).`);
        return false;
      }
    }
    if (step === 2) {
      if (!deadline) { toast.error("Informe o prazo desejado."); return false; }
      if (!urgencyLevel) { toast.error("Selecione o nível de urgência."); return false; }
      if (justification.length < 10) { toast.error("Justificativa deve ter pelo menos 10 caracteres."); return false; }
    }
    return true;
  };

  const handleNext = () => { if (validateStep()) { toast.dismiss(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    const computedTitle = `${serviceName} (${SERVICE_TYPES.find((t) => t.value === serviceType)?.label ?? serviceType})`;
    const moduleData = {
      service_type: serviceType,
      scope_of_work: scopeOfWork,
      deliverables,
      execution_location: executionLocation,
      measurement_criteria: measurementCriteria,
      pre_negotiated_price: parseBRLNumber(preNegotiatedPrice),
      milestones: milestones.length > 0 ? milestones : null,
    };
    try {
      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: computedTitle,
          description,
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: deadline?.toISOString().slice(0, 10) ?? null,
          moduleData,
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
      const { error } = await supabaseBrowser
        .from("requisitions")
        .insert({
          module: "M3",
          title: computedTitle,
          description,
          justification,
          urgency: urgencyLevel,
          desired_date: deadline?.toISOString().slice(0, 10) ?? null,
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
        .eq("module", "M3")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      toast.success("Requisição de serviço criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `${serviceName} (${SERVICE_TYPES.find((t) => t.value === serviceType)?.label ?? serviceType})`,
        module: "M3",
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

  const minDate = addDays(new Date(), 3);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Wrench className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M3 — Serviços</h1>
            <p className="text-sm text-muted-foreground">Consultoria, manutenção e projetos</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Wrench className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de serviço ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>
              {editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Serviço"}
            </DialogTitle>
            <DialogDescription>
              {editMode ? "Altere os campos desejados e salve para registrar nova versão." : "Descreva o serviço necessário."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = i === step;
              const done = i < step;
              return (
                <button key={s.label} type="button" onClick={() => { if (i < step) setStep(i); }}
                  className={cn("flex flex-col items-center gap-1 text-[10px] font-medium transition-colors flex-1",
                    active ? "text-vp-yellow-dark" : done ? "text-green-600" : "text-muted-foreground")}>
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                    active ? "border-vp-yellow bg-amber-50" : done ? "border-green-500 bg-green-50" : "border-border")}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {s.label}
                </button>
              );
            })}
          </div>

          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome do Serviço *</label>
                <Input placeholder="Ex.: Consultoria ERP Financeiro" value={serviceName} onChange={(e) => setServiceName(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Serviço *</label>
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição Detalhada *</label>
                <Textarea placeholder="Descreva o serviço, contexto e necessidade..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
                <p className="text-[11px] text-muted-foreground">{description.length}/1000</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Valor Pré-Negociado (R$)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex.: 12000 (deixe em branco se não houver)"
                  value={preNegotiatedPrice}
                  onChange={(e) => setPreNegotiatedPrice(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">Preencha se já houver um valor acordado com o fornecedor.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Escopo do Trabalho *</label>
                <Textarea placeholder="O que precisa ser feito? Quais atividades estão incluídas?" value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} rows={3} maxLength={1000} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Entregáveis Esperados</label>
                <Textarea placeholder="Relatório, laudo técnico, execução concluída..." value={deliverables} onChange={(e) => setDeliverables(e.target.value)} rows={2} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Critério de Medição / Aceite</label>
                <Input placeholder="Ex.: Aprovação do laudo pela Engenharia" value={measurementCriteria} onChange={(e) => setMeasurementCriteria(e.target.value)} maxLength={300} />
                <p className="text-[11px] text-muted-foreground">Como será verificado que o serviço foi concluído com êxito?</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Local de Execução</label>
                <Input placeholder="Ex.: Planta SP — Linha 3, Usinagem" value={executionLocation} onChange={(e) => setExecutionLocation(e.target.value)} />
              </div>

              {/* Milestones */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Marcos de Pagamento</label>
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full",
                    totalPercentage === 100 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                    Total: {totalPercentage}%
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Divida o pagamento em marcos. A soma dos percentuais deve ser 100%.</p>
                <div className="space-y-2">
                  {milestones.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        placeholder={`Marco ${idx + 1} — Ex.: Entrega do relatório`}
                        value={m.description}
                        onChange={(e) => updateMilestone(idx, "description", e.target.value)}
                        maxLength={200}
                      />
                      <div className="flex items-center gap-1 w-28 shrink-0">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          className="w-16 text-center"
                          value={m.percentage}
                          onChange={(e) => updateMilestone(idx, "percentage", Number(e.target.value))}
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      {milestones.length > 1 && (
                        <button type="button" onClick={() => removeMilestone(idx)}
                          className="text-muted-foreground hover:text-red-600 transition-colors shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {milestones.length < 5 && (
                  <Button type="button" variant="outline" size="sm" onClick={addMilestone}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Marco
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Prazo Desejado *</label>
                <Popover open={deadlineOpen} onOpenChange={setDeadlineOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !deadline && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {deadline ? format(deadline, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={deadline} onSelect={(d) => { setDeadline(d); setDeadlineOpen(false); }}
                      disabled={(d) => d < minDate} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Urgência *</label>
                <div className="grid grid-cols-4 gap-2">
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
                <label className="text-sm font-medium">Justificativa *</label>
                <Textarea placeholder="Por que este serviço é necessário? Qual o impacto de não contratá-lo?" value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} maxLength={500} />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500</p>
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
                <Wrench className="h-4 w-4 mr-1" /> {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

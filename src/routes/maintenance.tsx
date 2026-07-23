import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  HardHat, Plus, ChevronRight, ChevronLeft, Cog, AlertTriangle, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

const MAINTENANCE_TYPES = [
  { value: "CORRETIVA", label: "Corretiva" },
  { value: "PREVENTIVA", label: "Preventiva" },
  { value: "PREDITIVA", label: "Preditiva" },
];

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Equipamento", icon: Cog },
  { label: "Problema", icon: AlertTriangle },
  { label: "Prioridade", icon: ClipboardList },
];

const DIALOG_KEY = 'vpreq_m4';

export const Route = createFileRoute("/maintenance")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M4 Manutenção — VPRequisições" },
      { name: "description", content: "Requisição de manutenção industrial" },
    ],
  }),
  component: MaintenancePage,
});

function MaintenancePage() {
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

  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentTag, setEquipmentTag] = useState("");
  const [sector, setSector] = useState("");

  const [maintenanceType, setMaintenanceType] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const [machineDown, setMachineDown] = useState(false);

  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M4")
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
      if (typeof s.equipmentName === 'string') setEquipmentName(s.equipmentName);
      if (typeof s.equipmentTag === 'string') setEquipmentTag(s.equipmentTag);
      if (typeof s.sector === 'string') setSector(s.sector);
      if (typeof s.maintenanceType === 'string') setMaintenanceType(s.maintenanceType);
      if (typeof s.problemDescription === 'string') setProblemDescription(s.problemDescription);
      if (typeof s.machineDown === 'boolean') setMachineDown(s.machineDown);
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
        .select("id,description,justification,urgency,module_data,edition")
        .eq("ticket_number", editTicketNumber)
        .maybeSingle();
      if (!data) { toast.error("Requisição não encontrada."); return; }
      const md = (data.module_data ?? {}) as Record<string, unknown>;
      setEditMode(true);
      setEditReqId(data.id as string);
      setEditEdition((data.edition as number | undefined) ?? 1);
      setEquipmentName((md.equipment_name as string | undefined) ?? "");
      setEquipmentTag((md.equipment_tag as string | undefined) ?? "");
      setSector((md.sector as string | undefined) ?? "");
      setMaintenanceType((md.maintenance_type as string | undefined) ?? "");
      setMachineDown((md.machine_down as boolean | undefined) ?? false);
      setProblemDescription((data.description as string) ?? "");
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, equipmentName, equipmentTag, sector,
        maintenanceType, problemDescription, machineDown, urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, equipmentName, equipmentTag, sector,
      maintenanceType, problemDescription, machineDown, urgencyLevel, justification]);

  // Quando máquina está parada, eleva urgência automaticamente
  const handleMachineDown = (checked: boolean) => {
    setMachineDown(checked);
    if (checked) setUrgencyLevel("URGENT");
  };

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setEquipmentName(""); setEquipmentTag(""); setSector("");
    setMaintenanceType(""); setProblemDescription(""); setMachineDown(false);
    setUrgencyLevel(""); setJustification("");
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (equipmentName.length < 3) { toast.error("Nome do equipamento deve ter pelo menos 3 caracteres."); return false; }
      if (!sector.trim()) { toast.error("Informe o setor."); return false; }
    }
    if (step === 1) {
      if (!maintenanceType) { toast.error("Selecione o tipo de manutenção."); return false; }
      if (problemDescription.length < 20) { toast.error("Descrição do problema deve ter pelo menos 20 caracteres."); return false; }
    }
    if (step === 2) {
      if (!urgencyLevel) { toast.error("Selecione o nível de urgência."); return false; }
      if (justification.length < 10) { toast.error("Justificativa deve ter pelo menos 10 caracteres."); return false; }
    }
    return true;
  };

  const handleNext = () => { if (validateStep()) { toast.dismiss(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    const computedTitle = `${equipmentName}${equipmentTag ? ` (${equipmentTag})` : ""} — ${maintenanceType}`;
    const moduleData = {
      equipment_name: equipmentName,
      equipment_tag: equipmentTag,
      sector,
      maintenance_type: maintenanceType,
      machine_down: machineDown,
    };
    try {
      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: computedTitle,
          description: problemDescription,
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: null,
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
          module: "M4",
          title: computedTitle,
          description: problemDescription,
          justification,
          urgency: urgencyLevel,
          desired_date: null,
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
        .eq("module", "M4")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      toast.success("Requisição de manutenção criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `${equipmentName} — ${maintenanceType}`,
        module: "M4",
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
            <HardHat className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M4 — Manutenção</h1>
            <p className="text-sm text-muted-foreground">Corretiva, preventiva e preditiva</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<HardHat className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de manutenção ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>
              {editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Manutenção"}
            </DialogTitle>
            <DialogDescription>
              {editMode ? "Altere os campos desejados e salve para registrar nova versão." : "Informe o equipamento e o problema."}
            </DialogDescription>
          </DialogHeader>

          <Stepper steps={STEPS} currentStep={step} onStepClick={setStep} />

          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome do Equipamento *</label>
                <Input placeholder="Ex.: Prensa Hidráulica 200t" value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)} maxLength={200} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">TAG / Patrimônio</label>
                  <Input placeholder="Ex.: PH-001" value={equipmentTag} onChange={(e) => setEquipmentTag(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Setor / Linha *</label>
                  <Input placeholder="Ex.: Linha 3 — Usinagem" value={sector} onChange={(e) => setSector(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Manutenção *</label>
                <Select value={maintenanceType} onValueChange={setMaintenanceType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição do Problema *</label>
                <Textarea placeholder="Descreva o defeito, sintoma ou necessidade..." value={problemDescription} onChange={(e) => setProblemDescription(e.target.value)} rows={4} maxLength={1000} />
                <p className="text-[11px] text-muted-foreground">{problemDescription.length}/1000</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border-2 border-red-200 bg-red-50 p-4">
                <div>
                  <label className="text-sm font-medium text-red-700">Máquina Parada?</label>
                  <p className="text-xs text-red-600">Marque se o equipamento está inoperante — urgência será elevada para URGENTE automaticamente</p>
                </div>
                <Switch checked={machineDown} onCheckedChange={handleMachineDown} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Urgência *</label>
                {machineDown && (
                  <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 mb-2">
                    <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Máquina parada — urgência elevada automaticamente para URGENTE
                    </p>
                  </div>
                )}
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
                <Textarea placeholder="Impacto na produção, riscos de segurança..." value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} maxLength={500} />
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
                <HardHat className="h-4 w-4 mr-1" /> {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

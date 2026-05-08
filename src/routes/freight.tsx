import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  Truck, Plus, ChevronRight, ChevronLeft, MapPin, Package, CalendarIcon, ClipboardList, ShieldCheck,
  ImageIcon, Upload,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

const VEHICLE_TYPES = [
  { value: "TRUCK", label: "Caminhão" },
  { value: "VAN", label: "Van/Furgão" },
  { value: "FLATBED", label: "Prancha" },
  { value: "CONTAINER", label: "Container" },
  { value: "OTHER", label: "Outro" },
];

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Rota", icon: MapPin },
  { label: "Carga", icon: Package },
  { label: "Prazo", icon: ClipboardList },
];

const INSURANCE_RATE = 0.005; // 0,5%

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const DIALOG_KEY = 'vpreq_m5';

export const Route = createFileRoute("/freight")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M5 Frete — VPRequisições" },
      { name: "description", content: "Requisição de frete e transporte" },
    ],
  }),
  component: FreightPage,
});

function FreightPage() {
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
  const [editCargoPhotoPath, setEditCargoPhotoPath] = useState<string | null>(null);

  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [vehicleType, setVehicleType] = useState("");

  const [cargoDescription, setCargoDescription] = useState("");
  const [unloadingLocation, setUnloadingLocation] = useState("");
  const [cargoPhotoFile, setCargoPhotoFile] = useState<File | null>(null);
  const [cargoPhotoPreview, setCargoPhotoPreview] = useState<string | null>(null);
  const [cargoPhotoDescription, setCargoPhotoDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [fragile, setFragile] = useState(false);
  const [declaredValue, setDeclaredValue] = useState("");

  const [pickupDate, setPickupDate] = useState<Date | undefined>();
  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  const insuranceCost = useMemo(() => {
    const val = parseFloat(declaredValue.replace(",", "."));
    return val > 0 ? val * INSURANCE_RATE : 0;
  }, [declaredValue]);

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M5")
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
      if (typeof s.originAddress === 'string') setOriginAddress(s.originAddress);
      if (typeof s.destinationAddress === 'string') setDestinationAddress(s.destinationAddress);
      if (typeof s.vehicleType === 'string') setVehicleType(s.vehicleType);
      if (typeof s.cargoDescription === 'string') setCargoDescription(s.cargoDescription);
      if (typeof s.unloadingLocation === 'string') setUnloadingLocation(s.unloadingLocation);
      if (typeof s.cargoPhotoDescription === 'string') setCargoPhotoDescription(s.cargoPhotoDescription);
      if (typeof s.weight === 'string') setWeight(s.weight);
      if (typeof s.dimensions === 'string') setDimensions(s.dimensions);
      if (typeof s.fragile === 'boolean') setFragile(s.fragile);
      if (typeof s.declaredValue === 'string') setDeclaredValue(s.declaredValue);
      if (typeof s.pickupDate === 'string') setPickupDate(new Date(s.pickupDate));
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
        .select("id,description,justification,urgency,desired_date,module_data,edition")
        .eq("ticket_number", editTicketNumber)
        .maybeSingle();
      if (!data) { toast.error("Requisição não encontrada."); return; }
      const md = (data.module_data ?? {}) as Record<string, unknown>;
      setEditMode(true);
      setEditReqId(data.id as string);
      setEditEdition((data.edition as number | undefined) ?? 1);
      setEditCargoPhotoPath((md.cargo_photo_path as string | null) ?? null);
      setOriginAddress((md.origin_address as string | undefined) ?? "");
      setDestinationAddress((md.destination_address as string | undefined) ?? "");
      setVehicleType((md.vehicle_type as string | undefined) ?? "");
      setCargoDescription((data.description as string) ?? "");
      setUnloadingLocation((md.unloading_location as string | undefined) ?? "");
      setCargoPhotoDescription((md.cargo_photo_description as string | undefined) ?? "");
      setWeight(String((md.weight_kg as number | undefined) ?? ""));
      setDimensions((md.dimensions as string | undefined) ?? "");
      setFragile((md.fragile as boolean | undefined) ?? false);
      setDeclaredValue(String((md.declared_value as number | undefined) ?? ""));
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      if (data.desired_date) setPickupDate(new Date(data.desired_date as string));
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, originAddress, destinationAddress, vehicleType,
        cargoDescription, unloadingLocation, cargoPhotoDescription, weight, dimensions, fragile, declaredValue,
        pickupDate: pickupDate?.toISOString(),
        urgencyLevel, justification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, originAddress, destinationAddress, vehicleType,
      cargoDescription, unloadingLocation, cargoPhotoDescription, weight, dimensions, fragile, declaredValue,
      pickupDate, urgencyLevel, justification]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setOriginAddress(""); setDestinationAddress(""); setVehicleType("");
    setCargoDescription(""); setUnloadingLocation("");
    if (cargoPhotoPreview) URL.revokeObjectURL(cargoPhotoPreview);
    setCargoPhotoFile(null); setCargoPhotoPreview(null); setCargoPhotoDescription("");
    setWeight(""); setDimensions(""); setFragile(false); setDeclaredValue("");
    setPickupDate(undefined); setUrgencyLevel(""); setJustification("");
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (!originAddress.trim()) { toast.error("Informe o endereço de origem."); return false; }
      if (!destinationAddress.trim()) { toast.error("Informe o endereço de destino."); return false; }
      if (!vehicleType) { toast.error("Selecione o tipo de veículo."); return false; }
    }
    if (step === 1) {
      if (cargoDescription.length < 10) { toast.error("Descrição da carga deve ter pelo menos 10 caracteres."); return false; }
    }
    if (step === 2) {
      if (!pickupDate) { toast.error("Informe a data de coleta."); return false; }
      if (!urgencyLevel) { toast.error("Selecione o nível de urgência."); return false; }
      if (justification.length < 10) { toast.error("Justificativa deve ter pelo menos 10 caracteres."); return false; }
    }
    return true;
  };

  const handleNext = () => { if (validateStep()) { toast.dismiss(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    try {
      let cargoPhotoPath: string | null = editCargoPhotoPath;
      if (cargoPhotoFile) {
        const ext = cargoPhotoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `m5/${user?.id ?? "anon"}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
          .from("travel-docs")
          .upload(path, cargoPhotoFile, { upsert: true });
        if (uploadError) console.warn("[photo upload]", uploadError.message);
        else cargoPhotoPath = uploadData.path;
      }

      const moduleData = {
        origin_address: originAddress,
        destination_address: destinationAddress,
        vehicle_type: vehicleType,
        unloading_location: unloadingLocation || null,
        cargo_photo_path: cargoPhotoPath,
        cargo_photo_description: cargoPhotoDescription || null,
        weight_kg: weight ? parseFloat(weight) : null,
        dimensions,
        fragile,
        declared_value: declaredValue ? parseFloat(declaredValue.replace(",", ".")) : null,
        insurance_cost: insuranceCost || null,
      };

      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: `Frete ${originAddress} → ${destinationAddress}`,
          description: cargoDescription,
          justification,
          urgency: urgencyLevel as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: pickupDate?.toISOString().slice(0, 10) ?? null,
          moduleData,
          editorName: profile?.full_name || user?.email || "Usuário VP",
        });
        const ordinals = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª", "8ª", "9ª", "10ª"];
        const ordinal = ordinals[(result.edition ?? 2) - 1] ?? `${result.edition}ª`;
        toast.success(`Requisição editada — ${ordinal} Edição`, { description: editTicketNumber ?? "" });
        setDialogOpen(false);
        resetForm();
        setEditMode(false); setEditReqId(null); setEditEdition(1); setEditCargoPhotoPath(null);
        void router.navigate({ to: "/logs" });
        return;
      }

      const { error } = await supabaseBrowser
        .from("requisitions")
        .insert({
          module: "M5",
          title: `Frete ${originAddress} → ${destinationAddress}`,
          description: cargoDescription,
          justification,
          urgency: urgencyLevel,
          desired_date: pickupDate?.toISOString().slice(0, 10) ?? null,
          requester_name: profile?.full_name || user?.email || "Usuário VP",
          requester_email: profile?.email || user?.email || "",
          requester_department: profile?.department || "Não informado",
          requester_profile_id: user?.id ?? null,
          module_data: moduleData,
        });

      if (error) throw error;

      // SELECT separado para não acionar policy de SELECT durante INSERT
      const { data: created } = await supabaseBrowser
        .from("requisitions")
        .select("id,ticket_number")
        .eq("module", "M5")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      toast.success("Requisição de frete criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `Frete ${originAddress} → ${destinationAddress}`,
        module: "M5",
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
            <Truck className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M5 — Frete</h1>
            <p className="text-sm text-muted-foreground">Transporte e logística</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Truck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de frete ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Frete"}</DialogTitle>
            <DialogDescription>Informe os dados do transporte.</DialogDescription>
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
                <label className="text-sm font-medium">Endereço de Origem *</label>
                <Input
                  placeholder="Ex.: São Paulo, SP — Rua das Indústrias, 100"
                  value={originAddress}
                  onChange={(e) => setOriginAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Endereço de Destino *</label>
                <Input
                  placeholder="Ex.: Curitiba, PR — Av. Cândido de Abreu, 200"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Veículo *</label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição da Carga *</label>
                <Textarea placeholder="O que será transportado? Quantidade, tipo..." value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} rows={3} maxLength={500} />
                <p className="text-[11px] text-muted-foreground">{cargoDescription.length}/500</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Peso Estimado (kg)</label>
                  <Input type="number" min="0" placeholder="Ex.: 500" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Dimensões (CxLxA)</label>
                  <Input placeholder="Ex.: 2m x 1m x 0.5m" value={dimensions} onChange={(e) => setDimensions(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                  Valor Declarado da Carga (R$)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex.: 50000"
                  value={declaredValue}
                  onChange={(e) => setDeclaredValue(e.target.value)}
                />
                {insuranceCost > 0 && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                    Seguro estimado (0,5%): <strong>{formatBRL(insuranceCost)}</strong>
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium">Carga Frágil?</label>
                  <p className="text-xs text-muted-foreground">Requer cuidados especiais no transporte</p>
                </div>
                <Switch checked={fragile} onCheckedChange={setFragile} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Local de Descarregamento</label>
                <Input
                  placeholder="Ex.: Portão traseiro, rua sem saída, acesso por rampa..."
                  value={unloadingLocation}
                  onChange={(e) => setUnloadingLocation(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Descreva as condições de acesso para que o cotador avalie o tipo de veículo adequado.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" /> Foto do Local de Descarga
                  <span className="text-muted-foreground font-normal text-[11px]">(opcional)</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id="cargo-photo"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (cargoPhotoPreview) URL.revokeObjectURL(cargoPhotoPreview);
                    setCargoPhotoFile(file);
                    setCargoPhotoPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                <label
                  htmlFor="cargo-photo"
                  className={cn(
                    "flex items-center gap-3 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors",
                    cargoPhotoFile ? "border-green-400 bg-green-50" : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  {cargoPhotoPreview ? (
                    <>
                      <img src={cargoPhotoPreview} alt="Local" className="h-14 w-14 rounded object-cover border" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-green-700 truncate">{cargoPhotoFile?.name}</p>
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
                          <Upload className="h-3.5 w-3.5" /> Enviar foto do local
                        </p>
                        <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP — máx. 5 MB</p>
                      </div>
                    </>
                  )}
                </label>
                {cargoPhotoFile && (
                  <Input
                    placeholder="Descreva o que a foto mostra (acesso, rampa, portão...)"
                    value={cargoPhotoDescription}
                    onChange={(e) => setCargoPhotoDescription(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data de Coleta *</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !pickupDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {pickupDate ? format(pickupDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={pickupDate} onSelect={setPickupDate}
                      disabled={(d) => d < addDays(new Date(), 1)} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
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
                <Textarea placeholder="Motivo do frete, urgência..." value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} maxLength={500} />
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
                <Truck className="h-4 w-4 mr-1" /> {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

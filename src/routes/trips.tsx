import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  Plane, Plus, ChevronRight, ChevronLeft, MapPin, Hotel,
  CalendarIcon, Target, AlertTriangle,
} from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
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

const TRANSPORT_MODES = [
  { value: "AVIAO", label: "Avião" },
  { value: "CARRO_EMPRESA", label: "Carro da Empresa" },
  { value: "CARRO_PROPRIO", label: "Carro Próprio" },
  { value: "ONIBUS", label: "Ônibus" },
];

const PURPOSES = [
  { value: "OBRA", label: "Obra" },
  { value: "CURSO", label: "Curso" },
  { value: "VISITA_CLIENTE", label: "Visita a Cliente" },
  { value: "WORKSHOP", label: "Workshop" },
  { value: "EVENTO_FEIRA", label: "Evento/Feira" },
];

const STEPS = [
  { label: "Roteiro", icon: MapPin },
  { label: "Hospedagem", icon: Hotel },
  { label: "Objetivo", icon: Target },
];

export const Route = createFileRoute("/trips")({
  head: () => ({
    meta: [
      { title: "M2 Viagens — VPRequisições" },
      { name: "description", content: "Requisição de viagens corporativas" },
    ],
  }),
  component: TripsPage,
});

const DIALOG_KEY = 'vpreq_m2';

function TripsPage() {
  const { session, profile, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [travelerName, setTravelerName] = useState("");
  const [originCity, setOriginCity] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [departureDate, setDepartureDate] = useState<Date | undefined>();
  const [returnDate, setReturnDate] = useState<Date | undefined>();
  const [transportMode, setTransportMode] = useState("");

  const [needsHotel, setNeedsHotel] = useState(false);
  const [hotelNights, setHotelNights] = useState("");
  const [needsLocalCar, setNeedsLocalCar] = useState(false);

  const [purposes, setPurposes] = useState<string[]>([]);
  const [justification, setJustification] = useState("");
  const [shortNoticeJustification, setShortNoticeJustification] = useState("");

  const durationDays = useMemo(() => {
    if (departureDate && returnDate) return differenceInCalendarDays(returnDate, departureDate);
    return 0;
  }, [departureDate, returnDate]);

  const isAdvancedNotice = useMemo(() => {
    if (!departureDate) return true;
    return differenceInCalendarDays(departureDate, new Date()) >= 5;
  }, [departureDate]);

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M2")
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
      if (typeof s.travelerName === 'string') setTravelerName(s.travelerName);
      if (typeof s.originCity === 'string') setOriginCity(s.originCity);
      if (typeof s.destinationCity === 'string') setDestinationCity(s.destinationCity);
      if (typeof s.departureDate === 'string') setDepartureDate(new Date(s.departureDate));
      if (typeof s.returnDate === 'string') setReturnDate(new Date(s.returnDate));
      if (typeof s.transportMode === 'string') setTransportMode(s.transportMode);
      if (typeof s.needsHotel === 'boolean') setNeedsHotel(s.needsHotel);
      if (typeof s.hotelNights === 'string') setHotelNights(s.hotelNights);
      if (typeof s.needsLocalCar === 'boolean') setNeedsLocalCar(s.needsLocalCar);
      if (Array.isArray(s.purposes)) setPurposes(s.purposes as string[]);
      if (typeof s.justification === 'string') setJustification(s.justification);
      if (typeof s.shortNoticeJustification === 'string') setShortNoticeJustification(s.shortNoticeJustification);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadTickets(); }, [session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(DIALOG_KEY, JSON.stringify({
        open: true, step, travelerName, originCity, destinationCity,
        departureDate: departureDate?.toISOString(),
        returnDate: returnDate?.toISOString(),
        transportMode, needsHotel, hotelNights, needsLocalCar,
        purposes, justification, shortNoticeJustification,
      }));
    } catch { /* ignore */ }
  }, [dialogOpen, step, travelerName, originCity, destinationCity, departureDate,
      returnDate, transportMode, needsHotel, hotelNights, needsLocalCar,
      purposes, justification, shortNoticeJustification]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setTravelerName(""); setOriginCity(""); setDestinationCity("");
    setDepartureDate(undefined); setReturnDate(undefined); setTransportMode("");
    setNeedsHotel(false); setHotelNights(""); setNeedsLocalCar(false);
    setPurposes([]); setJustification(""); setShortNoticeJustification("");
  };

  const togglePurpose = (val: string) => {
    setPurposes((prev) =>
      prev.includes(val) ? prev.filter((p) => p !== val) : [...prev, val]
    );
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (!travelerName.trim()) { toast.error("Informe o nome do viajante."); return false; }
      if (!originCity.trim()) { toast.error("Informe a cidade de origem."); return false; }
      if (!destinationCity.trim()) { toast.error("Informe a cidade de destino."); return false; }
      if (!departureDate) { toast.error("Informe a data de partida."); return false; }
      if (!returnDate) { toast.error("Informe a data de retorno."); return false; }
      // Permite retorno no mesmo dia (viagem de ida e volta no dia)
      if (returnDate < departureDate) { toast.error("Data de retorno não pode ser anterior à partida."); return false; }
      if (!transportMode) { toast.error("Selecione o meio de transporte."); return false; }
    }
    if (step === 1) {
      if (needsHotel && (!hotelNights || parseInt(hotelNights) <= 0)) {
        toast.error("Informe o número de noites de hotel."); return false;
      }
    }
    if (step === 2) {
      if (purposes.length === 0) { toast.error("Selecione pelo menos um objetivo."); return false; }
      if (justification.length < 20) { toast.error("Justificativa deve ter pelo menos 20 caracteres."); return false; }
      if (!isAdvancedNotice && shortNoticeJustification.length < 50) {
        toast.error("Justificativa de urgência deve ter pelo menos 50 caracteres."); return false;
      }
    }
    return true;
  };

  const handleNext = () => { if (validateStep()) { toast.dismiss(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    try {
      const urgency = !isAdvancedNotice ? "URGENT" : durationDays > 7 ? "HIGH" : "MEDIUM";
      const { error } = await supabaseBrowser
        .from("requisitions")
        .insert({
          module: "M2",
          title: `Viagem ${originCity} → ${destinationCity}`,
          description: justification,
          justification,
          urgency,
          desired_date: departureDate?.toISOString().slice(0, 10) ?? null,
          requester_name: profile?.full_name || user?.email || "Usuário VP",
          requester_email: profile?.email || user?.email || "",
          requester_department: profile?.department || "Não informado",
          requester_profile_id: user?.id ?? null,
          module_data: {
            traveler_name: travelerName,
            origin_city: originCity,
            destination_city: destinationCity,
            departure_date: departureDate?.toISOString().slice(0, 10),
            return_date: returnDate?.toISOString().slice(0, 10),
            duration_days: durationDays,
            transport_mode: transportMode,
            needs_hotel: needsHotel,
            hotel_nights: hotelNights ? parseInt(hotelNights) : null,
            needs_local_car: needsLocalCar,
            purposes,
            short_notice_justification: shortNoticeJustification || null,
          },
        });

      if (error) throw error;

      // SELECT separado para não acionar policy de SELECT durante INSERT
      const { data: created } = await supabaseBrowser
        .from("requisitions")
        .select("id,ticket_number")
        .eq("module", "M2")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Insere itens de viagem para cotação individual por item
      if (created?.id) {
        const itemsPayload = [
          { requisition_id: created.id, item_type: 'voo', sort_order: 0 },
          ...(needsHotel ? [{ requisition_id: created.id, item_type: 'hotel', sort_order: 1 }] : []),
          ...(needsLocalCar ? [{ requisition_id: created.id, item_type: 'carro', sort_order: 2 }] : []),
        ];
        const { error: itemsError } = await supabaseBrowser.from('requisition_items').insert(itemsPayload);
        if (itemsError) console.warn('[requisition_items]', itemsError.message);
      }

      toast.success("Requisição de viagem criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `Viagem ${originCity} → ${destinationCity}`,
        module: "M2",
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
            <Plane className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M2 — Viagens</h1>
            <p className="text-sm text-muted-foreground">Passagens, hotel e despesas</p>
          </div>
        </div>
        <Button variant="vp" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Plane className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de viagem ainda."
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Nova Requisição de Viagem</DialogTitle>
            <DialogDescription>Preencha os dados da viagem corporativa.</DialogDescription>
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
                <label className="text-sm font-medium">Nome do Viajante *</label>
                <Input placeholder="Nome completo" value={travelerName} onChange={(e) => setTravelerName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cidade de Origem *</label>
                  <Input placeholder="Ex.: São Paulo, SP" value={originCity} onChange={(e) => setOriginCity(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cidade de Destino *</label>
                  <Input placeholder="Ex.: Curitiba, PR" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Partida *</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !departureDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {departureDate ? format(departureDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={departureDate} onSelect={(d) => {
                        setDepartureDate(d);
                        // Se retorno já escolhido e ficou antes da nova partida, limpa
                        if (returnDate && d && returnDate < d) setReturnDate(undefined);
                      }}
                        disabled={(d) => d < new Date()} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Retorno *</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !returnDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {returnDate ? format(returnDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      {/* Permite mesmo dia de retorno (ida e volta) */}
                      <Calendar mode="single" selected={returnDate} onSelect={setReturnDate}
                        disabled={(d) => d < (departureDate ?? new Date())} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {departureDate && returnDate && (
                <p className="text-sm text-muted-foreground">
                  Duração: <span className="font-semibold text-foreground">{durationDays === 0 ? "ida e volta no mesmo dia" : `${durationDays} dia(s)`}</span>
                  {!isAdvancedNotice && (
                    <span className="ml-2 text-orange-600 font-medium">⚠ menos de 5 dias de antecedência</span>
                  )}
                </p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Meio de Transporte *</label>
                <Select value={transportMode} onValueChange={setTransportMode}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_MODES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium">Precisa de Hotel?</label>
                  <p className="text-xs text-muted-foreground">Marque se necessita hospedagem</p>
                </div>
                <Switch checked={needsHotel} onCheckedChange={setNeedsHotel} />
              </div>
              {needsHotel && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Noites de Hotel *</label>
                  <Input type="number" min="1" placeholder="0" value={hotelNights} onChange={(e) => setHotelNights(e.target.value)} />
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium">Carro Alocado no Destino?</label>
                  <p className="text-xs text-muted-foreground">Necessita locação de veículo</p>
                </div>
                <Switch checked={needsLocalCar} onCheckedChange={setNeedsLocalCar} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Objetivo da Viagem * (selecione um ou mais)</label>
                <div className="grid grid-cols-2 gap-2">
                  {PURPOSES.map((p) => (
                    <button key={p.value} type="button" onClick={() => togglePurpose(p.value)}
                      className={cn("rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        purposes.includes(p.value) ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark" : "border-border hover:border-muted-foreground/40")}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Justificativa *</label>
                <Textarea placeholder="Descreva o motivo da viagem..." value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} maxLength={500} />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500</p>
              </div>
              {!isAdvancedNotice && (
                <div className="space-y-1.5 rounded-lg border-2 border-orange-300 bg-orange-50 p-3">
                  <label className="text-sm font-medium flex items-center gap-1 text-orange-700">
                    <AlertTriangle className="h-4 w-4" /> Justificativa de Urgência *
                  </label>
                  <p className="text-xs text-orange-600">Viagem com menos de 5 dias de antecedência requer justificativa detalhada (mín. 50 caracteres).</p>
                  <Textarea placeholder="Explique a urgência..." value={shortNoticeJustification}
                    onChange={(e) => setShortNoticeJustification(e.target.value)} rows={3} maxLength={500} />
                  <p className="text-[11px] text-muted-foreground">{shortNoticeJustification.length}/500</p>
                </div>
              )}
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
                <Plane className="h-4 w-4 mr-1" /> {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

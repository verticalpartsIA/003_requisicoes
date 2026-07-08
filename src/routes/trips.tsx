import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  Plane, Plus, ChevronRight, ChevronLeft, MapPin, Hotel,
  CalendarIcon, Target, AlertTriangle, Users, UserPlus, Trash2, Upload, ImageIcon,
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
import { updateRequisitionClient } from "@/features/requisitions/client";
import { useRouter } from "@tanstack/react-router";

interface Traveler {
  id: string;
  fullName: string;
  docType: "CPF" | "RG" | "CNH";
  docNumber: string;
  docPhotoFile: File | null;
  docPhotoPreview: string | null;
}

function makeTraveler(): Traveler {
  return {
    id: crypto.randomUUID(),
    fullName: "",
    docType: "CPF",
    docNumber: "",
    docPhotoFile: null,
    docPhotoPreview: null,
  };
}

function isFullName(name: string): boolean {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

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
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  head: () => ({
    meta: [
      { title: "M2 Viagens — VPRequisições" },
      { name: "description", content: "Requisição de viagens corporativas" },
    ],
  }),
  component: TripsPage,
});

const DIALOG_KEY = "vpreq_m2";

function TripsPage() {
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
  const [travelerExistingPaths, setTravelerExistingPaths] = useState<Record<string, string | null>>({});

  const [travelers, setTravelers] = useState<Traveler[]>([makeTraveler()]);
  const [originCity, setOriginCity] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [departureDate, setDepartureDate] = useState<Date | undefined>();
  const [departureDateOpen, setDepartureDateOpen] = useState(false);
  const [returnDate, setReturnDate] = useState<Date | undefined>();
  const [returnDateOpen, setReturnDateOpen] = useState(false);
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

  const updateTraveler = (id: string, field: keyof Omit<Traveler, "id">, value: unknown) => {
    setTravelers((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const handlePhotoChange = (id: string, file: File | null) => {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.docPhotoPreview) URL.revokeObjectURL(t.docPhotoPreview);
        return { ...t, docPhotoFile: file, docPhotoPreview: file ? URL.createObjectURL(file) : null };
      }),
    );
  };

  const addTraveler = () => setTravelers((prev) => [...prev, makeTraveler()]);

  const removeTraveler = (id: string) => {
    setTravelers((prev) => {
      const target = prev.find((t) => t.id === id);
      if (target?.docPhotoPreview) URL.revokeObjectURL(target.docPhotoPreview);
      return prev.filter((t) => t.id !== id);
    });
  };

  const loadTickets = async () => {
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("requisitions")
      .select("ticket_number,title,requester_name,urgency,status,created_at")
      .eq("module", "M2")
      .order("created_at", { ascending: false })
      .limit(20);
    setTickets(
      (data ?? []).map((item) => ({
        id: item.ticket_number,
        title: item.title,
        requester: item.requester_name,
        urgency: item.urgency as TicketRow["urgency"],
        status: item.status as TicketRow["status"],
        date: new Date(item.created_at).toLocaleDateString("pt-BR"),
      })),
    );
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DIALOG_KEY);
      if (!saved) return;
      const s = JSON.parse(saved) as Record<string, unknown>;
      if (!s.open) return;
      setDialogOpen(true);
      if (typeof s.step === "number") setStep(s.step);
      if (Array.isArray(s.travelers) && s.travelers.length > 0) {
        setTravelers(
          (s.travelers as Omit<Traveler, "docPhotoFile" | "docPhotoPreview">[]).map((t) => ({
            ...t,
            docPhotoFile: null,
            docPhotoPreview: null,
          })),
        );
      } else if (typeof s.travelerName === "string" && s.travelerName) {
        setTravelers([{ ...makeTraveler(), fullName: s.travelerName as string }]);
      }
      if (typeof s.originCity === "string") setOriginCity(s.originCity);
      if (typeof s.destinationCity === "string") setDestinationCity(s.destinationCity);
      if (typeof s.departureDate === "string") setDepartureDate(new Date(s.departureDate));
      if (typeof s.returnDate === "string") setReturnDate(new Date(s.returnDate));
      if (typeof s.transportMode === "string") setTransportMode(s.transportMode);
      if (typeof s.needsHotel === "boolean") setNeedsHotel(s.needsHotel);
      if (typeof s.hotelNights === "string") setHotelNights(s.hotelNights);
      if (typeof s.needsLocalCar === "boolean") setNeedsLocalCar(s.needsLocalCar);
      if (Array.isArray(s.purposes)) setPurposes(s.purposes as string[]);
      if (typeof s.justification === "string") setJustification(s.justification);
      if (typeof s.shortNoticeJustification === "string")
        setShortNoticeJustification(s.shortNoticeJustification);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadTickets();
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
      setOriginCity((md.origin_city as string | undefined) ?? "");
      setDestinationCity((md.destination_city as string | undefined) ?? "");
      if (md.departure_date) setDepartureDate(new Date(md.departure_date as string));
      if (md.return_date) setReturnDate(new Date(md.return_date as string));
      setTransportMode((md.transport_mode as string | undefined) ?? "");
      setNeedsHotel((md.needs_hotel as boolean | undefined) ?? false);
      setHotelNights(String((md.hotel_nights as number | undefined) ?? ""));
      setNeedsLocalCar((md.needs_local_car as boolean | undefined) ?? false);
      setPurposes((md.purposes as string[] | undefined) ?? []);
      setJustification((data.justification as string) ?? "");
      setShortNoticeJustification((md.short_notice_justification as string | undefined) ?? "");
      const travelersData = (md.travelers as Array<{ id?: string; full_name: string; doc_type: string; doc_number: string; doc_photo_path?: string | null }> | undefined) ?? [];
      const pathMap: Record<string, string | null> = {};
      const restoredTravelers = travelersData.map((t) => {
        const tid = t.id ?? crypto.randomUUID();
        pathMap[tid] = t.doc_photo_path ?? null;
        return { id: tid, fullName: t.full_name ?? "", docType: (t.doc_type ?? "CPF") as "CPF" | "RG" | "CNH", docNumber: t.doc_number ?? "", docPhotoFile: null, docPhotoPreview: null };
      });
      if (restoredTravelers.length > 0) setTravelers(restoredTravelers);
      setTravelerExistingPaths(pathMap);
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      const travelersData = travelers.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ docPhotoFile, docPhotoPreview, ...rest }) => rest,
      );
      sessionStorage.setItem(
        DIALOG_KEY,
        JSON.stringify({
          open: true,
          step,
          travelers: travelersData,
          originCity,
          destinationCity,
          departureDate: departureDate?.toISOString(),
          returnDate: returnDate?.toISOString(),
          transportMode,
          needsHotel,
          hotelNights,
          needsLocalCar,
          purposes,
          justification,
          shortNoticeJustification,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    dialogOpen, step, travelers, originCity, destinationCity, departureDate,
    returnDate, transportMode, needsHotel, hotelNights, needsLocalCar,
    purposes, justification, shortNoticeJustification,
  ]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    travelers.forEach((t) => {
      if (t.docPhotoPreview) URL.revokeObjectURL(t.docPhotoPreview);
    });
    setTravelers([makeTraveler()]);
    setOriginCity("");
    setDestinationCity("");
    setDepartureDate(undefined);
    setReturnDate(undefined);
    setTransportMode("");
    setNeedsHotel(false);
    setHotelNights("");
    setNeedsLocalCar(false);
    setPurposes([]);
    setJustification("");
    setShortNoticeJustification("");
  };

  const togglePurpose = (val: string) => {
    setPurposes((prev) =>
      prev.includes(val) ? prev.filter((p) => p !== val) : [...prev, val],
    );
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      for (let i = 0; i < travelers.length; i++) {
        const t = travelers[i];
        const label = travelers.length > 1 ? `Viajante ${i + 1}` : "Viajante";
        if (!isFullName(t.fullName)) {
          toast.error(`${label}: informe nome completo (nome e sobrenome).`);
          return false;
        }
        if (!t.docNumber.trim()) {
          toast.error(`${label}: informe o número do ${t.docType}.`);
          return false;
        }
        if (!t.docPhotoFile && !travelerExistingPaths[t.id]) {
          toast.error(`${label}: foto do documento é obrigatória.`);
          return false;
        }
      }
      if (!originCity.trim()) {
        toast.error("Informe a cidade de origem.");
        return false;
      }
      if (!destinationCity.trim()) {
        toast.error("Informe a cidade de destino.");
        return false;
      }
      if (!departureDate) {
        toast.error("Informe a data de partida.");
        return false;
      }
      if (!returnDate) {
        toast.error("Informe a data de retorno.");
        return false;
      }
      if (returnDate < departureDate) {
        toast.error("Data de retorno não pode ser anterior à partida.");
        return false;
      }
      if (!transportMode) {
        toast.error("Selecione o meio de transporte.");
        return false;
      }
    }
    if (step === 1) {
      if (needsHotel && (!hotelNights || parseInt(hotelNights) <= 0)) {
        toast.error("Informe o número de noites de hotel.");
        return false;
      }
    }
    if (step === 2) {
      if (purposes.length === 0) {
        toast.error("Selecione pelo menos um objetivo.");
        return false;
      }
      if (justification.length < 20) {
        toast.error("Justificativa deve ter pelo menos 20 caracteres.");
        return false;
      }
      if (!isAdvancedNotice && shortNoticeJustification.length < 50) {
        toast.error("Justificativa de urgência deve ter pelo menos 50 caracteres.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) {
      toast.dismiss();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    try {
      const travelersWithPaths = await Promise.all(
        travelers.map(async (t, i) => {
          let photoPath: string | null = travelerExistingPaths[t.id] ?? null;
          if (t.docPhotoFile) {
            const ext = t.docPhotoFile.name.split(".").pop()?.toLowerCase() || "jpg";
            const path = `${user?.id ?? "anon"}/${Date.now()}_${i}.${ext}`;
            const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
              .from("travel-docs")
              .upload(path, t.docPhotoFile, { upsert: true });
            if (uploadError) throw new Error(`Foto do viajante ${i + 1}: ${uploadError.message}`);
            photoPath = uploadData.path;
          }
          return {
            id: t.id,
            full_name: t.fullName.trim(),
            doc_type: t.docType,
            doc_number: t.docNumber.trim(),
            doc_photo_path: photoPath,
          };
        }),
      );

      const urgency = !isAdvancedNotice ? "URGENT" : durationDays > 7 ? "HIGH" : "MEDIUM";
      const moduleData = {
        traveler_name: travelersWithPaths[0]?.full_name ?? "",
        travelers: travelersWithPaths,
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
      };

      if (editMode && editReqId) {
        const result = await updateRequisitionClient({
          requisitionId: editReqId,
          title: `Viagem ${originCity} → ${destinationCity}`,
          description: justification,
          justification,
          urgency: urgency as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
          desiredDate: departureDate?.toISOString().slice(0, 10) ?? null,
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

      const { error } = await supabaseBrowser.from("requisitions").insert({
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
        module_data: moduleData,
        status: "GESTOR",
      });

      if (error) throw error;

      const { data: created } = await supabaseBrowser
        .from("requisitions")
        .select("id,ticket_number")
        .eq("module", "M2")
        .eq("requester_profile_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (created?.id) {
        const itemsPayload = [
          { requisition_id: created.id, item_type: "voo", sort_order: 0 },
          ...(needsHotel ? [{ requisition_id: created.id, item_type: "hotel", sort_order: 1 }] : []),
          ...(needsLocalCar ? [{ requisition_id: created.id, item_type: "carro", sort_order: 2 }] : []),
        ];
        const { error: itemsError } = await supabaseBrowser
          .from("requisition_items")
          .insert(itemsPayload);
        if (itemsError) console.warn("[requisition_items]", itemsError.message);
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
            <DialogTitle>
              {editMode ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição` : "Nova Requisição de Viagem"}
            </DialogTitle>
            <DialogDescription>
              {editMode ? "Altere os campos desejados e salve para registrar nova versão." : "Preencha os dados da viagem corporativa."}
            </DialogDescription>
          </DialogHeader>

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

          {step === 0 && (
            <div className="space-y-4">
              {/* Travelers */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Viajantes</span>
                  </div>
                  <Button variant="outline" size="sm" type="button" onClick={addTraveler} className="h-7 text-xs gap-1">
                    <UserPlus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>

                {travelers.map((t, i) => (
                  <div key={t.id} className="rounded-lg border p-3 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {travelers.length > 1 ? `Viajante ${i + 1}` : "Viajante"}
                      </span>
                      {travelers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTraveler(t.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Nome Completo *</label>
                      <Input
                        placeholder="Nome e sobrenome"
                        value={t.fullName}
                        onChange={(e) => updateTraveler(t.id, "fullName", e.target.value)}
                        className={cn(
                          t.fullName.trim() && !isFullName(t.fullName) ? "border-orange-400" : "",
                        )}
                      />
                      {t.fullName.trim() && !isFullName(t.fullName) && (
                        <p className="text-[11px] text-orange-600">Informe nome e sobrenome.</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Tipo de Documento *</label>
                        <div className="flex gap-1">
                          {(["CPF", "RG", "CNH"] as const).map((dtype) => (
                            <button
                              key={dtype}
                              type="button"
                              onClick={() => updateTraveler(t.id, "docType", dtype)}
                              className={cn(
                                "flex-1 rounded border py-1.5 text-xs font-medium transition-colors",
                                t.docType === dtype
                                  ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
                                  : "border-border hover:border-muted-foreground/50",
                              )}
                            >
                              {dtype}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Número do {t.docType} *</label>
                        <Input
                          placeholder={
                            t.docType === "CPF"
                              ? "000.000.000-00"
                              : t.docType === "RG"
                              ? "00.000.000-0"
                              : "00000000000"
                          }
                          value={t.docNumber}
                          onChange={(e) => updateTraveler(t.id, "docNumber", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium flex items-center gap-1">
                        Foto do Documento *
                        <span className="text-orange-600 font-normal text-[11px]">(obrigatório)</span>
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        id={`doc-photo-${t.id}`}
                        onChange={(e) => handlePhotoChange(t.id, e.target.files?.[0] ?? null)}
                      />
                      <label
                        htmlFor={`doc-photo-${t.id}`}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors",
                          t.docPhotoFile
                            ? "border-green-400 bg-green-50"
                            : "border-border hover:border-muted-foreground/50",
                        )}
                      >
                        {t.docPhotoPreview ? (
                          <>
                            <img
                              src={t.docPhotoPreview}
                              alt="Documento"
                              className="h-14 w-14 rounded object-cover border"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-green-700 truncate">
                                {t.docPhotoFile?.name}
                              </p>
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
                                <Upload className="h-3.5 w-3.5" /> Enviar foto do documento
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                JPG, PNG, WebP — máx. 5 MB
                              </p>
                            </div>
                          </>
                        )}
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t" />

              {/* Route */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cidade de Origem *</label>
                  <Input
                    placeholder="Ex.: São Paulo, SP"
                    value={originCity}
                    onChange={(e) => setOriginCity(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cidade de Destino *</label>
                  <Input
                    placeholder="Ex.: Curitiba, PR"
                    value={destinationCity}
                    onChange={(e) => setDestinationCity(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Partida *</label>
                  <Popover open={departureDateOpen} onOpenChange={setDepartureDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !departureDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {departureDate ? format(departureDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={departureDate}
                        onSelect={(d) => {
                          setDepartureDate(d);
                          if (returnDate && d && returnDate < d) setReturnDate(undefined);
                          setDepartureDateOpen(false);
                        }}
                        disabled={(d) => d < new Date()}
                        initialFocus
                        className="p-3 pointer-events-auto"
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data de Retorno *</label>
                  <Popover open={returnDateOpen} onOpenChange={setReturnDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !returnDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {returnDate ? format(returnDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={returnDate}
                        onSelect={(d) => { setReturnDate(d); setReturnDateOpen(false); }}
                        disabled={(d) => d < (departureDate ?? new Date())}
                        initialFocus
                        className="p-3 pointer-events-auto"
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {departureDate && returnDate && (
                <p className="text-sm text-muted-foreground">
                  Duração:{" "}
                  <span className="font-semibold text-foreground">
                    {durationDays === 0 ? "ida e volta no mesmo dia" : `${durationDays} dia(s)`}
                  </span>
                  {!isAdvancedNotice && (
                    <span className="ml-2 text-orange-600 font-medium">
                      ⚠ menos de 5 dias de antecedência
                    </span>
                  )}
                </p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Meio de Transporte *</label>
                <Select value={transportMode} onValueChange={setTransportMode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
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
                  <Input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={hotelNights}
                    onChange={(e) => setHotelNights(e.target.value)}
                  />
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
                <label className="text-sm font-medium">
                  Objetivo da Viagem * (selecione um ou mais)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PURPOSES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => togglePurpose(p.value)}
                      className={cn(
                        "rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        purposes.includes(p.value)
                          ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Justificativa *</label>
                <Textarea
                  placeholder="Descreva o motivo da viagem..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500</p>
              </div>
              {!isAdvancedNotice && (
                <div className="space-y-1.5 rounded-lg border-2 border-orange-300 bg-orange-50 p-3">
                  <label className="text-sm font-medium flex items-center gap-1 text-orange-700">
                    <AlertTriangle className="h-4 w-4" /> Justificativa de Urgência *
                  </label>
                  <p className="text-xs text-orange-600">
                    Viagem com menos de 5 dias de antecedência requer justificativa detalhada (mín. 50
                    caracteres).
                  </p>
                  <Textarea
                    placeholder="Explique a urgência..."
                    value={shortNoticeJustification}
                    onChange={(e) => setShortNoticeJustification(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {shortNoticeJustification.length}/500
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? setDialogOpen(false) : setStep(step - 1))}
            >
              {step === 0 ? "Cancelar" : <><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</>}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="vp" onClick={handleNext}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button variant="vp" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                <Plane className="h-4 w-4 mr-1" />
                {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

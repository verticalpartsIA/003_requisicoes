import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  Truck,
  Plus,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Package,
  CalendarIcon,
  ClipboardList,
  ShieldCheck,
  ImageIcon,
  Upload,
  Wrench,
  Trash2,
  Users,
} from "lucide-react";
import { format, startOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn, parseLocalDate } from "@/lib/utils";
import { Stepper } from "@/components/ui/stepper";
import { FIELD_ERROR_CLASS } from "@/lib/field-error";
import { parseBRLNumber } from "@/lib/number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { TicketsTable, type TicketRow } from "@/components/tickets-table";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { friendlySupabaseError } from "@/lib/supabase-error";
import { useAuth } from "@/features/auth/auth-context";
import { toast } from "sonner";
import { notifyVpClickClient } from "@/features/vpclick/client";
import { notifyWhatsappClient } from "@/features/whatsapp/client";
import { updateRequisitionClient } from "@/features/requisitions/client";
import { useRouter } from "@tanstack/react-router";

const VEHICLE_TYPES = [
  { value: "TRUCK", label: "Caminhão Truck" },
  { value: "VAN", label: "Van/Furgão" },
  { value: "FLATBED", label: "Prancha" },
  { value: "CONTAINER", label: "Container" },
  { value: "BAU", label: "Caminhão Baú" },
  { value: "CARRETA", label: "Caminhão Carreta" },
  { value: "OTHER", label: "Outro" },
];

const CARGO_TYPES = [
  { value: "ELEVADOR", label: "Elevador" },
  { value: "EQUIPAMENTO", label: "Equipamento" },
  { value: "MATERIAL_CONSTRUCAO", label: "Material de Construção" },
  { value: "OUTRO", label: "Outro" },
];

const MUNCK_SIZES = [
  { value: "10_15", label: "10 a 15 toneladas" },
  { value: "20_25", label: "20 a 25 toneladas" },
  { value: "30_35", label: "30 a 35 toneladas" },
  { value: "40_45", label: "40 a 45 toneladas" },
  { value: "50", label: "50 toneladas" },
  { value: "OUTRO", label: "Outro" },
];

type EquipmentType =
  | "paleteira"
  | "paleteira_eletrica"
  | "cinta_elevacao"
  | "ganchos"
  | "ajudante"
  | "outro";

const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: "paleteira", label: "Paleteira" },
  { value: "paleteira_eletrica", label: "Paleteira elétrica" },
  { value: "cinta_elevacao", label: "Cinta de elevação" },
  { value: "ganchos", label: "Ganchos" },
  { value: "ajudante", label: "Ajudante" },
  { value: "outro", label: "Outros" },
];

type EquipmentRow = { enabled: boolean; quantity: string; spec: string };

const emptyEquipmentRows = (): Record<EquipmentType, EquipmentRow> => ({
  paleteira: { enabled: false, quantity: "", spec: "" },
  paleteira_eletrica: { enabled: false, quantity: "", spec: "" },
  cinta_elevacao: { enabled: false, quantity: "", spec: "" },
  ganchos: { enabled: false, quantity: "", spec: "" },
  ajudante: { enabled: false, quantity: "", spec: "" },
  outro: { enabled: false, quantity: "", spec: "" },
});

type ElevatorItem = {
  id: string;
  model: string;
  capacityKg: string;
  passengers: string;
  stops: string;
  boxesQty: string;
  totalWeightKg: string;
  volumeM3: string;
  hasMachineRoom: boolean;
};

const emptyElevatorItem = (): ElevatorItem => ({
  id: crypto.randomUUID(),
  model: "",
  capacityKg: "",
  passengers: "",
  stops: "",
  boxesQty: "",
  totalWeightKg: "",
  volumeM3: "",
  hasMachineRoom: false,
});

const URGENCY = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const STEPS = [
  { label: "Rota", icon: MapPin },
  { label: "Carga", icon: Package },
  { label: "Serviços", icon: Wrench },
  { label: "Prazo", icon: ClipboardList },
];

const INSURANCE_RATE = 0.005; // 0,5%
const MIN_LEAD_DAYS = 7;

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const DIALOG_KEY = "vpreq_m5";

export const Route = createFileRoute("/freight")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
    duplicate: typeof search.duplicate === "string" ? search.duplicate : undefined,
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
  const { edit: editTicketNumber, duplicate: duplicateTicketNumber } = Route.useSearch();
  const router = useRouter();
  const { session, profile, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [stepAttempted, setStepAttempted] = useState(false);
  useEffect(() => {
    setStepAttempted(false);
  }, [step]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editReqId, setEditReqId] = useState<string | null>(null);
  const [editEdition, setEditEdition] = useState(1);
  const [editCargoPhotoPath, setEditCargoPhotoPath] = useState<string | null>(null);
  const [editCargoPicPaths, setEditCargoPicPaths] = useState<string[]>([]);
  const [duplicateFrom, setDuplicateFrom] = useState<string | null>(null);

  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [isForConstruction, setIsForConstruction] = useState<"" | "sim" | "nao">("");
  const [projectNumber, setProjectNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteSupervisor, setSiteSupervisor] = useState("");

  const [cargoDescription, setCargoDescription] = useState("");
  const [cargoType, setCargoType] = useState("");
  const [elevatorItems, setElevatorItems] = useState<ElevatorItem[]>([]);
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [unloadingLocation, setUnloadingLocation] = useState("");
  const [cargoPhotoFile, setCargoPhotoFile] = useState<File | null>(null);
  const [cargoPhotoPreview, setCargoPhotoPreview] = useState<string | null>(null);
  const [cargoPhotoDescription, setCargoPhotoDescription] = useState("");
  const [cargoPicFiles, setCargoPicFiles] = useState<File[]>([]);
  const [cargoPicPreviews, setCargoPicPreviews] = useState<string[]>([]);
  const [weight, setWeight] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [cargoHeight, setCargoHeight] = useState("");
  const [cargoLength, setCargoLength] = useState("");
  const [fragile, setFragile] = useState(false);
  const [declaredValue, setDeclaredValue] = useState("");

  const [needsTransport, setNeedsTransport] = useState(true);
  const [vehicleCapacityTon, setVehicleCapacityTon] = useState("");
  const [vehicleLengthM, setVehicleLengthM] = useState("");
  const [vehicleOtherSpec, setVehicleOtherSpec] = useState("");
  const [needsMunck, setNeedsMunck] = useState(false);
  const [serviceLocationAddress, setServiceLocationAddress] = useState("");
  const [munckQuantity, setMunckQuantity] = useState("");
  const [munckSize, setMunckSize] = useState("");
  const [munckSizeOther, setMunckSizeOther] = useState("");
  const [munckBoomLengthM, setMunckBoomLengthM] = useState("");
  const [munckUsageHours, setMunckUsageHours] = useState("");
  const [equipmentRows, setEquipmentRows] =
    useState<Record<EquipmentType, EquipmentRow>>(emptyEquipmentRows());

  const [pickupDate, setPickupDate] = useState<Date | undefined>();
  const [pickupDateOpen, setPickupDateOpen] = useState(false);
  const [unloadingDate, setUnloadingDate] = useState<Date | undefined>();
  const [unloadingDateOpen, setUnloadingDateOpen] = useState(false);
  const [serviceTime, setServiceTime] = useState("");
  const [allowedSchedule, setAllowedSchedule] = useState("");
  const [accessRestriction, setAccessRestriction] = useState("");
  const [needsCityHallAuthorization, setNeedsCityHallAuthorization] = useState(false);
  const [urgencyLevel, setUrgencyLevel] = useState("");
  const [justification, setJustification] = useState("");

  const handleCargoPics = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    setCargoPicFiles((prev) => [...prev, ...newFiles]);
    setCargoPicPreviews((prev) => [...prev, ...newFiles.map((f) => URL.createObjectURL(f))]);
  };

  const removeCargoPic = (idx: number) => {
    setCargoPicPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
    setCargoPicFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const addElevatorItem = () => setElevatorItems((prev) => [...prev, emptyElevatorItem()]);
  const removeElevatorItem = (id: string) =>
    setElevatorItems((prev) => prev.filter((it) => it.id !== id));
  const updateElevatorItem = (id: string, patch: Partial<ElevatorItem>) =>
    setElevatorItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const updateEquipmentRow = (type: EquipmentType, patch: Partial<EquipmentRow>) =>
    setEquipmentRows((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));

  const insuranceCost = useMemo(() => {
    const val = parseBRLNumber(declaredValue) ?? 0;
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
      if (typeof s.originAddress === "string") setOriginAddress(s.originAddress);
      if (typeof s.destinationAddress === "string") setDestinationAddress(s.destinationAddress);
      if (typeof s.vehicleType === "string") setVehicleType(s.vehicleType);
      if (typeof s.isForConstruction === "string")
        setIsForConstruction(s.isForConstruction as "" | "sim" | "nao");
      if (typeof s.projectNumber === "string") setProjectNumber(s.projectNumber);
      if (typeof s.clientName === "string") setClientName(s.clientName);
      if (typeof s.siteSupervisor === "string") setSiteSupervisor(s.siteSupervisor);
      if (typeof s.cargoDescription === "string") setCargoDescription(s.cargoDescription);
      if (typeof s.cargoType === "string") setCargoType(s.cargoType);
      if (Array.isArray(s.elevatorItems)) setElevatorItems(s.elevatorItems as ElevatorItem[]);
      if (typeof s.receiverName === "string") setReceiverName(s.receiverName);
      if (typeof s.receiverPhone === "string") setReceiverPhone(s.receiverPhone);
      if (typeof s.unloadingLocation === "string") setUnloadingLocation(s.unloadingLocation);
      if (typeof s.cargoPhotoDescription === "string")
        setCargoPhotoDescription(s.cargoPhotoDescription);
      if (typeof s.weight === "string") setWeight(s.weight);
      if (typeof s.dimensions === "string") setDimensions(s.dimensions);
      if (typeof s.cargoHeight === "string") setCargoHeight(s.cargoHeight);
      if (typeof s.cargoLength === "string") setCargoLength(s.cargoLength);
      if (typeof s.fragile === "boolean") setFragile(s.fragile);
      if (typeof s.declaredValue === "string") setDeclaredValue(s.declaredValue);
      if (typeof s.needsTransport === "boolean") setNeedsTransport(s.needsTransport);
      if (typeof s.vehicleCapacityTon === "string") setVehicleCapacityTon(s.vehicleCapacityTon);
      if (typeof s.vehicleLengthM === "string") setVehicleLengthM(s.vehicleLengthM);
      if (typeof s.vehicleOtherSpec === "string") setVehicleOtherSpec(s.vehicleOtherSpec);
      if (typeof s.needsMunck === "boolean") setNeedsMunck(s.needsMunck);
      if (typeof s.serviceLocationAddress === "string")
        setServiceLocationAddress(s.serviceLocationAddress);
      if (typeof s.munckQuantity === "string") setMunckQuantity(s.munckQuantity);
      if (typeof s.munckSize === "string") setMunckSize(s.munckSize);
      if (typeof s.munckSizeOther === "string") setMunckSizeOther(s.munckSizeOther);
      if (typeof s.munckBoomLengthM === "string") setMunckBoomLengthM(s.munckBoomLengthM);
      if (typeof s.munckUsageHours === "string") setMunckUsageHours(s.munckUsageHours);
      if (s.equipmentRows && typeof s.equipmentRows === "object")
        setEquipmentRows(s.equipmentRows as Record<EquipmentType, EquipmentRow>);
      if (typeof s.pickupDate === "string") setPickupDate(new Date(s.pickupDate));
      if (typeof s.unloadingDate === "string") setUnloadingDate(new Date(s.unloadingDate));
      if (typeof s.serviceTime === "string") setServiceTime(s.serviceTime);
      if (typeof s.allowedSchedule === "string") setAllowedSchedule(s.allowedSchedule);
      if (typeof s.accessRestriction === "string") setAccessRestriction(s.accessRestriction);
      if (typeof s.needsCityHallAuthorization === "boolean")
        setNeedsCityHallAuthorization(s.needsCityHallAuthorization);
      if (typeof s.urgencyLevel === "string") setUrgencyLevel(s.urgencyLevel);
      if (typeof s.justification === "string") setJustification(s.justification);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [session]);

  useEffect(() => {
    const sourceTicketNumber = editTicketNumber || duplicateTicketNumber;
    if (!sourceTicketNumber || !session) return;
    const isDuplicate = !editTicketNumber && !!duplicateTicketNumber;
    void (async () => {
      const { data } = await supabaseBrowser
        .from("requisitions")
        .select("id,description,justification,urgency,desired_date,module_data,edition")
        .eq("ticket_number", sourceTicketNumber)
        .maybeSingle();
      if (!data) {
        toast.error("Requisição não encontrada.");
        return;
      }
      const md = (data.module_data ?? {}) as Record<string, unknown>;
      if (isDuplicate) {
        setDuplicateFrom(sourceTicketNumber);
        toast.info(
          `Dados copiados de ${sourceTicketNumber} — revise e envie como uma nova requisição.`,
        );
      } else {
        setEditMode(true);
        setEditReqId(data.id as string);
        setEditEdition((data.edition as number | undefined) ?? 1);
      }
      // Duplicar não reaproveita as fotos antigas em silêncio — o comprador
      // precisa anexar fotos novas (a UI não expõe/permite remover a foto
      // "herdada" de editCargoPhotoPath, então herdar aqui a deixaria presa
      // sem controle até o próximo envio).
      if (!isDuplicate) {
        setEditCargoPhotoPath((md.cargo_photo_path as string | null) ?? null);
        setEditCargoPicPaths((md.cargo_photos_paths as string[] | undefined) ?? []);
      }
      setOriginAddress((md.origin_address as string | undefined) ?? "");
      setDestinationAddress((md.destination_address as string | undefined) ?? "");
      setVehicleType((md.vehicle_type as string | undefined) ?? "");
      const wasConstruction =
        (md.is_construction_site as boolean | undefined) ??
        !!(md.project_number as string | undefined);
      setIsForConstruction(wasConstruction ? "sim" : "nao");
      setProjectNumber((md.project_number as string | undefined) ?? "");
      setClientName((md.client_name as string | undefined) ?? "");
      setSiteSupervisor((md.site_supervisor as string | undefined) ?? "");
      setCargoDescription((data.description as string) ?? "");
      setCargoType((md.cargo_type as string | undefined) ?? "");
      const rawElevators = (md.elevator_items as Array<Record<string, unknown>> | undefined) ?? [];
      setElevatorItems(
        rawElevators.map((it) => ({
          id: crypto.randomUUID(),
          model: (it.model as string) ?? "",
          capacityKg: it.capacity_kg != null ? String(it.capacity_kg) : "",
          passengers: it.passengers != null ? String(it.passengers) : "",
          stops: it.stops != null ? String(it.stops) : "",
          boxesQty: it.boxes_qty != null ? String(it.boxes_qty) : "",
          totalWeightKg: it.total_weight_kg != null ? String(it.total_weight_kg) : "",
          volumeM3: it.volume_m3 != null ? String(it.volume_m3) : "",
          hasMachineRoom: (it.has_machine_room as boolean | undefined) ?? false,
        })),
      );
      setReceiverName((md.receiver_name as string | undefined) ?? "");
      setReceiverPhone((md.receiver_phone as string | undefined) ?? "");
      setUnloadingLocation((md.unloading_location as string | undefined) ?? "");
      setCargoPhotoDescription((md.cargo_photo_description as string | undefined) ?? "");
      setWeight(String((md.weight_kg as number | undefined) ?? ""));
      setDimensions((md.dimensions as string | undefined) ?? "");
      setCargoHeight(String((md.cargo_height_m as number | undefined) ?? ""));
      setCargoLength(String((md.cargo_length_m as number | undefined) ?? ""));
      setFragile((md.fragile as boolean | undefined) ?? false);
      setDeclaredValue(String((md.declared_value as number | undefined) ?? ""));
      setNeedsTransport((md.needs_transport as boolean | undefined) ?? true);
      setVehicleCapacityTon(String((md.vehicle_capacity_ton as number | undefined) ?? ""));
      setVehicleLengthM(String((md.vehicle_length_m as number | undefined) ?? ""));
      setVehicleOtherSpec((md.vehicle_other_spec as string | undefined) ?? "");
      setNeedsMunck((md.needs_munck as boolean | undefined) ?? false);
      setServiceLocationAddress((md.service_location_address as string | undefined) ?? "");
      setMunckQuantity(String((md.munck_quantity as number | undefined) ?? ""));
      setMunckSize((md.munck_size as string | undefined) ?? "");
      setMunckSizeOther((md.munck_size_other as string | undefined) ?? "");
      setMunckBoomLengthM(String((md.munck_boom_length_m as number | undefined) ?? ""));
      setMunckUsageHours(String((md.munck_usage_hours as number | undefined) ?? ""));
      const rawEquipment =
        (md.additional_equipment as Array<Record<string, unknown>> | undefined) ?? [];
      const nextEquipmentRows = emptyEquipmentRows();
      rawEquipment.forEach((eq) => {
        const type = eq.type as EquipmentType;
        if (type && type in nextEquipmentRows) {
          nextEquipmentRows[type] = {
            enabled: true,
            quantity: eq.quantity != null ? String(eq.quantity) : "",
            spec: (eq.spec as string) ?? "",
          };
        }
      });
      setEquipmentRows(nextEquipmentRows);
      setAllowedSchedule((md.allowed_schedule as string | undefined) ?? "");
      setServiceTime((md.service_time as string | undefined) ?? "");
      setAccessRestriction((md.access_restriction as string | undefined) ?? "");
      setNeedsCityHallAuthorization(
        (md.needs_city_hall_authorization as boolean | undefined) ?? false,
      );
      setUrgencyLevel((data.urgency as string) ?? "");
      setJustification((data.justification as string) ?? "");
      // Duplicar não copia as datas antigas — um ticket concluído/cancelado
      // pode ter data no passado; deixa em branco para escolher datas novas.
      if (!isDuplicate) {
        if (data.desired_date) setPickupDate(parseLocalDate(data.desired_date as string));
        if (md.unloading_date) setUnloadingDate(parseLocalDate(md.unloading_date as string));
      }
      setStep(0);
      setDialogOpen(true);
    })();
  }, [editTicketNumber, duplicateTicketNumber, session]);

  useEffect(() => {
    if (!dialogOpen) return;
    try {
      sessionStorage.setItem(
        DIALOG_KEY,
        JSON.stringify({
          open: true,
          step,
          originAddress,
          destinationAddress,
          vehicleType,
          isForConstruction,
          projectNumber,
          clientName,
          siteSupervisor,
          cargoDescription,
          cargoType,
          elevatorItems,
          receiverName,
          receiverPhone,
          unloadingLocation,
          cargoPhotoDescription,
          weight,
          dimensions,
          cargoHeight,
          cargoLength,
          fragile,
          declaredValue,
          needsTransport,
          vehicleCapacityTon,
          vehicleLengthM,
          vehicleOtherSpec,
          needsMunck,
          serviceLocationAddress,
          munckQuantity,
          munckSize,
          munckSizeOther,
          munckBoomLengthM,
          munckUsageHours,
          equipmentRows,
          pickupDate: pickupDate?.toISOString(),
          unloadingDate: unloadingDate?.toISOString(),
          serviceTime,
          allowedSchedule,
          accessRestriction,
          needsCityHallAuthorization,
          urgencyLevel,
          justification,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    dialogOpen,
    step,
    originAddress,
    destinationAddress,
    vehicleType,
    isForConstruction,
    projectNumber,
    clientName,
    siteSupervisor,
    cargoDescription,
    cargoType,
    elevatorItems,
    receiverName,
    receiverPhone,
    unloadingLocation,
    cargoPhotoDescription,
    weight,
    dimensions,
    cargoHeight,
    cargoLength,
    fragile,
    declaredValue,
    needsTransport,
    vehicleCapacityTon,
    vehicleLengthM,
    vehicleOtherSpec,
    needsMunck,
    serviceLocationAddress,
    munckQuantity,
    munckSize,
    munckSizeOther,
    munckBoomLengthM,
    munckUsageHours,
    equipmentRows,
    pickupDate,
    unloadingDate,
    serviceTime,
    allowedSchedule,
    accessRestriction,
    needsCityHallAuthorization,
    urgencyLevel,
    justification,
  ]);

  const resetForm = () => {
    sessionStorage.removeItem(DIALOG_KEY);
    setStep(0);
    setOriginAddress("");
    setDestinationAddress("");
    setVehicleType("");
    setIsForConstruction("");
    setProjectNumber("");
    setClientName("");
    setSiteSupervisor("");
    setCargoDescription("");
    setCargoType("");
    setElevatorItems([]);
    setReceiverName("");
    setReceiverPhone("");
    setUnloadingLocation("");
    if (cargoPhotoPreview) URL.revokeObjectURL(cargoPhotoPreview);
    setCargoPhotoFile(null);
    setCargoPhotoPreview(null);
    setCargoPhotoDescription("");
    cargoPicPreviews.forEach((p) => URL.revokeObjectURL(p));
    setCargoPicFiles([]);
    setCargoPicPreviews([]);
    setEditCargoPhotoPath(null);
    setEditCargoPicPaths([]);
    setWeight("");
    setDimensions("");
    setCargoHeight("");
    setCargoLength("");
    setFragile(false);
    setDeclaredValue("");
    setNeedsTransport(true);
    setVehicleCapacityTon("");
    setVehicleLengthM("");
    setVehicleOtherSpec("");
    setNeedsMunck(false);
    setServiceLocationAddress("");
    setMunckQuantity("");
    setMunckSize("");
    setMunckSizeOther("");
    setMunckBoomLengthM("");
    setMunckUsageHours("");
    setEquipmentRows(emptyEquipmentRows());
    setPickupDate(undefined);
    setUnloadingDate(undefined);
    setServiceTime("");
    setAllowedSchedule("");
    setAccessRestriction("");
    setNeedsCityHallAuthorization(false);
    setUrgencyLevel("");
    setJustification("");
    setDuplicateFrom(null);
  };

  const validateStep = (): boolean => {
    if (step === 0) {
      if (!originAddress.trim()) {
        toast.error("Informe o endereço de origem.");
        return false;
      }
      if (!destinationAddress.trim()) {
        toast.error("Informe o endereço de destino.");
        return false;
      }
      if (!clientName.trim()) {
        toast.error("Informe o cliente/projeto.");
        return false;
      }
      if (!vehicleType) {
        toast.error("Selecione o tipo de veículo.");
        return false;
      }
      if (!isForConstruction) {
        toast.error("Informe se é para atender uma obra.");
        return false;
      }
      if (isForConstruction === "sim" && !projectNumber.trim()) {
        toast.error("Informe o número da obra.");
        return false;
      }
    }
    if (step === 1) {
      if (cargoDescription.length < 10) {
        toast.error("Descrição da carga deve ter pelo menos 10 caracteres.");
        return false;
      }
      if (!cargoType) {
        toast.error("Selecione o tipo de carga.");
        return false;
      }
      if (cargoType === "ELEVADOR" && elevatorItems.length === 0) {
        toast.error("Adicione ao menos um elevador com suas características.");
        return false;
      }
      for (const it of elevatorItems) {
        if (!it.capacityKg.trim() || !it.stops.trim()) {
          toast.error("Informe capacidade e número de paradas de cada elevador.");
          return false;
        }
      }
      if (!receiverName.trim()) {
        toast.error("Informe o nome de quem vai receber a carga.");
        return false;
      }
      if (!receiverPhone.trim()) {
        toast.error("Informe o telefone de quem vai receber a carga.");
        return false;
      }
    }
    if (step === 2) {
      if (!needsTransport && !needsMunck) {
        toast.error("Selecione ao menos um serviço: Transporte e/ou Locação de Munck.");
        return false;
      }
      if (needsMunck && !munckQuantity.trim()) {
        toast.error("Informe a quantidade de Munck necessária.");
        return false;
      }
      if (needsMunck && !munckSize) {
        toast.error("Selecione o tamanho do Munck.");
        return false;
      }
    }
    if (step === 3) {
      if (!pickupDate) {
        toast.error("Informe a data de coleta.");
        return false;
      }
      if (!unloadingDate) {
        toast.error("Informe a data da descarga.");
        return false;
      }
      if (!urgencyLevel) {
        toast.error("Selecione o nível de urgência.");
        return false;
      }
      if (justification.length < 10) {
        toast.error("Justificativa deve ter pelo menos 10 caracteres.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) {
      toast.dismiss();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } else setStepAttempted(true);
  };

  const handleSubmit = async () => {
    if (!validateStep()) {
      setStepAttempted(true);
      return;
    }
    if (unloadingDate && differenceInCalendarDays(unloadingDate, new Date()) < MIN_LEAD_DAYS) {
      toast.warning(
        `Atenção: o prazo recomendado para cotação e contratação de transporte/Munck é de ${MIN_LEAD_DAYS} dias de antecedência.`,
      );
    }
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

      const newCargoPicPaths = await Promise.all(
        cargoPicFiles.map(async (file, i) => {
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `m5/${user?.id ?? "anon"}/${Date.now()}_${i}.${ext}`;
          const { data: uploadData, error: uploadError } = await supabaseBrowser.storage
            .from("travel-docs")
            .upload(path, file, { upsert: true });
          if (uploadError) {
            console.warn("[cargo pic upload]", uploadError.message);
            return null;
          }
          return uploadData.path;
        }),
      );
      const cargoPicsPaths = [
        ...editCargoPicPaths,
        ...newCargoPicPaths.filter((p): p is string => !!p),
      ];

      const additionalEquipment = EQUIPMENT_TYPES.filter((t) => equipmentRows[t.value].enabled).map(
        (t) => ({
          type: t.value,
          label: t.label,
          quantity: equipmentRows[t.value].quantity
            ? parseInt(equipmentRows[t.value].quantity, 10)
            : null,
          spec: equipmentRows[t.value].spec || null,
        }),
      );

      const elevatorItemsPayload = elevatorItems.map((it) => ({
        model: it.model || null,
        capacity_kg: it.capacityKg ? parseFloat(it.capacityKg) : null,
        passengers: it.passengers ? parseInt(it.passengers, 10) : null,
        stops: it.stops ? parseInt(it.stops, 10) : null,
        boxes_qty: it.boxesQty ? parseInt(it.boxesQty, 10) : null,
        total_weight_kg: it.totalWeightKg ? parseFloat(it.totalWeightKg) : null,
        volume_m3: it.volumeM3 ? parseFloat(it.volumeM3) : null,
        has_machine_room: it.hasMachineRoom,
      }));

      const moduleData = {
        origin_address: originAddress,
        destination_address: destinationAddress,
        vehicle_type: vehicleType,
        is_construction_site: isForConstruction === "sim",
        project_number: isForConstruction === "sim" ? projectNumber || null : null,
        client_name: clientName || null,
        site_supervisor: siteSupervisor || null,
        cargo_type: cargoType || null,
        elevator_items: elevatorItemsPayload.length > 0 ? elevatorItemsPayload : null,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        unloading_location: unloadingLocation || null,
        unloading_date: unloadingDate?.toISOString().slice(0, 10) ?? null,
        service_time: serviceTime || null,
        allowed_schedule: allowedSchedule || null,
        access_restriction: accessRestriction || null,
        needs_city_hall_authorization: needsCityHallAuthorization,
        cargo_photo_path: cargoPhotoPath,
        cargo_photo_description: cargoPhotoDescription || null,
        cargo_photos_paths: cargoPicsPaths.length > 0 ? cargoPicsPaths : null,
        weight_kg: weight ? parseFloat(weight) : null,
        dimensions,
        cargo_height_m: cargoHeight ? parseFloat(cargoHeight) : null,
        cargo_length_m: cargoLength ? parseFloat(cargoLength) : null,
        fragile,
        declared_value: parseBRLNumber(declaredValue),
        insurance_cost: insuranceCost || null,
        needs_transport: needsTransport,
        vehicle_capacity_ton: vehicleCapacityTon ? parseFloat(vehicleCapacityTon) : null,
        vehicle_length_m: vehicleLengthM ? parseFloat(vehicleLengthM) : null,
        vehicle_other_spec: vehicleType === "OTHER" ? vehicleOtherSpec || null : null,
        needs_munck: needsMunck,
        service_location_address: serviceLocationAddress || null,
        munck_quantity: needsMunck && munckQuantity ? parseInt(munckQuantity, 10) : null,
        munck_size: needsMunck ? munckSize || null : null,
        munck_size_other: needsMunck && munckSize === "OUTRO" ? munckSizeOther || null : null,
        munck_boom_length_m: munckBoomLengthM ? parseFloat(munckBoomLengthM) : null,
        munck_usage_hours: munckUsageHours ? parseFloat(munckUsageHours) : null,
        additional_equipment: additionalEquipment.length > 0 ? additionalEquipment : null,
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
        toast.success(`Requisição editada — ${ordinal} Edição`, {
          description: editTicketNumber ?? "",
        });
        setDialogOpen(false);
        resetForm();
        setEditMode(false);
        setEditReqId(null);
        setEditEdition(1);
        setEditCargoPhotoPath(null);
        void router.navigate({ to: "/logs" });
        return;
      }

      const { error } = await supabaseBrowser.from("requisitions").insert({
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
        status: "GESTOR",
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

      if (created?.id) {
        const { error: auditError } = await supabaseBrowser.from("audit_logs").insert({
          requisition_id: created.id,
          ticket_number: created.ticket_number,
          action: "REQUISITION_CREATED",
          new_status: "GESTOR",
          actor_name: profile?.full_name || user?.email || "Usuário VP",
          details: { module: "M5", urgency: urgencyLevel },
        });
        if (auditError) console.warn("[audit_logs]", auditError.message);
      }

      toast.success("Requisição de frete criada!", { description: created?.ticket_number ?? "" });
      void notifyVpClickClient({
        stage: "V1",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `Frete ${originAddress} → ${destinationAddress}`,
        module: "M5",
        requesterName: profile?.full_name || user?.email || "Usuário VP",
      }).catch(console.warn);
      void notifyWhatsappClient({
        stage: "LIDER_CIENCIA",
        requisitionId: created?.id ?? "",
        ticketNumber: created?.ticket_number ?? "",
        title: `Frete ${originAddress} → ${destinationAddress}`,
        module: "M5",
        requesterName: profile?.full_name || user?.email || "Usuário VP",
        requesterId: user?.id,
        requesterDepartment: profile?.department ?? undefined,
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
        <Button
          variant="vp"
          onClick={() => {
            resetForm();
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Nova Requisição
        </Button>
      </div>

      <TicketsTable
        tickets={tickets}
        emptyIcon={<Truck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />}
        emptyMessage="Nenhuma requisição de frete ainda."
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) setDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>
              {editMode
                ? `Editando ${editTicketNumber} — ${editEdition + 1}ª Edição`
                : duplicateFrom
                  ? `Nova Requisição de Frete — copiada de ${duplicateFrom}`
                  : "Nova Requisição de Frete"}
            </DialogTitle>
            <DialogDescription>Informe os dados do transporte.</DialogDescription>
          </DialogHeader>

          <Stepper steps={STEPS} currentStep={step} onStepClick={setStep} />

          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Cliente / Projeto *</label>
                <Input
                  placeholder="Ex.: VIP Gails, Urban Campo Limpo..."
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className={cn(stepAttempted && !clientName.trim() && FIELD_ERROR_CLASS)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Encarregado do Serviço
                  <span className="text-muted-foreground font-normal text-[11px]"> (opcional)</span>
                </label>
                <Input
                  placeholder="Responsável VerticalParts pelo acompanhamento"
                  value={siteSupervisor}
                  onChange={(e) => setSiteSupervisor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Endereço de Origem *</label>
                <Input
                  placeholder="Ex.: São Paulo, SP — Rua das Indústrias, 100"
                  value={originAddress}
                  onChange={(e) => setOriginAddress(e.target.value)}
                  className={cn(stepAttempted && !originAddress.trim() && FIELD_ERROR_CLASS)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Endereço de Destino (entrega) *</label>
                <Input
                  placeholder="Ex.: Curitiba, PR — Av. Cândido de Abreu, 200"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  className={cn(stepAttempted && !destinationAddress.trim() && FIELD_ERROR_CLASS)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Veículo *</label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger className={cn(stepAttempted && !vehicleType && FIELD_ERROR_CLASS)}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">É para atender uma obra? *</label>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-2 rounded-lg",
                    stepAttempted && !isForConstruction && "ring-2 ring-destructive ring-offset-2",
                  )}
                >
                  {(["sim", "nao"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setIsForConstruction(opt)}
                      className={cn(
                        "rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        isForConstruction === opt
                          ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                    >
                      {opt === "sim" ? "Sim" : "Não"}
                    </button>
                  ))}
                </div>
              </div>
              {isForConstruction === "sim" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Número da Obra/Projeto *</label>
                  <Input
                    placeholder="Ex.: 28978/776"
                    value={projectNumber}
                    onChange={(e) => setProjectNumber(e.target.value)}
                    className={cn(stepAttempted && !projectNumber.trim() && FIELD_ERROR_CLASS)}
                  />
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição da Carga *</label>
                <Textarea
                  placeholder="O que será transportado? Quantidade, tipo..."
                  value={cargoDescription}
                  onChange={(e) => setCargoDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className={cn(stepAttempted && cargoDescription.length < 10 && FIELD_ERROR_CLASS)}
                />
                <p className="text-[11px] text-muted-foreground">{cargoDescription.length}/500</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Carga *</label>
                <Select value={cargoType} onValueChange={setCargoType}>
                  <SelectTrigger className={cn(stepAttempted && !cargoType && FIELD_ERROR_CLASS)}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {CARGO_TYPES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {cargoType === "ELEVADOR" && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Elevadores ({elevatorItems.length})
                    </label>
                    <Button type="button" variant="outline" size="sm" onClick={addElevatorItem}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar elevador
                    </Button>
                  </div>
                  {elevatorItems.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum elevador adicionado ainda.
                    </p>
                  )}
                  {elevatorItems.map((it, idx) => (
                    <div key={it.id} className="space-y-2 rounded-md border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">Elevador {idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeElevatorItem(it.id)}
                          className="text-destructive hover:opacity-70"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <Input
                        placeholder="Modelo (ex.: SMR, GEP-MRL)"
                        value={it.model}
                        onChange={(e) => updateElevatorItem(it.id, { model: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="number"
                          placeholder="Capacidade (kg) *"
                          value={it.capacityKg}
                          onChange={(e) =>
                            updateElevatorItem(it.id, { capacityKg: e.target.value })
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Passageiros"
                          value={it.passengers}
                          onChange={(e) =>
                            updateElevatorItem(it.id, { passengers: e.target.value })
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Nº de paradas *"
                          value={it.stops}
                          onChange={(e) => updateElevatorItem(it.id, { stops: e.target.value })}
                        />
                        <Input
                          type="number"
                          placeholder="Nº de caixas/volumes"
                          value={it.boxesQty}
                          onChange={(e) => updateElevatorItem(it.id, { boxesQty: e.target.value })}
                        />
                        <Input
                          type="number"
                          placeholder="Peso total (kg)"
                          value={it.totalWeightKg}
                          onChange={(e) =>
                            updateElevatorItem(it.id, { totalWeightKg: e.target.value })
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Volume (m³)"
                          value={it.volumeM3}
                          onChange={(e) => updateElevatorItem(it.id, { volumeM3: e.target.value })}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={it.hasMachineRoom}
                          onCheckedChange={(v) =>
                            updateElevatorItem(it.id, { hasMachineRoom: v === true })
                          }
                        />
                        Com casa de máquinas
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-lg border p-3">
                <label className="text-sm font-medium">Quem vai receber a carga? *</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Nome</label>
                    <Input
                      placeholder="Nome do responsável"
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      className={cn(stepAttempted && !receiverName.trim() && FIELD_ERROR_CLASS)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Telefone</label>
                    <Input
                      placeholder="(00) 00000-0000"
                      value={receiverPhone}
                      onChange={(e) => setReceiverPhone(e.target.value)}
                      className={cn(stepAttempted && !receiverPhone.trim() && FIELD_ERROR_CLASS)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Peso (kg)</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Ex.: 500"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Altura (m)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex.: 1.5"
                    value={cargoHeight}
                    onChange={(e) => setCargoHeight(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Comprimento (m)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex.: 2"
                    value={cargoLength}
                    onChange={(e) => setCargoLength(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Dimensões (CxLxA)</label>
                <Input
                  placeholder="Ex.: 2m x 1m x 0.5m"
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                />
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
                  <p className="text-xs text-muted-foreground">
                    Requer cuidados especiais no transporte
                  </p>
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
                  Descreva as condições de acesso para que o cotador avalie o tipo de veículo
                  adequado.
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
                    cargoPhotoFile
                      ? "border-green-400 bg-green-50"
                      : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  {cargoPhotoPreview ? (
                    <>
                      <img
                        src={cargoPhotoPreview}
                        alt="Local"
                        className="h-14 w-14 rounded object-cover border"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-green-700 truncate">
                          {cargoPhotoFile?.name}
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
                          <Upload className="h-3.5 w-3.5" /> Enviar foto do local
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          JPG, PNG, WebP — máx. 5 MB
                        </p>
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

              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1">
                  📸 Tem fotos da carga?
                  <span className="text-muted-foreground font-normal text-[11px]">
                    (ajuda na cotação)
                  </span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  id="cargo-pics"
                  onChange={(e) => {
                    handleCargoPics(e.target.files);
                    e.target.value = "";
                  }}
                />
                <label
                  htmlFor="cargo-pics"
                  className="flex items-center gap-2 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors border-border hover:border-muted-foreground/50 w-fit"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">📎 Adicionar fotos</span>
                </label>
                {(cargoPicPreviews.length > 0 || editCargoPicPaths.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {cargoPicPreviews.map((preview, idx) => (
                      <div key={preview} className="relative">
                        <img
                          src={preview}
                          alt={`Foto da carga ${idx + 1}`}
                          className="h-16 w-16 rounded object-cover border"
                        />
                        <button
                          type="button"
                          onClick={() => removeCargoPic(idx)}
                          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs leading-none"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {editCargoPicPaths.map((path) => (
                      <div
                        key={path}
                        className="flex h-16 w-16 items-center justify-center rounded border bg-green-50"
                      >
                        <ImageIcon className="h-5 w-5 text-green-600" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium">Serviço de Transporte</label>
                  <p className="text-xs text-muted-foreground">
                    Frete do caminhão selecionado na Rota
                  </p>
                </div>
                <Switch checked={needsTransport} onCheckedChange={setNeedsTransport} />
              </div>
              {needsTransport && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Capacidade do veículo (ton)
                    </label>
                    <Input
                      type="number"
                      placeholder="Ex.: 8"
                      value={vehicleCapacityTon}
                      onChange={(e) => setVehicleCapacityTon(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Comprimento do veículo (m)
                    </label>
                    <Input
                      type="number"
                      placeholder="Ex.: 9"
                      value={vehicleLengthM}
                      onChange={(e) => setVehicleLengthM(e.target.value)}
                    />
                  </div>
                  {vehicleType === "OTHER" && (
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Especifique o tipo de veículo
                      </label>
                      <Input
                        placeholder="Ex.: Munck 3/4"
                        value={vehicleOtherSpec}
                        onChange={(e) => setVehicleOtherSpec(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium">Locação de Munck</label>
                  <p className="text-xs text-muted-foreground">Guindaste para desova/descarga</p>
                </div>
                <Switch checked={needsMunck} onCheckedChange={setNeedsMunck} />
              </div>
              {needsMunck && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Local do serviço (onde o Munck vai atuar, se diferente do destino)
                    </label>
                    <Input
                      placeholder="Deixe em branco se for o mesmo endereço de destino"
                      value={serviceLocationAddress}
                      onChange={(e) => setServiceLocationAddress(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Quantidade de Munck *</label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="Ex.: 1"
                        value={munckQuantity}
                        onChange={(e) => setMunckQuantity(e.target.value)}
                        className={cn(stepAttempted && !munckQuantity.trim() && FIELD_ERROR_CLASS)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Tempo estimado de uso (horas)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="Ex.: 4"
                        value={munckUsageHours}
                        onChange={(e) => setMunckUsageHours(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Tamanho do Munck *</label>
                    <Select value={munckSize} onValueChange={setMunckSize}>
                      <SelectTrigger
                        className={cn(stepAttempted && !munckSize && FIELD_ERROR_CLASS)}
                      >
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {MUNCK_SIZES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {munckSize === "OUTRO" && (
                    <Input
                      placeholder="Especifique o tamanho do Munck"
                      value={munckSizeOther}
                      onChange={(e) => setMunckSizeOther(e.target.value)}
                    />
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Tamanho da lança (m)</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Ex.: 20"
                      value={munckBoomLengthM}
                      onChange={(e) => setMunckBoomLengthM(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-lg border p-3">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Equipamento adicional
                </label>
                <p className="text-xs text-muted-foreground">
                  Marque o que for necessário para a descarga/desova.
                </p>
                {EQUIPMENT_TYPES.map((t) => {
                  const row = equipmentRows[t.value];
                  return (
                    <div
                      key={t.value}
                      className="space-y-1.5 border-t pt-2 first:border-t-0 first:pt-0"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={row.enabled}
                          onCheckedChange={(v) =>
                            updateEquipmentRow(t.value, { enabled: v === true })
                          }
                        />
                        {t.label}
                      </label>
                      {row.enabled && (
                        <div className="grid grid-cols-3 gap-2 pl-6">
                          <Input
                            type="number"
                            min="0"
                            placeholder="Quantidade"
                            value={row.quantity}
                            onChange={(e) =>
                              updateEquipmentRow(t.value, { quantity: e.target.value })
                            }
                          />
                          <Input
                            className="col-span-2"
                            placeholder="Especificações (opcional)"
                            value={row.spec}
                            onChange={(e) => updateEquipmentRow(t.value, { spec: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data de Coleta *</label>
                <Popover open={pickupDateOpen} onOpenChange={setPickupDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !pickupDate && "text-muted-foreground",
                        stepAttempted && !pickupDate && FIELD_ERROR_CLASS,
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {pickupDate
                        ? format(pickupDate, "dd/MM/yyyy", { locale: ptBR })
                        : "Selecione a data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={pickupDate}
                      onSelect={(d) => {
                        setPickupDate(d);
                        setPickupDateOpen(false);
                      }}
                      disabled={(d) => d < startOfDay(new Date())}
                      initialFocus
                      className="p-3 pointer-events-auto"
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <label className="text-sm font-medium">Quando precisa? *</label>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Data do serviço/descarga</label>
                  <Popover open={unloadingDateOpen} onOpenChange={setUnloadingDateOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !unloadingDate && "text-muted-foreground",
                          stepAttempted && !unloadingDate && FIELD_ERROR_CLASS,
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {unloadingDate
                          ? format(unloadingDate, "dd/MM/yyyy", { locale: ptBR })
                          : "Selecione a data"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={unloadingDate}
                        onSelect={(d) => {
                          setUnloadingDate(d);
                          setUnloadingDateOpen(false);
                        }}
                        disabled={(d) => d < startOfDay(pickupDate ?? new Date())}
                        initialFocus
                        className="p-3 pointer-events-auto"
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                  {unloadingDate &&
                    differenceInCalendarDays(unloadingDate, new Date()) < MIN_LEAD_DAYS && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Atenção: prazo recomendado é de {MIN_LEAD_DAYS} dias de antecedência para
                        cotação e contratação de transporte/Munck.
                      </p>
                    )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Horário do serviço</label>
                  <Input
                    placeholder="Ex.: 09:00"
                    value={serviceTime}
                    onChange={(e) => setServiceTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Horário permitido</label>
                  <Input
                    placeholder="Ex.: Seg-Sex, 8h-17h"
                    value={allowedSchedule}
                    onChange={(e) => setAllowedSchedule(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Tem alguma restrição de acesso?
                  </label>
                  <Textarea
                    placeholder="Ex.: Rua estreita, horário limitado..."
                    value={accessRestriction}
                    onChange={(e) => setAccessRestriction(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <label className="text-sm font-medium">Precisa avisar a Prefeitura?</label>
                    <p className="text-xs text-muted-foreground">
                      Ex.: pegar autorização de acesso/carga e descarga
                    </p>
                  </div>
                  <Switch
                    checked={needsCityHallAuthorization}
                    onCheckedChange={setNeedsCityHallAuthorization}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Urgência *</label>
                <div
                  className={cn(
                    "grid grid-cols-4 gap-2 rounded-lg",
                    stepAttempted && !urgencyLevel && "ring-2 ring-destructive ring-offset-2",
                  )}
                >
                  {URGENCY.map((u) => (
                    <button
                      key={u.value}
                      type="button"
                      onClick={() => setUrgencyLevel(u.value)}
                      className={cn(
                        "rounded-lg border-2 p-2.5 text-xs font-medium text-center transition-all",
                        urgencyLevel === u.value
                          ? u.value === "LOW"
                            ? "border-green-500 bg-green-50 text-green-700"
                            : u.value === "MEDIUM"
                              ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                              : u.value === "HIGH"
                                ? "border-orange-500 bg-orange-50 text-orange-700"
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
                <label className="text-sm font-medium">Justificativa *</label>
                <Textarea
                  placeholder="Motivo do frete, urgência..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className={cn(stepAttempted && justification.length < 10 && FIELD_ERROR_CLASS)}
                />
                <p className="text-[11px] text-muted-foreground">{justification.length}/500</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? setDialogOpen(false) : setStep(step - 1))}
            >
              {step === 0 ? (
                "Cancelar"
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
                </>
              )}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="vp" onClick={handleNext}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button variant="vp" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                <Truck className="h-4 w-4 mr-1" />{" "}
                {isSubmitting ? "Enviando..." : "Enviar Requisição"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

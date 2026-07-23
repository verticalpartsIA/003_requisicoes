import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useAuth } from "@/features/auth/auth-context";
import {
  ScrollText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Timer,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  User,
  FileText,
  ArrowRight,
  Download,
  Building2,
  Hourglass,
} from "lucide-react";
import {
  OctagonAlert,
  Bell,
  Lightbulb,
  FileDown,
  FileJson,
  FileSpreadsheet,
  Loader2,
  ExternalLink,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { generateAndSaveRequisitionPdf } from "@/features/pdf/client";
import { deleteRequisitionClient } from "@/features/requisitions/client";
import { getLogsOverview, type LogsPayload, type LogsEntry } from "@/features/logs/api";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { pendencyOf, PENDENCY_TONE_CLASS, MODULE_ROUTES, OPEN_STATUSES } from "@/lib/requisitions";
import { cn } from "@/lib/utils";
import { excelTable } from "@/lib/excel-table";

/* ── Export types ── */

type ExportFormat = "PDF" | "CSV" | "JSON";

interface ExportResponse {
  download_url: string;
  expires_at: string;
  file_size_bytes: number;
  generated_at: string;
}

export const Route = createFileRoute("/movimentacoes")({
  validateSearch: (search: Record<string, unknown>) => ({
    ticket: typeof search.ticket === "string" ? search.ticket : undefined,
    module: typeof search.module === "string" ? search.module : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Movimentações — VPRequisições" },
      {
        name: "description",
        content: "Busca e histórico completo de eventos de cada requisição — trilha imutável",
      },
    ],
  }),
  component: MovimentacoesPage,
});

type SlaStatus = "ok" | "warning" | "breach";

/* ── Live Ticket Detail (fetched from DB) ── */
interface LiveTicketDetail {
  ticket_id: string;
  requisition_id: string;
  edition: number;
  module: string;
  status: string;
  title: string;
  description: string;
  justification: string;
  requester_name: string;
  requester_department: string | null;
  created_at: string;
  completed_at: string | null;
  suppliers: Array<{
    id: string;
    name: string;
    price: number | null;
    deadline: string | null;
    notes: string | null;
    proposal_received: boolean;
    is_winner: boolean;
  }>;
  win_criteria: string | null;
  approval_decision: string | null;
  approval_level: number | null;
  approval_value: number | null;
  approval_decided_at: string | null;
  approval_justification: string | null;
  purchase_supplier: string | null;
  purchase_price: number | null;
  purchase_order_number: string | null;
  payment_method: string | null;
  purchased_at: string | null;
  receipt_condition: string | null;
  deliverer_name: string | null;
  received_at: string | null;
  receipt_notes: string | null;
  ticket_audit_logs: Array<{
    id: string;
    action: string;
    actor_name: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  module_data: Record<string, unknown> | null;
}

/* ────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────── */

/** Format hours as "X dias Yh" per spec §2.2 */
function formatSla(hours: number): string {
  if (hours === 0) return "0h";
  const days = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  if (days === 0) return `${h}h`;
  if (h === 0) return `${days} dia${days > 1 ? "s" : ""}`;
  return `${days} dia${days > 1 ? "s" : ""} ${h}h`;
}

function formatMetricAvg(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  if (h === 0) return `${days}d`;
  return `${days}d ${h}h`;
}

function slaIcon(status: SlaStatus) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <AlertTriangle className="h-4 w-4 text-red-500" />;
}

function slaBadge(status: SlaStatus) {
  const map = {
    ok: { label: "No prazo", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    warning: { label: "Atenção", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    breach: { label: "SLA Excedido", cls: "bg-red-100 text-red-700 border-red-200" },
  };
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}
    >
      {slaIcon(status)}
      {m.label}
    </span>
  );
}

function metricColor(status: SlaStatus) {
  if (status === "ok") return "text-emerald-600";
  if (status === "warning") return "text-amber-500";
  return "text-red-500";
}

/* ────────────────────────────────────────────────
 *  Page Component
 * ──────────────────────────────────────────────── */

const moduleOptions = ["Todos", "M1", "M2", "M3", "M4", "M5", "M6"];
const stageOptions = ["Todos", "GESTOR", "COTAÇÃO", "APROVAÇÃO", "COMPRA", "RECEBIMENTO"];
const slaOptions = ["Todos", "ok", "warning", "breach"];

/* Cards de resumo — vieram do Dashboard, que duplicava esses números sem
 * poder filtrar a lista abaixo. Aqui clicar num card filtra os tickets pelo
 * status atual, ao invés de só mostrar uma contagem estática. */
type StatusQuickFilter = "Todos" | "OPEN" | "COTAÇÃO" | "APROVAÇÃO" | "CONCLUÍDO";
const OPEN_STATUS_SET = new Set<string>(OPEN_STATUSES);
const quickFilterCards: { key: StatusQuickFilter; label: string; icon: React.ReactNode }[] = [
  { key: "OPEN", label: "Tickets Abertos", icon: <Clock className="h-5 w-5 text-vp-yellow-dark" /> },
  { key: "COTAÇÃO", label: "Em Cotação", icon: <FileText className="h-5 w-5 text-vp-yellow-dark" /> },
  { key: "APROVAÇÃO", label: "Em Aprovação", icon: <AlertTriangle className="h-5 w-5 text-vp-yellow-dark" /> },
  { key: "CONCLUÍDO", label: "Concluídos", icon: <CheckCircle2 className="h-5 w-5 text-vp-yellow-dark" /> },
];
function matchesQuickFilter(status: string, filter: StatusQuickFilter): boolean {
  if (filter === "Todos") return true;
  if (filter === "OPEN") return OPEN_STATUS_SET.has(status);
  return status === filter;
}

function mapActionToDescription(action: string, details: Record<string, unknown>): string {
  const map: Record<string, string> = {
    GESTOR_APPROVED: "Aprovada pelo gestor",
    GESTOR_REJECTED: "Reprovada pelo gestor",
    REQUISITION_EDITED: "Requisição editada",
    QUOTATION_STARTED: "Cotação iniciada",
    WINNER_SELECTED: "Fornecedor vencedor selecionado",
    M2_QUOTE_COMPLETED: "Cotação de viagem concluída",
    APPROVAL_REQUESTED: "Enviada para aprovação",
    APPROVAL_GRANTED: "Aprovada",
    APPROVAL_REJECTED: "Reprovada",
    PURCHASE_CONFIRMED: "Compra confirmada",
    RECEIPT_REGISTERED: "Recebimento registrado",
  };
  const base = map[action] ?? action.replace(/_/g, " ").toLowerCase();
  const suppliersCount =
    typeof details.suppliers_count === "number" ? ` — ${details.suppliers_count} fornecedores` : "";
  const reason =
    action === "GESTOR_REJECTED" && typeof details.reason === "string"
      ? ` — motivo: ${details.reason}`
      : action === "APPROVAL_REJECTED" && typeof details.justification === "string" && details.justification
        ? ` — motivo: ${details.justification}`
        : "";
  return base + suppliersCount + reason;
}

const MODULE_LABELS: Record<string, string> = {
  M1: "Produto",
  M2: "Viagem",
  M3: "Serviço",
  M4: "Manutenção",
  M5: "Frete",
  M6: "Locação",
};

function StorageFileLink({
  path,
  bucket = "travel-docs",
  label,
}: {
  path: string;
  bucket?: string;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    setUrl(null);
    supabaseBrowser.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setUrl(data.signedUrl);
      });
  }, [path, bucket]);
  if (!url) return null;
  return (
    <div className="col-span-2 mt-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
      >
        📎 {label}
      </a>
    </div>
  );
}

function StoragePhoto({
  path,
  bucket = "travel-docs",
  alt,
}: {
  path: string;
  bucket?: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!path) return;
    setUrl(null);
    setLoaded(false);
    supabaseBrowser.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setUrl(data.signedUrl);
      });
  }, [path, bucket]);
  if (!url) return null;
  return (
    <div className="col-span-2 mt-1">
      {loaded && <p className="text-[10px] text-muted-foreground mb-1">{alt}</p>}
      <img
        src={url}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setUrl(null)}
        className={`max-w-full max-h-48 rounded-md border border-border object-contain ${loaded ? "" : "hidden"}`}
      />
    </div>
  );
}

function ModuleDataSection({ module, data }: { module: string; data: Record<string, unknown> }) {
  const f = (v: unknown) => (v != null && v !== "" ? String(v) : "—");
  const fDate = (v: unknown) => {
    if (typeof v !== "string" || !v) return "—";
    const [y, m, d] = v.slice(0, 10).split("-");
    return y && m && d ? `${d}/${m}/${y}` : v;
  };

  const rows: Array<{ label: string; value: string; full?: boolean }> = [];

  if (module === "M1") {
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
    if (items.length > 0) {
      // Multi-itens: antes o resumo (req.description) concatenava tudo com
      // "|" num parágrafo só — aqui cada produto vira uma linha da tabela.
      return (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
              M
            </span>
            {MODULE_LABELS[module] ?? module} — {items.length} item{items.length !== 1 ? "ns" : ""}
          </h3>
          {data.delivery_location != null && data.delivery_location !== "" && (
            <p className="text-[11px] text-muted-foreground">
              Local de Entrega: <span className="font-medium text-foreground">{f(data.delivery_location)}</span>
            </p>
          )}
          <Card className="p-0 overflow-hidden">
            <div className={excelTable.wrapper}>
              <div className="overflow-x-auto">
                <table className={excelTable.table}>
                  <thead className={excelTable.thead}>
                    <tr className={excelTable.headRow}>
                      <th className={cn(excelTable.th, "w-8")}>#</th>
                      <th className={excelTable.th}>Código</th>
                      <th className={excelTable.th}>Produto</th>
                      <th className={excelTable.th}>Descrição</th>
                      <th className={excelTable.thRight}>Qtd.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const details = [
                        it.technical_specs ? `Espec.: ${f(it.technical_specs)}` : null,
                        it.brand_preference ? `Marca: ${f(it.brand_preference)}` : null,
                        it.model_reference ? `Ref.: ${f(it.model_reference)}` : null,
                      ].filter(Boolean).join(" · ");
                      return (
                        <tr key={i} className={excelTable.row(i)}>
                          <td className={cn(excelTable.td, "text-muted-foreground")}>{i + 1}</td>
                          <td className={cn(excelTable.td, "font-mono text-foreground")}>{f(it.product_code)}</td>
                          <td className={cn(excelTable.td, "font-medium text-foreground")}>{f(it.product_name)}</td>
                          <td className={cn(excelTable.td, "text-foreground")}>
                            {f(it.description)}
                            {details && <p className="text-[10px] text-muted-foreground mt-0.5">{details}</p>}
                            {typeof it.photo_path === "string" && it.photo_path && (
                              <StoragePhoto path={it.photo_path} alt={`Foto — ${f(it.product_name)}`} />
                            )}
                          </td>
                          <td className={cn(excelTable.tdRight, "text-foreground")}>{f(it.quantity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      );
    }

    if (data.quantity) rows.push({ label: "Quantidade", value: f(data.quantity) });
    if (data.delivery_location)
      rows.push({ label: "Local de Entrega", value: f(data.delivery_location) });
    if (data.technical_specs)
      rows.push({ label: "Especificações Técnicas", value: f(data.technical_specs), full: true });
    if (data.brand_preference)
      rows.push({ label: "Marca Preferida", value: f(data.brand_preference) });
    if (data.model_reference) rows.push({ label: "Ref. Modelo", value: f(data.model_reference) });
    if (data.online_purchase_suggestion)
      rows.push({
        label: "Sugestão Online",
        value: f(data.online_purchase_suggestion),
        full: true,
      });
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
            M
          </span>
          {MODULE_LABELS[module] ?? module} — Dados do Formulário
        </h3>
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              {rows.map((r) => (
                <div key={r.label} className={r.full ? "col-span-2" : ""}>
                  <p className="text-[10px] text-muted-foreground">{r.label}</p>
                  <p className="font-medium text-foreground break-words">{r.value}</p>
                </div>
              ))}
              {typeof data.photo_path === "string" && data.photo_path && (
                <StoragePhoto path={data.photo_path} alt="Foto do Produto" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  } else if (module === "M2") {
    const TRANSPORT_LABELS: Record<string, string> = {
      AVIAO: "Avião",
      CARRO_EMPRESA: "Carro da Empresa",
      CARRO_PROPRIO: "Carro Próprio",
      ONIBUS: "Ônibus",
    };
    const PURPOSE_LABELS: Record<string, string> = {
      OBRA: "Obra",
      CURSO: "Curso",
      VISITA_CLIENTE: "Visita a Cliente",
      WORKSHOP: "Workshop",
      EVENTO_FEIRA: "Evento/Feira",
    };
    const FLIGHT_CLASS_LABELS: Record<string, string> = {
      ECONOMICA: "Econômica",
      EXECUTIVA: "Executiva",
    };
    const FLIGHT_TIME_LABELS: Record<string, string> = {
      QUALQUER: "Qualquer horário",
      MANHA: "Manhã (até 12h)",
      TARDE: "Tarde (12h às 18h)",
      NOITE: "Noite (após 18h)",
    };
    const FLIGHT_BAGGAGE_LABELS: Record<string, string> = {
      EQUIPAMENTO: "Equipamento",
      BAGAGEM_EXTRA: "Bagagem extra",
    };

    const tripRows: Array<{ label: string; value: string; full?: boolean }> = [];
    if (data.origin_city) tripRows.push({ label: "Origem", value: f(data.origin_city) });
    if (data.destination_city) tripRows.push({ label: "Destino", value: f(data.destination_city) });
    if (data.departure_date)
      tripRows.push({ label: "Data de Partida", value: fDate(data.departure_date) });
    if (data.return_date)
      tripRows.push({ label: "Data de Retorno", value: fDate(data.return_date) });
    if (data.duration_days != null)
      tripRows.push({ label: "Duração", value: `${f(data.duration_days)} dia(s)` });
    if (data.transport_mode) {
      tripRows.push({
        label: "Meio de Transporte",
        value: TRANSPORT_LABELS[data.transport_mode as string] ?? f(data.transport_mode),
      });
    }
    if (data.transport_mode === "AVIAO") {
      if (data.flight_class)
        tripRows.push({
          label: "Classe",
          value: FLIGHT_CLASS_LABELS[data.flight_class as string] ?? f(data.flight_class),
        });
      if (data.flight_time_preference)
        tripRows.push({
          label: "Horário Preferido",
          value:
            FLIGHT_TIME_LABELS[data.flight_time_preference as string] ??
            f(data.flight_time_preference),
        });
      const baggage = data.flight_baggage as string[] | undefined;
      if (baggage?.length)
        tripRows.push({
          label: "Bagagem Especial",
          value: baggage.map((b) => FLIGHT_BAGGAGE_LABELS[b] ?? b).join(", "),
        });
    }
    if (data.needs_hotel)
      tripRows.push({ label: "Hotel", value: `${f(data.hotel_nights)} noite(s)` });
    if (data.needs_local_car)
      tripRows.push({ label: "Carro no Destino", value: `${f(data.car_rental_days)} dia(s)` });
    const purposes = data.purposes as string[] | undefined;
    if (purposes?.length)
      tripRows.push({
        label: "Objetivo",
        value: purposes.map((p) => PURPOSE_LABELS[p] ?? p).join(", "),
        full: true,
      });
    if (data.project_number)
      tripRows.push({ label: "Número da Obra", value: f(data.project_number) });

    const tripDetails = tripRows.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
            M
          </span>
          {MODULE_LABELS[module]} — Dados da Viagem
        </h3>
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              {tripRows.map((r) => (
                <div key={r.label} className={r.full ? "col-span-2" : ""}>
                  <p className="text-[10px] text-muted-foreground">{r.label}</p>
                  <p className="font-medium text-foreground break-words">{r.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );

    const travelers = data.travelers as Array<Record<string, unknown>> | undefined;
    if (travelers?.length) {
      return (
        <div className="space-y-3">
          {tripDetails}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
                M
              </span>
              {MODULE_LABELS[module]} — {travelers.length} viajante
              {travelers.length !== 1 ? "s" : ""}
            </h3>
            <div className="space-y-2">
              {travelers.map((t, i) => {
                const photoPath = (t.docPhotoPath ?? t.doc_photo_path) as string | undefined;
                return (
                  <Card key={i}>
                    <CardContent className="p-3">
                      <p className="text-xs font-semibold text-foreground">
                        {i + 1}. {f(t.fullName)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {f(t.docType)}: {f(t.docNumber)}
                      </p>
                      {photoPath && (
                        <div className="mt-2">
                          <StoragePhoto path={photoPath} alt={`Documento — ${f(t.fullName)}`} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    if (tripDetails) return tripDetails;
    if (data.traveler_name) rows.push({ label: "Viajante", value: f(data.traveler_name) });
  } else if (module === "M5") {
    if (data.project_number) rows.push({ label: "Número da Obra", value: f(data.project_number) });
    if (data.cargo_description)
      rows.push({ label: "Descrição da Carga", value: f(data.cargo_description), full: true });
    if (data.receiver_name || data.receiver_phone) {
      rows.push({
        label: "Recebedor da Carga",
        value: `${f(data.receiver_name)} — ${f(data.receiver_phone)}`,
        full: true,
      });
    }
    if (data.unloading_location)
      rows.push({
        label: "Local de Descarregamento",
        value: f(data.unloading_location),
        full: true,
      });
    if (data.unloading_date)
      rows.push({ label: "Data da Descarga", value: fDate(data.unloading_date) });
    if (data.allowed_schedule)
      rows.push({ label: "Horário Permitido", value: f(data.allowed_schedule) });
    if (data.access_restriction)
      rows.push({ label: "Restrição de Acesso", value: f(data.access_restriction), full: true });
    if (data.needs_city_hall_authorization)
      rows.push({ label: "Autorização da Prefeitura", value: "Necessária" });
    if (data.cargo_photo_description)
      rows.push({ label: "Obs. da Foto", value: f(data.cargo_photo_description), full: true });
    const cargoPics = data.cargo_photos_paths as string[] | undefined;
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
            M
          </span>
          {MODULE_LABELS[module] ?? module} — Dados do Formulário
        </h3>
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              {rows.map((r) => (
                <div key={r.label} className={r.full ? "col-span-2" : ""}>
                  <p className="text-[10px] text-muted-foreground">{r.label}</p>
                  <p className="font-medium text-foreground break-words">{r.value}</p>
                </div>
              ))}
              {typeof data.cargo_photo_path === "string" && data.cargo_photo_path && (
                <StoragePhoto path={data.cargo_photo_path} alt="Foto do Local de Descarga" />
              )}
              {cargoPics?.map((path, i) => (
                <StoragePhoto key={path} path={path} alt={`Foto da Carga ${i + 1}`} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (module === "M6") {
    const cats = data.categories as string[] | undefined;
    if (cats?.length) rows.push({ label: "Categorias", value: cats.join(" + "), full: true });
    if (data.quantity) rows.push({ label: "Quantidade", value: f(data.quantity) });
    if (data.project_number) rows.push({ label: "Número da Obra", value: f(data.project_number) });
    if (data.rental_days) rows.push({ label: "Dias de Locação", value: f(data.rental_days) });
    if (data.start_date) rows.push({ label: "Início", value: f(data.start_date) });
    if (data.end_date) rows.push({ label: "Término", value: f(data.end_date) });
    if (data.delivery_location)
      rows.push({ label: "Local de Entrega", value: f(data.delivery_location), full: true });
    if (data.specs) rows.push({ label: "Especificações", value: f(data.specs), full: true });
    if (data.needs_art) {
      const ART_STATUS_LABELS: Record<string, string> = {
        EMITIR: "Precisa emitir",
        TEMOS: "Já existe",
        NAO_SEI: "Não informado",
      };
      rows.push({ label: "ART", value: ART_STATUS_LABELS[data.art_status as string] ?? "—" });
      rows.push({
        label: "Indução de Segurança",
        value: data.needs_security_induction ? "Exigida" : "Não exigida",
      });
    }
  }

  if (!rows.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
          M
        </span>
        {MODULE_LABELS[module] ?? module} — Dados do Formulário
      </h3>
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            {rows.map((r) => (
              <div key={r.label} className={r.full ? "col-span-2" : ""}>
                <p className="text-[10px] text-muted-foreground">{r.label}</p>
                <p className="font-medium text-foreground break-words">{r.value}</p>
              </div>
            ))}
            {module === "M6" &&
              typeof data.client_norm_path === "string" &&
              data.client_norm_path && (
                <StorageFileLink path={data.client_norm_path} label="Norma específica do cliente" />
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MovimentacoesPage() {
  const { session, user, hasRole } = useAuth();
  const router = useRouter();
  const isAdmin = hasRole("admin");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  const [stageFilter, setStageFilter] = useState("Todos");
  const [slaFilter, setSlaFilter] = useState("Todos");
  const [statusQuickFilter, setStatusQuickFilter] = useState<StatusQuickFilter>("Todos");
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [overview, setOverview] = useState<LogsPayload | null>(null);
  const [entriesLimit, setEntriesLimit] = useState(200);
  const [logsLoading, setLogsLoading] = useState(true);
  const [liveDetail, setLiveDetail] = useState<LiveTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { ticket: ticketParam, module: moduleParam } = Route.useSearch();

  // Deep-link: /movimentacoes?ticket=M1-000105 chega com a busca já preenchida
  // e o detalhe do ticket aberto (usado pelo Monitor SLA e por outras telas).
  useEffect(() => {
    if (!ticketParam) return;
    setSearch(ticketParam);
    setSelectedTicket(ticketParam);
  }, [ticketParam]);

  // Deep-link: /movimentacoes?module=M1 chega com o filtro de módulo já
  // aplicado — usado pelo drill-down do Analytics (métrica → tickets).
  useEffect(() => {
    if (!moduleParam) return;
    setModuleFilter(moduleParam);
  }, [moduleParam]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const fetchOverview = async (silent: boolean) => {
      if (!silent) setLogsLoading(true);
      try {
        const payload = await getLogsOverview({ data: { entriesLimit } });
        if (!cancelled) setOverview(payload);
      } catch (err) {
        console.error("[logs]", err);
      } finally {
        if (!silent && !cancelled) setLogsLoading(false);
      }
    };
    void fetchOverview(false);
    const interval = setInterval(() => void fetchOverview(true), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session, entriesLimit]);

  // Fetch full ticket detail from DB when user opens the side panel
  useEffect(() => {
    if (!selectedTicket || !session) {
      setLiveDetail(null);
      return;
    }
    (async () => {
      setDetailLoading(true);
      setLiveDetail(null);
      try {
        const { data: req } = await supabaseBrowser
          .from("requisitions")
          .select(
            "id,ticket_number,module,status,title,description,justification,requester_name,requester_department,created_at,completed_at,module_data,edition",
          )
          .eq("ticket_number", selectedTicket)
          .maybeSingle();

        if (!req) return;

        const [{ data: quot }, { data: appr }, { data: purch }, { data: rec }, { data: logs }] =
          await Promise.all([
            supabaseBrowser
              .from("quotations")
              .select(
                "id,win_criteria,status,quotation_suppliers(id,supplier_name,price,deadline,notes,proposal_received,is_winner)",
              )
              .eq("requisition_id", req.id)
              .maybeSingle(),
            supabaseBrowser
              .from("approvals")
              .select("decision,approval_level,total_value,justification,decided_at")
              .eq("requisition_id", req.id)
              .maybeSingle(),
            supabaseBrowser
              .from("purchases")
              .select(
                "supplier_name,supplier_price,purchase_order_number,payment_method,purchased_at",
              )
              .eq("requisition_id", req.id)
              .maybeSingle(),
            supabaseBrowser
              .from("receipts")
              .select("condition,deliverer_name,notes,received_at")
              .eq("requisition_id", req.id)
              .maybeSingle(),
            supabaseBrowser
              .from("audit_logs")
              .select("id,action,actor_name,details,created_at")
              .eq("ticket_number", selectedTicket)
              .order("created_at", { ascending: true }),
          ]);

        const suppliersRaw = (quot?.quotation_suppliers ?? []) as Array<{
          id: string;
          supplier_name: string;
          price: number | null;
          deadline: string | null;
          notes: string | null;
          proposal_received: boolean;
          is_winner: boolean;
        }>;

        setLiveDetail({
          ticket_id: req.ticket_number,
          requisition_id: req.id,
          edition: (req.edition as number | undefined) ?? 1,
          module: req.module,
          status: req.status,
          title: req.title,
          description: req.description,
          justification: req.justification,
          requester_name: req.requester_name,
          requester_department: req.requester_department ?? null,
          created_at: new Date(req.created_at).toLocaleString("pt-BR"),
          completed_at: req.completed_at
            ? new Date(req.completed_at).toLocaleString("pt-BR")
            : null,
          suppliers: suppliersRaw.map((s) => ({
            id: s.id,
            name: s.supplier_name,
            price: s.price,
            deadline: s.deadline,
            notes: s.notes,
            proposal_received: s.proposal_received,
            is_winner: s.is_winner,
          })),
          win_criteria: quot?.win_criteria ?? null,
          approval_decision: appr?.decision ?? null,
          approval_level: appr?.approval_level ?? null,
          approval_value: appr?.total_value ?? null,
          approval_decided_at: appr?.decided_at
            ? new Date(appr.decided_at).toLocaleString("pt-BR")
            : null,
          approval_justification: appr?.justification ?? null,
          purchase_supplier: purch?.supplier_name ?? null,
          purchase_price: purch?.supplier_price ?? null,
          purchase_order_number: purch?.purchase_order_number ?? null,
          payment_method: purch?.payment_method ?? null,
          purchased_at: purch?.purchased_at
            ? new Date(purch.purchased_at).toLocaleString("pt-BR")
            : null,
          receipt_condition: rec?.condition ?? null,
          deliverer_name: rec?.deliverer_name ?? null,
          received_at: rec?.received_at ? new Date(rec.received_at).toLocaleString("pt-BR") : null,
          receipt_notes: rec?.notes ?? null,
          ticket_audit_logs: (logs ?? []).map((l) => ({
            id: l.id,
            action: l.action,
            actor_name: l.actor_name ?? null,
            details: (l.details ?? {}) as Record<string, unknown>,
            created_at: new Date(l.created_at).toLocaleString("pt-BR"),
          })),
          module_data: (req.module_data ?? null) as Record<string, unknown> | null,
        });
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [selectedTicket, session]);

  const auditEntries = overview?.entries ?? [];
  const ticketMeta = overview?.ticketMeta ?? {};
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTicketId, setExportTicketId] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [exportIncludeMetadata, setExportIncludeMetadata] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResponse | null>(null);

  // ticketId "__ALL__" exporta todos os eventos filtrados (sem PDF, que é por ticket)
  const handleOpenExport = (ticketId: string) => {
    setExportTicketId(ticketId);
    setExportFormat(ticketId === "__ALL__" ? "CSV" : "PDF");
    setExportIncludeMetadata(true);
    setExportResult(null);
    setExportDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!liveDetail || !user) return;
    setDeleteLoading(true);
    try {
      await deleteRequisitionClient(liveDetail.requisition_id, user.id);
      toast.success(`Requisição ${liveDetail.ticket_id} excluída.`);
      setDeleteConfirmOpen(false);
      setSelectedTicket(null);
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              entries: prev.entries.filter((e) => e.ticket !== liveDetail.ticket_id),
              activeTickets: prev.activeTickets.filter((t) => t.ticket !== liveDetail.ticket_id),
              bottlenecks: prev.bottlenecks.filter((b) => b.ticket !== liveDetail.ticket_id),
            }
          : prev,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir requisição.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleNavigateEdit = () => {
    if (!liveDetail) return;
    const route = MODULE_ROUTES[liveDetail.module];
    if (!route) return;
    setSelectedTicket(null);
    void router.navigate({ to: route, search: { edit: liveDetail.ticket_id } });
  };

  /** Motivo da recusa — busca no histórico o evento de reprovação (gestor ou
   * alçada) para o requisitante entender o que precisa corrigir antes de
   * reenviar. GESTOR_REJECTED guarda o motivo em details.reason; a reprovação
   * de alçada (V3) já vem em approval_justification. */
  const rejectionEvent = liveDetail?.ticket_audit_logs.find((l) => l.action === "GESTOR_REJECTED");
  const rejectionReason =
    liveDetail?.status === "REJEITADO"
      ? liveDetail.approval_justification ||
        (typeof rejectionEvent?.details.reason === "string" ? rejectionEvent.details.reason : null)
      : null;
  const rejectedBy = rejectionEvent
    ? rejectionEvent.actor_name
    : liveDetail?.approval_decision === "rejected"
      ? "Aprovador da alçada"
      : null;

  const handleExport = async () => {
    if (!exportTicketId) return;
    setExportLoading(true);

    const now = new Date();
    const isAll = exportTicketId === "__ALL__";
    // Use liveDetail when it matches the export ticket (opened from detail panel)
    const richDetail = !isAll && liveDetail?.ticket_id === exportTicketId ? liveDetail : null;
    const ticketEntries = isAll
      ? filtered
      : auditEntries.filter((e) => e.ticket === exportTicketId);

    const fmtPrice = (v: number | null) =>
      v != null ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";

    let content: string;
    let mimeType: string;
    let ext: string;

    if (exportFormat === "JSON") {
      ext = "json";
      mimeType = "application/json;charset=utf-8";
      if (richDetail) {
        content = JSON.stringify(
          {
            exportado_em: now.toISOString(),
            ticket: richDetail.ticket_id,
            modulo: richDetail.module,
            status: richDetail.status,
            titulo: richDetail.title,
            descricao: richDetail.description,
            justificativa: richDetail.justification,
            requisitante: richDetail.requester_name,
            departamento: richDetail.requester_department,
            criado_em: richDetail.created_at,
            concluido_em: richDetail.completed_at,
            dados_formulario: richDetail.module_data ?? null,
            cotacao: {
              fornecedores: richDetail.suppliers.map((s) => ({
                nome: s.name,
                preco: fmtPrice(s.price),
                prazo: s.deadline,
                proposta_recebida: s.proposal_received,
                vencedor: s.is_winner,
                observacoes: s.notes,
              })),
              criterio_vencedor: richDetail.win_criteria,
            },
            aprovacao: richDetail.approval_decision
              ? {
                  decisao: richDetail.approval_decision,
                  nivel: richDetail.approval_level,
                  valor: fmtPrice(richDetail.approval_value),
                  data: richDetail.approval_decided_at,
                  justificativa: richDetail.approval_justification,
                }
              : null,
            compra: richDetail.purchase_supplier
              ? {
                  fornecedor: richDetail.purchase_supplier,
                  valor: fmtPrice(richDetail.purchase_price),
                  numero_pedido: richDetail.purchase_order_number,
                  forma_pagamento: richDetail.payment_method,
                  data: richDetail.purchased_at,
                }
              : null,
            recebimento: richDetail.receipt_condition
              ? {
                  condicao: richDetail.receipt_condition,
                  entregador: richDetail.deliverer_name,
                  data: richDetail.received_at,
                  observacoes: richDetail.receipt_notes,
                }
              : null,
            historico: richDetail.ticket_audit_logs.map((l) => ({
              acao: l.action,
              responsavel: l.actor_name,
              data: l.created_at,
              detalhes: l.details,
            })),
          },
          null,
          2,
        );
      } else {
        const rows = ticketEntries.map((e) => ({
          ticket: e.ticket,
          modulo: e.module,
          etapa: e.stage,
          acao: e.action,
          descricao: e.description,
          requisitante: ticketMeta[e.ticket]?.requester ?? "—",
          titulo: ticketMeta[e.ticket]?.title ?? "—",
          responsavel: e.actor,
          data: new Date(e.createdAt).toLocaleString("pt-BR"),
        }));
        content = JSON.stringify(
          {
            ticket: isAll ? "todos (filtro atual)" : exportTicketId,
            exportado_em: now.toISOString(),
            eventos: rows,
          },
          null,
          2,
        );
      }
    } else if (exportFormat === "CSV") {
      ext = "csv";
      mimeType = "text/csv;charset=utf-8";
      if (richDetail) {
        const rows: string[] = [
          "Secao;Campo;Valor",
          `Requisicao;Ticket;${richDetail.ticket_id}`,
          `Requisicao;Titulo;${richDetail.title}`,
          `Requisicao;Requisitante;${richDetail.requester_name}`,
          `Requisicao;Departamento;${richDetail.requester_department ?? "—"}`,
          `Requisicao;Status;${richDetail.status}`,
          `Requisicao;Criado em;${richDetail.created_at}`,
          `Requisicao;Concluido em;${richDetail.completed_at ?? "—"}`,
          ...richDetail.suppliers.map(
            (s) =>
              `Cotacao;Fornecedor;${s.name};Preco;${s.price != null ? s.price.toFixed(2) : "—"};Vencedor;${s.is_winner ? "SIM" : "NAO"};Proposta;${s.proposal_received ? "Recebida" : "Pendente"}`,
          ),
          richDetail.win_criteria ? `Cotacao;Criterio Vencedor;${richDetail.win_criteria}` : "",
          richDetail.approval_decision
            ? `Aprovacao;Decisao;${richDetail.approval_decision};Nivel;${richDetail.approval_level ?? "—"};Valor;${richDetail.approval_value?.toFixed(2) ?? "—"};Data;${richDetail.approval_decided_at ?? "—"}`
            : "",
          richDetail.purchase_supplier
            ? `Compra;Fornecedor;${richDetail.purchase_supplier};Valor;${richDetail.purchase_price?.toFixed(2) ?? "—"};Pedido;${richDetail.purchase_order_number ?? "—"};Data;${richDetail.purchased_at ?? "—"}`
            : "",
          richDetail.receipt_condition
            ? `Recebimento;Condicao;${richDetail.receipt_condition};Entregador;${richDetail.deliverer_name ?? "—"};Data;${richDetail.received_at ?? "—"}`
            : "",
          ...richDetail.ticket_audit_logs.map(
            (l) =>
              `Historico;Acao;${l.action};Responsavel;${l.actor_name ?? "Sistema"};Data;${l.created_at}`,
          ),
        ].filter(Boolean);
        content = rows.join("\n");
      } else {
        const header = "Ticket;Modulo;Etapa;Acao;Descricao;Requisitante;Titulo;Responsavel;Data\n";
        const rows = ticketEntries
          .map(
            (e) =>
              `${e.ticket};${e.module};${e.stage};${e.action};${e.description};${ticketMeta[e.ticket]?.requester ?? "—"};${ticketMeta[e.ticket]?.title ?? "—"};${e.actor};${new Date(e.createdAt).toLocaleString("pt-BR")}`,
          )
          .join("\n");
        content = header + rows;
      }
    } else {
      // PDF gerado no navegador e salvo no Supabase Storage (apenas por ticket)
      if (isAll) {
        toast.error("PDF é gerado por ticket. Use CSV ou JSON para exportar a lista filtrada.");
        setExportLoading(false);
        return;
      }
      try {
        const { blob, signedUrl } = await generateAndSaveRequisitionPdf(exportTicketId);
        const blobUrl = URL.createObjectURL(blob);
        const filename = `vpreq-${exportTicketId}-${now.toISOString().slice(0, 10)}.pdf`;
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        setExportResult({
          download_url: signedUrl,
          expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
          file_size_bytes: blob.size,
          generated_at: now.toISOString(),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao gerar PDF");
      }
      setExportLoading(false);
      return;
    }

    const blob = new Blob(["﻿" + content], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const filename = `auditoria-${exportTicketId}-${now.toISOString().slice(0, 10)}.${ext}`;

    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);

    setExportResult({
      download_url: blobUrl,
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      file_size_bytes: blob.size,
      generated_at: now.toISOString(),
    });
    setExportLoading(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filtered = auditEntries.filter((e) => {
    if (moduleFilter !== "Todos" && e.module !== moduleFilter) return false;
    if (stageFilter !== "Todos" && e.stage !== stageFilter) return false;
    if (slaFilter !== "Todos" && e.slaStatus !== slaFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const meta = ticketMeta[e.ticket];
      return (
        e.ticket.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.actorDept.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (meta?.requester ?? "").toLowerCase().includes(q) ||
        (meta?.title ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by ticket for timeline view
  const grouped = filtered.reduce<Record<string, LogsEntry[]>>((acc, entry) => {
    if (!acc[entry.ticket]) acc[entry.ticket] = [];
    acc[entry.ticket].push(entry);
    return acc;
  }, {});

  const ticketIds = Object.keys(grouped).filter((id) =>
    matchesQuickFilter(ticketMeta[id]?.status ?? "", statusQuickFilter),
  );

  // Contagens do conjunto completo de tickets (não só os eventos carregados)
  // pros cards de resumo — os mesmos números que antes só existiam, estáticos,
  // no Dashboard.
  const quickFilterCounts: Record<StatusQuickFilter, number> = { Todos: 0, OPEN: 0, COTAÇÃO: 0, APROVAÇÃO: 0, CONCLUÍDO: 0 };
  Object.values(ticketMeta).forEach((meta) => {
    if (OPEN_STATUS_SET.has(meta.status)) quickFilterCounts.OPEN++;
    if (meta.status === "COTAÇÃO") quickFilterCounts["COTAÇÃO"]++;
    if (meta.status === "APROVAÇÃO") quickFilterCounts["APROVAÇÃO"]++;
    if (meta.status === "CONCLUÍDO") quickFilterCounts["CONCLUÍDO"]++;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <ScrollText className="h-5 w-5 text-vp-yellow-dark" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Movimentações</h1>
          <p className="text-sm text-muted-foreground">
            O que aconteceu com cada requisição — trilha imutável de eventos
          </p>
        </div>
      </div>

      {logsLoading && !overview && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
        </div>
      )}

      {/* Resumo — clicável, filtra a lista abaixo pelo status atual do ticket */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickFilterCards.map((c) => {
            const active = statusQuickFilter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatusQuickFilter(active ? "Todos" : c.key)}
                className="text-left"
              >
                <Card
                  className={`card-hover-yellow transition-colors ${active ? "border-vp-yellow ring-1 ring-vp-yellow" : ""}`}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                      {c.icon}
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{quickFilterCounts[c.key]}</p>
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters & Timeline */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por ticket, ação, ator, departamento..."
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
                {moduleOptions.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o === "Todos" ? "Módulo" : o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full sm:w-[130px]">
                <ArrowRight className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Etapa" />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o === "Todos" ? "Etapa" : o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={slaFilter} onValueChange={setSlaFilter}>
              <SelectTrigger className="w-full sm:w-[130px]">
                <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="SLA" />
              </SelectTrigger>
              <SelectContent>
                {slaOptions.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o === "Todos"
                      ? "SLA"
                      : o === "ok"
                        ? "No prazo"
                        : o === "warning"
                          ? "Atenção"
                          : "Excedido"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handleOpenExport("__ALL__")}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Timeline grouped by ticket */}
      <div className="space-y-3">
        {ticketIds.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <ScrollText className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">Nenhum registro encontrado.</p>
            </CardContent>
          </Card>
        )}

        {ticketIds.map((ticketId) => {
          const entries = grouped[ticketId];
          const isExpanded = expandedTicket === ticketId;
          const worstSla: SlaStatus = entries.some((e) => e.slaStatus === "breach")
            ? "breach"
            : entries.some((e) => e.slaStatus === "warning")
              ? "warning"
              : "ok";
          // entries chegam em ordem decrescente — o primeiro é o evento mais recente
          const lastEntry = entries[0];
          const meta = ticketMeta[ticketId];

          return (
            <Card key={ticketId} className="card-hover-yellow">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setExpandedTicket(isExpanded ? null : ticketId)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent shrink-0">
                    <FileText className="h-4 w-4 text-vp-yellow-dark" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {ticketId}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {MODULE_LABELS[lastEntry.module] ?? lastEntry.module}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {entries.length} {entries.length === 1 ? "ação" : "ações"}
                      </Badge>
                      {slaBadge(worstSla)}
                    </div>
                    {meta && (
                      <>
                        <p className="text-sm text-foreground font-medium truncate mt-0.5">
                          {meta.title}
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            — {meta.requester}
                          </span>
                        </p>
                        {(() => {
                          const pendency = pendencyOf(meta.status, meta.module);
                          return (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium mt-0.5 ${PENDENCY_TONE_CLASS[pendency.tone]}`}
                            >
                              {pendency.tone === "action" && <Clock className="h-3 w-3 shrink-0" />}
                              {pendency.tone === "done" && (
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                              )}
                              {pendency.tone === "blocked" && (
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                              )}
                              {pendency.label}
                            </span>
                          );
                        })()}
                      </>
                    )}
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">
                        Último evento: {lastEntry.description}
                      </p>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                        <Clock className="h-3 w-3" />
                        {new Date(lastEntry.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 pb-4">
                  {/* Ticket detail button */}
                  <div className="flex justify-end mt-3 mb-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTicket(ticketId);
                      }}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Ver detalhes do ticket
                    </Button>
                  </div>
                  <div className="relative ml-6 mt-2 space-y-0">
                    {/* Vertical timeline line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

                    {[...entries].reverse().map((entry, idx) => {
                      const status = entry.slaStatus;
                      return (
                        <div key={entry.id} className="relative pl-8 pb-5 last:pb-0">
                          {/* Timeline dot */}
                          <div
                            className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 ${
                              status === "breach"
                                ? "border-red-400 bg-red-100"
                                : status === "warning"
                                  ? "border-amber-400 bg-amber-100"
                                  : "border-emerald-400 bg-emerald-100"
                            }`}
                          />

                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-[10px]">
                                {entry.stage}
                              </Badge>
                              <span className="text-sm font-semibold text-foreground">
                                {entry.description}
                              </span>
                              {slaBadge(status)}
                            </div>

                            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {entry.actor}
                                {entry.actorRole !== "—" ? ` (${entry.actorRole})` : ""}
                              </span>
                              {entry.actorDept !== "—" && (
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {entry.actorDept}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(entry.createdAt).toLocaleString("pt-BR")}
                              </span>
                              <span className="flex items-center gap-1">
                                <Hourglass className="h-3 w-3" />
                                Tempo na etapa: {formatSla(entry.elapsedHours)}
                              </span>
                            </div>
                          </div>

                          {/* Flow arrow between entries */}
                          {idx < entries.length - 1 && (
                            <div className="flex items-center gap-1 mt-2 ml-0 text-[10px] text-muted-foreground">
                              <ArrowRight className="h-3 w-3" />
                              <span>Próxima etapa</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        {overview && overview.totalEntries > auditEntries.length && (
          <div className="flex justify-center pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setEntriesLimit((l) => l + 200)}
            >
              Carregar mais eventos ({auditEntries.length} de {overview.totalEntries})
            </Button>
          </div>
        )}
      </div>

      {/* Ticket Detail Sheet */}
      <Sheet open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {/* Radix exige um título acessível enquanto o Sheet está aberto —
              nos estados de carregamento/não-encontrado o título "rico" ainda
              não existe, então um título oculto (só para leitor de tela)
              cobre esses momentos transitórios. */}
          {(detailLoading || !liveDetail) && (
            <SheetHeader className="sr-only">
              <SheetTitle>
                {detailLoading ? "Carregando detalhes do ticket" : `Ticket ${selectedTicket} não encontrado`}
              </SheetTitle>
            </SheetHeader>
          )}

          {/* Loading state */}
          {detailLoading && (
            <div className="flex items-center justify-center h-48 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Carregando detalhes...</span>
            </div>
          )}

          {/* Not found */}
          {!detailLoading && !liveDetail && selectedTicket && (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm">Ticket não encontrado</p>
              <p className="text-xs font-mono">{selectedTicket}</p>
            </div>
          )}

          {/* Rich detail */}
          {!detailLoading && liveDetail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{liveDetail.ticket_id}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {liveDetail.module}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      ["CONCLUÍDO", "RECEBIMENTO"].includes(liveDetail.status)
                        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                        : ["REJEITADO", "CANCELADO"].includes(liveDetail.status)
                          ? "bg-red-100 text-red-700 border-red-200"
                          : "bg-blue-100 text-blue-700 border-blue-200"
                    }`}
                  >
                    {liveDetail.status}
                  </Badge>
                  {liveDetail.edition > 1 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
                    >
                      {liveDetail.edition}ª Edição
                    </Badge>
                  )}
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-5 mt-6">
                {/* Recusa — por que parou e o que fazer pra reenviar */}
                {liveDetail.status === "REJEITADO" && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Requisição reprovada{rejectedBy ? ` por ${rejectedBy}` : ""}
                    </div>
                    <p className="text-xs text-red-900">
                      {rejectionReason || "Nenhum motivo foi registrado para esta reprovação."}
                    </p>
                    {MODULE_ROUTES[liveDetail.module] && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800"
                        onClick={handleNavigateEdit}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Corrigir a pendência e reenviar
                      </Button>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => handleOpenExport(liveDetail.ticket_id)}
                  >
                    <FileDown className="h-4 w-4" />
                    Exportar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={handleNavigateEdit}
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  )}
                </div>

                {/* V1 — Requisição */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold">
                      V1
                    </span>
                    Requisição
                  </h3>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{liveDetail.title}</p>
                      {!(liveDetail.module === "M1" && Array.isArray((liveDetail.module_data as Record<string, unknown> | null)?.items) && ((liveDetail.module_data as Record<string, unknown>).items as unknown[]).length > 0) && (
                        <p className="text-xs text-muted-foreground">{liveDetail.description}</p>
                      )}
                      {liveDetail.justification && (
                        <p className="text-xs bg-muted/50 rounded px-2 py-1 text-muted-foreground">
                          <span className="font-medium text-foreground">Justificativa:</span>{" "}
                          {liveDetail.justification}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Requisitante</p>
                          <p className="font-medium">{liveDetail.requester_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Departamento</p>
                          <p className="font-medium">{liveDetail.requester_department ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Criado em</p>
                          <p className="font-medium">{liveDetail.created_at}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">
                            {liveDetail.completed_at ? "Concluído em" : "Status"}
                          </p>
                          <p className="font-medium">
                            {liveDetail.completed_at ?? liveDetail.status}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Module Data */}
                {liveDetail.module_data && Object.keys(liveDetail.module_data).length > 0 && (
                  <ModuleDataSection module={liveDetail.module} data={liveDetail.module_data} />
                )}

                {/* V2 — Cotação */}
                {liveDetail.suppliers.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">
                        V2
                      </span>
                      Cotação — {liveDetail.suppliers.length} fornecedor
                      {liveDetail.suppliers.length !== 1 ? "es" : ""}
                    </h3>
                    <div className="space-y-2">
                      {liveDetail.suppliers.map((s) => (
                        <Card
                          key={s.id}
                          className={s.is_winner ? "border-emerald-300 bg-emerald-50/30" : ""}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-foreground">
                                {s.name}
                              </span>
                              {s.is_winner && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  <Check className="h-3 w-3" />
                                  Vencedor
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span>
                                Preço:{" "}
                                <span
                                  className={`font-semibold ${s.is_winner ? "text-emerald-700" : "text-foreground"}`}
                                >
                                  {s.price != null
                                    ? `R$ ${s.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                    : "—"}
                                </span>
                              </span>
                              <span>
                                Prazo:{" "}
                                <span className="font-medium text-foreground">
                                  {s.deadline ?? "—"}
                                </span>
                              </span>
                              <span>
                                Proposta:{" "}
                                <span className="font-medium text-foreground">
                                  {s.proposal_received ? "Recebida" : "Pendente"}
                                </span>
                              </span>
                            </div>
                            {s.notes && (
                              <p className="text-[10px] text-muted-foreground mt-1 italic">
                                {s.notes}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                      {liveDetail.win_criteria && (
                        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
                          <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>
                            <span className="font-semibold">Critério:</span>{" "}
                            {liveDetail.win_criteria}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* V3 — Aprovação */}
                {liveDetail.approval_decision && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-purple-100 text-purple-700 text-[9px] font-bold">
                        V3
                      </span>
                      Aprovação
                    </h3>
                    <Card
                      className={
                        liveDetail.approval_decision === "approved"
                          ? "border-emerald-200"
                          : liveDetail.approval_decision === "rejected"
                            ? "border-red-200"
                            : ""
                      }
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-foreground">
                            Nível {liveDetail.approval_level ?? "—"}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              liveDetail.approval_decision === "approved"
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : liveDetail.approval_decision === "rejected"
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {liveDetail.approval_decision === "approved"
                              ? "Aprovado"
                              : liveDetail.approval_decision === "rejected"
                                ? "Rejeitado"
                                : "Pendente"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Valor:{" "}
                            <span className="font-semibold text-foreground">
                              {liveDetail.approval_value != null
                                ? `R$ ${liveDetail.approval_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                : "—"}
                            </span>
                          </span>
                          <span>
                            Data:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.approval_decided_at ?? "—"}
                            </span>
                          </span>
                        </div>
                        {liveDetail.approval_justification && (
                          <p className="text-[10px] text-muted-foreground mt-1.5 italic">
                            {liveDetail.approval_justification}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* V4 — Compra */}
                {liveDetail.purchase_supplier && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold">
                        V4
                      </span>
                      Compra
                    </h3>
                    <Card>
                      <CardContent className="p-3">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="col-span-2">
                            Fornecedor:{" "}
                            <span className="font-semibold text-foreground">
                              {liveDetail.purchase_supplier}
                            </span>
                          </span>
                          <span>
                            Valor:{" "}
                            <span className="font-semibold text-foreground">
                              {liveDetail.purchase_price != null
                                ? `R$ ${liveDetail.purchase_price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                : "—"}
                            </span>
                          </span>
                          <span>
                            Pagamento:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.payment_method ?? "—"}
                            </span>
                          </span>
                          <span>
                            Nº Pedido:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.purchase_order_number ?? "—"}
                            </span>
                          </span>
                          <span>
                            Data:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.purchased_at ?? "—"}
                            </span>
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* V5 — Recebimento */}
                {liveDetail.receipt_condition && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold">
                        V5
                      </span>
                      Recebimento
                    </h3>
                    <Card
                      className={
                        liveDetail.receipt_condition === "ok"
                          ? "border-emerald-200"
                          : liveDetail.receipt_condition === "damaged"
                            ? "border-red-200"
                            : "border-amber-200"
                      }
                    >
                      <CardContent className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] mb-2 ${
                            liveDetail.receipt_condition === "ok"
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : liveDetail.receipt_condition === "damaged"
                                ? "bg-red-100 text-red-700 border-red-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                          }`}
                        >
                          {liveDetail.receipt_condition === "ok"
                            ? "OK — Conforme"
                            : liveDetail.receipt_condition === "damaged"
                              ? "Danificado"
                              : "Divergente"}
                        </Badge>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Entregador:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.deliverer_name ?? "—"}
                            </span>
                          </span>
                          <span>
                            Data:{" "}
                            <span className="font-medium text-foreground">
                              {liveDetail.received_at ?? "—"}
                            </span>
                          </span>
                        </div>
                        {liveDetail.receipt_notes && (
                          <p className="text-[10px] text-muted-foreground mt-1 italic">
                            {liveDetail.receipt_notes}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Histórico de Ações */}
                {liveDetail.ticket_audit_logs.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Histórico de Ações
                    </h3>
                    <div className="relative space-y-0">
                      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                      {liveDetail.ticket_audit_logs.map((log) => (
                        <div key={log.id} className="relative pl-7 pb-4 last:pb-0">
                          <div className="absolute left-0 top-1 h-[14px] w-[14px] rounded-full border-2 border-blue-400 bg-blue-100" />
                          <div>
                            <span className="text-xs font-semibold text-foreground">
                              {mapActionToDescription(log.action, log.details)}
                            </span>
                            <div className="flex items-center gap-2.5 mt-0.5 text-[10px] text-muted-foreground">
                              <span>{log.actor_name ?? "Sistema"}</span>
                              <span>{log.created_at}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Excluir Requisição
            </DialogTitle>
            <DialogDescription>
              Esta ação é irreversível. A requisição{" "}
              <span className="font-mono font-semibold">{liveDetail?.ticket_id}</span> e todos os
              dados associados (cotações, aprovações, compras, recebimentos) serão permanentemente
              excluídos.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteLoading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              {deleteLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Excluir Definitivamente
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="h-5 w-5" />
              Exportar Auditoria
            </DialogTitle>
            <DialogDescription>
              {exportTicketId === "__ALL__" ? (
                <>Todos os eventos do filtro atual ({filtered.length})</>
              ) : (
                <>
                  Ticket: <span className="font-mono font-semibold">{exportTicketId}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {!exportResult ? (
            <div className="space-y-5 mt-2">
              {/* Format Selection */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Formato
                </Label>
                <RadioGroup
                  value={exportFormat}
                  onValueChange={(v) => setExportFormat(v as ExportFormat)}
                  className="grid grid-cols-3 gap-3"
                >
                  {[
                    { value: "PDF" as const, icon: FileText, label: "PDF" },
                    { value: "CSV" as const, icon: FileSpreadsheet, label: "CSV" },
                    { value: "JSON" as const, icon: FileJson, label: "JSON" },
                  ]
                    .filter((opt) => exportTicketId !== "__ALL__" || opt.value !== "PDF")
                    .map((opt) => (
                      <Label
                        key={opt.value}
                        htmlFor={`fmt-${opt.value}`}
                        className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 cursor-pointer transition-all hover:border-[var(--vp-yellow)] ${
                          exportFormat === opt.value
                            ? "border-[var(--vp-yellow)] bg-accent"
                            : "border-border"
                        }`}
                      >
                        <RadioGroupItem
                          value={opt.value}
                          id={`fmt-${opt.value}`}
                          className="sr-only"
                        />
                        <opt.icon className="h-6 w-6 text-muted-foreground" />
                        <span className="text-sm font-medium">{opt.label}</span>
                      </Label>
                    ))}
                </RadioGroup>
              </div>

              {/* Options */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-metadata"
                  checked={exportIncludeMetadata}
                  onCheckedChange={(v) => setExportIncludeMetadata(!!v)}
                />
                <Label htmlFor="include-metadata" className="text-sm cursor-pointer">
                  Incluir metadados (transições, responsáveis, motivos)
                </Label>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <p>🔒 Nenhum dado financeiro será incluído na exportação.</p>
                <p className="mt-1">📋 Idioma: Português (pt-BR)</p>
              </div>

              <Button className="w-full gap-2" onClick={handleExport} disabled={exportLoading}>
                {exportLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando arquivo...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Gerar Exportação
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              {/* Success State */}
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
                <p className="text-sm font-medium text-foreground">Arquivo gerado com sucesso!</p>
              </div>

              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Formato</span>
                    <span className="font-medium">{exportFormat}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tamanho</span>
                    <span className="font-medium">
                      {formatFileSize(exportResult.file_size_bytes)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gerado em</span>
                    <span className="font-medium">
                      {new Date(exportResult.generated_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expira em</span>
                    <span className="font-medium">
                      {new Date(exportResult.expires_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = exportResult.download_url;
                    a.download = `auditoria-${exportTicketId}.${exportFormat === "JSON" ? "json" : exportFormat === "CSV" ? "csv" : "txt"}`;
                    a.click();
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Baixar Arquivo
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setExportResult(null)}>
                  Nova Exportação
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

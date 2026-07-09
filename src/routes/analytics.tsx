import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getAnalytics, type AnalyticsPayload } from "@/features/analytics/api";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Package,
  Target,
  Timer,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Zap,
  RotateCcw,
} from "lucide-react";
import { Download, FileText, FileSpreadsheet, GitCompareArrows, Filter } from "lucide-react";
import { Loader2, Check, OctagonAlert } from "lucide-react";
import { Radio, Bell, ShoppingCart, AlertCircle, UserCheck, Trophy, FileEdit, PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — VPRequisições" },
      {
        name: "description",
        content: "Métricas, SLA e indicadores de desempenho do sistema de requisições",
      },
    ],
  }),
  component: AnalyticsPage,
});

/* ────────────────────────────────────────────────
 *  Configs de gráfico (cores por módulo)
 * ──────────────────────────────────────────────── */

const volumeChartConfig: ChartConfig = {
  M1: { label: "Produtos", color: "#3B82F6" },
  M2: { label: "Viagens", color: "#10B981" },
  M3: { label: "Serviços", color: "#8B5CF6" },
  M4: { label: "Manutenção", color: "#F59E0B" },
  M5: { label: "Frete", color: "#EF4444" },
  M6: { label: "Locação", color: "#06B6D4" },
};

const pieChartConfig: ChartConfig = {
  Produtos: { label: "Produtos", color: "#3B82F6" },
  Viagens: { label: "Viagens", color: "#10B981" },
  Serviços: { label: "Serviços", color: "#8B5CF6" },
  Manutenção: { label: "Manutenção", color: "#F59E0B" },
  Frete: { label: "Frete", color: "#EF4444" },
  Locação: { label: "Locação", color: "#06B6D4" },
};

const stageBarConfig: ChartConfig = {
  avg: { label: "Média (h)", color: "#3B82F6" },
  target: { label: "Meta (h)", color: "#E5E7EB" },
};

const slaTrendConfig: ChartConfig = { compliance_rate: { label: "Compliance %", color: "#F5A623" } };
const savingsChartConfig: ChartConfig = {
  original: { label: "Proposta mais cara", color: "#E5E7EB" },
  final: { label: "Valor contratado", color: "#3B82F6" },
};
const levelChartConfig: ChartConfig = { count: { label: "Aprovações", color: "#F5A623" } };

const PERIOD_LABELS: Record<string, string> = {
  "30d": "Últimos 30 dias", "3m": "Últimos 3 meses", "6m": "Últimos 6 meses", "12m": "Últimos 12 meses",
};

/* ────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────── */

function SLAGauge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
        Sem dados no período
      </div>
    );
  }
  const color = value >= 95 ? "#10B981" : value >= 85 ? "#F59E0B" : "#EF4444";
  const label = value >= 95 ? "Excelente" : value >= 85 ? "Atenção" : "Crítico";
  const gaugeData = [{ value, fill: color }];
  const gaugeConfig: ChartConfig = { value: { label: "SLA", color } };

  return (
    <div className="flex flex-col items-center">
      <ChartContainer config={gaugeConfig} className="h-[160px] w-[160px] aspect-square">
        <RadialBarChart
          innerRadius={55}
          outerRadius={75}
          startAngle={180}
          endAngle={180 - (value / 100) * 360}
          data={gaugeData}
          cx="50%"
          cy="50%"
        >
          <RadialBar dataKey="value" cornerRadius={8} background />
        </RadialBarChart>
      </ChartContainer>
      <div className="text-center -mt-20">
        <span className="text-3xl font-bold text-foreground">{value}%</span>
        <Badge
          variant="outline"
          className="ml-2 text-[10px]"
          style={{ borderColor: color, color }}
        >
          {label}
        </Badge>
      </div>
    </div>
  );
}

function DeltaLine({ delta, unit, invert, compareLabel }: { delta: number | null; unit: string; invert?: boolean; compareLabel: string | null }) {
  if (delta == null || compareLabel == null) {
    return <p className="text-xs text-muted-foreground mt-1">no período selecionado</p>;
  }
  const positiveIsGood = !invert;
  const isGood = delta === 0 ? true : delta > 0 === positiveIsGood;
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex items-center gap-1 mt-1">
      <Icon className={`h-3 w-3 ${isGood ? "text-emerald-500" : "text-red-500"}`} />
      <span className={`text-xs font-medium ${isGood ? "text-emerald-600" : "text-red-500"}`}>
        {delta > 0 ? "+" : ""}{delta}{unit}
      </span>
      <span className="text-xs text-muted-foreground">{compareLabel}</span>
    </div>
  );
}

const fmtBRL = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `R$ ${(v / 1_000).toFixed(1)}K`
    : `R$ ${v.toLocaleString("pt-BR")}`;

const relativeTime = (iso: string) => {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const FEED_META: Record<string, { label: string; icon: typeof Package; bg: string; fg: string; badge: string }> = {
  SUBMITTED: { label: "Nova Requisição", icon: Package, bg: "bg-blue-100", fg: "text-blue-600", badge: "bg-blue-50 text-blue-600 border-blue-200" },
  GESTOR_APPROVED: { label: "Aprovada pelo Gestor", icon: UserCheck, bg: "bg-amber-100", fg: "text-amber-700", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  GESTOR_REJECTED: { label: "Reprovada pelo Gestor", icon: AlertCircle, bg: "bg-red-100", fg: "text-red-600", badge: "bg-red-50 text-red-600 border-red-200" },
  QUOTATION_STARTED: { label: "Cotação Iniciada", icon: FileText, bg: "bg-purple-100", fg: "text-purple-600", badge: "bg-purple-50 text-purple-600 border-purple-200" },
  WINNER_SELECTED: { label: "Vencedor Selecionado", icon: Trophy, bg: "bg-yellow-100", fg: "text-yellow-700", badge: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  M2_QUOTE_COMPLETED: { label: "Cotação de Viagem", icon: FileText, bg: "bg-purple-100", fg: "text-purple-600", badge: "bg-purple-50 text-purple-600 border-purple-200" },
  APPROVAL_REQUESTED: { label: "Enviada p/ Aprovação", icon: Bell, bg: "bg-orange-100", fg: "text-orange-600", badge: "bg-orange-50 text-orange-600 border-orange-200" },
  APPROVAL_GRANTED: { label: "Aprovada", icon: CheckCircle2, bg: "bg-emerald-100", fg: "text-emerald-600", badge: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  APPROVAL_REJECTED: { label: "Reprovada", icon: AlertCircle, bg: "bg-red-100", fg: "text-red-600", badge: "bg-red-50 text-red-600 border-red-200" },
  PURCHASE_CONFIRMED: { label: "Compra Confirmada", icon: ShoppingCart, bg: "bg-emerald-100", fg: "text-emerald-600", badge: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  RECEIPT_REGISTERED: { label: "Recebimento", icon: PackageCheck, bg: "bg-cyan-100", fg: "text-cyan-700", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  REQUISITION_EDITED: { label: "Requisição Editada", icon: FileEdit, bg: "bg-slate-100", fg: "text-slate-600", badge: "bg-slate-50 text-slate-600 border-slate-200" },
};

/* ────────────────────────────────────────────────
 *  Page Component
 * ──────────────────────────────────────────────── */

function AnalyticsPage() {
  const { session } = useAuth();
  const [period, setPeriod] = useState<"30d" | "3m" | "6m" | "12m">("3m");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  const [compareMode, setCompareMode] = useState<"none" | "previous_period" | "same_period_last_year">("none");
  const [activeTab, setActiveTab] = useState<"executive" | "sla" | "financial" | "operational">("executive");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportReportType, setExportReportType] = useState<"executive" | "sla" | "financial" | "operational">("executive");
  const [exportFormat, setExportFormat] = useState<"PDF" | "Excel" | "CSV">("PDF");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const payload = await getAnalytics({ data: { period, module: moduleFilter, compare: compareMode } });
      setData(payload);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("[analytics]", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period, moduleFilter, compareMode]);

  useEffect(() => {
    if (!session) return;
    void fetchData();
  }, [session, fetchData]);

  // Atualização periódica real (60s), sem piscar a tela
  const fetchRef = useRef(fetchData);
  fetchRef.current = fetchData;
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => void fetchRef.current(true), 60_000);
    return () => clearInterval(interval);
  }, [session]);

  const compareLabel = compareMode === "previous_period"
    ? "vs período anterior"
    : compareMode === "same_period_last_year" ? "vs ano anterior" : null;

  /* ── Export com dados reais ── */
  const buildRows = useCallback((): { header: string[]; rows: (string | number)[][]; title: string } => {
    const d = data!;
    if (exportReportType === "executive") {
      return {
        title: "Relatório Executivo",
        header: ["Período", "M1 Produtos", "M2 Viagens", "M3 Serviços", "M4 Manutenção", "M5 Frete", "M6 Locação"],
        rows: d.volumeTrend.map((r) => [r.month, r.M1, r.M2, r.M3, r.M4, r.M5, r.M6] as (string | number)[]),
      };
    }
    if (exportReportType === "sla") {
      return {
        title: "Relatório de SLA",
        header: ["Estágio", "Média (h)", "Mediana (h)", "P95 (h)", "Meta (h)", "Amostras"],
        rows: d.stageDuration.map((s) => [s.label, s.avg, s.median, s.p95, s.target, s.count]),
      };
    }
    if (exportReportType === "financial") {
      return {
        title: "Relatório Financeiro",
        header: ["Módulo", "Valor Comprado R$", "% do Gasto", "Qtd Compras"],
        rows: d.financial.spendByModule.map((c) => [c.label, c.value, c.pct, c.count]),
      };
    }
    return {
      title: "Relatório Operacional",
      header: ["Comprador", "Compras", "Valor Total R$"],
      rows: d.topBuyers.map((b) => [b.name, b.purchases, b.totalValue]),
    };
  }, [data, exportReportType]);

  const handleExportGenerate = async () => {
    if (!data) return;
    setExportLoading(true);
    try {
      const { header, rows, title } = buildRows();
      const now = new Date();
      const baseName = `vprequisicoes-${exportReportType}-${now.toISOString().slice(0, 10)}`;

      if (exportFormat === "PDF") {
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text(`VPRequisições — ${title}`, 14, 18);
        doc.setFontSize(9);
        doc.text(`Período: ${PERIOD_LABELS[period]} · Módulo: ${moduleFilter} · Gerado em ${now.toLocaleString("pt-BR")}`, 14, 25);
        doc.setFontSize(10);
        let y = 36;
        const colW = 180 / header.length;
        doc.setFont("helvetica", "bold");
        header.forEach((h, i) => doc.text(String(h), 14 + i * colW, y, { maxWidth: colW - 2 }));
        doc.setFont("helvetica", "normal");
        y += 7;
        for (const row of rows) {
          if (y > 280) { doc.addPage(); y = 20; }
          row.forEach((cell, i) => {
            const text = typeof cell === "number" ? cell.toLocaleString("pt-BR") : String(cell);
            doc.text(text, 14 + i * colW, y, { maxWidth: colW - 2 });
          });
          y += 6;
        }
        doc.save(`${baseName}.pdf`);
        setExportDone(`${baseName}.pdf`);
      } else {
        const sep = exportFormat === "CSV" ? "," : "\t";
        const q = (v: string | number) => {
          const s = typeof v === "number" ? String(v) : v;
          return exportFormat === "CSV" ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const content = [header.map(q).join(sep), ...rows.map((r) => r.map(q).join(sep))].join("\r\n");
        const ext = exportFormat === "CSV" ? "csv" : "xls";
        const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setExportDone(`${baseName}.${ext}`);
      }
    } finally {
      setExportLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <AlertTriangle className="h-8 w-8" />
        <p className="text-sm">Não foi possível carregar as métricas.</p>
        <Button variant="outline" size="sm" onClick={() => void fetchData()}>Tentar novamente</Button>
      </div>
    );
  }

  const { kpis, slaBreakdown } = data;
  const slaTotalOpen = slaBreakdown.onTime + slaBreakdown.atRisk + slaBreakdown.exceeded;
  const activeModules = moduleFilter === "Todos" ? (["M1", "M2", "M3", "M4", "M5", "M6"] as const) : ([moduleFilter] as const);

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <BarChart3 className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Métricas, SLA e indicadores de desempenho
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[120px]">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Todos", "M1", "M2", "M3", "M4", "M5", "M6"].map((m) => (
                <SelectItem key={m} value={m}>{m === "Todos" ? "Todos Módulos" : m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="3m">Últimos 3 meses</SelectItem>
              <SelectItem value="6m">Últimos 6 meses</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
          <Select value={compareMode} onValueChange={(v) => setCompareMode(v as typeof compareMode)}>
            <SelectTrigger className="w-[160px]">
              <GitCompareArrows className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Comparar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem comparação</SelectItem>
              <SelectItem value="previous_period">Período anterior</SelectItem>
              <SelectItem value="same_period_last_year">Mesmo período ano anterior</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setExportDone(null); setExportOpen(true); }}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
        </div>
      </div>

      {/* Comparison banner */}
      {compareMode !== "none" && (
        <Card className="border-dashed border-[var(--vp-yellow)]">
          <CardContent className="p-3 flex items-center gap-3">
            <GitCompareArrows className="h-4 w-4 text-vp-yellow-dark shrink-0" />
            <p className="text-xs text-muted-foreground">
              Comparando com{" "}
              <span className="font-medium text-foreground">
                {compareMode === "previous_period" ? "o período anterior de mesma duração" : "o mesmo período do ano anterior"}
              </span>
              {" · "}Variações calculadas sobre os dados reais.
            </p>
            <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setCompareMode("none")}>
              Remover
            </button>
          </CardContent>
        </Card>
      )}

      {/* View Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="executive">Executivo</TabsTrigger>
          <TabsTrigger value="sla">SLA</TabsTrigger>
          <TabsTrigger value="financial">Financeiro</TabsTrigger>
          <TabsTrigger value="operational">Operacional</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Atualizando métricas...
        </div>
      )}

      {/* KPI Row — always visible */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="card-hover-yellow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Total Requisições</p>
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">
              {kpis.totalReqs.toLocaleString("pt-BR")}
            </p>
            <DeltaLine delta={kpis.totalReqsDelta} unit="%" compareLabel={compareLabel} />
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Tempo Médio Ciclo</p>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">
              {kpis.avgCycleHours != null
                ? `${Math.floor(kpis.avgCycleHours / 24)}d ${kpis.avgCycleHours % 24}h`
                : "—"}
            </p>
            <DeltaLine delta={kpis.avgCycleDeltaHours} unit="h" invert compareLabel={compareLabel} />
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Compliance SLA</p>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">
              {kpis.slaCompliance != null ? `${kpis.slaCompliance}%` : "—"}
            </p>
            <DeltaLine delta={kpis.slaComplianceDelta} unit="pp" compareLabel={compareLabel} />
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Taxa Aprovação</p>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">
              {kpis.approvalRate != null ? `${kpis.approvalRate}%` : "—"}
            </p>
            <DeltaLine delta={kpis.approvalRateDelta} unit="pp" compareLabel={compareLabel} />
          </CardContent>
        </Card>
      </div>

      {/* Volume Trend + SLA Gauge */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Volume de Requisições</CardTitle>
            <p className="text-xs text-muted-foreground">
              {PERIOD_LABELS[period]}{moduleFilter !== "Todos" ? ` · ${moduleFilter}` : " por módulo"}
            </p>
          </CardHeader>
          <CardContent>
            <ChartContainer config={volumeChartConfig} className="h-[280px] w-full">
              <AreaChart data={data.volumeTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} className="fill-muted-foreground" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {activeModules.map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={volumeChartConfig[key].color}
                    fill={volumeChartConfig[key].color}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Compliance SLA Geral</CardTitle>
            <p className="text-xs text-muted-foreground">Meta: ≥ 95% · etapas concluídas dentro do prazo</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pt-4">
            <SLAGauge value={kpis.slaCompliance} />
            <div className="w-full mt-6 space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                Requisições em andamento ({slaTotalOpen})
              </p>
              {[
                { label: "No prazo", value: slaBreakdown.onTime, color: "#10B981" },
                { label: "Em risco", value: slaBreakdown.atRisk, color: "#F59E0B" },
                { label: "Excedido", value: slaBreakdown.exceeded, color: "#EF4444" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                  <span className="text-muted-foreground flex-1">{item.label}</span>
                  <span className="font-medium text-foreground">{item.value}</span>
                  <span className="text-muted-foreground">
                    ({slaTotalOpen > 0 ? Math.round((item.value / slaTotalOpen) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Module Distribution + Stage Duration */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Distribuição por Módulo</CardTitle>
            <p className="text-xs text-muted-foreground">{PERIOD_LABELS[period]}</p>
          </CardHeader>
          <CardContent>
            {data.moduleDist.every((m) => m.value === 0) ? (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                Sem requisições no período
              </div>
            ) : (
              <ChartContainer config={pieChartConfig} className="h-[250px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={data.moduleDist.filter((m) => m.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {data.moduleDist.filter((m) => m.value > 0).map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Duração por Estágio</CardTitle>
            <p className="text-xs text-muted-foreground">Média real vs Meta (horas)</p>
          </CardHeader>
          <CardContent>
            <ChartContainer config={stageBarConfig} className="h-[250px] w-full">
              <BarChart
                data={data.stageDuration}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={80}
                  className="fill-muted-foreground"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="target" fill="#E5E7EB" radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey="avg" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* SLA by Module + Aprovações por Alçada */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">SLA por Módulo</CardTitle>
            <p className="text-xs text-muted-foreground">Compliance % das etapas concluídas no período</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.slaByModule.map((mod) => {
              if (mod.compliance == null) {
                return (
                  <div key={mod.module} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{mod.module} — {mod.label}</span>
                      <span className="text-muted-foreground">sem dados</span>
                    </div>
                    <Progress value={0} className="h-2" />
                  </div>
                );
              }
              const color =
                mod.compliance >= 90 ? "text-emerald-600" : mod.compliance >= 80 ? "text-amber-600" : "text-red-600";
              const bg =
                mod.compliance >= 90
                  ? "[&>div]:bg-emerald-500"
                  : mod.compliance >= 80
                    ? "[&>div]:bg-amber-500"
                    : "[&>div]:bg-red-500";
              return (
                <div key={mod.module} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {mod.module} — {mod.label}
                    </span>
                    <span className={`font-semibold ${color}`}>{mod.compliance}%</span>
                  </div>
                  <Progress value={mod.compliance} className={`h-2 ${bg}`} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Aprovações por Alçada</CardTitle>
            <p className="text-xs text-muted-foreground">Decisões no período, por nível</p>
          </CardHeader>
          <CardContent>
            {data.approvalsByLevel.every((l) => l.count === 0) ? (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                Nenhuma decisão de aprovação no período
              </div>
            ) : (
              <>
                <ChartContainer config={levelChartConfig} className="h-[190px] w-full">
                  <BarChart data={data.approvalsByLevel.map((l) => ({ ...l, label: `${l.level}ª Alçada` }))} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} className="fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="#F5A623" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ChartContainer>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {data.approvalsByLevel.map((l) => (
                    <div key={l.level} className="rounded-lg border p-2">
                      <p className="text-[10px] text-muted-foreground">{l.level}ª Alçada</p>
                      <p className="text-xs font-bold text-foreground">{fmtBRL(l.totalValue)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quality + Efficiency + Top Buyers (Executive) */}
      {activeTab === "executive" && (
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Qualidade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Taxa de Aprovação", value: data.quality.approvalRate != null ? `${data.quality.approvalRate}%` : "—", icon: CheckCircle2 },
              { label: "Requisições Reprovadas", value: String(data.quality.rejectedCount), icon: AlertTriangle },
              { label: "Requisições Editadas", value: String(data.quality.editedCount), icon: RotateCcw },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
                  <m.icon className="h-4 w-4 text-vp-yellow-dark" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-bold text-foreground">{m.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Eficiência</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Compras Concluídas", value: String(data.efficiency.purchasesCount) },
              { label: "Cotações Concluídas", value: String(data.efficiency.quotationsCompleted) },
              { label: "Tempo Médio de Cotação", value: data.efficiency.avgQuotationHours != null ? `${data.efficiency.avgQuotationHours}h` : "—" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
                  <Zap className="h-4 w-4 text-vp-yellow-dark" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-bold text-foreground">{m.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="card-hover-yellow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Compradores</CardTitle>
            <p className="text-xs text-muted-foreground">Por compras no período</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topBuyers.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhuma compra no período.</p>
            )}
            {data.topBuyers.map((b, i) => (
              <div key={b.name} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-4">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {b.purchases} compra(s) · {fmtBRL(b.totalValue)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      )}

      {/* ═══ SLA TAB ═══ */}
      {activeTab === "sla" && (
        <div className="space-y-4">
          <Card className="card-hover-yellow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tendência SLA</CardTitle>
              <p className="text-xs text-muted-foreground">Compliance % últimos 6 meses (dados reais)</p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={slaTrendConfig} className="h-[250px] w-full">
                <LineChart data={data.slaTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="compliance_rate" stroke="#F5A623" strokeWidth={3} dot={{ r: 5, fill: "#F5A623" }} connectNulls />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Duração por Estágio (detalhada)</CardTitle>
                <p className="text-xs text-muted-foreground">Média · Mediana · P95 vs Meta — {PERIOD_LABELS[period]}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.stageDuration.filter((s) => s.count > 0).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Nenhuma etapa concluída no período.</p>
                )}
                {data.stageDuration.filter((s) => s.count > 0).map((s) => (
                  <div key={s.stage} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{s.label} ({s.count})</span>
                      <span className={s.p95 > s.target ? "text-red-500 font-semibold" : "text-emerald-600 font-semibold"}>
                        P95: {s.p95}h {s.p95 > s.target ? "⚠" : "✓"}
                      </span>
                    </div>
                    <div className="flex gap-4 text-[10px] text-muted-foreground">
                      <span>Média: {s.avg}h</span><span>Mediana: {s.median}h</span><span>Meta: {s.target}h</span>
                    </div>
                    <Progress value={Math.min((s.avg / s.target) * 100, 100)} className="h-1.5" />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <OctagonAlert className="h-4 w-4 text-red-500" />
                  Gargalos Ativos
                </CardTitle>
                <p className="text-xs text-muted-foreground">{data.bottlenecks.length} requisição(ões) acima da meta do estágio atual</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.bottlenecks.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Nenhum gargalo ativo. 🎉</p>
                )}
                {data.bottlenecks.map((b) => (
                  <div key={b.ticket} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-foreground">{b.ticket}</span>
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                        {b.hours}h / {b.target}h meta
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{b.stage} · Solicitante: {b.requester}</p>
                    <Progress value={Math.min((b.hours / b.target) * 100, 100)} className="h-1 [&>div]:bg-red-500" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══ FINANCIAL TAB ═══ */}
      {activeTab === "financial" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Valor Aprovado", value: fmtBRL(data.financial.approvedTotal) },
              { label: "Valor Comprado", value: fmtBRL(data.financial.purchasedTotal) },
              { label: "Economia em Cotações", value: fmtBRL(data.financial.savings) },
              { label: "% Economia", value: data.financial.savingsPct != null ? `${data.financial.savingsPct}%` : "—", highlight: true },
            ].map((item) => (
              <Card key={item.label} className="card-hover-yellow">
                <CardContent className="p-4">
                  <p className="text-[10px] text-muted-foreground font-medium">{item.label}</p>
                  <p className={`text-lg font-bold mt-1 ${item.highlight ? "text-emerald-600" : "text-foreground"}`}>{item.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Economia Mensal em Cotações</CardTitle>
                <p className="text-xs text-muted-foreground">Proposta mais cara vs valor contratado</p>
              </CardHeader>
              <CardContent>
                {data.financial.monthlySavings.every((m) => m.original === 0) ? (
                  <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                    Nenhuma cotação com múltiplas propostas no período
                  </div>
                ) : (
                  <ChartContainer config={savingsChartConfig} className="h-[220px] w-full">
                    <BarChart data={data.financial.monthlySavings} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} className="fill-muted-foreground" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="original" fill="#E5E7EB" radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar dataKey="final" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={20} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Gasto por Módulo</CardTitle>
                <p className="text-xs text-muted-foreground">Compras confirmadas no período</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.financial.spendByModule.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Nenhuma compra no período.</p>
                )}
                {data.financial.spendByModule.map((c) => (
                  <div key={c.module} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{c.module} — {c.label} · {c.count} compra(s)</span>
                      <span className="font-medium text-foreground">{fmtBRL(c.value)} ({c.pct}%)</span>
                    </div>
                    <Progress value={c.pct} className="h-1.5" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <Card className="card-hover-yellow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top Fornecedores</CardTitle>
              <p className="text-xs text-muted-foreground">Por valor comprado no período</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.financial.topSuppliers.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhuma compra no período.</p>
              )}
              {data.financial.topSuppliers.map((s, i) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground">{s.count} pedido(s) · {fmtBRL(s.value)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══ OPERATIONAL TAB ═══ */}
      {activeTab === "operational" && (
        <div className="space-y-4">
          <Card className="card-hover-yellow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Produtividade por Comprador</CardTitle>
              <p className="text-xs text-muted-foreground">Compras confirmadas — {PERIOD_LABELS[period]}</p>
            </CardHeader>
            <CardContent>
              {data.topBuyers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-4 text-center">Nenhuma compra no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 font-medium">Comprador</th>
                        <th className="text-right py-2 font-medium">Compras</th>
                        <th className="text-right py-2 font-medium">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topBuyers.map((b) => (
                        <tr key={b.name} className="border-b border-border/50 hover:bg-accent/50">
                          <td className="py-2 font-medium text-foreground">{b.name}</td>
                          <td className="py-2 text-right text-foreground">{b.purchases}</td>
                          <td className="py-2 text-right text-foreground">{fmtBRL(b.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Métricas por Estágio</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={stageBarConfig} className="h-[250px] w-full">
                  <BarChart data={data.stageDuration} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={80} className="fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="target" fill="#E5E7EB" radius={[0, 4, 4, 0]} barSize={14} />
                    <Bar dataKey="avg" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={14} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card className="card-hover-yellow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <OctagonAlert className="h-4 w-4 text-red-500" />
                  Gargalos Operacionais
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.bottlenecks.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Nenhum gargalo ativo. 🎉</p>
                )}
                {data.bottlenecks.map((b) => (
                  <div key={b.ticket} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-foreground">{b.ticket}</span>
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                        {Math.round((b.hours / b.target) * 100)}% da meta
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{b.stage} · {b.requester} · {b.hours}h no estágio</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>

    {/* ═══ Atividade Recente (dados reais, atualização a cada 60s) ═══ */}
    <div className="max-w-6xl mx-auto mt-6 space-y-4">
      <Card className="card-hover-yellow overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-accent/30">
            <div className="relative flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-500" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <span className="text-xs font-semibold text-foreground">Hoje</span>
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              Atualiza a cada 60s
            </Badge>
            {lastRefresh && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                Atualizado {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border">
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Requisições Hoje</p>
              <p className="text-lg font-bold text-foreground">{data.live.reqsToday}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Valor Aprovado Hoje</p>
              <p className="text-lg font-bold text-foreground">{fmtBRL(data.live.valueApprovedToday)}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Gargalos Ativos</p>
              <p className={`text-lg font-bold ${data.live.activeBottlenecks > 3 ? "text-red-500" : "text-foreground"}`}>{data.live.activeBottlenecks}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">SLA Compliance</p>
              <p className={`text-lg font-bold ${data.live.slaCompliance == null || data.live.slaCompliance >= 85 ? "text-foreground" : "text-red-500"}`}>
                {data.live.slaCompliance != null ? `${data.live.slaCompliance}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="card-hover-yellow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-vp-yellow-dark" />
            Feed de Eventos
          </CardTitle>
          <p className="text-xs text-muted-foreground">Últimos eventos reais registrados no sistema</p>
        </CardHeader>
        <CardContent>
          {data.feed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mb-2" />
              <p className="text-xs">Nenhum evento registrado ainda.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {data.feed.map((evt) => {
                const meta = FEED_META[evt.action] ?? {
                  label: evt.action.replace(/_/g, " "), icon: Activity,
                  bg: "bg-slate-100", fg: "text-slate-600", badge: "bg-slate-50 text-slate-600 border-slate-200",
                };
                const Icon = meta.icon;
                return (
                  <div key={evt.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.bg}`}>
                      <Icon className={`h-3.5 w-3.5 ${meta.fg}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {evt.ticket && (
                          <span className="text-xs font-mono font-bold text-foreground">{evt.ticket}</span>
                        )}
                        <Badge variant="outline" className={`text-[9px] ${meta.badge}`}>{meta.label}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {evt.actor ? `${evt.actor} · ` : ""}{new Date(evt.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(evt.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    {/* Export Dialog */}
    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar Relatório
          </DialogTitle>
          <DialogDescription>
            Gera um arquivo com os dados reais exibidos no período selecionado
          </DialogDescription>
        </DialogHeader>
        {!exportDone ? (
          <div className="space-y-5 mt-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo de Relatório</Label>
              <RadioGroup value={exportReportType} onValueChange={(v) => setExportReportType(v as typeof exportReportType)} className="grid grid-cols-2 gap-2">
                {[
                  { value: "executive" as const, label: "Executivo" },
                  { value: "sla" as const, label: "SLA" },
                  { value: "financial" as const, label: "Financeiro" },
                  { value: "operational" as const, label: "Operacional" },
                ].map((opt) => (
                  <Label key={opt.value} htmlFor={`rt-${opt.value}`} className={`flex items-center gap-2 rounded-lg border-2 p-3 cursor-pointer transition-all hover:border-[var(--vp-yellow)] ${exportReportType === opt.value ? "border-[var(--vp-yellow)] bg-accent" : "border-border"}`}>
                    <RadioGroupItem value={opt.value} id={`rt-${opt.value}`} className="sr-only" />
                    <span className="text-sm">{opt.label}</span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formato</Label>
              <RadioGroup value={exportFormat} onValueChange={(v) => setExportFormat(v as typeof exportFormat)} className="grid grid-cols-3 gap-2">
                {[
                  { value: "PDF" as const, icon: FileText },
                  { value: "Excel" as const, icon: FileSpreadsheet },
                  { value: "CSV" as const, icon: FileSpreadsheet },
                ].map((opt) => (
                  <Label key={opt.value} htmlFor={`ef-${opt.value}`} className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 cursor-pointer transition-all hover:border-[var(--vp-yellow)] ${exportFormat === opt.value ? "border-[var(--vp-yellow)] bg-accent" : "border-border"}`}>
                    <RadioGroupItem value={opt.value} id={`ef-${opt.value}`} className="sr-only" />
                    <opt.icon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs font-medium">{opt.value}</span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              📋 Período: {PERIOD_LABELS[period]} · Módulo: {moduleFilter === "Todos" ? "Todos" : moduleFilter}
            </div>
            <Button className="w-full gap-2" onClick={() => void handleExportGenerate()} disabled={exportLoading}>
              {exportLoading ? (<><Loader2 className="h-4 w-4 animate-spin" />Gerando...</>) : (<><Download className="h-4 w-4" />Gerar Relatório</>)}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-foreground">Relatório baixado!</p>
              <p className="text-xs text-muted-foreground font-mono">{exportDone}</p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setExportDone(null)}>Novo Relatório</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

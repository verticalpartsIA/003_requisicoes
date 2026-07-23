import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/features/auth/auth-context";
import {
  Clock,
  CheckCircle2,
  Timer,
  User,
  Hourglass,
  OctagonAlert,
  Bell,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLogsOverview, type LogsPayload } from "@/features/logs/api";

/* A investigação (busca, trilha de eventos, detalhe do ticket, exportação)
 * vive na tela Movimentações (/movimentacoes). Esta tela é só o monitor:
 * métricas por etapa, gargalos e tickets ativos — clicar num ticket abre
 * a Movimentações já filtrada nele (?ticket=). */

export const Route = createFileRoute("/logs")({
  head: () => ({
    meta: [
      { title: "Monitor SLA — VPRequisições" },
      {
        name: "description",
        content: "Métricas por etapa, gargalos e tickets ativos com SLA em tempo real",
      },
    ],
  }),
  component: LogsPage,
});

type SlaStatus = "ok" | "warning" | "breach";

/* ── Helpers ── */

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

function metricColor(status: SlaStatus) {
  if (status === "ok") return "text-emerald-600";
  if (status === "warning") return "text-amber-500";
  return "text-red-500";
}

function LogsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<LogsPayload | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [activeStatusFilter, setActiveStatusFilter] = useState<
    "all" | "on_track" | "at_risk" | "breached"
  >("all");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const fetchOverview = async (silent: boolean) => {
      if (!silent) setLogsLoading(true);
      try {
        // O monitor não usa a lista de eventos (fica na Movimentações);
        // limite mínimo só para reduzir o payload.
        const payload = await getLogsOverview({ data: { entriesLimit: 1 } });
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
  }, [session]);

  const abrirMovimentacoes = (ticket: string) => {
    void router.navigate({ to: "/movimentacoes", search: { ticket, module: undefined } });
  };

  const filteredActive = (overview?.activeTickets ?? []).filter(
    (t) => activeStatusFilter === "all" || t.slaStatus === activeStatusFilter,
  );

  const stageMetrics = overview?.stageMetrics ?? [];
  const liveBottlenecks = overview?.bottlenecks ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <Timer className="h-5 w-5 text-vp-yellow-dark" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Monitor SLA</h1>
          <p className="text-sm text-muted-foreground">
            Métricas por etapa · Gargalos · Tickets ativos em tempo real
          </p>
        </div>
      </div>

      {logsLoading && !overview && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
        </div>
      )}

      {/* Médias reais por estágio */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {stageMetrics.map((m) => (
            <Card key={m.stage} className="card-hover-yellow">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Média {m.label}</p>
                </div>
                <p
                  className={`text-2xl font-bold ${m.count === 0 ? "text-muted-foreground" : metricColor(m.status)}`}
                >
                  {m.count === 0 ? "—" : formatMetricAvg(m.avg)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Meta: {formatMetricAvg(m.target)}
                  {m.count > 0 && ` · ${m.count} etapa(s)`}
                  {m.status === "breach" && (
                    <span className="text-red-500 font-semibold ml-1">● Excedido</span>
                  )}
                  {m.status === "warning" && (
                    <span className="text-amber-500 font-semibold ml-1">● Atenção</span>
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Gargalos reais (requisições acima da meta do estágio atual) */}
      {liveBottlenecks.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <OctagonAlert className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-semibold text-foreground">Gargalos Detectados</h2>
              <Badge variant="outline" className="text-[10px] border-red-200 text-red-600">
                {liveBottlenecks.length} ticket{liveBottlenecks.length > 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="space-y-3">
              {liveBottlenecks.map((b) => {
                const overPercent = Math.round(((b.hours - b.target) / b.target) * 100);
                return (
                  <div
                    key={b.ticket}
                    className="rounded-lg border border-red-200 bg-white p-3 space-y-2 cursor-pointer hover:border-red-300"
                    onClick={() => abrirMovimentacoes(b.ticket)}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {b.ticket}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {b.stageLabel}
                        </Badge>
                        <span className="text-[10px] text-red-600 font-semibold">
                          +{overPercent}% acima da meta
                        </span>
                      </div>
                      {b.escalation && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          <Bell className="h-3 w-3" />
                          Escalonamento necessário
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-foreground font-medium truncate">
                      {b.title}{" "}
                      <span className="text-muted-foreground font-normal">— {b.requester}</span>
                    </p>

                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-red-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min((b.hours / b.target) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{formatSla(b.hours)} na etapa</span>
                      <span>Meta: {formatSla(b.target)}</span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {b.responsible} ({b.responsibleRole})
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Desde {new Date(b.since).toLocaleString("pt-BR")}
                      </span>
                    </div>

                    <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{b.recommendation}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Tickets Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-vp-yellow-dark" />
            Tickets Ativos
            <Badge variant="outline" className="text-[10px]">
              {filteredActive.length}
            </Badge>
          </h2>
          <div className="flex gap-1">
            {(
              [
                { key: "all", label: "Todos" },
                { key: "on_track", label: "No prazo" },
                { key: "at_risk", label: "Em risco" },
                { key: "breached", label: "Excedido" },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.key}
                variant={activeStatusFilter === opt.key ? "default" : "outline"}
                size="sm"
                className="text-[10px] h-7 px-2"
                onClick={() => setActiveStatusFilter(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {filteredActive.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        Ticket
                      </th>
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        Etapa
                      </th>
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        SLA Total
                      </th>
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        Etapa Atual
                      </th>
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        Responsável
                      </th>
                      <th className="text-left p-3 text-[10px] font-medium text-muted-foreground uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActive.map((t) => (
                      <tr
                        key={t.ticket}
                        className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                        onClick={() => abrirMovimentacoes(t.ticket)}
                      >
                        <td className="p-3 max-w-[220px]">
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {t.ticket}
                          </span>
                          <p className="text-xs text-foreground truncate">{t.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {t.requester} · {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                          </p>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px]">
                            {t.stageLabel}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <div className="space-y-1 min-w-[120px]">
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{formatSla(t.hoursElapsed)}</span>
                              <span>{t.slaPct.toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  t.slaStatus === "breached"
                                    ? "bg-red-500"
                                    : t.slaStatus === "at_risk"
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                }`}
                                style={{ width: `${Math.min(t.slaPct, 100)}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Meta: {formatSla(t.slaTargetHours)}
                            </p>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="space-y-1 min-w-[100px]">
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{formatSla(t.stageHours)}</span>
                              <span>{formatSla(t.stageTarget)}</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  t.stageBottleneck ? "bg-red-500" : "bg-emerald-500"
                                }`}
                                style={{
                                  width: `${Math.min((t.stageHours / t.stageTarget) * 100, 100)}%`,
                                }}
                              />
                            </div>
                            {t.stageBottleneck && (
                              <span className="text-[10px] text-red-500 font-semibold">
                                ● Gargalo
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <p className="text-xs text-foreground">{t.responsible}</p>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              t.slaStatus === "breached"
                                ? "bg-red-100 text-red-700 border-red-200"
                                : t.slaStatus === "at_risk"
                                  ? "bg-amber-100 text-amber-700 border-amber-200"
                                  : "bg-emerald-100 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {t.slaStatus === "breached"
                              ? "Excedido"
                              : t.slaStatus === "at_risk"
                                ? "Em risco"
                                : "No prazo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhum ticket ativo com esse filtro.</p>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span>
            Clique em qualquer ticket para abrir as <strong>Movimentações</strong> dele — busca,
            trilha de eventos e exportação.
          </span>
        </div>
      </div>
    </div>
  );
}

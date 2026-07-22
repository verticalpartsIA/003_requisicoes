import { createFileRoute } from "@tanstack/react-router";
import {
  Package,
  Plane,
  Wrench,
  HardHat,
  Truck,
  Key,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardDataClient } from "@/features/dashboard/client";
import { useAuth } from "@/features/auth/auth-context";
import { pendencyOf, PENDENCY_TONE_CLASS } from "@/lib/requisitions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — VPRequisições" },
      {
        name: "description",
        content: "Painel de controle do sistema de requisições VerticalParts",
      },
    ],
  }),
  component: Index,
});

const urgencyLabel: Record<string, string> = {
  URGENT: "Urgente",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

function urgencyColor(u: string) {
  if (u === "URGENT") return "bg-red-100 text-red-700 border-red-200";
  if (u === "HIGH") return "bg-orange-100 text-orange-700 border-orange-200";
  if (u === "MEDIUM") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function statusColor(s: string) {
  if (s === "GESTOR") return "bg-amber-100 text-amber-800";
  if (s === "ABERTO") return "bg-blue-100 text-blue-700";
  if (s === "COTAÇÃO") return "bg-purple-100 text-purple-700";
  if (s === "APROVAÇÃO") return "bg-amber-100 text-amber-700";
  if (s === "COMPRA") return "bg-emerald-100 text-emerald-700";
  return "bg-muted text-muted-foreground";
}

function Index() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboardDataClient>> | null>(null);

  useEffect(() => {
    if (!session) return;
    void getDashboardDataClient().then(setData);
  }, [session]);

  const stats = data?.stats || [];
  const modules = data?.modules || [];
  const recentTickets = data?.recentTickets || [];
  const moduleIcons = {
    M1: Package,
    M2: Plane,
    M3: Wrench,
    M4: HardHat,
    M5: Truck,
    M6: Key,
  } as const;
  const statIcons = [Clock, AlertTriangle, CheckCircle2, TrendingUp] as const;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="animate-fade-in-up">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Bom dia! 👋</h1>
        <p className="text-muted-foreground mt-1">Acompanhe suas requisições e fluxos de compra.</p>
      </div>

      {/* Stats */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up"
        style={{ animationDelay: "0.1s" }}
      >
        {stats.map((s, index) => {
          const Icon = statIcons[index] || Clock;

          return (
            <Card key={s.label} className="card-hover-yellow">
              <CardContent className="p-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <Icon className="h-5 w-5 text-vp-yellow-dark" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-[10px] text-vp-yellow-dark font-medium mt-0.5">{s.trend}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Modules */}
      <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
        <h2 className="text-lg font-semibold text-foreground mb-3">Nova Requisição</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {modules.map((m) => {
            const Icon = moduleIcons[m.tag];

            return (
              <Link key={m.tag} to={m.url} search={{ edit: undefined }}>
                <Card className="card-hover-yellow cursor-pointer h-full">
                  <CardContent className="p-4 text-center flex flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                      <Icon className="h-6 w-6 text-vp-yellow-dark" />
                    </div>
                    <div>
                      <Badge variant="outline" className="text-[10px] mb-1">
                        {m.tag}
                      </Badge>
                      <p className="text-sm font-semibold text-foreground">{m.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {m.desc}
                      </p>
                    </div>
                    <span className="text-xs text-vp-yellow-dark font-medium">
                      {m.count} abertos
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Tickets — resumo rápido; status, histórico e motivo de recusa
          ficam em Movimentações (busca, timeline completa e resolução de
          pendências vivem lá, não aqui). */}
      <div className="animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Tickets Recentes</h2>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => void navigate({ to: "/movimentacoes", search: { ticket: undefined } })}
          >
            Ver tudo em Movimentações <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {recentTickets.map((t) => {
              const pendency = pendencyOf(t.status, t.module);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
                  onClick={() => void navigate({ to: "/movimentacoes", search: { ticket: t.id } })}
                >
                  <span className="font-mono text-xs font-semibold text-foreground shrink-0">
                    {t.id}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground">{t.title}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0 ${urgencyColor(t.urgency)}`}
                  >
                    {urgencyLabel[t.urgency] || t.urgency}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${statusColor(t.status)}`}
                  >
                    {t.status}
                  </span>
                  <span
                    className={`hidden sm:inline-flex items-center gap-1 text-xs font-medium shrink-0 ${PENDENCY_TONE_CLASS[pendency.tone]}`}
                  >
                    {pendency.tone === "action" && <Clock className="h-3 w-3 shrink-0" />}
                    {pendency.tone === "done" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                    {pendency.tone === "blocked" && (
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                    )}
                    {pendency.label}
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0">{t.date}</span>
                </button>
              );
            })}
            {recentTickets.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhum ticket encontrado ainda.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

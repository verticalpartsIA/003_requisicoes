import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Trophy,
  Clock,
  DollarSign,
  Scale,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Plane,
  Hotel,
  Car,
  Package,
  UserCheck,
  Search,
  Filter,
  ScrollText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { type ApprovalRequestItem, type ApprovalTravelItem } from "@/features/approvals/api";
import { toast } from "sonner";
import { AccessGuard } from "@/components/access-guard";
import {
  approveRequisitionClient,
  listPendingApprovalsClient,
  rejectRequisitionClient,
  decideItemsClient,
} from "@/features/approvals/client";
import { useAuth } from "@/features/auth/auth-context";
import { notifyVpClickClient } from "@/features/vpclick/client";
import { approvalLevelLabels, DEFAULT_TIER_THRESHOLDS, type TierThresholds } from "@/lib/approval";
import { getTierThresholds } from "@/features/admin/api";
import {
  getManagerScopeClient,
  listGestorQueueClient,
  gestorApproveClient,
  gestorRejectClient,
  type GestorQueueItem,
} from "@/features/gestor/client";

export const Route = createFileRoute("/approval")({
  head: () => ({
    meta: [
      { title: "V3 Aprovação — VPRequisições" },
      { name: "description", content: "Aprovação de requisições por alçada e tier" },
    ],
  }),
  component: ApprovalPage,
});

const approvalLevelBadge: Record<number, string> = {
  1: "bg-green-100 text-green-700 border-green-200",
  2: "bg-yellow-100 text-yellow-700 border-yellow-200",
  3: "bg-red-100 text-red-700 border-red-200",
};

const winCriteriaLabel: Record<string, string> = {
  price: "Menor Preço",
  deadline: "Menor Prazo",
  price_deadline: "Melhor Preço / Prazo",
};

const winCriteriaIcon: Record<string, React.ReactNode> = {
  price: <DollarSign className="h-4 w-4" />,
  deadline: <Clock className="h-4 w-4" />,
  price_deadline: <Scale className="h-4 w-4" />,
};

const travelItemConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  voo: { label: "Passagem Aérea", icon: <Plane className="h-4 w-4" /> },
  hotel: { label: "Hospedagem", icon: <Hotel className="h-4 w-4" /> },
  carro: { label: "Locação de Carro", icon: <Car className="h-4 w-4" /> },
  produto: { label: "Produto", icon: <Package className="h-4 w-4" /> },
};

// ─── Seção Gestor ──────────────────────────────────────────────────────────────

function GestorSection({ gestorName }: { gestorName: string }) {
  const [gestorQueue, setGestorQueue] = useState<GestorQueueItem[]>([]);
  const [selected, setSelected] = useState<GestorQueueItem | null>(null);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    void listGestorQueueClient(user.id).then((queue) => {
      setGestorQueue(queue);
      setLoaded(true);
    });
  }, [user]);

  const reload = async () => {
    if (!user) return;
    const queue = await listGestorQueueClient(user.id);
    setGestorQueue(queue);
  };

  const handleApprove = async () => {
    if (!selected || !user) return;
    setIsSaving(true);
    try {
      await gestorApproveClient(selected.requisitionId, user.id, gestorName, notes);
      toast.success("Requisição aprovada e encaminhada para cotação.");
      setSelected(null);
      setNotes("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selected || !user) return;
    if (!notes.trim()) {
      toast.error("Informe uma justificativa para reprovar.");
      return;
    }
    setIsSaving(true);
    try {
      await gestorRejectClient(selected.requisitionId, user.id, gestorName, notes);
      toast.success("Requisição reprovada.");
      setSelected(null);
      setNotes("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reprovar.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
          <UserCheck className="h-5 w-5 text-amber-700" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Aprovação do Gestor</h2>
          <p className="text-sm text-muted-foreground">
            Requisições dos seus colaboradores aguardando sua aprovação
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {gestorQueue.map((item) => (
          <Card key={item.requisitionId} className="border-amber-200/70 bg-amber-50/30">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="font-mono text-xs">
                    {item.ticketNumber}
                  </Badge>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.module} • {item.requesterName} • Depto: {item.requesterDepartment} •{" "}
                      {item.createdAt}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 hover:bg-amber-100"
                  onClick={() => {
                    setSelected(item);
                    setNotes("");
                  }}
                >
                  <Eye className="h-4 w-4 mr-1" /> Analisar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {gestorQueue.length === 0 && (
          <Card className="border-amber-200/50">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma requisição aguardando sua aprovação.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-amber-600" />
                  Gestor — {selected.ticketNumber}
                </DialogTitle>
                <DialogDescription>
                  {selected.title} • {selected.module}
                </DialogDescription>
              </DialogHeader>

              <Card className="border-dashed border-amber-300/60">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    Justificativa — {selected.requesterName}
                  </p>
                  <p className="text-sm text-foreground">{selected.justification}</p>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <Label className="text-sm">Observações / Justificativa de reprovação</Label>
                <Textarea
                  placeholder="Observações sobre a decisão (obrigatório para reprovar)..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <DialogFooter className="gap-2">
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={isSaving}
                  className="gap-1"
                >
                  <ThumbsDown className="h-4 w-4" /> Reprovar
                </Button>
                <Button variant="vp" onClick={handleApprove} disabled={isSaving} className="gap-1">
                  <ThumbsUp className="h-4 w-4" /> Aprovar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

function ApprovalPage() {
  const { session, profile, hasRole } = useAuth();
  const router = useRouter();
  const [approvals, setApprovals] = useState<ApprovalRequestItem[]>([]);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  const [levelFilter, setLevelFilter] = useState<"Todos" | 1 | 2 | 3>("Todos");
  const [selected, setSelected] = useState<ApprovalRequestItem | null>(null);
  const [justification, setJustification] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGestor, setIsGestor] = useState(false);
  const [deptsLoaded, setDeptsLoaded] = useState(false);
  const [thresholds, setThresholds] = useState<TierThresholds>(DEFAULT_TIER_THRESHOLDS);

  const { user } = useAuth();

  useEffect(() => {
    if (!session) return;
    void getTierThresholds()
      .then(setThresholds)
      .catch(() => {});
  }, [session]);

  const levelLabels = approvalLevelLabels(thresholds);
  const shortLevelLabels: Record<1 | 2 | 3, string> = {
    1: `Nível 1 (até ${thresholds.tier1_max.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`,
    2: `Nível 2`,
    3: `Nível 3 (acima ${thresholds.tier2_max.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`,
  };

  // M2 per-item decisions: approvalItemId → 'approved' | 'rejected'
  const [m2Decisions, setM2Decisions] = useState<Record<string, "approved" | "rejected">>({});

  useEffect(() => {
    if (!session) return;
    void listPendingApprovalsClient().then(setApprovals);
  }, [session]);

  useEffect(() => {
    if (!user) return;
    void getManagerScopeClient(user.id)
      .then((scope) => {
        setIsGestor(scope.departments.length > 0 || scope.isApproverOfSomeone);
        setDeptsLoaded(true);
      })
      .catch(() => setDeptsLoaded(true));
  }, [user]);
  const canAccess = hasRole("admin") || hasRole("aprovador") || isGestor;

  const openApproval = (request: ApprovalRequestItem) => {
    setSelected(request);
    setJustification("");
    if (request.travelItems && request.travelItems.length > 0) {
      const initial: Record<string, "approved" | "rejected"> = {};
      request.travelItems.forEach((ti) => {
        if (ti.decision === "approved" || ti.decision === "rejected") {
          initial[ti.approvalItemId] = ti.decision;
        }
      });
      setM2Decisions(initial);
    } else {
      setM2Decisions({});
    }
  };

  const handleApprove = async () => {
    if (!selected) return;

    setIsSaving(true);

    try {
      await approveRequisitionClient(selected.approvalId, selected.requisitionId, justification);
      toast.success("Requisição aprovada e enviada para compra.");
      void notifyVpClickClient({
        stage: "V3_approved",
        requisitionId: selected.requisitionId,
        ticketNumber: selected.id,
        title: selected.title,
        module: selected.module,
        requesterName: selected.requesterName,
      }).catch(console.warn);
      setSelected(null);
      setJustification("");
      setApprovals(await listPendingApprovalsClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aprovar agora.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;

    if (!justification.trim()) {
      toast.error("Informe uma justificativa para reprovar a requisição.");
      return;
    }

    setIsSaving(true);

    try {
      await rejectRequisitionClient(selected.approvalId, selected.requisitionId, justification);
      toast.success("Requisição reprovada com sucesso.");
      void notifyVpClickClient({
        stage: "V3_rejected",
        requisitionId: selected.requisitionId,
        ticketNumber: selected.id,
        title: selected.title,
        module: selected.module,
        requesterName: selected.requesterName,
      }).catch(console.warn);
      setSelected(null);
      setJustification("");
      setApprovals(await listPendingApprovalsClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reprovar agora.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleM2Decide = async () => {
    if (!selected || !selected.travelItems) return;

    const allDecided = selected.travelItems.every(
      (ti) => m2Decisions[ti.approvalItemId] !== undefined,
    );
    if (!allDecided) {
      toast.error("Decida Aprovar ou Reprovar cada item antes de confirmar.");
      return;
    }

    setIsSaving(true);
    try {
      const decisions = selected.travelItems.map((ti) => ({
        approvalItemId: ti.approvalItemId,
        itemId: ti.itemId,
        decision: m2Decisions[ti.approvalItemId]!,
        notes: justification,
      }));

      await decideItemsClient(selected.approvalId, selected.requisitionId, decisions);

      const approvedCount = decisions.filter((d) => d.decision === "approved").length;
      const rejectedCount = decisions.filter((d) => d.decision === "rejected").length;

      if (approvedCount > 0 && rejectedCount > 0) {
        toast.success(
          `Decisão registrada: ${approvedCount} item(s) aprovado(s), ${rejectedCount} rejeitado(s). Encaminhado para compra.`,
        );
      } else if (approvedCount > 0) {
        toast.success("Todos os itens aprovados. Encaminhado para compra.");
      } else {
        toast.success("Todos os itens reprovados. Requisição encerrada.");
      }

      void notifyVpClickClient({
        stage: approvedCount > 0 ? "V3_approved" : "V3_rejected",
        requisitionId: selected.requisitionId,
        ticketNumber: selected.id,
        title: selected.title,
        module: selected.module,
        requesterName: selected.requesterName,
      }).catch(console.warn);

      setSelected(null);
      setJustification("");
      setM2Decisions({});
      setApprovals(await listPendingApprovalsClient());
      await router.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível registrar as decisões.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const hasItemDecisions = (selected?.travelItems || []).length > 0;
  const m2AllDecided =
    hasItemDecisions &&
    (selected?.travelItems || []).every((ti) => m2Decisions[ti.approvalItemId] !== undefined);

  if (!deptsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <AccessGuard roles={["aprovador"]}>
        <></>
      </AccessGuard>
    );
  }

  const gestorName = profile?.full_name ?? user?.email ?? "Gestor";

  const filteredApprovals = approvals.filter((request) => {
    if (moduleFilter !== "Todos" && request.moduleCode !== moduleFilter) return false;
    if (levelFilter !== "Todos" && request.approvalLevel !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        request.id.toLowerCase().includes(q) ||
        request.title.toLowerCase().includes(q) ||
        request.requesterName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Seção Gestor (aparece apenas para usuários com departamentos gerenciados) */}
      {isGestor && <GestorSection gestorName={gestorName} />}

      {/* Separador entre seções quando gestor também é aprovador */}
      {isGestor && (hasRole("admin") || hasRole("aprovador")) && (
        <div className="border-t border-border pt-2" />
      )}

      {/* V3 — Aprovação financeira (apenas para admin/aprovador) */}
      {(hasRole("admin") || hasRole("aprovador")) && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
              <CheckCircle2 className="h-5 w-5 text-vp-yellow-dark" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">V3 — Aprovação</h1>
              <p className="text-sm text-muted-foreground">Aprovações pendentes da diretoria</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((level) => {
              const count = approvals.filter((item) => item.approvalLevel === level).length;
              return (
                <Card key={level} className="card-hover-yellow">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{count}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {shortLevelLabels[level as 1 | 2 | 3]}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por ticket, título ou solicitante..."
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
                    {["Todos", "M1", "M2", "M3", "M4", "M5", "M6"].map((m) => (
                      <SelectItem key={m} value={m}>{m === "Todos" ? "Módulo" : m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(levelFilter)}
                  onValueChange={(v) => setLevelFilter(v === "Todos" ? "Todos" : (Number(v) as 1 | 2 | 3))}
                >
                  <SelectTrigger className="w-full sm:w-[130px]">
                    <SelectValue placeholder="Alçada" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Todos">Alçada</SelectItem>
                    <SelectItem value="1">Nível 1</SelectItem>
                    <SelectItem value="2">Nível 2</SelectItem>
                    <SelectItem value="3">Nível 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {filteredApprovals.map((request) => {
              const winner = request.suppliers.find((supplier) => supplier.isWinner);
              return (
                <Card key={request.approvalId} className="card-hover-yellow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {request.id}
                        </Badge>
                        <div>
                          <p className="font-semibold text-foreground text-sm">{request.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {request.module} • Requisitante: {request.requesterName} •{" "}
                            {request.createdAt}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${approvalLevelBadge[request.approvalLevel]}`}
                        >
                          Nível {request.approvalLevel}
                        </span>
                        <Link
                          to="/movimentacoes"
                          search={{ ticket: request.id }}
                          target="_blank"
                          title="Ver histórico completo do ticket"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-vp-yellow transition-colors"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                        </Link>
                        <Button variant="vp" size="sm" onClick={() => openApproval(request)}>
                          <Eye className="h-4 w-4 mr-1" /> Analisar
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      {request.moduleCode === "M2" ? (
                        <>
                          <Plane className="h-3.5 w-3.5 text-vp-yellow-dark" />
                          <span className="font-medium text-foreground">
                            {(request.travelItems || []).length} item(s) de viagem
                          </span>
                          <span>•</span>
                          <span>
                            R${" "}
                            {request.totalValue.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </>
                      ) : request.moduleCode === "M1" && (request.travelItems || []).length > 0 ? (
                        <>
                          <Package className="h-3.5 w-3.5 text-vp-yellow-dark" />
                          <span className="font-medium text-foreground">
                            {(request.travelItems || []).length} item(s) — {
                              new Set((request.travelItems || []).map((ti) => ti.supplierName)).size
                            } fornecedor(es)
                          </span>
                          <span>•</span>
                          <span>
                            R${" "}
                            {request.totalValue.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </>
                      ) : (
                        <>
                          <Trophy className="h-3.5 w-3.5 text-vp-yellow-dark" />
                          <span className="font-medium text-foreground">{winner?.name}</span>
                          <span>•</span>
                          <span>
                            R$ {winner?.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                          <span>•</span>
                          <span>Critério: {winCriteriaLabel[request.winCriteria]}</span>
                          <span>•</span>
                          <span>{request.suppliers.length} fornecedor(es)</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {filteredApprovals.length === 0 && (
              <Card className="card-hover-yellow">
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  {approvals.length === 0
                    ? "Nenhuma aprovação pendente neste momento."
                    : "Nenhum resultado para os filtros atuais."}
                </CardContent>
              </Card>
            )}
          </div>

          <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              {selected && (
                <>
                  <DialogHeader>
                    <DialogTitle className="text-lg flex items-center gap-2">
                      Aprovação — {selected.id}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${approvalLevelBadge[selected.approvalLevel]}`}
                      >
                        {levelLabels[selected.approvalLevel]}
                      </span>
                    </DialogTitle>
                    <DialogDescription>
                      {selected.title} • {selected.module}
                    </DialogDescription>
                  </DialogHeader>

                  <Card className="border-dashed border-vp-yellow/50">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">
                        Observações do Requisitante — {selected.requesterName}
                      </p>
                      <p className="text-sm text-foreground">{selected.requesterNotes}</p>
                    </CardContent>
                  </Card>

                  {/* Aprovação por item — M2 (viagem) e M1 multi-itens (produtos) */}
                  {hasItemDecisions ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground">
                        {selected.moduleCode === "M1"
                          ? "Itens do Pedido — decida cada item individualmente"
                          : "Itens de Viagem — decida cada item individualmente"}
                      </p>
                      {(selected.travelItems || []).map((ti: ApprovalTravelItem) => {
                        const cfg = travelItemConfig[ti.itemType] ?? {
                          label: ti.itemType,
                          icon: null,
                        };
                        const label = ti.itemType === "produto" ? (ti.description || cfg.label) : cfg.label;
                        const decision = m2Decisions[ti.approvalItemId];
                        return (
                          <Card
                            key={ti.approvalItemId}
                            className={`border-2 transition-all ${
                              decision === "approved"
                                ? "border-green-400 bg-green-50/40"
                                : decision === "rejected"
                                  ? "border-red-300 bg-red-50/30"
                                  : "border-border"
                            }`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {cfg.icon}
                                  <span className="text-sm font-semibold text-foreground">
                                    {label}
                                    {ti.itemType === "produto" && ti.quantity != null && (
                                      <span className="text-muted-foreground font-normal"> — qtd. {ti.quantity}</span>
                                    )}
                                  </span>
                                </div>
                                <span className="font-mono text-sm font-bold text-foreground">
                                  R${" "}
                                  {ti.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {ti.itemType === "produto" && ti.productCode ? `[${ti.productCode}] ` : ""}
                                {ti.supplierName}
                              </p>
                              <div className="flex gap-2 mt-3">
                                <Button
                                  size="sm"
                                  variant={decision === "approved" ? "default" : "outline"}
                                  className={`gap-1 text-xs flex-1 ${decision === "approved" ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                                  onClick={() =>
                                    setM2Decisions((prev) => ({
                                      ...prev,
                                      [ti.approvalItemId]: "approved",
                                    }))
                                  }
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" /> Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant={decision === "rejected" ? "destructive" : "outline"}
                                  className="gap-1 text-xs flex-1"
                                  onClick={() =>
                                    setM2Decisions((prev) => ({
                                      ...prev,
                                      [ti.approvalItemId]: "rejected",
                                    }))
                                  }
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" /> Reprovar
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}

                      <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
                        Total aprovado:{" "}
                        <strong className="text-foreground">
                          R${" "}
                          {(selected.travelItems || [])
                            .filter(
                              (ti: ApprovalTravelItem) =>
                                m2Decisions[ti.approvalItemId] === "approved",
                            )
                            .reduce((sum: number, ti: ApprovalTravelItem) => sum + ti.price, 0)
                            .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </strong>{" "}
                        / Total geral: R${" "}
                        {selected.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm">Observações (opcional)</Label>
                        <Textarea
                          placeholder="Comentário sobre a decisão..."
                          value={justification}
                          onChange={(e) => setJustification(e.target.value)}
                          rows={2}
                        />
                      </div>

                      <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setSelected(null)}>
                          Cancelar
                        </Button>
                        <Button
                          variant="vp"
                          onClick={handleM2Decide}
                          disabled={!m2AllDecided || isSaving}
                          className="gap-1"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Confirmar Decisões
                        </Button>
                      </DialogFooter>
                    </div>
                  ) : (
                    /* Padrão (não-M2) */
                    <>
                      <div className="flex items-center gap-2 rounded-lg bg-accent/50 p-3">
                        {winCriteriaIcon[selected.winCriteria]}
                        <span className="text-sm font-semibold text-foreground">
                          Critério de vitória: {winCriteriaLabel[selected.winCriteria]}
                        </span>
                      </div>

                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-foreground">
                          Comparativo de Fornecedores ({selected.suppliers.length})
                        </p>
                        {selected.suppliers.map((supplier, index) => (
                          <Card
                            key={`${selected.approvalId}-${index}`}
                            className={`border ${supplier.isWinner ? "border-vp-yellow bg-vp-yellow/5 ring-1 ring-vp-yellow/30" : "border-border"}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {supplier.name}
                                  </span>
                                  {supplier.isWinner && (
                                    <Badge className="bg-vp-yellow/20 text-vp-yellow-dark border-vp-yellow/40 text-[10px]">
                                      <Trophy className="h-3 w-3 mr-1" /> Vencedor
                                    </Badge>
                                  )}
                                </div>
                                <span className="font-mono text-sm font-bold text-foreground">
                                  R${" "}
                                  {supplier.price.toLocaleString("pt-BR", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Prazo: {supplier.deadline}
                                </div>
                                <div>Obs: {supplier.notes || "—"}</div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm">Justificativa</Label>
                        <Textarea
                          placeholder="Adicione observações sobre a decisão..."
                          value={justification}
                          onChange={(e) => setJustification(e.target.value)}
                          rows={3}
                        />
                      </div>

                      <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setSelected(null)}>
                          Cancelar
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleReject}
                          className="gap-1"
                          disabled={isSaving}
                        >
                          <ThumbsDown className="h-4 w-4" /> Reprovar
                        </Button>
                        <Button
                          variant="vp"
                          onClick={handleApprove}
                          className="gap-1"
                          disabled={isSaving}
                        >
                          <ThumbsUp className="h-4 w-4" /> Aprovar
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

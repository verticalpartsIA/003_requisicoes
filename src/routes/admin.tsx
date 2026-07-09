import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  Shield,
  UserCog,
  BadgeDollarSign,
  Trash2,
  Plus,
  Save,
  RefreshCw,
  ChevronDown,
  Building2,
  UserCheck,
  UserRoundCheck,
  Ban,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuth, type AppRole } from "@/features/auth/auth-context";
import {
  listUsersWithRoles,
  addUserRole,
  removeUserRole,
  updateApprovalTier,
  getTierThresholds,
  saveTierThresholds,
  setUserApprover,
  type UserWithRoles,
  type TierThresholds,
} from "@/features/admin/api";
import {
  setUserDepartmentClient,
  listDeptManagersClient,
  addDeptManagerClient,
  removeDeptManagerClient,
  type DeptManagerEntry,
} from "@/features/admin/client";
import { setUserActive, deleteUserAccount } from "@/features/admin/server";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — VPRequisições" },
      { name: "description", content: "Gestão de usuários, papéis e faixas de aprovação" },
    ],
  }),
  component: AdminPage,
});

const ALL_ROLES: AppRole[] = ["admin", "solicitante", "comprador", "aprovador", "almoxarife"];

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  solicitante: "Solicitante",
  comprador: "Comprador",
  aprovador: "Aprovador",
  almoxarife: "Almoxarife",
};

const ROLE_COLORS: Record<AppRole, string> = {
  admin: "bg-red-100 text-red-700 border-red-200",
  solicitante: "bg-blue-100 text-blue-700 border-blue-200",
  comprador: "bg-purple-100 text-purple-700 border-purple-200",
  aprovador: "bg-green-100 text-green-700 border-green-200",
  almoxarife: "bg-orange-100 text-orange-700 border-orange-200",
};

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "1ª Alçada",
  2: "2ª Alçada",
  3: "3ª Alçada",
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AdminPage() {
  const navigate = useNavigate();
  const { hasRole, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !hasRole("admin")) {
      toast.error("Acesso restrito ao administrador.");
      void navigate({ to: "/" });
    }
  }, [authLoading, hasRole, navigate]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
      </div>
    );
  }

  if (!hasRole("admin")) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-vp-yellow text-vp-dark">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie usuários, papéis e alçadas de aprovação
          </p>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="users" className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Usuários e Papéis
          </TabsTrigger>
          <TabsTrigger value="tiers" className="flex items-center gap-2">
            <BadgeDollarSign className="h-4 w-4" />
            Alçadas de Aprovação
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>

        <TabsContent value="tiers" className="mt-4">
          <TiersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [deptManagers, setDeptManagers] = useState<DeptManagerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDept, setEditingDept] = useState<Record<string, string>>({});
  const [newGestorDept, setNewGestorDept] = useState<Record<string, string>>({});

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [usersData, managersData] = await Promise.all([
        listUsersWithRoles(),
        listDeptManagersClient(),
      ]);
      setUsers(usersData);
      setDeptManagers(managersData);
      const deptMap: Record<string, string> = {};
      usersData.forEach((u) => { deptMap[u.id] = u.department ?? ""; });
      setEditingDept(deptMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar usuários.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Todas as ações abaixo atualizam o estado local, sem recarregar a lista —
  // a página não "pula" para o topo ao salvar.
  const patchUser = (userId: string, patch: Partial<UserWithRoles>) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } : u)));
  };

  const handleAddRole = async (userId: string, role: AppRole) => {
    try {
      await addUserRole(userId, role);
      const target = users.find((u) => u.id === userId);
      patchUser(userId, { roles: [...(target?.roles ?? []), { role, approval_tier: null }] });
      toast.success(`Papel "${ROLE_LABELS[role]}" adicionado.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar papel.");
    }
  };

  const handleRemoveRole = async (userId: string, role: AppRole) => {
    try {
      await removeUserRole(userId, role);
      const target = users.find((u) => u.id === userId);
      patchUser(userId, { roles: (target?.roles ?? []).filter((r) => r.role !== role) });
      toast.success(`Papel "${ROLE_LABELS[role]}" removido.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover papel.");
    }
  };

  const handleSetTier = async (userId: string, tier: 1 | 2 | 3 | null) => {
    try {
      await updateApprovalTier(userId, tier);
      const target = users.find((u) => u.id === userId);
      patchUser(userId, {
        roles: (target?.roles ?? []).map((r) =>
          r.role === "aprovador" ? { ...r, approval_tier: tier } : r,
        ),
      });
      toast.success(tier ? `Alçada ${tier} atribuída.` : "Alçada removida.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar alçada.");
    }
  };

  const handleSaveDept = async (userId: string) => {
    try {
      const dept = (editingDept[userId] ?? "").trim();
      await setUserDepartmentClient(userId, dept);
      patchUser(userId, { department: dept || null });
      toast.success("Departamento atualizado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar departamento.");
    }
  };

  const handleSetApprover = async (userId: string, approverId: string | null) => {
    try {
      await setUserApprover(userId, approverId);
      patchUser(userId, { approver_id: approverId });
      const approver = users.find((u) => u.id === approverId);
      toast.success(
        approverId
          ? `Aprovador definido: ${approver?.full_name ?? "usuário"}. As requisições deste colaborador irão para ele.`
          : "Aprovador removido.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao definir aprovador.");
    }
  };

  const handleToggleActive = async (target: UserWithRoles) => {
    if (!currentUser) return;
    const activating = !target.active;
    if (!activating) {
      const ok = window.confirm(
        `Inativar ${target.full_name ?? target.email}? O usuário não conseguirá mais entrar no sistema até ser reativado.`,
      );
      if (!ok) return;
    }
    try {
      await setUserActive({ data: { adminId: currentUser.id, targetUserId: target.id, active: activating } });
      patchUser(target.id, { active: activating });
      toast.success(activating ? "Usuário reativado." : "Usuário inativado. O login foi bloqueado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar status do usuário.");
    }
  };

  const handleDeleteUser = async (target: UserWithRoles) => {
    if (!currentUser) return;
    const ok = window.confirm(
      `EXCLUIR definitivamente ${target.full_name ?? target.email}? Esta ação não pode ser desfeita. As requisições já criadas por ele são mantidas no histórico.`,
    );
    if (!ok) return;
    try {
      await deleteUserAccount({ data: { adminId: currentUser.id, targetUserId: target.id } });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setDeptManagers((prev) => prev.filter((dm) => dm.manager_user_id !== target.id));
      toast.success("Usuário excluído.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    }
  };

  const handleAddGestor = async (userId: string) => {
    const dept = (newGestorDept[userId] ?? "").trim();
    if (!dept) { toast.error("Informe o nome do departamento."); return; }
    try {
      await addDeptManagerClient(dept, userId);
      setNewGestorDept((prev) => ({ ...prev, [userId]: "" }));
      await load(false);
      toast.success(`Usuário designado como gestor de "${dept}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao designar gestor.");
    }
  };

  const handleRemoveGestor = async (entryId: string) => {
    try {
      await removeDeptManagerClient(entryId);
      setDeptManagers((prev) => prev.filter((dm) => dm.id !== entryId));
      toast.success("Designação de gestor removida.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover gestor.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{users.length} usuário(s) encontrado(s)</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {users.map((user) => {
        const existingRoles = user.roles.map((r) => r.role);
        const availableRoles = ALL_ROLES.filter((r) => !existingRoles.includes(r));
        const aprovadorEntry = user.roles.find((r) => r.role === "aprovador");
        const userManagers = deptManagers.filter((dm) => dm.manager_user_id === user.id);
        const currentDept = editingDept[user.id] ?? user.department ?? "";
        const savedDept = user.department ?? "";
        const deptChanged = currentDept !== savedDept;
        const approver = users.find((u) => u.id === user.approver_id);
        const approverCandidates = users.filter((u) => u.id !== user.id && u.active);
        const isSelf = user.id === currentUser?.id;

        return (
          <Card key={user.id} className={`border-border/60 ${user.active ? "" : "opacity-60 bg-muted/30"}`}>
            <CardContent className="pt-5 pb-4 space-y-4">
              {/* Info do usuário + Papéis */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">
                      {user.full_name || "Sem nome"}
                    </p>
                    {!user.active && (
                      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        Inativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>

                <div className="flex flex-col gap-2 min-w-0 sm:items-end">
                  <div className="flex flex-wrap gap-1.5">
                    {user.roles.map(({ role, approval_tier }) => (
                      <span
                        key={role}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}
                      >
                        {ROLE_LABELS[role]}
                        {role === "aprovador" && approval_tier && (
                          <span className="opacity-70">· {approval_tier}ª</span>
                        )}
                        <button
                          className="ml-0.5 hover:opacity-70 transition-opacity"
                          title={`Remover ${ROLE_LABELS[role]}`}
                          onClick={() => void handleRemoveRole(user.id, role)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ))}

                    {availableRoles.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-vp-yellow hover:text-vp-dark transition-colors"
                            title="Adicionar papel"
                          >
                            <Plus className="h-3 w-3" />
                            Adicionar
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {availableRoles.map((r) => (
                            <DropdownMenuItem
                              key={r}
                              onClick={() => void handleAddRole(user.id, r)}
                            >
                              {ROLE_LABELS[r]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {aprovadorEntry && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Alçada:</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent transition-colors">
                            {aprovadorEntry.approval_tier
                              ? TIER_LABELS[aprovadorEntry.approval_tier]
                              : "Não definida"}
                            <ChevronDown className="h-3 w-3 opacity-50" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {([1, 2, 3] as const).map((t) => (
                            <DropdownMenuItem
                              key={t}
                              onClick={() => void handleSetTier(user.id, t)}
                            >
                              {TIER_LABELS[t]}
                            </DropdownMenuItem>
                          ))}
                          <Separator className="my-1" />
                          <DropdownMenuItem onClick={() => void handleSetTier(user.id, null)}>
                            Remover alçada
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Aprovador designado das requisições deste colaborador */}
              <div className="flex items-center gap-2">
                <UserRoundCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground w-24 shrink-0">Aprovador:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs transition-colors hover:bg-accent ${approver ? "text-foreground" : "text-muted-foreground italic"}`}>
                      {approver ? (approver.full_name ?? approver.email) : "Não definido"}
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {approverCandidates.map((candidate) => (
                      <DropdownMenuItem
                        key={candidate.id}
                        onClick={() => void handleSetApprover(user.id, candidate.id)}
                      >
                        {candidate.full_name ?? candidate.email}
                      </DropdownMenuItem>
                    ))}
                    {user.approver_id && (
                      <>
                        <Separator className="my-1" />
                        <DropdownMenuItem onClick={() => void handleSetApprover(user.id, null)}>
                          Remover aprovador
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {approver && (
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    aprova as requisições deste colaborador
                  </span>
                )}
              </div>

              {/* Departamento */}
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground w-24 shrink-0">Departamento:</span>
                <Input
                  className="h-7 text-xs max-w-[200px]"
                  placeholder="Ex: Engenharia"
                  value={currentDept}
                  onChange={(e) =>
                    setEditingDept((prev) => ({ ...prev, [user.id]: e.target.value }))
                  }
                />
                {deptChanged && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2"
                    onClick={() => void handleSaveDept(user.id)}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Salvar
                  </Button>
                )}
              </div>

              {/* Gestor de departamentos */}
              <div className="flex items-start gap-2">
                <UserCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-xs text-muted-foreground w-24 shrink-0 mt-0.5">Gestor de:</span>
                <div className="flex flex-col gap-1.5 flex-1">
                  {userManagers.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">Não designado</span>
                  )}
                  {userManagers.map((dm) => (
                    <span
                      key={dm.id}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 w-fit"
                    >
                      {dm.department}
                      <button
                        className="ml-0.5 hover:opacity-70 transition-opacity"
                        title="Remover designação"
                        onClick={() => void handleRemoveGestor(dm.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1.5 mt-1">
                    <Input
                      className="h-7 text-xs max-w-[180px]"
                      placeholder="Departamento..."
                      value={newGestorDept[user.id] ?? ""}
                      onChange={(e) =>
                        setNewGestorDept((prev) => ({ ...prev, [user.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleAddGestor(user.id);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={() => void handleAddGestor(user.id)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Designar
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Ações da conta */}
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-7 text-xs px-2 ${user.active ? "text-amber-700 border-amber-300 hover:bg-amber-50" : "text-green-700 border-green-300 hover:bg-green-50"}`}
                  disabled={isSelf}
                  title={isSelf ? "Você não pode inativar a própria conta." : undefined}
                  onClick={() => void handleToggleActive(user)}
                >
                  {user.active ? (
                    <><Ban className="h-3 w-3 mr-1" /> Inativar</>
                  ) : (
                    <><RotateCcw className="h-3 w-3 mr-1" /> Reativar</>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-2 text-red-700 border-red-300 hover:bg-red-50"
                  disabled={isSelf}
                  title={isSelf ? "Você não pode excluir a própria conta." : undefined}
                  onClick={() => void handleDeleteUser(user)}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Excluir
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TiersTab() {
  const [thresholds, setThresholds] = useState<TierThresholds>({ tier1_max: 1500, tier2_max: 3500 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTierThresholds()
      .then(setThresholds)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Erro ao carregar alçadas."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (thresholds.tier1_max <= 0 || thresholds.tier2_max <= thresholds.tier1_max) {
      toast.error("O limite da 2ª alçada deve ser maior que o da 1ª.");
      return;
    }

    setSaving(true);
    try {
      await saveTierThresholds(thresholds);
      toast.success("Alçadas atualizadas com sucesso.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar alçadas.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-vp-yellow border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limites das alçadas de aprovação</CardTitle>
          <CardDescription>
            Defina os valores máximos para cada alçada. Requisições acima do limite da 2ª alçada
            são automaticamente encaminhadas para a 3ª.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div className="rounded-lg border bg-blue-50 p-3">
              <p className="font-semibold text-blue-700">1ª Alçada</p>
              <p className="text-muted-foreground mt-0.5">
                Até {formatBRL(thresholds.tier1_max)}
              </p>
            </div>
            <div className="rounded-lg border bg-green-50 p-3">
              <p className="font-semibold text-green-700">2ª Alçada</p>
              <p className="text-muted-foreground mt-0.5">
                {formatBRL(thresholds.tier1_max + 0.01)} – {formatBRL(thresholds.tier2_max)}
              </p>
            </div>
            <div className="rounded-lg border bg-orange-50 p-3">
              <p className="font-semibold text-orange-700">3ª Alçada</p>
              <p className="text-muted-foreground mt-0.5">
                Acima de {formatBRL(thresholds.tier2_max)}
              </p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tier1_max">Limite máximo da 1ª alçada (R$)</Label>
              <Input
                id="tier1_max"
                type="number"
                min={1}
                step={0.01}
                value={thresholds.tier1_max}
                onChange={(e) =>
                  setThresholds((prev) => ({ ...prev, tier1_max: Number(e.target.value) }))
                }
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier2_max">Limite máximo da 2ª alçada (R$)</Label>
              <Input
                id="tier2_max"
                type="number"
                min={1}
                step={0.01}
                value={thresholds.tier2_max}
                onChange={(e) =>
                  setThresholds((prev) => ({ ...prev, tier2_max: Number(e.target.value) }))
                }
                disabled={saving}
              />
            </div>
          </div>

          <Button variant="vp" onClick={() => void handleSave()} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-muted/50 bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Como funciona:</strong> ao enviar uma requisição para aprovação, o sistema
            verifica o valor total e encaminha ao aprovador da alçada correspondente. Certifique-se
            de que há ao menos um aprovador cadastrado em cada alçada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

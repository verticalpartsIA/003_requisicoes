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
  Search,
  MoreVertical,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"Todos" | AppRole>("Todos");
  const [statusFilter, setStatusFilter] = useState<"Todos" | "ativos" | "inativos">("Todos");
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserWithRoles | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // A exclusão é destrutiva e irreversível — separada num Dialog de
  // confirmação (setDeleteTarget abre, confirmDelete executa) em vez de um
  // window.confirm nativo, e isolada num menu discreto na linha da tabela
  // ao invés de um botão sempre visível ao lado de ações comuns.
  const confirmDelete = async () => {
    if (!currentUser || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteUserAccount({ data: { adminId: currentUser.id, targetUserId: deleteTarget.id } });
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeptManagers((prev) => prev.filter((dm) => dm.manager_user_id !== deleteTarget.id));
      toast.success("Usuário excluído.");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    } finally {
      setDeleting(false);
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

  // Listagem primariamente read-only e filtrável — edição por usuário
  // acontece num painel dedicado (Sheet), não com dezenas de inputs
  // visíveis simultaneamente para todo mundo na lista.
  const filteredUsers = users.filter((u) => {
    if (statusFilter === "ativos" && !u.active) return false;
    if (statusFilter === "inativos" && u.active) return false;
    if (roleFilter !== "Todos" && !u.roles.some((r) => r.role === roleFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (u.full_name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.department ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const detailUser = users.find((u) => u.id === detailUserId) ?? null;
  const missingBadge = (
    <span className="inline-flex items-center gap-1 text-amber-700">
      <AlertTriangle className="h-3 w-3 shrink-0" /> —
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, e-mail ou departamento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Papel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Todos">Todos os papéis</SelectItem>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Todos">Todos os status</SelectItem>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {filteredUsers.length} de {users.length} usuário(s)
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Usuário</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Papéis</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Alçada</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Aprovador</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Departamento</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const aprovadorEntry = user.roles.find((r) => r.role === "aprovador");
                  const approver = users.find((u) => u.id === user.approver_id);
                  const isSelf = user.id === currentUser?.id;

                  return (
                    <tr
                      key={user.id}
                      className={`border-b border-border last:border-0 hover:bg-accent/50 transition-colors ${user.active ? "" : "opacity-60"}`}
                    >
                      <td className="p-3">
                        <p className="font-medium text-foreground truncate max-w-[180px]">
                          {user.full_name || "Sem nome"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-[220px]">{user.email}</p>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {user.roles.length === 0 && <span className="text-xs text-muted-foreground italic">—</span>}
                          {user.roles.map(({ role }) => (
                            <span
                              key={role}
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[role]}`}
                            >
                              {ROLE_LABELS[role]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        {aprovadorEntry ? (
                          aprovadorEntry.approval_tier ? (
                            <span className="text-foreground">{TIER_LABELS[aprovadorEntry.approval_tier]}</span>
                          ) : missingBadge
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {approver ? (
                          <span className="text-foreground truncate max-w-[160px] block">
                            {approver.full_name ?? approver.email}
                          </span>
                        ) : missingBadge}
                      </td>
                      <td className="p-3 text-xs">{user.department || missingBadge}</td>
                      <td className="p-3">
                        {user.active ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            Inativo
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreVertical className="h-4 w-4" />
                              <span className="sr-only">Ações — {user.full_name ?? user.email}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetailUserId(user.id)}>
                              Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={isSelf}
                              onClick={() => void handleToggleActive(user)}
                              className={user.active ? "text-amber-700 focus:text-amber-700" : "text-emerald-700 focus:text-emerald-700"}
                            >
                              {user.active ? (
                                <><Ban className="h-3.5 w-3.5 mr-2" /> Inativar</>
                              ) : (
                                <><RotateCcw className="h-3.5 w-3.5 mr-2" /> Reativar</>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isSelf}
                              onClick={() => setDeleteTarget(user)}
                              className="text-red-700 focus:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      Nenhum usuário encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Painel de detalhe/edição — um usuário por vez */}
      <Sheet open={!!detailUser} onOpenChange={(open) => !open && setDetailUserId(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {detailUser && (
            <UserDetailContent
              user={detailUser}
              users={users}
              deptManagers={deptManagers}
              editingDept={editingDept}
              setEditingDept={setEditingDept}
              newGestorDept={newGestorDept}
              setNewGestorDept={setNewGestorDept}
              onAddRole={handleAddRole}
              onRemoveRole={handleRemoveRole}
              onSetTier={handleSetTier}
              onSaveDept={handleSaveDept}
              onSetApprover={handleSetApprover}
              onAddGestor={handleAddGestor}
              onRemoveGestor={handleRemoveGestor}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmação forte de exclusão — ação destrutiva e irreversível */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Excluir Usuário
            </DialogTitle>
            <DialogDescription>
              Esta ação é irreversível.{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.full_name ?? deleteTarget?.email}
              </span>{" "}
              perderá acesso ao sistema e todos os vínculos (papéis, alçada, aprovador designado)
              serão removidos. Requisições já criadas por ele permanecem no histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir Definitivamente
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserDetailContent({
  user,
  users,
  deptManagers,
  editingDept,
  setEditingDept,
  newGestorDept,
  setNewGestorDept,
  onAddRole,
  onRemoveRole,
  onSetTier,
  onSaveDept,
  onSetApprover,
  onAddGestor,
  onRemoveGestor,
}: {
  user: UserWithRoles;
  users: UserWithRoles[];
  deptManagers: DeptManagerEntry[];
  editingDept: Record<string, string>;
  setEditingDept: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  newGestorDept: Record<string, string>;
  setNewGestorDept: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onAddRole: (userId: string, role: AppRole) => Promise<void>;
  onRemoveRole: (userId: string, role: AppRole) => Promise<void>;
  onSetTier: (userId: string, tier: 1 | 2 | 3 | null) => Promise<void>;
  onSaveDept: (userId: string) => Promise<void>;
  onSetApprover: (userId: string, approverId: string | null) => Promise<void>;
  onAddGestor: (userId: string) => Promise<void>;
  onRemoveGestor: (entryId: string) => Promise<void>;
}) {
  const existingRoles = user.roles.map((r) => r.role);
  const availableRoles = ALL_ROLES.filter((r) => !existingRoles.includes(r));
  const aprovadorEntry = user.roles.find((r) => r.role === "aprovador");
  const userManagers = deptManagers.filter((dm) => dm.manager_user_id === user.id);
  const currentDept = editingDept[user.id] ?? user.department ?? "";
  const savedDept = user.department ?? "";
  const deptChanged = currentDept !== savedDept;
  const approver = users.find((u) => u.id === user.approver_id);
  const approverCandidates = users.filter((u) => u.id !== user.id && u.active);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          {user.full_name || "Sem nome"}
          {!user.active && (
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
              Inativo
            </span>
          )}
        </SheetTitle>
        <SheetDescription>{user.email}</SheetDescription>
      </SheetHeader>

      <div className="space-y-5 mt-6">
        {/* Papéis */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Papéis</Label>
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
                  onClick={() => void onRemoveRole(user.id, role)}
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
                <DropdownMenuContent align="start">
                  {availableRoles.map((r) => (
                    <DropdownMenuItem key={r} onClick={() => void onAddRole(user.id, r)}>
                      {ROLE_LABELS[r]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {aprovadorEntry && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">Alçada:</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent transition-colors">
                  {aprovadorEntry.approval_tier ? TIER_LABELS[aprovadorEntry.approval_tier] : "Não definida"}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {([1, 2, 3] as const).map((t) => (
                  <DropdownMenuItem key={t} onClick={() => void onSetTier(user.id, t)}>
                    {TIER_LABELS[t]}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void onSetTier(user.id, null)}>
                  Remover alçada
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <Separator />

        {/* Aprovador designado das requisições deste colaborador */}
        <div className="flex items-center gap-2">
          <UserRoundCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground w-24 shrink-0">Aprovador:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs transition-colors hover:bg-accent ${approver ? "text-foreground" : "text-muted-foreground italic"}`}
              >
                {approver ? (approver.full_name ?? approver.email) : "Não definido"}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              {approverCandidates.map((candidate) => (
                <DropdownMenuItem key={candidate.id} onClick={() => void onSetApprover(user.id, candidate.id)}>
                  {candidate.full_name ?? candidate.email}
                </DropdownMenuItem>
              ))}
              {user.approver_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void onSetApprover(user.id, null)}>
                    Remover aprovador
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Departamento */}
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground w-24 shrink-0">Departamento:</span>
          <Input
            className="h-8 text-xs flex-1"
            placeholder="Ex: Engenharia"
            value={currentDept}
            onChange={(e) => setEditingDept((prev) => ({ ...prev, [user.id]: e.target.value }))}
          />
          {deptChanged && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs px-2 shrink-0"
              onClick={() => void onSaveDept(user.id)}
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
                  onClick={() => void onRemoveGestor(dm.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1.5 mt-1">
              <Input
                className="h-8 text-xs flex-1"
                placeholder="Departamento..."
                value={newGestorDept[user.id] ?? ""}
                onChange={(e) => setNewGestorDept((prev) => ({ ...prev, [user.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onAddGestor(user.id);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs px-2 shrink-0"
                onClick={() => void onAddGestor(user.id)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Designar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
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

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { AppRole } from "@/features/auth/auth-context";

export interface UserWithRoles {
  id: string;
  full_name: string | null;
  email: string | null;
  department: string | null;
  approver_id: string | null;
  active: boolean;
  roles: { role: AppRole; approval_tier: 1 | 2 | 3 | null }[];
}

export interface TierThresholds {
  tier1_max: number; // aprovações até este valor (1ª alçada)
  tier2_max: number; // aprovações até este valor (2ª alçada); acima = 3ª alçada
}

// ─── Usuários ──────────────────────────────────────────────────────────────

export async function listUsersWithRoles(): Promise<UserWithRoles[]> {
  const { data: profiles, error: profilesError } = await supabaseBrowser
    .from("profiles")
    .select("id, full_name, email, department, approver_id, active")
    .order("full_name");

  if (profilesError) throw profilesError;

  const { data: userRoles, error: rolesError } = await supabaseBrowser
    .from("user_roles")
    .select("user_id, role, approval_tier");

  if (rolesError) throw rolesError;

  return (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    department: p.department,
    approver_id: p.approver_id ?? null,
    active: p.active !== false,
    roles: (userRoles ?? [])
      .filter((r) => r.user_id === p.id)
      .map((r) => ({
        role: r.role as AppRole,
        approval_tier: (r.approval_tier ?? null) as 1 | 2 | 3 | null,
      })),
  }));
}

// ─── Gestão de papéis ──────────────────────────────────────────────────────

export async function addUserRole(
  userId: string,
  role: AppRole,
  approvalTier?: 1 | 2 | 3 | null,
): Promise<void> {
  const payload: Record<string, unknown> = { user_id: userId, role };
  if (approvalTier != null) payload.approval_tier = approvalTier;

  const { error } = await supabaseBrowser.from("user_roles").insert(payload);
  if (error) throw error;
}

export async function removeUserRole(userId: string, role: AppRole): Promise<void> {
  const { error } = await supabaseBrowser
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role);
  if (error) throw error;
}

export async function updateApprovalTier(
  userId: string,
  tier: 1 | 2 | 3 | null,
): Promise<void> {
  const { error } = await supabaseBrowser
    .from("user_roles")
    .update({ approval_tier: tier })
    .eq("user_id", userId)
    .eq("role", "aprovador");
  if (error) throw error;
}

// ─── Thresholds de alçadas ─────────────────────────────────────────────────

export async function getTierThresholds(): Promise<TierThresholds> {
  const { data, error } = await supabaseBrowser
    .from("settings")
    .select("key, value")
    .in("key", ["tier1_max", "tier2_max"]);

  if (error) throw error;

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, Number(r.value)]));
  return {
    tier1_max: map["tier1_max"] ?? 1500,
    tier2_max: map["tier2_max"] ?? 3500,
  };
}

export async function saveTierThresholds(thresholds: TierThresholds): Promise<void> {
  const rows = [
    { key: "tier1_max", value: String(thresholds.tier1_max), updated_at: new Date().toISOString() },
    { key: "tier2_max", value: String(thresholds.tier2_max), updated_at: new Date().toISOString() },
  ];

  const { error } = await supabaseBrowser
    .from("settings")
    .upsert(rows, { onConflict: "key" });

  if (error) throw error;
}

// ─── Departamento do usuário ──────────────────────────────────────────────────

export async function setUserDepartment(userId: string, department: string): Promise<void> {
  const { error } = await supabaseBrowser
    .from("profiles")
    .update({ department: department.trim() || null })
    .eq("id", userId);
  if (error) throw error;
}

// ─── Aprovador designado do colaborador ────────────────────────────────────────

export async function setUserApprover(userId: string, approverId: string | null): Promise<void> {
  const { error } = await supabaseBrowser
    .from("profiles")
    .update({ approver_id: approverId })
    .eq("id", userId);
  if (error) throw error;
}

// ─── Gestores de Departamento ─────────────────────────────────────────────────

export interface DepartmentManagerEntry {
  id: string;
  department: string;
  manager_user_id: string;
}

export async function listDepartmentManagers(): Promise<DepartmentManagerEntry[]> {
  const { data, error } = await supabaseBrowser
    .from("department_managers")
    .select("id, department, manager_user_id")
    .order("department");
  if (error) throw error;
  return (data ?? []) as DepartmentManagerEntry[];
}

export async function addDepartmentManager(department: string, userId: string): Promise<void> {
  const { error } = await supabaseBrowser
    .from("department_managers")
    .insert({ department: department.trim(), manager_user_id: userId });
  if (error) throw error;
}

export async function removeDepartmentManager(entryId: string): Promise<void> {
  const { error } = await supabaseBrowser
    .from("department_managers")
    .delete()
    .eq("id", entryId);
  if (error) throw error;
}

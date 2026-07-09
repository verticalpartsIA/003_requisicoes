import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseEnv } from "@/lib/env";
import { supabaseRest } from "@/lib/supabase-rest";

async function assertIsAdmin(userId: string) {
  const resp = await supabaseRest<{ role: string }[]>(
    `user_roles?select=role&user_id=eq.${userId}&role=eq.admin&limit=1`,
  );
  if ((resp.data ?? []).length === 0) {
    throw new Error("Apenas administradores podem executar esta ação.");
  }
}

async function authAdminRequest(path: string, method: "PUT" | "DELETE", body?: unknown) {
  const env = getSupabaseEnv();
  const response = await fetch(`${env.url}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Auth admin respondeu com status ${response.status}.`);
  }
}

/** Inativa (bloqueia login) ou reativa um usuário. */
export const setUserActive = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    active: z.boolean(),
  }))
  .handler(async ({ data }) => {
    await assertIsAdmin(data.adminId);
    if (data.adminId === data.targetUserId && !data.active) {
      throw new Error("Você não pode inativar a própria conta.");
    }

    // ban_duration "none" remove o bloqueio; um prazo longo equivale a inativar.
    await authAdminRequest(`users/${data.targetUserId}`, "PUT", {
      ban_duration: data.active ? "none" : "87600h",
    });

    await supabaseRest(`profiles?id=eq.${data.targetUserId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { active: data.active },
    });

    return { ok: true };
  });

/** Exclui definitivamente a conta do usuário (auth + perfil em cascata). */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminId: z.string().uuid(),
    targetUserId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    await assertIsAdmin(data.adminId);
    if (data.adminId === data.targetUserId) {
      throw new Error("Você não pode excluir a própria conta.");
    }

    // Solta vínculos que não são cascata para não órfãos travarem a exclusão.
    await supabaseRest(`profiles?approver_id=eq.${data.targetUserId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { approver_id: null },
    });
    await supabaseRest(`department_managers?manager_user_id=eq.${data.targetUserId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });

    await authAdminRequest(`users/${data.targetUserId}`, "DELETE");

    return { ok: true };
  });

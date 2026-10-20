/**
 * Emissão do token de ciência rápida — só roda no servidor (usa node:crypto via
 * quick-link.server). Mesmo desenho do link de aprovação financeira, mas para a
 * etapa GESTOR. Regras de segurança: database/037_ciencia_quick_links.sql.
 */

import { randomBytes } from "node:crypto";
import { supabaseRest } from "@/lib/supabase-rest";
import { hashQuickToken, QUICK_LINK_TTL_HOURS } from "@/features/approvals/quick-link.server";

/** Emite um link novo e devolve o token EM CLARO (só existe na mensagem). */
export async function createCienciaQuickLink(
  requisitionId: string,
  managerId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await supabaseRest("ciencia_quick_links", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: {
      token_hash: hashQuickToken(token),
      requisition_id: requisitionId,
      manager_id: managerId,
      expires_at: new Date(Date.now() + QUICK_LINK_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    },
  });
  return token;
}

/**
 * Emissão e hash dos tokens de aprovação rápida — só roda no servidor (usa
 * node:crypto). Fica num arquivo à parte porque quick-link.ts também entra no
 * bundle do navegador (por causa dos createServerFn) e o node:crypto quebra o
 * build do cliente.
 */

import { createHash, randomBytes } from "node:crypto";
import { supabaseRest } from "@/lib/supabase-rest";

export const QUICK_LINK_TTL_HOURS = 4;

export function hashQuickToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Emite um link novo e devolve o token EM CLARO (só existe na mensagem). */
export async function createApprovalQuickLink(
  approvalId: string,
  approverId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await supabaseRest("approval_quick_links", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: {
      token_hash: hashQuickToken(token),
      approval_id: approvalId,
      approver_id: approverId,
      expires_at: new Date(Date.now() + QUICK_LINK_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    },
  });
  return token;
}

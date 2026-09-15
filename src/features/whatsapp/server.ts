/**
 * Notificações de WhatsApp por etapa da requisição — server-side only.
 *
 * Espelha o desenho de src/features/vpclick/server.ts (mesmos pontos de
 * disparo), mas envia mensagem de texto via Evolution API em vez de criar
 * tarefa no vpclick. Reaproveita a mesma regra de "quem decide a ciência do
 * gestor" já usada em features/gestor/api.ts.
 *
 * NUNCA lança exceções para o chamador — qualquer erro é apenas logado.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";
import { getApprovalLevelForValue, DEFAULT_TIER_THRESHOLDS } from "@/lib/approval";

function evolutionApiUrl() {
  return process.env.EVOLUTION_API_URL ?? "http://72.61.48.156:8080";
}
function evolutionApiKey() {
  return process.env.EVOLUTION_APIKEY ?? "";
}
function evolutionInstance() {
  return process.env.EVOLUTION_INSTANCE ?? "pv360";
}
function vpreqBaseUrl() {
  return process.env.VPREQ_BASE_URL ?? "https://maroon-dove-178367.hostingersite.com";
}

async function sendWhatsappText(number: string, text: string): Promise<void> {
  const digits = number.replace(/\D/g, "");
  if (!digits) return;
  const apikey = evolutionApiKey();
  if (!apikey) {
    console.warn("[whatsapp] EVOLUTION_APIKEY não configurada — envio ignorado");
    return;
  }
  try {
    await fetch(`${evolutionApiUrl()}/message/sendText/${evolutionInstance()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ number: digits, text }),
    });
  } catch (err) {
    console.warn("[whatsapp] falha ao enviar", err instanceof Error ? err.message : err);
  }
}

// ─── Resolução de destinatários ──────────────────────────────────────────────

async function getUserIdsByRole(role: string): Promise<string[]> {
  const resp = await supabaseRest<{ user_id: string }[]>(
    `user_roles?select=user_id&role=eq.${encodeURIComponent(role)}`,
  );
  return (resp.data ?? []).map((r) => r.user_id);
}

async function getUserIdsByRoleAndTier(role: string, tier: 1 | 2 | 3): Promise<string[]> {
  const resp = await supabaseRest<{ user_id: string }[]>(
    `user_roles?select=user_id&role=eq.${encodeURIComponent(role)}&approval_tier=eq.${tier}`,
  );
  return (resp.data ?? []).map((r) => r.user_id);
}

/** Mesma regra de features/gestor/api.ts: aprovador pessoal designado
 *  (profiles.approver_id) ou, na falta desse, os gestores do departamento. */
async function resolveLiderUserIds(
  requesterId: string | undefined,
  department: string | undefined,
): Promise<string[]> {
  if (requesterId) {
    const resp = await supabaseRest<{ approver_id: string | null }[]>(
      `profiles?select=approver_id&id=eq.${requesterId}&limit=1`,
    );
    const approverId = resp.data?.[0]?.approver_id;
    if (approverId) return [approverId];
  }
  if (department) {
    const resp = await supabaseRest<{ manager_user_id: string }[]>(
      `department_managers?select=manager_user_id&department=eq.${encodeURIComponent(department)}`,
    );
    const ids = (resp.data ?? []).map((r) => r.manager_user_id);
    if (ids.length) return ids;
  }
  return [];
}

async function getWhatsappNumbers(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const ids = userIds.map((id) => `"${id}"`).join(",");
  const resp = await supabaseRest<{ whatsapp_number: string | null }[]>(
    `profiles?select=whatsapp_number&id=in.(${ids})`,
  );
  return (resp.data ?? []).map((r) => r.whatsapp_number).filter((n): n is string => !!n);
}

async function getTierThresholds() {
  const resp = await supabaseRest<{ key: string; value: string }[]>(
    `settings?select=key,value&key=in.(tier1_max,tier2_max)`,
  );
  const map = Object.fromEntries((resp.data ?? []).map((r) => [r.key, Number(r.value)]));
  return {
    tier1_max: map["tier1_max"] ?? DEFAULT_TIER_THRESHOLDS.tier1_max,
    tier2_max: map["tier2_max"] ?? DEFAULT_TIER_THRESHOLDS.tier2_max,
  };
}

// ─── Server function principal ───────────────────────────────────────────────

const notifySchema = z.object({
  stage: z.enum(["LIDER_CIENCIA", "COMPRADOR_COTAR", "APROVACAO_PENDENTE", "COMPRA_APROVADA"]),
  requisitionId: z.string().uuid(),
  ticketNumber: z.string(),
  title: z.string(),
  module: z.string(),
  requesterName: z.string(),
  requesterId: z.string().uuid().optional(),
  requesterDepartment: z.string().optional(),
  totalValue: z.number().optional(),
});

export const notifyWhatsappStage = createServerFn({ method: "POST" })
  .inputValidator(notifySchema)
  .handler(async ({ data }) => {
    const {
      stage,
      ticketNumber,
      title,
      requesterName,
      requesterId,
      requesterDepartment,
      totalValue,
    } = data;
    const base = vpreqBaseUrl();

    try {
      if (stage === "LIDER_CIENCIA") {
        const userIds = await resolveLiderUserIds(requesterId, requesterDepartment);
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Você tem um pedido *${ticketNumber}* feito por *${requesterName}* aguardando sua ciência.\n\n` +
          `${title}\n\n🔗 Dar ciência: ${base}/approval`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text)));
      } else if (stage === "COMPRADOR_COTAR") {
        const userIds = await getUserIdsByRole("comprador");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Novo pedido liberado para cotação: *${ticketNumber}*\n\n` +
          `${title} — solicitante: ${requesterName}\n\n🔗 Cotar: ${base}/quoting`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text)));
      } else if (stage === "APROVACAO_PENDENTE") {
        const thresholds = await getTierThresholds();
        const tier = getApprovalLevelForValue(totalValue ?? 0, thresholds);
        const userIds = await getUserIdsByRoleAndTier("aprovador", tier);
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Aprovação pendente: ticket *${ticketNumber}* (Nível ${tier})\n\n` +
          `${title} — solicitante: ${requesterName}\n\n🔗 Aprovar: ${base}/approval`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text)));
      } else if (stage === "COMPRA_APROVADA") {
        const userIds = await getUserIdsByRole("comprador");
        const numbers = await getWhatsappNumbers(userIds);
        const text = `Foi aprovado o ticket *${ticketNumber}* — pode prosseguir com a compra.\n\n${title}`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text)));
      }
    } catch (err) {
      // Nunca propaga — WhatsApp é efeito colateral
      console.warn("[whatsapp]", stage, ticketNumber, err instanceof Error ? err.message : err);
    }

    return { ok: true };
  });

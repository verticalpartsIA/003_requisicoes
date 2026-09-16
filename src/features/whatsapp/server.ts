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

async function logAttempt(entry: {
  stage: string;
  requisitionId: string;
  ticketNumber: string;
  recipientNumber: string;
  status: "sent" | "error" | "skipped_no_apikey" | "skipped_no_number";
  httpStatus?: number;
  errorDetail?: string;
}): Promise<void> {
  try {
    await supabaseRest("whatsapp_notification_log", {
      method: "POST",
      body: {
        stage: entry.stage,
        requisition_id: entry.requisitionId,
        ticket_number: entry.ticketNumber,
        recipient_number: entry.recipientNumber,
        status: entry.status,
        http_status: entry.httpStatus ?? null,
        error_detail: entry.errorDetail ?? null,
      },
    });
  } catch (err) {
    // O log é só observabilidade — nunca pode derrubar o envio em si.
    console.warn(
      "[whatsapp] falha ao gravar log de tentativa",
      err instanceof Error ? err.message : err,
    );
  }
}

async function sendWhatsappText(
  number: string,
  text: string,
  context: { stage: string; requisitionId: string; ticketNumber: string },
): Promise<void> {
  const digits = number.replace(/\D/g, "");
  if (!digits) {
    await logAttempt({ ...context, recipientNumber: number, status: "skipped_no_number" });
    return;
  }
  const apikey = evolutionApiKey();
  if (!apikey) {
    console.warn("[whatsapp] EVOLUTION_APIKEY não configurada — envio ignorado");
    await logAttempt({ ...context, recipientNumber: digits, status: "skipped_no_apikey" });
    return;
  }
  try {
    const resp = await fetch(`${evolutionApiUrl()}/message/sendText/${evolutionInstance()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ number: digits, text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      await logAttempt({
        ...context,
        recipientNumber: digits,
        status: "error",
        httpStatus: resp.status,
        errorDetail: body.slice(0, 500),
      });
      return;
    }
    await logAttempt({
      ...context,
      recipientNumber: digits,
      status: "sent",
      httpStatus: resp.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[whatsapp] falha ao enviar", message);
    await logAttempt({
      ...context,
      recipientNumber: digits,
      status: "error",
      errorDetail: message.slice(0, 500),
    });
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
  stage: z.enum([
    "LIDER_CIENCIA",
    "COMPRADOR_COTAR",
    "APROVACAO_PENDENTE",
    "COMPRA_APROVADA",
    "REQUISITANTE_CIENCIA_OK",
    "REQUISITANTE_REPROVADO_GESTOR",
    "REQUISITANTE_APROVADO_FINANCEIRO",
    "REQUISITANTE_REPROVADO_FINANCEIRO",
    "REQUISITANTE_COMPRADO",
  ]),
  requisitionId: z.string().uuid(),
  ticketNumber: z.string(),
  title: z.string(),
  module: z.string(),
  requesterName: z.string(),
  requesterId: z.string().uuid().optional(),
  requesterDepartment: z.string().optional(),
  totalValue: z.number().optional(),
  rejectionReason: z.string().optional(),
});

export const notifyWhatsappStage = createServerFn({ method: "POST" })
  .inputValidator(notifySchema)
  .handler(async ({ data }) => {
    const {
      stage,
      requisitionId,
      ticketNumber,
      title,
      requesterName,
      requesterId,
      requesterDepartment,
      totalValue,
      rejectionReason,
    } = data;
    const base = vpreqBaseUrl();
    const ctx = { stage, requisitionId, ticketNumber };

    try {
      if (stage === "LIDER_CIENCIA") {
        const userIds = await resolveLiderUserIds(requesterId, requesterDepartment);
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Você tem um pedido *${ticketNumber}* feito por *${requesterName}* aguardando sua ciência.\n\n` +
          `${title}\n\n🔗 Dar ciência: ${base}/approval`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "COMPRADOR_COTAR") {
        const userIds = await getUserIdsByRole("comprador");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Tem cotação pra você fazer: pedido *${ticketNumber}*\n\n` +
          `${title} — solicitante: ${requesterName}, já com ciência do gestor.\n\n🔗 Cotar: ${base}/quoting`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "APROVACAO_PENDENTE") {
        const thresholds = await getTierThresholds();
        const tier = getApprovalLevelForValue(totalValue ?? 0, thresholds);
        const userIds = await getUserIdsByRoleAndTier("aprovador", tier);
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Aprovação pendente: ticket *${ticketNumber}* (Nível ${tier})\n\n` +
          `${title} — solicitante: ${requesterName}\n\n🔗 Aprovar: ${base}/approval`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "COMPRA_APROVADA") {
        const userIds = await getUserIdsByRole("comprador");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Tem compra aprovada pra você fazer: pedido *${ticketNumber}*\n\n` +
          `${title} já foi aprovado pelo gestor de alçada.\n\n🔗 Comprar: ${base}/purchasing`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "REQUISITANTE_CIENCIA_OK") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi aprovada pelo seu gestor e já está em cotação.\n\n${title}`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "REQUISITANTE_REPROVADO_GESTOR") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi reprovada pelo seu gestor.\n\n${title}\n\n` +
          `Motivo: ${rejectionReason || "não informado"}\n\n` +
          `Se for o caso de ajustar alguma pendência, você pode editar e reenviar.`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "REQUISITANTE_APROVADO_FINANCEIRO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi aprovada pelo financeiro e aguarda compra.\n\n${title}`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "REQUISITANTE_REPROVADO_FINANCEIRO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi reprovada pelo financeiro.\n\n${title}\n\n` +
          `Motivo: ${rejectionReason || "não informado"}\n\n` +
          `Se for o caso de ajustar alguma pendência, você pode editar e reenviar.`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      } else if (stage === "REQUISITANTE_COMPRADO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text = `Sua requisição *${ticketNumber}* foi comprada! 🛒\n\n${title}`;
        await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
      }
    } catch (err) {
      // Nunca propaga — WhatsApp é efeito colateral. Erro aqui é antes de
      // chegar a enviar (ex.: falha resolvendo destinatários) — não passa
      // por sendWhatsappText, então precisa do próprio log.
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[whatsapp]", stage, ticketNumber, message);
      await logAttempt({
        ...ctx,
        recipientNumber: "",
        status: "error",
        errorDetail: message.slice(0, 500),
      });
    }

    return { ok: true };
  });

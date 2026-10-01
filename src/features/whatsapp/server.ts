/**
 * Notificações de WhatsApp por etapa da requisição — server-side only.
 *
 * Espelha o desenho de src/features/vpclick/server.ts (mesmos pontos de
 * disparo), mas envia mensagem de texto via Evolution API em vez de criar
 * tarefa no vpclick. Reaproveita a mesma regra de "quem decide a ciência do
 * gestor" já usada em features/gestor/api.ts.
 *
 * NUNCA lança exceções para o chamador — qualquer erro é apenas logado.
 *
 * O aviso de requisição vencida (SLA) NÃO passa por aqui: é disparado
 * direto do Postgres via pg_cron/pg_net a cada 4h, sem depender do app
 * estar de pé. Ver database/035_sla_breach_notifications.sql.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";
import { getApprovalLevelForValue, DEFAULT_TIER_THRESHOLDS } from "@/lib/approval";
import { buildPartialApprovalMessage } from "@/features/whatsapp/partial-approval";
import {
  createApprovalQuickLink,
  QUICK_LINK_TTL_HOURS,
} from "@/features/approvals/quick-link.server";
import { createCienciaQuickLink } from "@/features/approvals/ciencia-link.server";

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
  return (process.env.VPREQ_BASE_URL ?? "https://maroon-dove-178367.hostingersite.com").replace(
    /\/+$/,
    "",
  );
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

/** Como getWhatsappNumbers, mas mantém o vínculo usuário → número (o link de
 *  aprovação rápida é emitido por aprovador). */
async function getWhatsappRecipients(
  userIds: string[],
): Promise<{ userId: string; number: string }[]> {
  if (!userIds.length) return [];
  const ids = userIds.map((id) => `"${id}"`).join(",");
  const resp = await supabaseRest<{ id: string; whatsapp_number: string | null }[]>(
    `profiles?select=id,whatsapp_number&id=in.(${ids})`,
  );
  return (resp.data ?? [])
    .filter((r): r is { id: string; whatsapp_number: string } => !!r.whatsapp_number)
    .map((r) => ({ userId: r.id, number: r.whatsapp_number }));
}

/** Nome do solicitante direto da requisição — o front nem sempre o envia
 *  (ex.: finalização da cotação manda ""), e a mensagem saía "solicitante: ". */
async function resolveRequesterName(requisitionId: string): Promise<string> {
  try {
    const resp = await supabaseRest<{ requester_name: string | null }[]>(
      `requisitions?select=requester_name&id=eq.${requisitionId}&limit=1`,
    );
    return resp.data?.[0]?.requester_name?.trim() || "não informado";
  } catch {
    return "não informado";
  }
}

/** Envia o mesmo texto a vários números. Se não houver nenhum destinatário
 *  com WhatsApp, registra isso no log — antes a falha era silenciosa. */
async function sendToAll(
  numbers: string[],
  text: string,
  ctx: { stage: string; requisitionId: string; ticketNumber: string },
): Promise<void> {
  if (!numbers.length) {
    await logAttempt({ ...ctx, recipientNumber: "", status: "skipped_no_number" });
    return;
  }
  await Promise.all(numbers.map((n) => sendWhatsappText(n, text, ctx)));
}

/** Perfil do solicitante gravado na própria requisição (o front nem sempre o
 *  envia — ex.: finalização da cotação e recebimento). */
async function resolveRequesterProfileId(requisitionId: string): Promise<string | undefined> {
  try {
    const resp = await supabaseRest<{ requester_profile_id: string | null }[]>(
      `requisitions?select=requester_profile_id&id=eq.${requisitionId}&limit=1`,
    );
    return resp.data?.[0]?.requester_profile_id ?? undefined;
  } catch {
    return undefined;
  }
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
    "REQUISITANTE_APROVADO_PARCIAL",
    "REQUISITANTE_COMPRADO",
    "EXPEDICAO_RECEBIMENTO",
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
  rejectedItems: z.array(z.string().max(300)).max(500).optional(),
  approvedCount: z.number().int().nonnegative().optional(),
  supplierName: z.string().max(200).optional(),
});

export const notifyWhatsappStage = createServerFn({ method: "POST" })
  .inputValidator(notifySchema)
  .handler(async ({ data }) => {
    const {
      stage,
      requisitionId,
      ticketNumber,
      title,
      requesterName: requesterNameInput,
      requesterId,
      requesterDepartment,
      totalValue,
      rejectionReason,
      rejectedItems,
      approvedCount,
      supplierName,
    } = data;
    const base = vpreqBaseUrl();
    const requesterName = requesterNameInput.trim() || (await resolveRequesterName(requisitionId));
    const ctx = { stage, requisitionId, ticketNumber };

    try {
      if (stage === "LIDER_CIENCIA") {
        const userIds = await resolveLiderUserIds(requesterId, requesterDepartment);
        const recipients = await getWhatsappRecipients(userIds);
        const numbers = recipients.map((r) => r.number);
        const header =
          `Você tem um pedido *${ticketNumber}* feito por *${requesterName}* aguardando sua ciência.\n\n` +
          `${title}\n\n`;
        const systemLink = `💻 Abrir no sistema: ${base}/approval?req=${requisitionId}`;
        await Promise.all(
          recipients.map(async ({ userId, number }) => {
            // Link de ciência com 1 toque, exclusivo deste gestor. Se não der
            // pra emitir, cai no link normal (que pede login) — o aviso nunca
            // deixa de sair por causa disso.
            let text = `${header}🔗 Dar ciência: ${base}/approval?req=${requisitionId}`;
            try {
              const token = await createCienciaQuickLink(requisitionId, userId);
              text =
                `${header}👉 Dar ciência/Reprovar direto pelo celular (vale ${QUICK_LINK_TTL_HOURS}h, uso único):\n` +
                `${base}/aprovar/${token}\n\n${systemLink}`;
            } catch (err) {
              console.warn("[whatsapp] falha ao emitir link de ciência rápida", err);
            }
            await sendWhatsappText(number, text, ctx);
          }),
        );
        if (!recipients.length) {
          await logAttempt({ ...ctx, recipientNumber: "", status: "skipped_no_number" });
        }

        // Confirmação ao próprio solicitante (se ele também é quem dá a ciência,
        // já recebeu a mensagem acima — não duplica).
        const own = (await getWhatsappNumbers(requesterId ? [requesterId] : [])).filter(
          (n) => !numbers.includes(n),
        );
        if (own.length) {
          await sendToAll(
            own,
            `Sua requisição *${ticketNumber}* foi criada e enviada para a ciência do seu gestor.\n\n${title}`,
            { ...ctx, stage: "REQUISITANTE_CRIADA" },
          );
        }
      } else if (stage === "COMPRADOR_COTAR") {
        const userIds = await getUserIdsByRole("cotador");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Tem cotação pra você fazer: pedido *${ticketNumber}*\n\n` +
          `${title} — solicitante: ${requesterName}, já com ciência do gestor.\n\n🔗 Cotar: ${base}/quoting`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "APROVACAO_PENDENTE") {
        const thresholds = await getTierThresholds();
        const tier = getApprovalLevelForValue(totalValue ?? 0, thresholds);
        const userIds = await getUserIdsByRoleAndTier("aprovador", tier);
        const recipients = await getWhatsappRecipients(userIds);
        const approvalResp = await supabaseRest<{ id: string }[]>(
          `approvals?select=id&requisition_id=eq.${requisitionId}&limit=1`,
        );
        const approvalId = approvalResp.data?.[0]?.id;
        const header =
          `Aprovação pendente: ticket *${ticketNumber}* (Nível ${tier})\n\n` +
          `${title} — solicitante: ${requesterName}\n\n`;
        const systemLink = `💻 Abrir no sistema: ${base}/approval?req=${requisitionId}`;
        await Promise.all(
          recipients.map(async ({ userId, number }) => {
            // Link de aprovação com 1 toque, exclusivo deste aprovador. Se não
            // der pra emitir, cai no link normal (que pede login) — o aviso
            // nunca deixa de sair por causa disso.
            let text = `${header}${systemLink}`;
            if (approvalId) {
              try {
                const token = await createApprovalQuickLink(approvalId, userId);
                text =
                  `${header}👉 Aprovar/Reprovar direto pelo celular (vale ${QUICK_LINK_TTL_HOURS}h, uso único):\n` +
                  `${base}/aprovar/${token}\n\n${systemLink}`;
              } catch (err) {
                console.warn("[whatsapp] falha ao emitir link de aprovação rápida", err);
              }
            }
            await sendWhatsappText(number, text, ctx);
          }),
        );
        if (!recipients.length) {
          await logAttempt({ ...ctx, recipientNumber: "", status: "skipped_no_number" });
        }

        const reqId = requesterId ?? (await resolveRequesterProfileId(requisitionId));
        const own = await getWhatsappNumbers(reqId ? [reqId] : []);
        await sendToAll(
          own,
          `Sua requisição *${ticketNumber}* foi cotada e está aguardando aprovação financeira.\n\n${title}`,
          { ...ctx, stage: "REQUISITANTE_COTADO" },
        );
      } else if (stage === "COMPRA_APROVADA") {
        const userIds = await getUserIdsByRole("comprador");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `Tem compra aprovada pra você fazer: pedido *${ticketNumber}*\n\n` +
          `${title} já foi aprovado pelo gestor de alçada.\n\n🔗 Comprar: ${base}/purchasing`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_CIENCIA_OK") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text = `Sua requisição *${ticketNumber}* foi aprovada pelo seu gestor e já está em cotação.\n\n${title}`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_REPROVADO_GESTOR") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi reprovada pelo seu gestor.\n\n${title}\n\n` +
          `Motivo: ${rejectionReason || "não informado"}\n\n` +
          `Se for o caso de ajustar alguma pendência, você pode editar e reenviar.`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_APROVADO_FINANCEIRO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text = `Sua requisição *${ticketNumber}* foi aprovada pelo financeiro e aguarda compra.\n\n${title}`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_REPROVADO_FINANCEIRO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text =
          `Sua requisição *${ticketNumber}* foi reprovada pelo financeiro.\n\n${title}\n\n` +
          `Motivo: ${rejectionReason || "não informado"}\n\n` +
          `Se for o caso de ajustar alguma pendência, você pode editar e reenviar.`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_APROVADO_PARCIAL") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text = buildPartialApprovalMessage({
          ticketNumber,
          title,
          approvedCount: approvedCount ?? 0,
          rejectedItems: rejectedItems ?? [],
          rejectionReason,
        });
        await sendToAll(numbers, text, ctx);
      } else if (stage === "REQUISITANTE_COMPRADO") {
        const numbers = await getWhatsappNumbers(requesterId ? [requesterId] : []);
        const text = `Sua requisição *${ticketNumber}* foi comprada! 🛒\n\n${title}`;
        await sendToAll(numbers, text, ctx);
      } else if (stage === "EXPEDICAO_RECEBIMENTO") {
        const userIds = await getUserIdsByRole("expedicao");
        const numbers = await getWhatsappNumbers(userIds);
        const text =
          `📦 Chegou material do pedido *${ticketNumber}*\n\n${title}` +
          (supplierName ? ` — fornecedor: ${supplierName}` : "") +
          `\nSolicitante: ${requesterName}`;
        await sendToAll(numbers, text, ctx);

        const reqId = requesterId ?? (await resolveRequesterProfileId(requisitionId));
        const own = (await getWhatsappNumbers(reqId ? [reqId] : [])).filter(
          (n) => !numbers.includes(n),
        );
        if (own.length) {
          await sendToAll(
            own,
            `📦 O material da sua requisição *${ticketNumber}* chegou na expedição.\n\n${title}` +
              (supplierName ? ` — fornecedor: ${supplierName}` : ""),
            { ...ctx, stage: "REQUISITANTE_RECEBIDO" },
          );
        }
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

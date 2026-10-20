/**
 * Ciência rápida por WhatsApp — server functions.
 *
 * O gestor recebe `/aprovar/<token>` e dá ciência / reprova direto no celular,
 * sem login. Regras de segurança (hash do token, uso único, 4h, permissão
 * revalidada) vivem em database/037_ciencia_quick_links.sql.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseEnv } from "@/lib/env";
import { hashQuickToken } from "@/features/approvals/quick-link.server";
import { supabaseRest } from "@/lib/supabase-rest";

export type CienciaQuickPreview =
  | { status: "invalid" | "expired" | "used" | "not_pending"; message: string }
  | {
      status: "ok";
      expiresAt: string;
      requisitionId: string;
      ticketNumber: string;
      title: string;
      module: string;
      justification: string | null;
      urgency: string | null;
      requesterName: string;
      requesterProfileId: string | null;
      items: { productName: string; quantity: number | null }[];
    };

const tokenSchema = z.object({ token: z.string().min(20).max(200) });

export const getCienciaQuick = createServerFn({ method: "GET" })
  .inputValidator(tokenSchema)
  .handler(async ({ data }): Promise<CienciaQuickPreview> => {
    const hash = hashQuickToken(data.token);
    const linkResp = await supabaseRest<
      { requisition_id: string; expires_at: string; used_at: string | null }[]
    >(`ciencia_quick_links?select=requisition_id,expires_at,used_at&token_hash=eq.${hash}&limit=1`);
    const link = linkResp.data[0];
    if (!link) return { status: "invalid", message: "Link inválido." };
    if (link.used_at) return { status: "used", message: "Este link já foi usado." };
    if (new Date(link.expires_at).getTime() < Date.now()) {
      return {
        status: "expired",
        message: "Este link expirou (validade de 4 horas). Abra o sistema para decidir.",
      };
    }

    const reqResp = await supabaseRest<
      {
        id: string;
        ticket_number: string;
        title: string;
        module: string;
        justification: string | null;
        urgency: string | null;
        requester_name: string | null;
        requester_profile_id: string | null;
        status: string;
        module_data: Record<string, unknown> | null;
      }[]
    >(
      `requisitions?select=id,ticket_number,title,module,justification,urgency,requester_name,requester_profile_id,status,module_data&id=eq.${link.requisition_id}&limit=1`,
    );
    const r = reqResp.data[0];
    if (!r) return { status: "invalid", message: "Requisição não encontrada." };
    if (r.status !== "GESTOR") {
      return {
        status: "not_pending",
        message: "Esta requisição não está mais aguardando a ciência do gestor.",
      };
    }

    const rawItems =
      r.module === "M1"
        ? (r.module_data?.items as Array<Record<string, unknown>> | undefined)
        : undefined;

    return {
      status: "ok",
      expiresAt: link.expires_at,
      requisitionId: r.id,
      ticketNumber: r.ticket_number,
      title: r.title,
      module: r.module,
      justification: r.justification,
      urgency: r.urgency,
      requesterName: r.requester_name ?? "",
      requesterProfileId: r.requester_profile_id,
      items: (rawItems ?? []).map((it) => ({
        productName: String(it.product_name ?? ""),
        quantity: (it.quantity as number | null) ?? null,
      })),
    };
  });

const decideSchema = z.object({
  token: z.string().min(20).max(200),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().max(500).optional(),
});

export const decideCienciaQuick = createServerFn({ method: "POST" })
  .inputValidator(decideSchema)
  .handler(async ({ data }) => {
    const env = getSupabaseEnv();
    // Chamada direta ao RPC: o erro de negócio vem em português do RAISE
    // EXCEPTION e é repassado como está para a página.
    const response = await fetch(`${env.url}/rest/v1/rpc/quick_decide_ciencia`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_token_hash: hashQuickToken(data.token),
        p_decision: data.decision,
        p_notes: data.notes ?? null,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      new_status?: string;
      ticket_number?: string;
      requisition_id?: string;
    };
    if (!response.ok) {
      throw new Error(body.message || "Não foi possível registrar a decisão.");
    }
    return {
      newStatus: body.new_status ?? "",
      ticketNumber: body.ticket_number ?? "",
      requisitionId: body.requisition_id ?? "",
    };
  });

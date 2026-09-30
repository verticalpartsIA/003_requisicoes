/**
 * Aprovação rápida por WhatsApp — server-side only.
 *
 * O aprovador recebe um link `/aprovar/<token>` no WhatsApp e decide o ticket
 * inteiro (aprovar tudo / reprovar tudo) direto no celular, sem login. Regras
 * de segurança (token aleatório com só o hash no banco, uso único, 4h,
 * amarrado a aprovação+aprovador, alçada revalidada) vivem em
 * database/036_approval_quick_links.sql — aqui só emitimos o token e
 * chamamos a função de decisão.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseEnv } from "@/lib/env";
import { hashQuickToken } from "@/features/approvals/quick-link.server";
import { supabaseRest } from "@/lib/supabase-rest";

export type QuickApprovalPreview =
  | { status: "invalid" | "expired" | "used" | "decided" | "not_pending"; message: string }
  | {
      status: "ok";
      expiresAt: string;
      requisitionId: string;
      ticketNumber: string;
      title: string;
      module: string;
      requesterName: string;
      requesterProfileId: string | null;
      justification: string | null;
      totalValue: number;
      approvalLevel: number;
      itemCount: number;
      suppliers: { name: string; price: number }[];
    };

interface LinkRow {
  approval_id: string;
  expires_at: string;
  used_at: string | null;
}

const tokenSchema = z.object({ token: z.string().min(20).max(200) });

export const getQuickApproval = createServerFn({ method: "GET" })
  .inputValidator(tokenSchema)
  .handler(async ({ data }): Promise<QuickApprovalPreview> => {
    const hash = hashQuickToken(data.token);
    const linkResp = await supabaseRest<LinkRow[]>(
      `approval_quick_links?select=approval_id,expires_at,used_at&token_hash=eq.${hash}&limit=1`,
    );
    const link = linkResp.data[0];
    if (!link) return { status: "invalid", message: "Link inválido." };
    if (link.used_at) return { status: "used", message: "Este link já foi usado." };
    if (new Date(link.expires_at).getTime() < Date.now()) {
      return {
        status: "expired",
        message: "Este link expirou (validade de 4 horas). Abra o sistema para decidir.",
      };
    }

    const approvalResp = await supabaseRest<
      {
        id: string;
        requisition_id: string;
        quotation_id: string | null;
        approval_level: number;
        total_value: number | null;
        decision: string;
      }[]
    >(
      `approvals?select=id,requisition_id,quotation_id,approval_level,total_value,decision&id=eq.${link.approval_id}&limit=1`,
    );
    const approval = approvalResp.data[0];
    if (!approval) return { status: "invalid", message: "Aprovação não encontrada." };
    if (approval.decision !== "pending") {
      return { status: "decided", message: "Esta aprovação já foi decidida." };
    }

    const reqResp = await supabaseRest<
      {
        ticket_number: string;
        title: string;
        module: string;
        requester_name: string | null;
        requester_profile_id: string | null;
        justification: string | null;
        status: string;
      }[]
    >(
      `requisitions?select=ticket_number,title,module,requester_name,requester_profile_id,justification,status&id=eq.${approval.requisition_id}&limit=1`,
    );
    const requisition = reqResp.data[0];
    if (!requisition || requisition.status !== "APROVAÇÃO") {
      return { status: "not_pending", message: "A requisição não está mais aguardando aprovação." };
    }

    const itemsResp = await supabaseRest<{ id: string }[]>(
      `approval_items?select=id&approval_id=eq.${approval.id}`,
    );
    const suppliersResp = approval.quotation_id
      ? await supabaseRest<{ supplier_name: string; price: number | null }[]>(
          `quotation_suppliers?select=supplier_name,price&quotation_id=eq.${approval.quotation_id}&is_winner=eq.true`,
        )
      : { data: [] as { supplier_name: string; price: number | null }[] };

    return {
      status: "ok",
      expiresAt: link.expires_at,
      requisitionId: approval.requisition_id,
      ticketNumber: requisition.ticket_number,
      title: requisition.title,
      module: requisition.module,
      requesterName: requisition.requester_name ?? "",
      requesterProfileId: requisition.requester_profile_id,
      justification: requisition.justification,
      totalValue: approval.total_value ?? 0,
      approvalLevel: approval.approval_level,
      itemCount: itemsResp.data.length,
      suppliers: suppliersResp.data.map((s) => ({ name: s.supplier_name, price: s.price ?? 0 })),
    };
  });

const decideSchema = z.object({
  token: z.string().min(20).max(200),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().max(1000).optional(),
});

export const decideQuickApproval = createServerFn({ method: "POST" })
  .inputValidator(decideSchema)
  .handler(async ({ data }) => {
    const env = getSupabaseEnv();
    // Chamada direta ao RPC: o erro de negócio vem em português do RAISE
    // EXCEPTION e é repassado como está para a página.
    const response = await fetch(`${env.url}/rest/v1/rpc/quick_decide_approval`, {
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

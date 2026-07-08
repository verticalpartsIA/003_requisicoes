/**
 * M7 - Quadro de Comando — funções server-side para a página pública
 * (/pedido-comando/$token). Não há login nem sessão Supabase nessa página:
 * todo acesso é validado pelo token e feito via service role (bypassa RLS).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { getSupabaseEnv } from "@/lib/env";
import { supabaseRest } from "@/lib/supabase-rest";
import type { ComandoAnexo, ComandoPedido } from "@/features/comando/types";

function requestContext() {
  const ip = getRequestIP({ xForwardedFor: true }) ?? null;
  const userAgent = getRequestHeader("user-agent") ?? null;
  return { ip, userAgent };
}

async function registrarAuditoria(
  pedidoId: string,
  evento: "visualizado" | "respondido" | "reaberto",
  ctx: { ip: string | null; userAgent: string | null },
) {
  await supabaseRest("comando_auditoria", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: [
      {
        pedido_id: pedidoId,
        evento,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
      },
    ],
  });
}

function isExpired(pedido: Pick<ComandoPedido, "expires_at">) {
  return !!pedido.expires_at && new Date(pedido.expires_at).getTime() < Date.now();
}

// ─── Envio direto de WhatsApp (gateway interno VerticalParts) ─────────────────
// Envia a mensagem de verdade para o número do cliente, sem depender do
// WhatsApp Web aberto no navegador do vendedor.

function evolutionConfig() {
  return {
    url: process.env.EVOLUTION_URL ?? "http://72.61.48.156:8080",
    apikey: process.env.EVOLUTION_APIKEY ?? "suporte123",
    instance: process.env.EVOLUTION_INSTANCE ?? "pv360",
  };
}

export const enviarWhatsAppComando = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      telefone: z.string().min(8),
      texto: z.string().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const digits = data.telefone.replace(/\D/g, "");
    const number = digits.length <= 11 ? `55${digits}` : digits;

    const evo = evolutionConfig();
    const resp = await fetch(`${evo.url}/message/sendText/${evo.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evo.apikey },
      body: JSON.stringify({ number, text: data.texto }),
    });
    const result = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const detail = (result?.message as string) ?? (result?.error as string) ?? `HTTP ${resp.status}`;
      throw new Error(`Gateway WhatsApp: ${JSON.stringify(detail)}`);
    }

    return { ok: true };
  });

// ─── Buscar pedido pelo token (e marcar como visualizado) ────────────────────

export const getPedidoPublico = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(10) }))
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseRest<ComandoPedido[]>(
      `comando_pedidos?select=*&token=eq.${encodeURIComponent(data.token)}&limit=1`,
    );
    const pedido = rows?.[0];
    if (!pedido) throw new Error("Formulário não encontrado. Verifique o link recebido.");
    if (pedido.status === "rascunho") throw new Error("Este formulário ainda não foi enviado pelo vendedor.");
    if (isExpired(pedido)) throw new Error("Este link expirou. Solicite um novo link ao vendedor responsável.");

    const ctx = requestContext();
    if (pedido.status === "enviado") {
      await supabaseRest(`comando_pedidos?id=eq.${pedido.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "visualizado", visualizado_at: new Date().toISOString() },
      });
      await registrarAuditoria(pedido.id, "visualizado", ctx);
      pedido.status = "visualizado";
    }

    const { data: anexos } = await supabaseRest<ComandoAnexo[]>(
      `comando_anexos?select=*&pedido_id=eq.${pedido.id}&order=created_at.asc`,
    );

    return { pedido, anexos: anexos ?? [] };
  });

// ─── Enviar respostas do formulário ───────────────────────────────────────────

export const enviarRespostasPublico = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string().min(10),
      respostas: z.record(z.unknown()),
    }),
  )
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseRest<ComandoPedido[]>(
      `comando_pedidos?select=id,status,expires_at&token=eq.${encodeURIComponent(data.token)}&limit=1`,
    );
    const pedido = rows?.[0];
    if (!pedido) throw new Error("Formulário não encontrado.");
    if (pedido.status === "rascunho") throw new Error("Este formulário ainda não foi enviado pelo vendedor.");
    if (isExpired(pedido)) throw new Error("Este link expirou. Solicite um novo link ao vendedor responsável.");
    if (pedido.status === "respondido") {
      throw new Error("Este formulário já foi respondido. Solicite ao vendedor para reabrir, se precisar alterar algo.");
    }

    await supabaseRest(`comando_pedidos?id=eq.${pedido.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        respostas: data.respostas,
        status: "respondido",
        respondido_at: new Date().toISOString(),
      },
    });

    await registrarAuditoria(pedido.id, "respondido", requestContext());

    return { ok: true };
  });

// ─── Upload de anexo (fotos de plaqueta, logo etc.) ──────────────────────────

const MAX_ANEXO_BYTES = 10 * 1024 * 1024;

export const uploadAnexoPublico = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string().min(10),
      secao: z.string().max(50),
      fileName: z.string().max(200),
      mimeType: z.string().max(100),
      base64Content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseRest<ComandoPedido[]>(
      `comando_pedidos?select=id,status,expires_at&token=eq.${encodeURIComponent(data.token)}&limit=1`,
    );
    const pedido = rows?.[0];
    if (!pedido) throw new Error("Formulário não encontrado.");
    if (isExpired(pedido)) throw new Error("Este link expirou.");
    if (pedido.status === "respondido") throw new Error("Este formulário já foi respondido.");

    const binary = Buffer.from(data.base64Content, "base64");
    if (binary.byteLength > MAX_ANEXO_BYTES) {
      throw new Error("Arquivo muito grande (máximo 10MB).");
    }

    const env = getSupabaseEnv();
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${data.token}/${Date.now()}_${safeName}`;

    const uploadResp = await fetch(
      `${env.url}/storage/v1/object/comando-anexos/${path}`,
      {
        method: "POST",
        headers: {
          apikey: env.serviceRoleKey,
          Authorization: `Bearer ${env.serviceRoleKey}`,
          "Content-Type": data.mimeType || "application/octet-stream",
        },
        body: binary,
      },
    );
    if (!uploadResp.ok) {
      throw new Error(`Falha ao enviar arquivo: ${await uploadResp.text()}`);
    }

    const { data: created } = await supabaseRest<ComandoAnexo[]>("comando_anexos", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: [
        {
          pedido_id: pedido.id,
          secao: data.secao,
          file_path: path,
          file_name: data.fileName,
          file_size: binary.byteLength,
          mime_type: data.mimeType || null,
        },
      ],
    });

    return { anexo: created?.[0] ?? null };
  });

export const removerAnexoPublico = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().min(10), anexoId: z.string() }))
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseRest<ComandoPedido[]>(
      `comando_pedidos?select=id,status&token=eq.${encodeURIComponent(data.token)}&limit=1`,
    );
    const pedido = rows?.[0];
    if (!pedido) throw new Error("Formulário não encontrado.");
    if (pedido.status === "respondido") throw new Error("Este formulário já foi respondido.");

    const { data: anexoRows } = await supabaseRest<Array<{ id: string; file_path: string }>>(
      `comando_anexos?select=id,file_path&id=eq.${data.anexoId}&pedido_id=eq.${pedido.id}&limit=1`,
    );
    const anexo = anexoRows?.[0];
    if (!anexo) return { ok: true };

    const env = getSupabaseEnv();
    await fetch(`${env.url}/storage/v1/object/comando-anexos/${anexo.file_path}`, {
      method: "DELETE",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
      },
    });
    await supabaseRest(`comando_anexos?id=eq.${anexo.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });

    return { ok: true };
  });

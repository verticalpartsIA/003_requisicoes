/**
 * M7 - Quadro de Comando — funções client-side do painel interno.
 * Usa supabaseBrowser (sessão do usuário autenticado + RLS), no mesmo padrão
 * usado pelos módulos M2/M5/M6.
 */

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { ComandoAnexo, ComandoAuditoria, ComandoPedido, ComandoPedidoStatus } from "@/features/comando/types";
import { COMANDO_LINK_EXPIRATION_DAYS } from "@/features/comando/types";

export async function listComandoPedidos(status?: ComandoPedidoStatus | "todos") {
  let query = supabaseBrowser
    .from("comando_pedidos")
    .select("*")
    .order("created_at", { ascending: false });

  if (status && status !== "todos") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ComandoPedido[];
}

export async function getComandoPedidoDetalhe(id: string) {
  const [{ data: pedido, error: pedidoError }, { data: anexos, error: anexosError }, { data: auditoria, error: auditoriaError }] =
    await Promise.all([
      supabaseBrowser.from("comando_pedidos").select("*").eq("id", id).single(),
      supabaseBrowser.from("comando_anexos").select("*").eq("pedido_id", id).order("created_at", { ascending: true }),
      supabaseBrowser.from("comando_auditoria").select("*").eq("pedido_id", id).order("created_at", { ascending: true }),
    ]);

  if (pedidoError) throw pedidoError;
  if (anexosError) throw anexosError;
  if (auditoriaError) throw auditoriaError;

  return {
    pedido: pedido as ComandoPedido,
    anexos: (anexos ?? []) as ComandoAnexo[],
    auditoria: (auditoria ?? []) as ComandoAuditoria[],
  };
}

export async function createComandoPedido(input: {
  clienteNome: string;
  clienteTelefone: string;
  clienteEmail?: string | null;
  projetoNumero?: string | null;
  observacoesInternas?: string | null;
}) {
  const { data, error } = await supabaseBrowser
    .from("comando_pedidos")
    .insert({
      cliente_nome: input.clienteNome,
      cliente_telefone: input.clienteTelefone,
      cliente_email: input.clienteEmail || null,
      projeto_numero: input.projetoNumero || null,
      observacoes_internas: input.observacoesInternas || null,
      status: "rascunho",
    })
    .select()
    .single();

  if (error) throw error;
  return data as ComandoPedido;
}

/** Marca o pedido como enviado e (re)inicia a janela de expiração do link. */
export async function marcarComandoPedidoEnviado(id: string, userId: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + COMANDO_LINK_EXPIRATION_DAYS);

  const { data, error } = await supabaseBrowser
    .from("comando_pedidos")
    .update({
      status: "enviado",
      enviado_at: new Date().toISOString(),
      enviado_by: userId,
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  await supabaseBrowser.from("comando_auditoria").insert({
    pedido_id: id,
    evento: "enviado",
  });

  return data as ComandoPedido;
}

/** Reabre um pedido já respondido, permitindo que o cliente responda de novo. */
export async function reabrirComandoPedido(id: string, userId: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + COMANDO_LINK_EXPIRATION_DAYS);

  const { data, error } = await supabaseBrowser
    .from("comando_pedidos")
    .update({
      status: "enviado",
      reaberto_at: new Date().toISOString(),
      reaberto_by: userId,
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  await supabaseBrowser.from("comando_auditoria").insert({
    pedido_id: id,
    evento: "reaberto",
  });

  return data as ComandoPedido;
}

export async function excluirComandoPedido(id: string) {
  const { error } = await supabaseBrowser.from("comando_pedidos").delete().eq("id", id);
  if (error) throw error;
}

export function comandoPublicUrl(token: string) {
  const base =
    (typeof window !== "undefined" && window.location.origin) || "https://maroon-dove-178367.hostingersite.com";
  return `${base}/pedido-comando/${token}`;
}

export function comandoWhatsAppLink(telefone: string, url: string, numeroDocumento: string) {
  const digits = telefone.replace(/\D/g, "");
  const phone = digits.length <= 11 ? `55${digits}` : digits;
  const message =
    `Olá! Segue o formulário técnico ${numeroDocumento} para levantamento do seu Quadro de Comando de Elevador. ` +
    `Por favor, preencha pelo link abaixo:\n${url}\n\n` +
    `O link é válido por ${COMANDO_LINK_EXPIRATION_DAYS} dias. Qualquer dúvida, estamos à disposição!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

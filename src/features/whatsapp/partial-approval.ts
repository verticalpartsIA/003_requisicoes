// Mensagem de WhatsApp para o requisitante quando a Aprovação (V3) aprova só
// parte dos itens (M1 multi-itens / M2). Antes ele recebia a mesma mensagem
// de "aprovada pelo financeiro" da aprovação total, sem saber que algum item
// tinha ficado de fora — só descobria no recebimento.

/** Limite de itens listados — WhatsApp aceita textos longos, mas uma lista
 *  de 29 linhas vira ruído; o restante é resumido em "+N outro(s)". */
export const MAX_LISTED_ITEMS = 15;

export interface PartialApprovalMessageInput {
  ticketNumber: string;
  title: string;
  approvedCount: number;
  rejectedItems: string[];
  rejectionReason?: string;
}

export function buildPartialApprovalMessage({
  ticketNumber,
  title,
  approvedCount,
  rejectedItems,
  rejectionReason,
}: PartialApprovalMessageInput): string {
  const total = approvedCount + rejectedItems.length;
  const listed = rejectedItems.slice(0, MAX_LISTED_ITEMS).map((label) => `• ${label}`);
  const hidden = rejectedItems.length - listed.length;
  if (hidden > 0) listed.push(`• +${hidden} outro(s)`);

  return (
    `Sua requisição *${ticketNumber}* foi aprovada *parcialmente* pelo financeiro: ` +
    `${approvedCount} de ${total} ${total === 1 ? "item segue" : "itens seguem"} para compra.\n\n` +
    `${title}\n\n` +
    `❌ Itens reprovados (${rejectedItems.length}):\n${listed.join("\n")}\n\n` +
    `Motivo: ${rejectionReason?.trim() || "não informado"}\n\n` +
    `Se ainda precisar dos itens reprovados, abra uma nova requisição com eles.`
  );
}

/** Rótulo de um item para a lista: `[código] descrição — qtd. N`. */
export function partialApprovalItemLabel(item: {
  productCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  fallbackLabel: string;
  supplierName?: string;
}): string {
  const code = item.productCode ? `[${item.productCode}] ` : "";
  const name = item.description?.trim() || item.fallbackLabel;
  const qty = item.quantity != null ? ` — qtd. ${item.quantity}` : "";
  const supplier = !item.productCode && item.supplierName ? ` (${item.supplierName})` : "";
  return `${code}${name}${qty}${supplier}`;
}

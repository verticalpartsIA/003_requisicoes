// Mensagem de WhatsApp para o requisitante quando o comprador devolve a
// requisição na Cotação por falta de informação (QUOTATION_RETURNED_FOR_INFO).
// Antes o ticket ia para REJEITADO e o requisitante só descobria abrindo o
// sistema — nenhum aviso saía, ao contrário das reprovações do gestor e do
// financeiro.

export interface ReturnedForInfoMessageInput {
  ticketNumber: string;
  title: string;
  reason?: string;
  /** Base do sistema (sem barra final) para o link de Movimentações. */
  baseUrl: string;
}

export function buildReturnedForInfoMessage({
  ticketNumber,
  title,
  reason,
  baseUrl,
}: ReturnedForInfoMessageInput): string {
  return (
    `Sua requisição *${ticketNumber}* foi devolvida pelo comprador por falta de informação.\n\n` +
    `${title}\n\n` +
    `Motivo: ${reason?.trim() || "não informado"}\n\n` +
    `Complete o que faltou e reenvie — ela volta direto para a cotação.\n` +
    `🔗 Corrigir e reenviar: ${baseUrl}/movimentacoes`
  );
}

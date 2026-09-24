/**
 * WhatsApp — wrapper client-side
 *
 * Chame sempre com void + .catch para que erros de integração nunca bloqueiem
 * o fluxo principal. Exemplo: void notifyWhatsappClient({ ... }).catch(console.warn)
 */

import { notifyWhatsappStage } from "@/features/whatsapp/server";

export type WhatsappStage =
  | "LIDER_CIENCIA"
  | "COMPRADOR_COTAR"
  | "APROVACAO_PENDENTE"
  | "COMPRA_APROVADA"
  | "REQUISITANTE_CIENCIA_OK"
  | "REQUISITANTE_REPROVADO_GESTOR"
  | "REQUISITANTE_APROVADO_FINANCEIRO"
  | "REQUISITANTE_REPROVADO_FINANCEIRO"
  | "REQUISITANTE_APROVADO_PARCIAL"
  | "REQUISITANTE_COMPRADO"
  | "EXPEDICAO_RECEBIMENTO";

export interface WhatsappNotifyInput {
  stage: WhatsappStage;
  requisitionId: string;
  ticketNumber: string;
  title: string;
  module: string;
  requesterName: string;
  /** LIDER_CIENCIA: resolve o aprovador pessoal designado do solicitante,
   *  ou os gestores do departamento como fallback.
   *  REQUISITANTE_*: manda direto pro whatsapp desse perfil. */
  requesterId?: string;
  requesterDepartment?: string;
  /** APROVACAO_PENDENTE: define a alçada (nível 1/2/3) que deve ser notificada. */
  totalValue?: number;
  /** REQUISITANTE_REPROVADO_*: motivo informado por quem reprovou. */
  rejectionReason?: string;
  /** REQUISITANTE_APROVADO_PARCIAL: itens reprovados (rótulo pronto) e quantos seguiram. */
  rejectedItems?: string[];
  approvedCount?: number;
  /** EXPEDICAO_RECEBIMENTO: fornecedor de quem o material chegou. */
  supplierName?: string;
}

export async function notifyWhatsappClient(input: WhatsappNotifyInput): Promise<void> {
  await notifyWhatsappStage({ data: input });
}

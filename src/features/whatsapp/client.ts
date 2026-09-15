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
  | "COMPRA_APROVADA";

export interface WhatsappNotifyInput {
  stage: WhatsappStage;
  requisitionId: string;
  ticketNumber: string;
  title: string;
  module: string;
  requesterName: string;
  /** LIDER_CIENCIA: resolve o aprovador pessoal designado do solicitante,
   *  ou os gestores do departamento como fallback. */
  requesterId?: string;
  requesterDepartment?: string;
  /** APROVACAO_PENDENTE: define a alçada (nível 1/2/3) que deve ser notificada. */
  totalValue?: number;
}

export async function notifyWhatsappClient(input: WhatsappNotifyInput): Promise<void> {
  await notifyWhatsappStage({ data: input });
}

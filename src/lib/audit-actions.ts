/**
 * Fonte única de tradução das ações de audit_logs — estágio (para o badge
 * GESTOR/COTAÇÃO/APROVAÇÃO/COMPRA/RECEBIMENTO da timeline) e rótulo em
 * português. Antes esse mapa existia duplicado à mão em três lugares
 * (features/logs/api.ts, routes/movimentacoes.tsx, features/pdf/template.ts)
 * e cada um ficava incompleto de um jeito diferente — a ação
 * M1_ITEMS_QUOTE_COMPLETED (cotação fracionada do M1) nunca foi adicionada
 * em nenhum dos três, então caía no fallback "GESTOR" (etapa errada) e
 * aparecia com o texto cru "m1 items quote completed" na timeline e no PDF.
 *
 * A etapa GESTOR é só CIÊNCIA do gestor (ele não tem alçada de aprovação
 * financeira — isso só acontece depois, na etapa APROVAÇÃO/V3, por alçada de
 * valor). Os rótulos abaixo refletem isso: "Ciência confirmada pelo gestor",
 * não "Aprovada pelo gestor" — essa palavra já causou confusão real (um
 * gestor sem alçada de aprovação parecia ter "aprovado" a requisição).
 */
export interface ActionInfo {
  label: string;
  /** Etapa da timeline (GESTOR/COTAÇÃO/APROVAÇÃO/COMPRA/RECEBIMENTO). Ações
   *  sem etapa definida (ex.: STATUS_CHANGED, NOTES_ADDED) não aparecem
   *  filtráveis por etapa nem contam pra SLA de nenhum estágio específico. */
  stage?: "GESTOR" | "COTAÇÃO" | "APROVAÇÃO" | "COMPRA" | "RECEBIMENTO";
}

export const ACTION_INFO: Record<string, ActionInfo> = {
  REQUISITION_CREATED:      { label: "Requisição criada", stage: "GESTOR" },
  GESTOR_APPROVED:          { label: "Ciência confirmada pelo gestor", stage: "GESTOR" },
  GESTOR_REJECTED:          { label: "Reprovada pelo gestor", stage: "GESTOR" },
  REQUISITION_EDITED:       { label: "Requisição editada", stage: "GESTOR" },
  QUOTATION_STARTED:        { label: "Cotação iniciada", stage: "COTAÇÃO" },
  QUOTATION_UPDATED:        { label: "Cotação atualizada", stage: "COTAÇÃO" },
  SUPPLIER_ADDED:           { label: "Fornecedor adicionado", stage: "COTAÇÃO" },
  SUPPLIER_UPDATED:         { label: "Fornecedor atualizado", stage: "COTAÇÃO" },
  SUPPLIER_REMOVED:         { label: "Fornecedor removido", stage: "COTAÇÃO" },
  QUOTATION_RETURNED_FOR_INFO: { label: "Devolvida ao solicitante — falta de informação", stage: "COTAÇÃO" },
  WINNER_SELECTED:          { label: "Fornecedor vencedor selecionado", stage: "COTAÇÃO" },
  M1_ITEMS_QUOTE_COMPLETED: { label: "Cotação de itens concluída", stage: "COTAÇÃO" },
  M2_QUOTE_COMPLETED:       { label: "Cotação de viagem concluída", stage: "COTAÇÃO" },
  APPROVAL_REQUESTED:       { label: "Enviada para aprovação", stage: "COTAÇÃO" },
  APPROVAL_GRANTED:         { label: "Aprovada", stage: "APROVAÇÃO" },
  APPROVAL_REJECTED:        { label: "Reprovada", stage: "APROVAÇÃO" },
  PURCHASE_CONFIRMED:       { label: "Compra confirmada", stage: "COMPRA" },
  PURCHASE_UPDATED:         { label: "Compra atualizada", stage: "COMPRA" },
  RECEIPT_REGISTERED:       { label: "Recebimento registrado", stage: "RECEBIMENTO" },
  RECEIPT_UPDATED:          { label: "Recebimento atualizado", stage: "RECEBIMENTO" },
  STATUS_CHANGED:           { label: "Status alterado" },
  VPCLICK_TASK_CREATED:     { label: "Tarefa criada no VPClick" },
  NOTES_ADDED:              { label: "Observação adicionada" },
};

/** Rótulo em português de uma ação, com fallback pro texto cru (só pra ações
 *  realmente não mapeadas — não deveria mais acontecer com M1_ITEMS_QUOTE_COMPLETED). */
export function actionLabel(action: string): string {
  return ACTION_INFO[action]?.label ?? action.replace(/_/g, " ");
}

/** Etapa de uma ação pra fins de badge/filtro/SLA da timeline. */
export function actionStage(action: string): string {
  return ACTION_INFO[action]?.stage ?? "GESTOR";
}

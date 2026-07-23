/**
 * Classe compartilhada para destacar campos obrigatórios inválidos/ausentes
 * nos wizards M1-M7, aplicada junto de um flag "tentou avançar" por etapa
 * (em vez de só mostrar toast, como era antes em todos os módulos exceto
 * o formulário de item do M1 — ver issue de padronização de UX).
 */
export const FIELD_ERROR_CLASS = "border-destructive focus-visible:ring-destructive";

export type ComandoPedidoStatus = "rascunho" | "enviado" | "visualizado" | "respondido";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ComandoPedido {
  id: string;
  numero_documento: string;
  token: string;
  status: ComandoPedidoStatus;
  cliente_nome: string;
  cliente_telefone: string;
  cliente_email: string | null;
  projeto_numero: string | null;
  observacoes_internas: string | null;
  respostas: Record<string, JsonValue>;
  requisition_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  enviado_at: string | null;
  enviado_by: string | null;
  visualizado_at: string | null;
  respondido_at: string | null;
  expires_at: string | null;
  reaberto_at: string | null;
  reaberto_by: string | null;
}

export interface ComandoAnexo {
  id: string;
  pedido_id: string;
  secao: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface ComandoAuditoria {
  id: string;
  pedido_id: string;
  evento: "criado" | "enviado" | "visualizado" | "respondido" | "reaberto";
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * Seções do formulário público, na mesma ordem exibida ao cliente.
 * `respostas` é salvo como JSONB livre — cada chave de seção guarda um objeto
 * com os campos daquela seção, permitindo evoluir o formulário sem migração.
 */
export const COMANDO_SECOES = [
  { key: "comerciais", title: "Informações Comerciais" },
  { key: "motor", title: "Dados do Motor" },
  { key: "encoder", title: "Encoder" },
  { key: "botoeira", title: "Botoeira" },
  { key: "porta_cabina", title: "Porta de Cabina" },
  { key: "porta_pavimento", title: "Porta de Pavimento" },
  { key: "distancias", title: "Distâncias e Dimensões" },
  { key: "observacoes", title: "Observações Técnicas" },
] as const;

export type ComandoSecaoKey = (typeof COMANDO_SECOES)[number]["key"];

export const COMANDO_STATUS_LABELS: Record<ComandoPedidoStatus, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  visualizado: "Visualizado",
  respondido: "Respondido",
};

export const COMANDO_LINK_EXPIRATION_DAYS = 7;

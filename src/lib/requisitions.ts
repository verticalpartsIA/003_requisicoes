export const OPEN_STATUSES = ["GESTOR", "ABERTO", "COTAÇÃO", "APROVAÇÃO", "COMPRA", "RECEBIMENTO"] as const;

export const MODULE_LABELS = {
  M1: "Produtos",
  M2: "Viagens",
  M3: "Serviços",
  M4: "Manutenção",
  M5: "Frete",
  M6: "Locação",
} as const;

export const URGENCY_LABELS = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
} as const;

export const STATUS_LABELS = {
  RASCUNHO: "Rascunho",
  GESTOR: "Aguard. Gestor",
  ABERTO: "Aberto",
  COTAÇÃO: "Cotação",
  APROVAÇÃO: "Aprovação",
  COMPRA: "Compra",
  RECEBIMENTO: "Recebimento",
  CONCLUÍDO: "Concluído",
  CANCELADO: "Cancelado",
  REJEITADO: "Rejeitado",
} as const;

export type RequisitionModule = keyof typeof MODULE_LABELS;
export type RequisitionUrgency = keyof typeof URGENCY_LABELS;
export type RequisitionStatus = keyof typeof STATUS_LABELS;

export interface ProductItem {
  product_name: string;
  quantity: number;
  description: string;
  technical_specs: string;
  brand_preference: string;
  model_reference: string;
  reference_links: string[];
  online_purchase_suggestion: string;
  photo_path: string | null;
}

export interface ProductModuleData {
  items: ProductItem[];
  delivery_location: string;
  revenda: boolean;
  pedido_venda_numero: string | null;
  pedido_venda_vendedor: string | null;
  // Legado — requisições antigas (campo único)
  product_name?: string;
  quantity?: number;
  technical_specs?: string;
  brand_preference?: string;
  model_reference?: string;
  reference_links?: string[];
  online_purchase_suggestion?: string;
  photo_path?: string | null;
}

export interface RequisitionRecord {
  id: string;
  ticket_number: string;
  module: RequisitionModule;
  title: string;
  description: string;
  justification: string;
  urgency: RequisitionUrgency;
  status: RequisitionStatus;
  requester_name: string;
  requester_email: string | null;
  requester_department: string | null;
  desired_date: string | null;
  created_at: string;
  completed_at: string | null;
  module_data: ProductModuleData | Record<string, unknown>;
}

export interface DashboardStat {
  label: string;
  value: string;
  trend: string;
}

export interface DashboardModuleCard {
  title: string;
  desc: string;
  url: string;
  tag: RequisitionModule;
  count: number;
}

export interface DashboardRecentTicket {
  id: string;
  module: RequisitionModule;
  title: string;
  urgency: RequisitionUrgency;
  status: RequisitionStatus;
  date: string;
}

/** Rota do formulário de cada módulo — usada para editar/reenviar uma requisição. */
export const MODULE_ROUTES: Record<string, string> = {
  M1: "/products",
  M2: "/trips",
  M3: "/services",
  M4: "/maintenance",
  M5: "/freight",
  M6: "/rental",
};

export type PendencyTone = "action" | "done" | "blocked";

export interface Pendency {
  label: string;
  route: string;
  tone: PendencyTone;
}

/**
 * O que falta para o ticket andar e onde isso se resolve — usada no Dashboard
 * e em Movimentações para que requisitante e decisores vejam, sem precisar
 * abrir o ticket, onde ele está parado e o que fazer a respeito.
 */
export function pendencyOf(status: string, module: string): Pendency {
  switch (status) {
    case "GESTOR":
      return { label: "Falta aprovação do gestor", route: "/approval", tone: "action" };
    case "ABERTO":
      return { label: "Falta iniciar a cotação", route: "/quoting", tone: "action" };
    case "COTAÇÃO":
      return { label: "Falta concluir a cotação", route: "/quoting", tone: "action" };
    case "APROVAÇÃO":
      return { label: "Falta aprovação da alçada", route: "/approval", tone: "action" };
    case "COMPRA":
      return { label: "Falta efetivar a compra", route: "/purchasing", tone: "action" };
    case "RECEBIMENTO":
      return { label: "Falta receber o material", route: "/receipt", tone: "action" };
    case "REJEITADO":
      return {
        label: "Reprovada — revisar e reenviar",
        route: MODULE_ROUTES[module] ?? "/",
        tone: "blocked",
      };
    case "CANCELADO":
      return { label: "Cancelada", route: MODULE_ROUTES[module] ?? "/", tone: "blocked" };
    case "RASCUNHO":
      return {
        label: "Falta enviar a requisição",
        route: MODULE_ROUTES[module] ?? "/",
        tone: "action",
      };
    case "CONCLUÍDO":
      return {
        label: "Concluído — nada pendente",
        route: MODULE_ROUTES[module] ?? "/",
        tone: "done",
      };
    default:
      return { label: status, route: MODULE_ROUTES[module] ?? "/", tone: "action" };
  }
}

export const PENDENCY_TONE_CLASS: Record<PendencyTone, string> = {
  action: "text-amber-700",
  done: "text-emerald-600",
  blocked: "text-red-600",
};

import { supabaseBrowser } from "@/lib/supabase-browser";

interface RequisitionRow {
  ticket_number: string;
  title: string;
  urgency: string;
  status: string;
  created_at: string;
  module: "M1" | "M2" | "M3" | "M4" | "M5" | "M6";
  requester_name: string | null;
}

const moduleMeta = {
  M1: { title: "Produtos", desc: "Materiais, insumos e equipamentos", url: "/products" },
  M2: { title: "Viagens", desc: "Deslocamento e hospedagem", url: "/trips" },
  M3: { title: "Serviços", desc: "Contratações e escopos", url: "/services" },
  M4: { title: "Manutenção", desc: "Preventiva e corretiva", url: "/maintenance" },
  M5: { title: "Frete", desc: "Transportes e entregas", url: "/freight" },
  M6: { title: "Locação", desc: "Aluguéis e locações", url: "/rental" },
} as const;

export async function getDashboardDataClient() {
  const { data, error } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,title,urgency,status,created_at,module,requester_name")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data || []) as RequisitionRow[];
  const totalOpen = rows.filter(
    (item) => item.status !== "CONCLUÍDO" && item.status !== "CANCELADO",
  ).length;
  const urgent = rows.filter((item) => item.urgency === "URGENT").length;
  const completed = rows.filter((item) => item.status === "CONCLUÍDO").length;
  const approvals = rows.filter((item) => item.status === "APROVAÇÃO").length;

  const stats = [
    { label: "Em aberto", value: totalOpen, trend: "Fluxos ativos" },
    { label: "Urgentes", value: urgent, trend: "Prioridade máxima" },
    { label: "Concluídos", value: completed, trend: "Ciclos encerrados" },
    { label: "Em aprovação", value: approvals, trend: "Aguardando decisão" },
  ];

  const modules = (Object.keys(moduleMeta) as Array<keyof typeof moduleMeta>).map((tag) => ({
    tag,
    ...moduleMeta[tag],
    count: rows.filter(
      (item) => item.module === tag && item.status !== "CONCLUÍDO" && item.status !== "CANCELADO",
    ).length,
  }));

  const recentTickets = rows.slice(0, 8).map((item) => ({
    id: item.ticket_number,
    title: item.title,
    urgency: item.urgency,
    status: item.status,
    module: item.module,
    requester: item.requester_name ?? "—",
    date: new Date(item.created_at).toLocaleDateString("pt-BR"),
  }));

  return { stats, modules, recentTickets };
}

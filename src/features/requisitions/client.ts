import { supabaseBrowser } from "@/lib/supabase-browser";
import { friendlySupabaseError } from "@/lib/supabase-error";
import type { TicketRow } from "@/components/tickets-table";
import { updateRequisition, deleteRequisition } from "@/features/requisitions/api";

export interface UpdateRequisitionInput {
  requisitionId: string;
  title: string;
  description: string;
  justification: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  desiredDate?: string | null;
  moduleData: Record<string, unknown>;
  editorName: string;
}

export async function updateRequisitionClient(input: UpdateRequisitionInput) {
  const result = await updateRequisition({ data: input });
  return result;
}

export async function deleteRequisitionClient(requisitionId: string, actorId: string) {
  await deleteRequisition({ data: { requisitionId, actorId } });
}

export interface ProductItemInput {
  productCode?: string | null;
  productName: string;
  description: string;
  quantity: number;
  technicalSpecs: string;
  brandPreference: string;
  modelReference: string;
  referenceLinks: string[];
  onlinePurchaseSuggestion: string;
  photoPath?: string | null;
}

export interface ProductRequisitionInput {
  items: ProductItemInput[];
  deliveryDeadline: string;
  deliveryLocation: string;
  urgencyLevel: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  justification: string;
  revenda: boolean;
  pedidoVendaNumero?: string | null;
  pedidoVendaVendedor?: string | null;
  requesterName: string;
  requesterEmail: string;
  requesterDepartment: string;
  requesterProfileId?: string;
}

export async function listProductRequisitionsClient() {
  const { data, error } = await supabaseBrowser
    .from("requisitions")
    .select("ticket_number,title,requester_name,urgency,status,created_at")
    .eq("module", "M1")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data || []) as Array<{
    ticket_number: string;
    title: string;
    requester_name: string;
    urgency: TicketRow["urgency"];
    status: TicketRow["status"];
    created_at: string;
  }>).map((item) => ({
    id: item.ticket_number,
    title: item.title,
    requester: item.requester_name,
    urgency: item.urgency,
    status: item.status,
    date: new Date(item.created_at).toLocaleDateString("pt-BR"),
  })) satisfies TicketRow[];
}

export async function createProductRequisitionClient(input: ProductRequisitionInput) {
  const title =
    input.items.length === 1
      ? input.items[0].productName
      : `${input.items.length} itens — ${input.items[0].productName} e outros`;

  const { error } = await supabaseBrowser
    .from("requisitions")
    .insert({
      module: "M1",
      title,
      description: input.items.map((i) => `${i.productName}: ${i.description}`).join(" | "),
      justification: input.justification,
      urgency: input.urgencyLevel,
      desired_date: input.deliveryDeadline.slice(0, 10),
      requester_name: input.requesterName,
      requester_email: input.requesterEmail,
      requester_department: input.requesterDepartment,
      requester_profile_id: input.requesterProfileId ?? null,
      estimated_cost: null,
      status: "GESTOR",
      module_data: {
        items: input.items.map((item) => ({
          product_code: item.productCode ?? null,
          product_name: item.productName,
          quantity: item.quantity,
          description: item.description,
          technical_specs: item.technicalSpecs,
          brand_preference: item.brandPreference,
          model_reference: item.modelReference,
          reference_links: item.referenceLinks,
          online_purchase_suggestion: item.onlinePurchaseSuggestion,
          photo_path: item.photoPath ?? null,
        })),
        delivery_location: input.deliveryLocation,
        revenda: input.revenda,
        pedido_venda_numero: input.pedidoVendaNumero ?? null,
        pedido_venda_vendedor: input.pedidoVendaVendedor ?? null,
      },
    });

  if (error) throw new Error(friendlySupabaseError(error));

  const { data: created } = await supabaseBrowser
    .from("requisitions")
    .select("id,ticket_number,status")
    .eq("module", "M1")
    .eq("requester_profile_id", input.requesterProfileId ?? "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: created?.id ?? "",
    ticketNumber: created?.ticket_number ?? "",
  };
}

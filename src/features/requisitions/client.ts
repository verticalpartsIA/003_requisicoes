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

interface ProductRequisitionInput {
  productName: string;
  description: string;
  quantity: number;
  technicalSpecs: string;
  brandPreference: string;
  modelReference: string;
  referenceLinks: string[];
  onlinePurchaseSuggestion: string;
  photoPath?: string;
  deliveryDeadline: string;
  deliveryLocation: string;
  urgencyLevel: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  justification: string;
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
  // INSERT sem SELECT para não depender da policy de SELECT (can_view_requisition)
  const { error } = await supabaseBrowser
    .from("requisitions")
    .insert({
      module: "M1",
      title: input.productName,
      description: input.description,
      justification: input.justification,
      urgency: input.urgencyLevel,
      desired_date: input.deliveryDeadline.slice(0, 10),
      requester_name: input.requesterName,
      requester_email: input.requesterEmail,
      requester_department: input.requesterDepartment,
      requester_profile_id: input.requesterProfileId ?? null,
      estimated_cost: null,
      module_data: {
        product_name: input.productName,
        quantity: input.quantity,
        technical_specs: input.technicalSpecs,
        brand_preference: input.brandPreference,
        model_reference: input.modelReference,
        reference_links: input.referenceLinks,
        online_purchase_suggestion: input.onlinePurchaseSuggestion,
        photo_path: input.photoPath || null,
        delivery_location: input.deliveryLocation,
      },
    });

  if (error) throw new Error(friendlySupabaseError(error));

  // Busca o ticket recém-criado em query separada
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

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDefaultRequester } from "@/lib/env";
import type { TicketRow } from "@/components/tickets-table";
import type { ProductModuleData, RequisitionRecord } from "@/lib/requisitions";
import { supabaseRest } from "@/lib/supabase-rest";

// ─── Atualizar requisição (qualquer usuário, service_role bypassa RLS) ────────

export const updateRequisition = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requisitionId: z.string(),
      title: z.string(),
      description: z.string(),
      justification: z.string(),
      urgency: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
      desiredDate: z.string().nullable().optional(),
      moduleData: z.record(z.unknown()),
      editorName: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    let step = "fetch-current";
    try {
      const current = await supabaseRest<Array<{ edition: number; ticket_number: string }>>(
        `requisitions?select=edition,ticket_number&id=eq.${data.requisitionId}`,
      );
      const rec = current.data?.[0];
      const newEdition = (rec?.edition ?? 1) + 1;
      const ticketNumber = rec?.ticket_number ?? "";

      step = "patch-requisition";
      await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          title: data.title,
          description: data.description,
          justification: data.justification,
          urgency: data.urgency,
          desired_date: data.desiredDate ?? null,
          module_data: data.moduleData,
          edition: newEdition,
          updated_at: new Date().toISOString(),
        },
      });

      step = "insert-audit-log";
      await supabaseRest("audit_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: [
          {
            requisition_id: data.requisitionId,
            ticket_number: ticketNumber,
            action: "REQUISITION_EDITED",
            details: { edition: newEdition },
            actor_name: data.editorName,
          },
        ],
      });

      return { ok: true, edition: newEdition, ticketNumber };
    } catch (err) {
      throw new Error(`[${step}] ${err instanceof Error ? err.message : String(err)}`);
    }
  });

// ─── Excluir requisição (somente admin) ───────────────────────────────────────

export const deleteRequisition = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requisitionId: z.string(),
      actorId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const roleCheck = await supabaseRest<Array<{ role: string }>>(
      `user_roles?select=role&user_id=eq.${data.actorId}&role=eq.admin`,
    );
    if (!roleCheck.data?.length) {
      throw new Error("Acesso negado: apenas administradores podem excluir requisições.");
    }

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });

    return { ok: true };
  });

const productRequisitionSchema = z.object({
  productName: z.string().min(5).max(200),
  description: z.string().min(20).max(1000),
  quantity: z.number().positive(),
  technicalSpecs: z.string().max(2000).optional().default(""),
  brandPreference: z.string().max(200).optional().default(""),
  modelReference: z.string().max(200).optional().default(""),
  referenceLinks: z.array(z.string().max(500)).max(5),
  onlinePurchaseSuggestion: z.string().max(1000).optional().default(""),
  deliveryDeadline: z.string(),
  deliveryLocation: z.string().min(1).max(500),
  urgencyLevel: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  justification: z.string().min(10).max(500),
});

function mapProductTicket(ticket: RequisitionRecord): TicketRow {
  return {
    id: ticket.ticket_number,
    title: ticket.title,
    requester: ticket.requester_name,
    urgency: ticket.urgency,
    status: ticket.status,
    date: format(new Date(ticket.created_at), "dd/MM", { locale: ptBR }),
  };
}

export const listProductRequisitions = createServerFn({ method: "GET" }).handler(async () => {
  const response = await supabaseRest<RequisitionRecord[]>(
    "requisitions?select=id,ticket_number,module,title,description,justification,urgency,status,requester_name,requester_email,requester_department,desired_date,created_at,completed_at,module_data&module=eq.M1&order=created_at.desc&limit=20",
  );

  return response.data.map(mapProductTicket);
});

export const createProductRequisition = createServerFn({ method: "POST" })
  .inputValidator(productRequisitionSchema)
  .handler(async ({ data }) => {
    const requester = getDefaultRequester();
    const moduleData: ProductModuleData = {
      product_name: data.productName,
      quantity: data.quantity,
      technical_specs: data.technicalSpecs,
      brand_preference: data.brandPreference,
      model_reference: data.modelReference,
      reference_links: data.referenceLinks,
      online_purchase_suggestion: data.onlinePurchaseSuggestion,
      delivery_location: data.deliveryLocation,
    };

    const response = await supabaseRest<RequisitionRecord[]>("requisitions", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: [
        {
          module: "M1",
          title: data.productName,
          description: data.description,
          justification: data.justification,
          urgency: data.urgencyLevel,
          status: "ABERTO",
          desired_date: data.deliveryDeadline,
          requester_name: requester.name,
          requester_email: requester.email,
          requester_department: requester.department,
          module_data: moduleData,
        },
      ],
    });

    const created = response.data[0];

    if (!created) {
      throw new Error("A requisição foi enviada, mas o Supabase não retornou o registro criado.");
    }

    await supabaseRest("audit_logs", {
      method: "POST",
      body: [
        {
          requisition_id: created.id,
          ticket_number: created.ticket_number,
          action: "REQUISITION_CREATED",
          new_status: "ABERTO",
          actor_name: requester.name,
          details: {
            module: "M1",
            urgency: data.urgencyLevel,
          },
        },
      ],
    });

    return {
      id: created.id,
      ticketNumber: created.ticket_number,
    };
  });

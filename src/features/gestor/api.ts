import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";

interface GestorRequisition {
  id: string;
  ticket_number: string;
  module: string;
  title: string;
  justification: string;
  requester_name: string;
  requester_department: string | null;
  urgency: string;
  created_at: string;
  module_data: Record<string, unknown> | null;
}

export interface GestorQueueProductItem {
  productCode: string | null;
  productName: string;
  quantity: number | null;
}

export interface GestorQueueItem {
  requisitionId: string;
  ticketNumber: string;
  module: string;
  title: string;
  justification: string;
  requesterName: string;
  requesterDepartment: string;
  urgency: string;
  createdAt: string;
  // Colunas base (produto/quantidade) do M1 multi-itens — nascimento da
  // requisição só mostra isso; preço/fornecedor só entram depois da cotação
  // (V2), não antes. Ver issue de progressão de colunas por estado.
  items?: GestorQueueProductItem[];
}

export interface GestorScope {
  departments: string[];
  isApproverOfSomeone: boolean;
}

export interface GestorPendingItem extends GestorQueueItem {
  /** Nome(s) de quem precisa dar ciência — o aprovador pessoal designado,
   *  ou os gestores do departamento quando não há aprovador designado. */
  pendingManagerNames: string[];
}

async function assertIsAdmin(userId: string) {
  const resp = await supabaseRest<{ role: string }[]>(
    `user_roles?select=role&user_id=eq.${userId}&role=eq.admin&limit=1`,
  );
  if ((resp.data ?? []).length === 0) {
    throw new Error("Apenas administradores podem ver esta lista.");
  }
}

/** Escopo de gestor: departamentos gerenciados + se é aprovador designado de algum colaborador. */
export const getManagerScope = createServerFn({ method: "GET" })
  .inputValidator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }): Promise<GestorScope> => {
    const [deptsResp, subordinatesResp] = await Promise.all([
      supabaseRest<{ department: string }[]>(
        `department_managers?select=department&manager_user_id=eq.${data.managerId}`,
      ),
      supabaseRest<{ id: string }[]>(`profiles?select=id&approver_id=eq.${data.managerId}&limit=1`),
    ]);
    return {
      departments: (deptsResp.data ?? []).map((r) => r.department),
      isApproverOfSomeone: (subordinatesResp.data ?? []).length > 0,
    };
  });

/** Fila do gestor: requisições carimbadas com ele como aprovador designado e,
 *  como fallback (sem aprovador designado), as dos departamentos que gerencia. */
export const listGestorQueue = createServerFn({ method: "POST" })
  .inputValidator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const deptsResp = await supabaseRest<{ department: string }[]>(
      `department_managers?select=department&manager_user_id=eq.${data.managerId}`,
    );
    const departments = (deptsResp.data ?? []).map((r) => r.department);

    const filters = [`approver_id.eq.${data.managerId}`];
    if (departments.length > 0) {
      const deptList = departments.map((d) => `"${d.replace(/"/g, "")}"`).join(",");
      filters.push(`and(approver_id.is.null,requester_department.in.(${deptList}))`);
    }
    const orFilter = encodeURIComponent(`(${filters.join(",")})`);

    const response = await supabaseRest<GestorRequisition[]>(
      `requisitions?select=id,ticket_number,module,title,justification,requester_name,requester_department,urgency,created_at,module_data&status=eq.GESTOR&or=${orFilter}&order=created_at.asc`,
    );
    return (response.data ?? []).map((r): GestorQueueItem => {
      const rawItems =
        r.module === "M1"
          ? (r.module_data?.items as Array<Record<string, unknown>> | undefined)
          : undefined;
      return {
        requisitionId: r.id,
        ticketNumber: r.ticket_number,
        module: r.module,
        title: r.title,
        justification: r.justification,
        requesterName: r.requester_name,
        requesterDepartment: r.requester_department ?? "—",
        urgency: r.urgency,
        createdAt: new Date(r.created_at).toLocaleDateString("pt-BR"),
        items: rawItems?.map((it) => ({
          productCode: (it.product_code as string | null) ?? null,
          productName: String(it.product_name ?? ""),
          quantity: (it.quantity as number | null) ?? null,
        })),
      };
    });
  });

/** Visão de admin: TODAS as requisições travadas na etapa GESTOR no sistema
 *  (não só as do gestor logado), com o nome de quem precisa decidir cada uma —
 *  para achar rapidamente gargalos como "o gestor X ainda não decidiu". */
export const listAllGestorPending = createServerFn({ method: "POST" })
  .inputValidator(z.object({ adminId: z.string().uuid() }))
  .handler(async ({ data }): Promise<GestorPendingItem[]> => {
    await assertIsAdmin(data.adminId);

    const [reqResp, deptMgrResp] = await Promise.all([
      supabaseRest<Array<GestorRequisition & { approver_id: string | null }>>(
        `requisitions?select=id,ticket_number,module,title,justification,requester_name,requester_department,urgency,created_at,module_data,approver_id&status=eq.GESTOR&order=created_at.asc`,
      ),
      supabaseRest<{ department: string; manager_user_id: string }[]>(
        `department_managers?select=department,manager_user_id`,
      ),
    ]);
    const rows = reqResp.data ?? [];
    const deptManagers = deptMgrResp.data ?? [];

    const nameableIds = Array.from(
      new Set([
        ...rows.map((r) => r.approver_id).filter((id): id is string => !!id),
        ...deptManagers.map((d) => d.manager_user_id),
      ]),
    );
    const profilesResp = nameableIds.length
      ? await supabaseRest<{ id: string; full_name: string | null; email: string | null }[]>(
          `profiles?select=id,full_name,email&id=in.(${nameableIds.join(",")})`,
        )
      : { data: [] };
    const nameById = new Map(
      (profilesResp.data ?? []).map((p) => [p.id, p.full_name || p.email || "—"]),
    );

    const managerNamesByDept = new Map<string, string[]>();
    deptManagers.forEach((d) => {
      const list = managerNamesByDept.get(d.department) ?? [];
      list.push(nameById.get(d.manager_user_id) ?? "—");
      managerNamesByDept.set(d.department, list);
    });

    return rows.map((r): GestorPendingItem => {
      const rawItems =
        r.module === "M1"
          ? (r.module_data?.items as Array<Record<string, unknown>> | undefined)
          : undefined;
      const pendingManagerNames = r.approver_id
        ? [nameById.get(r.approver_id) ?? "—"]
        : (managerNamesByDept.get(r.requester_department ?? "") ?? []);
      return {
        requisitionId: r.id,
        ticketNumber: r.ticket_number,
        module: r.module,
        title: r.title,
        justification: r.justification,
        requesterName: r.requester_name,
        requesterDepartment: r.requester_department ?? "—",
        urgency: r.urgency,
        createdAt: new Date(r.created_at).toLocaleDateString("pt-BR"),
        items: rawItems?.map((it) => ({
          productCode: (it.product_code as string | null) ?? null,
          productName: String(it.product_name ?? ""),
          quantity: (it.quantity as number | null) ?? null,
        })),
        pendingManagerNames: pendingManagerNames.length
          ? pendingManagerNames
          : ["Nenhum gestor designado"],
      };
    });
  });

/** Garante que apenas o aprovador designado do solicitante (ou admin; ou, sem
 *  aprovador designado, o gestor do departamento) decida a etapa GESTOR. */
async function assertCanDecide(managerId: string, requisitionId: string) {
  const recResp = await supabaseRest<
    {
      ticket_number: string;
      status: string;
      approver_id: string | null;
      requester_department: string | null;
    }[]
  >(
    `requisitions?select=ticket_number,status,approver_id,requester_department&id=eq.${requisitionId}&limit=1`,
  );
  const rec = recResp.data?.[0];
  if (!rec) throw new Error("Requisição não encontrada.");
  if (rec.status !== "GESTOR")
    throw new Error("Esta requisição não está mais aguardando ciência do gestor.");

  if (rec.approver_id === managerId) return rec;

  const adminResp = await supabaseRest<{ role: string }[]>(
    `user_roles?select=role&user_id=eq.${managerId}&role=eq.admin&limit=1`,
  );
  if ((adminResp.data ?? []).length > 0) return rec;

  if (!rec.approver_id && rec.requester_department) {
    const deptResp = await supabaseRest<{ id: string }[]>(
      `department_managers?select=id&manager_user_id=eq.${managerId}&department=eq.${encodeURIComponent(rec.requester_department)}&limit=1`,
    );
    if ((deptResp.data ?? []).length > 0) return rec;
  }

  throw new Error("Apenas o aprovador designado deste colaborador pode decidir esta requisição.");
}

export const gestorApprove = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requisitionId: z.string().uuid(),
      managerId: z.string().uuid(),
      gestorName: z.string(),
      notes: z.string().max(500).optional().default(""),
    }),
  )
  .handler(async ({ data }) => {
    const rec = await assertCanDecide(data.managerId, data.requisitionId);

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { status: "ABERTO" },
    });

    await supabaseRest("audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [
        {
          requisition_id: data.requisitionId,
          ticket_number: rec.ticket_number,
          action: "GESTOR_APPROVED",
          old_status: "GESTOR",
          new_status: "ABERTO",
          actor_name: data.gestorName,
          details: { notes: data.notes },
        },
      ],
    });

    return { ok: true };
  });

export const gestorReject = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requisitionId: z.string().uuid(),
      managerId: z.string().uuid(),
      gestorName: z.string(),
      reason: z.string().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const rec = await assertCanDecide(data.managerId, data.requisitionId);

    await supabaseRest(`requisitions?id=eq.${data.requisitionId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { status: "REJEITADO" },
    });

    await supabaseRest("audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [
        {
          requisition_id: data.requisitionId,
          ticket_number: rec.ticket_number,
          action: "GESTOR_REJECTED",
          old_status: "GESTOR",
          new_status: "REJEITADO",
          actor_name: data.gestorName,
          details: { reason: data.reason },
        },
      ],
    });

    return { ok: true };
  });

import {
  getManagerScope,
  listGestorQueue,
  listAllGestorPending,
  gestorApprove,
  gestorReject,
} from "@/features/gestor/api";
import type { GestorPendingItem, GestorQueueItem, GestorScope } from "@/features/gestor/api";

export type { GestorPendingItem, GestorQueueItem, GestorScope };

export async function getManagerScopeClient(managerId: string): Promise<GestorScope> {
  return getManagerScope({ data: { managerId } });
}

/** Só para admin — todas as requisições travadas em GESTOR no sistema. */
export async function listAllGestorPendingClient(adminId: string): Promise<GestorPendingItem[]> {
  return listAllGestorPending({ data: { adminId } });
}

export async function listGestorQueueClient(managerId: string): Promise<GestorQueueItem[]> {
  return listGestorQueue({ data: { managerId } });
}

export async function gestorApproveClient(
  requisitionId: string,
  managerId: string,
  gestorName: string,
  notes?: string,
): Promise<void> {
  await gestorApprove({ data: { requisitionId, managerId, gestorName, notes: notes ?? "" } });
}

export async function gestorRejectClient(
  requisitionId: string,
  managerId: string,
  gestorName: string,
  reason: string,
): Promise<void> {
  await gestorReject({ data: { requisitionId, managerId, gestorName, reason } });
}

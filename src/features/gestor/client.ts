import { getManagerScope, listGestorQueue, gestorApprove, gestorReject } from "@/features/gestor/api";
import type { GestorQueueItem, GestorScope } from "@/features/gestor/api";

export type { GestorQueueItem, GestorScope };

export async function getManagerScopeClient(managerId: string): Promise<GestorScope> {
  return getManagerScope({ data: { managerId } });
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

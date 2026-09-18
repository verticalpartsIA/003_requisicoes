import {
  getManagerScope,
  listGestorQueue,
  listAllGestorPending,
  gestorApprove,
  gestorReject,
} from "@/features/gestor/api";
import type { GestorPendingItem, GestorQueueItem, GestorScope } from "@/features/gestor/api";
import { getAccessToken } from "@/lib/auth-token-client";

export type { GestorPendingItem, GestorQueueItem, GestorScope };

export async function getManagerScopeClient(): Promise<GestorScope> {
  return getManagerScope({ data: { accessToken: await getAccessToken() } });
}

/** Só para admin — todas as requisições travadas em GESTOR no sistema. */
export async function listAllGestorPendingClient(): Promise<GestorPendingItem[]> {
  return listAllGestorPending({ data: { accessToken: await getAccessToken() } });
}

export async function listGestorQueueClient(): Promise<GestorQueueItem[]> {
  return listGestorQueue({ data: { accessToken: await getAccessToken() } });
}

export async function gestorApproveClient(
  requisitionId: string,
  gestorName: string,
  notes?: string,
): Promise<void> {
  await gestorApprove({
    data: { requisitionId, accessToken: await getAccessToken(), gestorName, notes: notes ?? "" },
  });
}

export async function gestorRejectClient(
  requisitionId: string,
  gestorName: string,
  reason: string,
): Promise<void> {
  await gestorReject({
    data: { requisitionId, accessToken: await getAccessToken(), gestorName, reason },
  });
}

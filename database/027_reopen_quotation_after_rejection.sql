-- 027 — Comprador não conseguia recotar um M1 reprovado pelo aprovador
--
-- Caso concreto: M1-000160 foi reprovado pelo Diego (aprovador), editado
-- (correção de quantidade) e devolvido para a fila de Cotação (fix de
-- código em src/features/requisitions/api.ts, migration 026 já em
-- produção). Mas quando Andréia (comprador) tentou "Finalizar Cotação
-- Fracionada", recebeu "Sem permissão para realizar esta ação" — a etapa
-- de reabertura em código ficou incompleta: o RLS de `approvals` não
-- acompanhou.
--
-- Causa: a policy `approvals_reopen_comprador` (migration 025) só permite
-- ao comprador/admin levar uma aprovação de volta para 'pending' quando
-- `decision = 'approved'` (caso de origem: corrigir preço pós-aprovação).
-- Ela nunca previu `decision = 'rejected'` — naquela época reabrir uma
-- reprovação era proposital e explicitamente fora de escopo (ver
-- docs/reports/2026-08-25-correcao-preco-cotacao-pos-aprovacao.md). Agora
-- que reabrimos reprovações do aprovador (migration 026 do código), o RLS
-- precisa acompanhar: `saveItemQuotes`/`finalizeQuotation` fazem upsert em
-- `approvals` (onConflict requisition_id), que vira um UPDATE na linha já
-- `rejected` — e nenhuma policy de UPDATE existente cobre essa transição
-- para quem tem só o papel `comprador`.
--
-- O trigger `enforce_approvals_reopen_transition` (migration 025) já trata
-- 'approved' e 'rejected' igualmente — só a policy RLS precisava ser
-- estendida.

drop policy if exists approvals_reopen_comprador on public.approvals;
create policy approvals_reopen_comprador
on public.approvals
for update
to authenticated
using (
  private.has_any_role(array['admin', 'comprador']::public.app_role[])
  and decision in ('approved', 'rejected')
)
with check (
  private.has_any_role(array['admin', 'comprador']::public.app_role[])
  and decision = 'pending'
);

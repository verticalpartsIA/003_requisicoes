-- 025 — Permite reabrir uma aprovação já concedida para corrigir o preço
-- cotado (ex.: M1-000155 foi cotado com valor errado e só percebido em V4).
--
-- Hoje `approvals` só tem policy de UPDATE para o aprovador
-- (`approvals_update_aprovador`), e só enquanto `decision = 'pending'` — uma
-- vez decidida, a linha fica imutável para todo mundo, inclusive admin. Não
-- existia caminho para o comprador corrigir um preço errado sem contornar a
-- aprovação.
--
-- Esta policy abre uma única porta estreita: comprador/admin pode levar uma
-- aprovação já CONCEDIDA de volta para 'pending' (nunca para
-- 'approved'/'rejected' — isso continua exclusivo do aprovador via
-- `approvals_update_aprovador`). O fluxo de correção
-- (`correctQuotationPriceClient`) usa exatamente essa transição para forçar
-- nova aprovação sempre que o valor cotado mudar depois de já aprovado.
create policy approvals_reopen_comprador
on public.approvals
for update
to authenticated
using (
  private.has_any_role(array['admin', 'comprador']::public.app_role[])
  and decision = 'approved'
)
with check (
  private.has_any_role(array['admin', 'comprador']::public.app_role[])
  and decision = 'pending'
);

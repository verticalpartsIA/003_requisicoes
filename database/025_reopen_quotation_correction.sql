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

-- Postgres combina múltiplas policies permissivas de UPDATE com OR — cada
-- USING e cada WITH CHECK aplicável é avaliado independentemente, não em
-- pares. Isso abre um buraco: um admin (ou alguém com os papéis `comprador`
-- + `aprovador` com tier suficiente) pode ter uma linha `approved` admitida
-- pelo USING desta policy nova, e a mudança liberada pelo WITH CHECK da
-- `approvals_update_aprovador` (que só olha `can_approve_level`, não o novo
-- `decision`) — ou seja, dá pra alterar `total_value`/`decision` de uma
-- aprovação já decidida SEM forçar a volta para 'pending', o oposto do que
-- essa policy deveria garantir. RLS por policies não resolve isso (não dá
-- pra "casar" USING de uma com WITH CHECK de outra); a garantia real
-- precisa vir de um trigger, que vale independentemente de qual policy
-- deixou a linha passar.
create or replace function private.enforce_approvals_reopen_transition()
returns trigger
language plpgsql
as $$
begin
  if old.decision in ('approved', 'rejected') and new.decision is distinct from 'pending' then
    if new.decision is distinct from old.decision
      or new.total_value is distinct from old.total_value
      or new.approval_level is distinct from old.approval_level
    then
      raise exception
        'Uma aprovação já decidida só pode ser alterada devolvendo decision para ''pending'' (reabertura por correção).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_enforce_reopen_transition on public.approvals;
create trigger approvals_enforce_reopen_transition
before update on public.approvals
for each row execute function private.enforce_approvals_reopen_transition();

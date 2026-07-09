-- 016 — Aprovador designado por colaborador + usuários ativos/inativos
--
-- Cada colaborador tem um gestor aprovador (profiles.approver_id). Toda
-- requisição criada é carimbada com o aprovador do solicitante no momento da
-- criação (requisitions.approver_id) e somente esse aprovador (ou um admin)
-- pode aprovar/reprovar na etapa GESTOR. Requisições sem aprovador designado
-- seguem a regra antiga de gestor por departamento (department_managers).

alter table public.profiles
  add column if not exists approver_id uuid references public.profiles(id) on delete set null;

alter table public.profiles
  add column if not exists active boolean not null default true;

alter table public.requisitions
  add column if not exists approver_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_requisitions_approver on public.requisitions (approver_id) where status = 'GESTOR';

-- Carimba o aprovador designado do solicitante na criação da requisição.
create or replace function public.stamp_requisition_approver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approver_id is null then
    select p.approver_id
    into new.approver_id
    from public.profiles p
    where (new.requester_profile_id is not null and p.id = new.requester_profile_id)
       or (new.requester_email is not null and lower(p.email) = lower(new.requester_email))
    order by (p.id = new.requester_profile_id) desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_requisition_approver on public.requisitions;
create trigger trg_stamp_requisition_approver
  before insert on public.requisitions
  for each row
  execute function public.stamp_requisition_approver();

-- Backfill: requisições ainda na etapa GESTOR herdam o aprovador atual do solicitante.
update public.requisitions r
set approver_id = p.approver_id
from public.profiles p
where r.approver_id is null
  and r.status = 'GESTOR'
  and p.approver_id is not null
  and (r.requester_profile_id = p.id or lower(r.requester_email) = lower(p.email));

-- Admin pode atualizar o aprovador/ativo dos perfis (políticas já existentes de
-- update em profiles cobrem; nada adicional necessário se admin já edita department).

-- 037 — Link de ciência rápida (um toque, sem login) enviado por WhatsApp
--
-- Extensão da 036 para a etapa GESTOR (ciência do gestor): quem dá a ciência
-- (aprovador pessoal do solicitante, ou gestor do departamento) recebe no
-- WhatsApp um link `/aprovar/<token>` que abre uma página simples e permite
-- Dar ciência / Reprovar direto no celular, sem digitar senha.
--
-- Mesmas garantias da 036:
--   * token aleatório (32 bytes); só o HASH SHA-256 fica no banco;
--   * amarrado a UMA requisição e a UM gestor — a permissão é revalidada na
--     hora da decisão com a mesma regra de assertCanDecide
--     (src/features/gestor/api.ts): aprovador designado, admin, ou — sem
--     aprovador designado — gestor do departamento do solicitante;
--   * uso único (used_at) e validade de 4 horas (expires_at);
--   * RLS ligado e nenhuma policy → só a service role acessa;
--   * a decisão roda numa função SECURITY DEFINER com EXECUTE só para
--     service_role.

create table if not exists public.ciencia_quick_links (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  manager_id     uuid not null references auth.users(id) on delete cascade,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  used_decision  text check (used_decision in ('approved', 'rejected')),
  created_at     timestamptz not null default now()
);

create index if not exists ciencia_quick_links_requisition_idx
  on public.ciencia_quick_links (requisition_id);

alter table public.ciencia_quick_links enable row level security;
-- Sem policies de propósito: somente a service role (bypassa RLS) lê/escreve.
revoke all on public.ciencia_quick_links from anon, authenticated;

create or replace function public.quick_decide_ciencia(
  p_token_hash text,
  p_decision   text,
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_link        public.ciencia_quick_links%rowtype;
  v_requisition public.requisitions%rowtype;
  v_notes       text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now         timestamptz := now();
  v_next_status public.requisition_status;
  v_actor_name  text;
  v_allowed     boolean := false;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisão inválida.';
  end if;

  select * into v_link from public.ciencia_quick_links
    where token_hash = p_token_hash for update;
  if not found then
    raise exception 'Link inválido.';
  end if;
  if v_link.used_at is not null then
    raise exception 'Este link já foi usado.';
  end if;
  if v_link.expires_at < v_now then
    raise exception 'Este link expirou (validade de 4 horas). Abra o sistema para decidir.';
  end if;

  select * into v_requisition from public.requisitions
    where id = v_link.requisition_id for update;
  if not found then
    raise exception 'Requisição não encontrada.';
  end if;
  if v_requisition.status <> 'GESTOR' then
    raise exception 'Esta requisição não está mais aguardando ciência do gestor.';
  end if;

  -- Mesma regra de assertCanDecide (features/gestor/api.ts).
  if v_requisition.approver_id = v_link.manager_id then
    v_allowed := true;
  elsif exists (
    select 1 from public.user_roles
    where user_id = v_link.manager_id and role = 'admin'
  ) then
    v_allowed := true;
  elsif v_requisition.approver_id is null
        and v_requisition.requester_department is not null
        and exists (
          select 1 from public.department_managers
          where manager_user_id = v_link.manager_id
            and department = v_requisition.requester_department
        ) then
    v_allowed := true;
  end if;
  if not v_allowed then
    raise exception 'Apenas o aprovador designado deste colaborador pode decidir esta requisição.';
  end if;

  if p_decision = 'rejected' and v_notes is null then
    raise exception 'Informe o motivo da reprovação — ele é enviado ao requisitante.';
  end if;

  v_next_status := case when p_decision = 'rejected' then 'REJEITADO' else 'ABERTO' end;

  update public.requisitions set status = v_next_status where id = v_requisition.id;

  select full_name into v_actor_name from public.profiles where id = v_link.manager_id;

  insert into public.audit_logs
    (requisition_id, ticket_number, action, old_status, new_status, actor_id, actor_name, details)
  values (
    v_requisition.id,
    v_requisition.ticket_number,
    case when p_decision = 'rejected' then 'GESTOR_REJECTED' else 'GESTOR_APPROVED' end,
    v_requisition.status,
    v_next_status,
    v_link.manager_id,
    v_actor_name,
    case when p_decision = 'rejected'
         then jsonb_build_object('reason', v_notes, 'via', 'whatsapp_quick_link')
         else jsonb_build_object('notes', coalesce(v_notes, ''), 'via', 'whatsapp_quick_link')
    end
  );

  update public.ciencia_quick_links
     set used_at = v_now, used_decision = p_decision
   where id = v_link.id;

  return jsonb_build_object(
    'new_status', v_next_status,
    'ticket_number', v_requisition.ticket_number,
    'requisition_id', v_requisition.id
  );
end;
$$;

revoke all on function public.quick_decide_ciencia(text, text, text) from public, anon, authenticated;
grant execute on function public.quick_decide_ciencia(text, text, text) to service_role;

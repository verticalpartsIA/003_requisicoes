-- 036 — Link de aprovação rápida (um toque, sem login) enviado por WhatsApp
--
-- Pedido do Gelson (30/09/2026): o aprovador (CEO, que vive em reunião) recebe
-- no WhatsApp um link que abre uma página simples e permite Aprovar/Reprovar
-- direto no celular, sem digitar senha. Validade: 4 horas.
--
-- Segurança — quem tiver o link aprova dinheiro, então:
--   * o token é aleatório (32 bytes) e só o HASH SHA-256 fica no banco; o token
--     em claro existe apenas na mensagem de WhatsApp;
--   * cada link é amarrado a UMA aprovação e a UM aprovador (a alçada é
--     revalidada na hora da decisão, igual ao fluxo logado);
--   * uso único: depois de decidir, o link morre (used_at);
--   * expira em 4h (expires_at);
--   * a tabela não tem policy nenhuma (RLS ligado) → só a service role acessa;
--   * a decisão acontece numa função SECURITY DEFINER com EXECUTE só pra
--     service_role — nem anon nem authenticated conseguem chamá-la direto.
--
-- A decisão é sempre do ticket INTEIRO (aprovar tudo / reprovar tudo). Para
-- aprovação parcial item a item, a página manda o aprovador pro fluxo logado
-- (/approval?req=...).

create table if not exists public.approval_quick_links (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  approval_id   uuid not null references public.approvals(id) on delete cascade,
  approver_id   uuid not null references auth.users(id) on delete cascade,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_decision text check (used_decision in ('approved', 'rejected')),
  created_at    timestamptz not null default now()
);

create index if not exists approval_quick_links_approval_idx
  on public.approval_quick_links (approval_id);

alter table public.approval_quick_links enable row level security;
-- Sem policies de propósito: somente a service role (bypassa RLS) lê/escreve.
revoke all on public.approval_quick_links from anon, authenticated;

create or replace function public.quick_decide_approval(
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
  v_link        public.approval_quick_links%rowtype;
  v_approval    public.approvals%rowtype;
  v_requisition public.requisitions%rowtype;
  v_notes       text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now         timestamptz := now();
  v_next_status public.requisition_status;
  v_items       int;
  v_actor_name  text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisão inválida.';
  end if;

  select * into v_link from public.approval_quick_links
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

  select * into v_approval from public.approvals
    where id = v_link.approval_id for update;
  if not found then
    raise exception 'Aprovação não encontrada.';
  end if;
  if v_approval.decision <> 'pending' then
    raise exception 'Esta aprovação já foi decidida.';
  end if;

  -- Alçada do aprovador dono do link (mesma regra de private.can_approve_level,
  -- só que sem depender de auth.uid()).
  if not (
    exists (
      select 1 from public.user_roles
      where user_id = v_link.approver_id and role = 'admin'
    )
    or exists (
      select 1 from public.user_roles
      where user_id = v_link.approver_id
        and role = 'aprovador'
        and coalesce(approval_tier, 0) >= v_approval.approval_level
    )
  ) then
    raise exception 'Você não tem alçada para aprovar o nível %.', v_approval.approval_level;
  end if;

  select * into v_requisition from public.requisitions
    where id = v_approval.requisition_id for update;
  if not found or v_requisition.status <> 'APROVAÇÃO' then
    raise exception 'A requisição não está mais na etapa de Aprovação.';
  end if;

  if p_decision = 'rejected' and v_notes is null then
    raise exception 'Informe o motivo da reprovação — ele é enviado ao requisitante.';
  end if;

  v_next_status := case when p_decision = 'rejected' then 'REJEITADO' else 'COMPRA' end;

  select count(*) into v_items from public.approval_items where approval_id = v_approval.id;
  if v_items > 0 then
    update public.approval_items
       set decision = p_decision, notes = v_notes, decided_at = v_now
     where approval_id = v_approval.id;

    update public.requisition_items ri
       set status = p_decision
      from public.approval_items ai
     where ai.approval_id = v_approval.id and ri.id = ai.item_id;
  end if;

  update public.approvals
     set decision      = p_decision::public.approval_decision,
         justification = v_notes,
         decided_at    = v_now,
         approver_id   = v_link.approver_id
   where id = v_approval.id;

  update public.requisitions set status = v_next_status where id = v_requisition.id;

  select full_name into v_actor_name from public.profiles where id = v_link.approver_id;

  insert into public.audit_logs
    (requisition_id, ticket_number, action, old_status, new_status, actor_id, actor_name, details)
  values (
    v_requisition.id,
    v_requisition.ticket_number,
    case when p_decision = 'rejected' then 'APPROVAL_REJECTED' else 'APPROVAL_GRANTED' end,
    v_requisition.status,
    v_next_status,
    v_link.approver_id,
    v_actor_name,
    jsonb_build_object('justification', v_notes, 'via', 'whatsapp_quick_link')
  );

  update public.approval_quick_links
     set used_at = v_now, used_decision = p_decision
   where id = v_link.id;

  return jsonb_build_object(
    'new_status', v_next_status,
    'ticket_number', v_requisition.ticket_number,
    'requisition_id', v_requisition.id
  );
end;
$$;

revoke all on function public.quick_decide_approval(text, text, text) from public, anon, authenticated;
grant execute on function public.quick_decide_approval(text, text, text) to service_role;

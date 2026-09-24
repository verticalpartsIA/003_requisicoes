-- 035 — Aviso automático de requisição vencida (SLA) pro requisitante
--
-- Roda via pg_cron a cada 4h. Toda a detecção de atraso vive em SQL (fonte
-- única de verdade) e espelha deliberadamente a mesma regra já usada no
-- Monitor SLA / Analytics (src/features/analytics/api.ts::currentStageInfo,
-- STAGE_TARGETS) — se as metas por etapa mudarem lá, precisam mudar aqui
-- também (mesmo tipo de duplicação já documentada no CLAUDE.md para
-- features/pdf/template.ts).
--
-- Repetição: no máximo 1 aviso por ticket+etapa a cada ~20h (folga em
-- relação às 24h pra tolerar o jitter do cron de 4 em 4h), então o
-- requisitante recebe o aviso "diariamente" enquanto o ticket continuar
-- vencido na mesma etapa. Ao mudar de etapa (ou sair do estado vencido e
-- voltar depois), conta como um novo ciclo de aviso.
--
-- Envio via Evolution API direto do Postgres (pg_net), mesmo padrão já
-- usado em database/019_omie_purchase_orders_cron.sql (chamada HTTP
-- disparada por pg_cron com credencial embutida na função). O
-- EVOLUTION_APIKEY abaixo precisa ser preenchido manualmente antes de
-- aplicar esta migração em produção — ver CHANGELOG.md.
--
-- Backlog: só entram tickets vencidos há no máximo 168h (7 dias) além da
-- meta da etapa. Ticket "morto"/esquecido com atraso maior que isso nunca
-- dispara aviso (nem agora, nem depois — só volta a ser elegível se mudar
-- de etapa) pra não avisar o requisitante de coisa de meses atrás como se
-- fosse novidade. Decisão explícita do usuário ao ligar isso em produção
-- e ver 25 tickets vencidos, alguns com 1000+h de atraso.

create table if not exists public.sla_notifications (
  requisition_id  uuid not null references public.requisitions(id) on delete cascade,
  stage           text not null,
  last_notified_at timestamptz not null default now(),
  primary key (requisition_id, stage)
);

alter table public.sla_notifications enable row level security;

drop policy if exists sla_notifications_select_admin on public.sla_notifications;
create policy sla_notifications_select_admin
on public.sla_notifications
for select
to authenticated
using (private.has_role('admin'));

-- Sem grant de insert/update/delete para authenticated: só a função
-- SECURITY DEFINER abaixo (rodando como owner) escreve nessa tabela.
grant select on public.sla_notifications to authenticated;

-- ─── Detecção de vencidos (fonte de verdade em SQL) ─────────────────────────

create or replace function private.sla_active_breaches()
returns table (
  requisition_id   uuid,
  ticket_number    text,
  title            text,
  requester_name   text,
  whatsapp_number  text,
  stage            text,
  hours_elapsed    numeric,
  target_hours     numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with targets(stage, hours) as (
    values
      ('GESTOR', 24::numeric),
      ('COTAÇÃO', 72::numeric),
      ('APROVAÇÃO', 72::numeric),
      ('COMPRA', 48::numeric),
      ('RECEBIMENTO', 168::numeric)
  ),
  stage_map as (
    select
      r.id as requisition_id,
      r.ticket_number,
      r.title,
      r.requester_name,
      r.requester_profile_id,
      case
        when r.status = 'GESTOR' then 'GESTOR'
        when r.status in ('ABERTO', 'COTAÇÃO') then 'COTAÇÃO'
        when r.status = 'APROVAÇÃO' then 'APROVAÇÃO'
        when r.status = 'COMPRA' then 'COMPRA'
        when r.status = 'RECEBIMENTO' then 'RECEBIMENTO'
      end as stage,
      case
        when r.status = 'GESTOR' then r.created_at
        when r.status in ('ABERTO', 'COTAÇÃO') then coalesce(
          (select max(a.created_at) from public.audit_logs a
            where a.requisition_id = r.id and a.action = 'GESTOR_APPROVED'),
          r.created_at)
        when r.status = 'APROVAÇÃO' then coalesce(
          (select max(a.created_at) from public.audit_logs a
            where a.requisition_id = r.id and a.action = 'APPROVAL_REQUESTED'),
          r.created_at)
        when r.status = 'COMPRA' then coalesce(
          (select max(a.created_at) from public.audit_logs a
            where a.requisition_id = r.id and a.action = 'APPROVAL_GRANTED'),
          r.created_at)
        when r.status = 'RECEBIMENTO' then coalesce(
          (select max(a.created_at) from public.audit_logs a
            where a.requisition_id = r.id and a.action = 'PURCHASE_CONFIRMED'),
          r.created_at)
      end as stage_start
    from public.requisitions r
    where r.status in ('GESTOR', 'ABERTO', 'COTAÇÃO', 'APROVAÇÃO', 'COMPRA', 'RECEBIMENTO')
  )
  select
    sm.requisition_id,
    sm.ticket_number,
    sm.title,
    sm.requester_name,
    p.whatsapp_number,
    sm.stage,
    round(extract(epoch from (now() - sm.stage_start)) / 3600.0, 1) as hours_elapsed,
    t.hours as target_hours
  from stage_map sm
  join targets t on t.stage = sm.stage
  left join public.profiles p on p.id = sm.requester_profile_id
  where sm.stage_start is not null
    and now() - sm.stage_start >= (t.hours || ' hours')::interval
    and now() - sm.stage_start <= ((t.hours + 168) || ' hours')::interval
    and not exists (
      select 1 from public.sla_notifications n
      where n.requisition_id = sm.requisition_id
        and n.stage = sm.stage
        and n.last_notified_at > now() - interval '20 hours'
    );
$$;

revoke all on function private.sla_active_breaches() from public;
grant execute on function private.sla_active_breaches() to service_role;

-- ─── Envio + marcação de notificado ─────────────────────────────────────────

create or replace function private.sla_check_and_notify()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  rec record;
  evo_url text := 'http://72.61.48.156:8080';
  evo_apikey text := ''; -- PREENCHER antes de aplicar em produção (ver CHANGELOG.md)
  evo_instance text := 'pv360';
  base_url text := 'https://vprequisicoes.vpsistema.com';
  digits text;
  msg text;
begin
  for rec in select * from private.sla_active_breaches() loop
    digits := regexp_replace(coalesce(rec.whatsapp_number, ''), '\D', '', 'g');

    msg := format(
      E'⏰ Sua requisição *%s* está vencida na etapa atual (%s).\n\n%s\n\nJá são %s horas nessa etapa (meta: %sh) — vale a pena acompanhar.\n\n🔗 Acompanhar: %s/',
      rec.ticket_number, rec.stage, rec.title, rec.hours_elapsed, rec.target_hours, base_url
    );

    if digits = '' then
      insert into public.whatsapp_notification_log (stage, requisition_id, ticket_number, recipient_number, status)
      values ('REQUISITANTE_SLA_VENCIDO', rec.requisition_id, rec.ticket_number, '', 'skipped_no_number');
    elsif evo_apikey = '' then
      insert into public.whatsapp_notification_log (stage, requisition_id, ticket_number, recipient_number, status)
      values ('REQUISITANTE_SLA_VENCIDO', rec.requisition_id, rec.ticket_number, digits, 'skipped_no_apikey');
    else
      perform net.http_post(
        url := evo_url || '/message/sendText/' || evo_instance,
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', evo_apikey),
        body := jsonb_build_object('number', digits, 'text', msg)
      );
      insert into public.whatsapp_notification_log (stage, requisition_id, ticket_number, recipient_number, status)
      values ('REQUISITANTE_SLA_VENCIDO', rec.requisition_id, rec.ticket_number, digits, 'sent');
    end if;

    insert into public.sla_notifications (requisition_id, stage, last_notified_at)
    values (rec.requisition_id, rec.stage, now())
    on conflict (requisition_id, stage) do update set last_notified_at = excluded.last_notified_at;
  end loop;
end;
$$;

revoke all on function private.sla_check_and_notify() from public;
grant execute on function private.sla_check_and_notify() to postgres;

-- ─── Agendamento — a cada 4h ─────────────────────────────────────────────────

select cron.schedule(
  'sla-breach-check-4h',
  '0 */4 * * *',
  $$ select private.sla_check_and_notify(); $$
);

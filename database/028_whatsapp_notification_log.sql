-- 028 — Log persistente de tentativas de envio de WhatsApp
--
-- Contexto: investigando por que só um disparo de WhatsApp saiu pela manhã
-- de 15/09 e nenhuma requisição/aprovação nova notificou depois, ficou
-- claro que não há nenhum jeito de diagnosticar isso remotamente — o único
-- rastro de erro era um `console.warn` (src/features/whatsapp/server.ts),
-- que só existe no log do processo Node na Hostinger, inacessível fora do
-- servidor. Toda tentativa de envio (sucesso, erro de rede/HTTP, ou "pulado"
-- por falta de apikey/número) passa a ser gravada aqui.

create table if not exists public.whatsapp_notification_log (
  id              uuid primary key default gen_random_uuid(),
  stage           text not null,
  requisition_id  uuid references public.requisitions(id) on delete set null,
  ticket_number   text,
  recipient_number text,
  status          text not null check (status in ('sent', 'error', 'skipped_no_apikey', 'skipped_no_number')),
  http_status     int,
  error_detail    text,
  created_at      timestamptz not null default now()
);

create index if not exists whatsapp_notification_log_requisition_id_idx
  on public.whatsapp_notification_log (requisition_id);
create index if not exists whatsapp_notification_log_created_at_idx
  on public.whatsapp_notification_log (created_at desc);

alter table public.whatsapp_notification_log enable row level security;

-- Gravação sempre via supabaseRest (service role, bypassa RLS) — as
-- policies abaixo só precisam cobrir leitura para quem for investigar.
create policy whatsapp_notification_log_select_admin
on public.whatsapp_notification_log
for select
to authenticated
using (private.has_any_role(array['admin']::public.app_role[]));

grant select on public.whatsapp_notification_log to authenticated;

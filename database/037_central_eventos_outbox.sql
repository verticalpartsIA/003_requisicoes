-- 037 — Publicação do aviso de SLA na Central de Eventos (modo sombra)
--
-- A Central de Eventos (vpsistema.com/eventos) recebe os fatos de negócio de todos os
-- sistemas. Esta migração publica ali o evento `requisicao.sla_vencida` SEM mexer no envio
-- atual: o WhatsApp do SLA (035) continua saindo como sempre. A Central só registra e
-- simula (gatilho em modo "sombra"), para comparar os dois durante 7 dias úteis antes de
-- qualquer troca.
--
-- Como funciona
--   1. Um trigger em `sla_notifications` (já gravada a cada aviso do 035) copia o fato para
--      a caixa de saída `central_eventos_outbox`. Nunca falha o job de SLA: qualquer erro
--      vira WARNING.
--   2. `private.central_eventos_publicar()` (pg_cron, a cada minuto) assina e envia cada
--      linha pendente à API `eventos-ingest` (HMAC-SHA256 de "<timestamp>.<corpo>") via
--      pg_net, e confere as respostas. Falha temporária tenta de novo com espera crescente
--      (até 8 vezes); rejeição (400/401/403/404/413) é definitiva e fica visível na tabela.
--   3. Sem o segredo no Vault, a função não faz nada: pode ser aplicada antes do segredo.
--
-- Configuração (no SQL editor, uma vez; o segredo NUNCA entra neste arquivo nem no git):
--   select vault.create_secret('<mesmo valor de eventos_hmac_vprequisicoes da Central>', 'central_eventos_segredo');
--   -- opcional, só se a URL da Central mudar:
--   select vault.create_secret('https://<projeto>.supabase.co/functions/v1/eventos-ingest', 'central_eventos_url');
--
-- Privacidade: o evento leva ticket, título, etapa e e-mail do requisitante. Telefone não sai.

create table if not exists public.central_eventos_outbox (
  id                   bigint generated always as identity primary key,
  tipo                 text        not null,
  idempotency_key      text        not null unique,
  ocorrido_em          timestamptz not null,
  entidade_tipo        text,
  entidade_id          text,
  entidade_numero      text,
  payload              jsonb       not null default '{}',
  corpo                text,
  status               text        not null default 'pendente'
                         check (status in ('pendente', 'enviando', 'enviado', 'falha')),
  tentativas           int         not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  request_id           bigint,
  ultimo_erro          text,
  criado_em            timestamptz not null default now(),
  enviado_em           timestamptz
);

create index if not exists central_eventos_outbox_fila_idx
  on public.central_eventos_outbox (status, proxima_tentativa_em);

alter table public.central_eventos_outbox enable row level security;

drop policy if exists central_eventos_outbox_select_admin on public.central_eventos_outbox;
create policy central_eventos_outbox_select_admin
on public.central_eventos_outbox
for select
to authenticated
using (private.has_role('admin'));

-- Só as funções SECURITY DEFINER abaixo escrevem nesta tabela.
grant select on public.central_eventos_outbox to authenticated;

-- ─── Trigger: cada aviso de SLA vira um evento na caixa de saída ──────────────

create or replace function private.central_outbox_sla()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  req record;
  status_legado text;
begin
  begin
    select r.ticket_number, r.title, p.email as requisitante_email
      into req
      from public.requisitions r
      left join public.profiles p on p.id = r.requester_profile_id
     where r.id = new.requisition_id;

    select l.status
      into status_legado
      from public.whatsapp_notification_log l
     where l.requisition_id = new.requisition_id
       and l.stage = 'REQUISITANTE_SLA_VENCIDO'
     order by l.created_at desc
     limit 1;

    insert into public.central_eventos_outbox
      (tipo, idempotency_key, ocorrido_em, entidade_tipo, entidade_id, entidade_numero, payload)
    values (
      'requisicao.sla_vencida',
      -- chave só com [a-z0-9]: a Central rejeita acentos (etapa "COTAÇÃO" vira "cotacao")
      'sla:' || new.requisition_id || ':'
        || regexp_replace(translate(lower(new.stage), 'çãõáéíóúâêô', 'caoaeiouaeo'), '[^a-z0-9]', '', 'g')
        || ':' || floor(extract(epoch from new.last_notified_at))::bigint,
      new.last_notified_at,
      'requisicao',
      new.requisition_id::text,
      req.ticket_number,
      jsonb_strip_nulls(jsonb_build_object(
        'ticket', req.ticket_number,
        'titulo', req.title,
        'etapa', new.stage,
        'requisitante_email', req.requisitante_email,
        'envio_legado', status_legado
      ))
    )
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'central_outbox_sla: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function private.central_outbox_sla() from public;

drop trigger if exists central_outbox_sla on public.sla_notifications;
create trigger central_outbox_sla
  after insert or update on public.sla_notifications
  for each row execute function private.central_outbox_sla();

-- ─── Conferência das respostas do pg_net ──────────────────────────────────────

create or replace function private.central_eventos_conferir()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  r record;
  resp record;
  espera interval;
begin
  for r in
    select * from public.central_eventos_outbox where status = 'enviando' order by id limit 200
  loop
    select * into resp from net._http_response where id = r.request_id;

    if not found then
      -- resposta ainda não chegou (ou já foi expurgada pelo pg_net): espera até 10 min
      if r.proxima_tentativa_em < now() - interval '10 minutes' then
        update public.central_eventos_outbox
           set status = 'pendente', ultimo_erro = 'sem resposta do pg_net',
               proxima_tentativa_em = now()
         where id = r.id;
      end if;
      continue;
    end if;

    if resp.status_code between 200 and 299 then
      update public.central_eventos_outbox
         set status = 'enviado', enviado_em = now(), ultimo_erro = null
       where id = r.id;
    elsif resp.status_code in (400, 401, 403, 404, 413) then
      update public.central_eventos_outbox
         set status = 'falha',
             ultimo_erro = left('HTTP ' || resp.status_code || ': ' || coalesce(resp.content, ''), 500)
       where id = r.id;
    elsif r.tentativas >= 8 then
      update public.central_eventos_outbox
         set status = 'falha',
             ultimo_erro = left('desistiu após ' || r.tentativas || ' tentativas; último: '
                                || coalesce('HTTP ' || resp.status_code, resp.error_msg, 'sem resposta'), 500)
       where id = r.id;
    else
      espera := (r.tentativas * r.tentativas || ' minutes')::interval;
      update public.central_eventos_outbox
         set status = 'pendente',
             ultimo_erro = left(coalesce('HTTP ' || resp.status_code || ': ' || resp.content, resp.error_msg, 'erro de rede'), 500),
             proxima_tentativa_em = now() + espera
       where id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function private.central_eventos_conferir() from public;

-- ─── Publicação (pg_cron, a cada minuto) ──────────────────────────────────────

create or replace function private.central_eventos_publicar()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_segredo text;
  v_url text;
  r record;
  v_ts text;
  v_corpo text;
  v_assinatura text;
  v_rid bigint;
begin
  select decrypted_secret into v_segredo
    from vault.decrypted_secrets where name = 'central_eventos_segredo';
  if v_segredo is null then
    return;  -- desligado até o segredo ser cadastrado
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'central_eventos_url';
  v_url := coalesce(v_url, 'https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/eventos-ingest');

  perform private.central_eventos_conferir();

  for r in
    select * from public.central_eventos_outbox
     where status = 'pendente' and proxima_tentativa_em <= now()
     order by id
     limit 50
     for update skip locked
  loop
    -- O corpo é fixado na 1ª tentativa e reaproveitado: a mesma chave de idempotência
    -- sempre leva o mesmo conteúdo.
    v_corpo := coalesce(r.corpo, jsonb_build_object(
      'tipo', r.tipo,
      'idempotency_key', r.idempotency_key,
      'ocorrido_em', to_char(r.ocorrido_em at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'entidade', jsonb_strip_nulls(jsonb_build_object(
        'tipo', r.entidade_tipo, 'id', r.entidade_id, 'numero', r.entidade_numero)),
      'payload', r.payload
    )::text);

    v_ts := floor(extract(epoch from now()))::bigint::text;
    v_assinatura := 'sha256=' || encode(extensions.hmac(v_ts || '.' || v_corpo, v_segredo, 'sha256'), 'hex');

    v_rid := net.http_post(
      url := v_url,
      body := v_corpo::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-origem', 'vprequisicoes',
        'x-timestamp', v_ts,
        'x-assinatura', v_assinatura
      ),
      timeout_milliseconds := 15000
    );

    update public.central_eventos_outbox
       set corpo = v_corpo, status = 'enviando', request_id = v_rid,
           tentativas = r.tentativas + 1,
           proxima_tentativa_em = now()
     where id = r.id;
  end loop;

  -- Faxina: eventos já entregues há mais de 30 dias.
  delete from public.central_eventos_outbox
   where status = 'enviado' and enviado_em < now() - interval '30 days';
end;
$$;

revoke all on function private.central_eventos_publicar() from public;
grant execute on function private.central_eventos_publicar() to postgres;

select cron.schedule(
  'central-eventos-publicar',
  '* * * * *',
  $$ select private.central_eventos_publicar(); $$
);

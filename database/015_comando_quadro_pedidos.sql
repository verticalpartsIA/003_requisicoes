-- Migration 015: M7 - Quadro de Comando para Elevador
-- Pedidos de engenharia enviados por link publico (token) para o cliente preencher.
-- Fluxo: rascunho -> enviado -> visualizado -> respondido (reabrivel pelo vendedor)

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'comando_pedido_status') then
    create type public.comando_pedido_status as enum (
      'rascunho',
      'enviado',
      'visualizado',
      'respondido'
    );
  end if;
end
$$;

create sequence if not exists public.comando_pedidos_numero_seq;

create or replace function public.gerar_token_comando()
returns text
language sql
volatile
as $$
  select encode(gen_random_bytes(24), 'hex');
$$;

create or replace function public.gerar_numero_documento_comando()
returns text
language sql
volatile
as $$
  select 'QC-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.comando_pedidos_numero_seq')::text, 4, '0');
$$;

create table if not exists public.comando_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero_documento text not null unique default public.gerar_numero_documento_comando(),
  token text not null unique default public.gerar_token_comando(),
  status public.comando_pedido_status not null default 'rascunho',

  cliente_nome text not null,
  cliente_telefone text not null,
  cliente_email text,
  projeto_numero text,
  observacoes_internas text,

  respostas jsonb not null default '{}'::jsonb,

  requisition_id uuid references public.requisitions(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  enviado_at timestamptz,
  enviado_by uuid references auth.users(id) on delete set null,
  visualizado_at timestamptz,
  respondido_at timestamptz,
  expires_at timestamptz,

  reaberto_at timestamptz,
  reaberto_by uuid references auth.users(id) on delete set null
);

create index if not exists comando_pedidos_status_idx on public.comando_pedidos (status);
create index if not exists comando_pedidos_token_idx on public.comando_pedidos (token);

create table if not exists public.comando_anexos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.comando_pedidos(id) on delete cascade,
  secao text,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists comando_anexos_pedido_idx on public.comando_anexos (pedido_id);

create table if not exists public.comando_auditoria (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.comando_pedidos(id) on delete cascade,
  evento text not null, -- criado | enviado | visualizado | respondido | reaberto
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists comando_auditoria_pedido_idx on public.comando_auditoria (pedido_id);

drop trigger if exists comando_pedidos_set_updated_at on public.comando_pedidos;
create trigger comando_pedidos_set_updated_at
  before update on public.comando_pedidos
  for each row
  execute function public.set_updated_at();

alter table public.comando_pedidos enable row level security;
alter table public.comando_anexos enable row level security;
alter table public.comando_auditoria enable row level security;

drop policy if exists comando_pedidos_authenticated_all on public.comando_pedidos;
create policy comando_pedidos_authenticated_all
  on public.comando_pedidos for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists comando_anexos_authenticated_all on public.comando_anexos;
create policy comando_anexos_authenticated_all
  on public.comando_anexos for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists comando_auditoria_authenticated_all on public.comando_auditoria;
create policy comando_auditoria_authenticated_all
  on public.comando_auditoria for all
  to authenticated
  using (true)
  with check (true);

-- Bucket dedicado para anexos do formulario publico do Quadro de Comando.
-- Todo acesso (leitura/escrita) do lado publico passa por server functions com
-- service role; nao ha policy de anon aqui de proposito.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comando-anexos',
  'comando-anexos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can read comando anexos" on storage.objects;
create policy "Authenticated users can read comando anexos"
  on storage.objects for select to authenticated
  using (bucket_id = 'comando-anexos');

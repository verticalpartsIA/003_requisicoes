-- Cache local dos dados de estoque do Omie, sincronizado a cada hora comercial
-- pela Edge Function `sync-omie-stock` (supabase/functions/sync-omie-stock),
-- evitando chamadas ao vivo ao Omie na tela "Estoque Omie" (mais rápida) e
-- reduzindo o consumo de requisições contra a API do Omie (rate limit).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net;

create table if not exists public.omie_stock_cache (
  codigo text primary key,
  descricao text not null,
  estoque_fisico numeric not null default 0,
  estoque_reservado numeric not null default 0,
  estoque_disponivel numeric not null default 0,
  estoque_minimo numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.omie_stock_cache enable row level security;

drop policy if exists omie_stock_cache_select_authenticated on public.omie_stock_cache;
create policy omie_stock_cache_select_authenticated
  on public.omie_stock_cache
  for select
  to authenticated
  using (true);

grant select on public.omie_stock_cache to authenticated;

-- Agenda a sincronização a cada hora, de segunda a sexta, das 8h às 18h
-- (horário de Brasília = 11h-21h UTC).
select cron.schedule(
  'sync-omie-stock-business-hours',
  '0 11-21 * * 1-5',
  $$
  select net.http_post(
    url := 'https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/sync-omie-stock',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2Z2NyaHRtenZzc2ZkYXpra3prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDM5NjQsImV4cCI6MjA5MzE3OTk2NH0.NqDfKtEfv5riteRKY3d-jjMfHsNXOyfYg_r-JNP_eUk'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Sugestão de Compra para a tela "Estoque Omie": Curva ABC/D calculada pelo
-- giro de vendas dos últimos 4 meses (via NF-e), quantidade pendente em
-- pedidos de venda ainda não faturados (últimos 6 meses de criação) e
-- lançamentos manuais de "Comprado" (o que já está a caminho), tudo
-- combinado ao vivo numa view para refletir mudanças imediatamente.
--
-- Regras de negócio (definidas com o time de expedição):
--  - Estoque Mínimo = média mensal de vendas faturadas dos últimos 4 meses x 3
--    (90 dias de cobertura).
--  - Curva ABC calculada por volume faturado no período (A <=80% acumulado,
--    B <=95%, C <=100%).
--  - Curva D = produto sem histórico de venda suficiente no período: mínimo
--    fixo de 2 unidades se o custo médio (cmc) for <= R$2.500, senão 1 unidade.
--  - Sugestão de Compra = max(0, Estoque Mínimo − Estoque Disponível + Qtd
--    Pendente − Comprado ainda não chegado).
--  - Recalculado todos os dias às 9h (BRT) pela Edge Function
--    sync-omie-sales-velocity; o estoque em si já é sincronizado a cada hora
--    comercial pela sync-omie-stock (ver 013_omie_stock_cache.sql).

-- Custo médio (cmc) e tempo de importação (lead_time), capturados pela
-- sync-omie-stock a partir dos mesmos dados que ela já busca no Omie.
alter table public.omie_stock_cache
  add column if not exists cmc numeric not null default 0,
  add column if not exists lead_time_dias integer not null default 0;

-- Controle interno da sincronização horária de estoque (sync-omie-stock).
create table if not exists public.omie_sync_cursor (
  id boolean primary key default true,
  phase text not null default 'produtos',
  next_pagina int not null default 1,
  total_paginas int,
  started_at timestamptz not null default now(),
  constraint omie_sync_cursor_singleton check (id)
);

create table if not exists public.omie_products_staging (
  codigo text primary key,
  descricao text not null,
  lead_time_dias integer not null default 0
);

alter table public.omie_sync_cursor enable row level security;
alter table public.omie_products_staging enable row level security;

-- Giro de vendas / Curva ABC / quantidade pendente por produto, recalculado
-- semanalmente pela sync-omie-sales-velocity.
create table if not exists public.omie_sales_velocity (
  codigo text primary key,
  media_mensal_vendas numeric not null default 0,
  curva text not null default 'D' check (curva in ('A', 'B', 'C', 'D')),
  estoque_minimo_calculado numeric not null default 0,
  qtd_pendente numeric not null default 0,
  cmc numeric not null default 0,
  lead_time_dias integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.omie_sales_velocity enable row level security;

drop policy if exists omie_sales_velocity_select_authenticated on public.omie_sales_velocity;
create policy omie_sales_velocity_select_authenticated
  on public.omie_sales_velocity
  for select
  to authenticated
  using (true);

-- Lançamentos de "Comprado": quantidade que a analista de estoque já
-- encomendou e a data prevista de chegada. Enquanto a data não passa, o
-- valor é abatido da Sugestão de Compra (ver view abaixo).
create table if not exists public.omie_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  quantidade numeric not null check (quantidade > 0),
  previsao_chegada date not null,
  recebido boolean not null default false,
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists omie_purchase_orders_codigo_idx on public.omie_purchase_orders (codigo);

alter table public.omie_purchase_orders enable row level security;

drop policy if exists omie_purchase_orders_select_authenticated on public.omie_purchase_orders;
create policy omie_purchase_orders_select_authenticated
  on public.omie_purchase_orders
  for select
  to authenticated
  using (true);

drop policy if exists omie_purchase_orders_insert_compradores on public.omie_purchase_orders;
create policy omie_purchase_orders_insert_compradores
  on public.omie_purchase_orders
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('admin', 'comprador', 'almoxarife')
    )
  );

drop policy if exists omie_purchase_orders_update_compradores on public.omie_purchase_orders;
create policy omie_purchase_orders_update_compradores
  on public.omie_purchase_orders
  for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('admin', 'comprador', 'almoxarife')
    )
  );

-- View ao vivo: junta estoque (sync horário) + giro/curva/pendentes (sync
-- semanal) + comprados ainda não chegados (lançados manualmente), já
-- calculando a Sugestão de Compra sem precisar esperar o próximo job.
create or replace view public.omie_purchase_suggestions as
select
  c.codigo,
  c.descricao,
  c.estoque_fisico,
  c.estoque_reservado,
  c.estoque_disponivel,
  coalesce(v.estoque_minimo_calculado, c.estoque_minimo) as estoque_minimo,
  coalesce(v.curva, 'D') as curva,
  coalesce(v.qtd_pendente, 0) as qtd_pendente,
  coalesce(comprado.total, 0) as comprado,
  greatest(
    0,
    coalesce(v.estoque_minimo_calculado, c.estoque_minimo)
      - c.estoque_disponivel
      + coalesce(v.qtd_pendente, 0)
      - coalesce(comprado.total, 0)
  ) as sugestao_compra,
  c.updated_at as estoque_atualizado_em,
  v.updated_at as giro_calculado_em
from public.omie_stock_cache c
left join public.omie_sales_velocity v on v.codigo = c.codigo
left join (
  select codigo, sum(quantidade) as total
  from public.omie_purchase_orders
  where previsao_chegada >= current_date and not recebido
  group by codigo
) comprado on comprado.codigo = c.codigo;

grant select on public.omie_purchase_suggestions to authenticated;

-- Controle interno da sincronização semanal de giro/curva/pendentes
-- (sync-omie-sales-velocity).
create table if not exists public.omie_velocity_cursor (
  id boolean primary key default true,
  phase text not null default 'faturamento',
  next_pagina int not null default 1,
  total_paginas int,
  started_at timestamptz not null default now(),
  constraint omie_velocity_cursor_singleton check (id)
);

create table if not exists public.omie_velocity_staging (
  codigo text primary key,
  qtd_faturada numeric not null default 0,
  qtd_pendente numeric not null default 0
);

alter table public.omie_velocity_cursor enable row level security;
alter table public.omie_velocity_staging enable row level security;

-- Agenda a sincronização de giro/curva/pendentes todos os dias às 9h
-- (horário de Brasília = 12h UTC).
select cron.schedule(
  'sync-omie-sales-velocity-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/sync-omie-sales-velocity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2Z2NyaHRtenZzc2ZkYXpra3prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDM5NjQsImV4cCI6MjA5MzE3OTk2NH0.NqDfKtEfv5riteRKY3d-jjMfHsNXOyfYg_r-JNP_eUk'
    ),
    body := '{}'::jsonb
  );
  $$
);

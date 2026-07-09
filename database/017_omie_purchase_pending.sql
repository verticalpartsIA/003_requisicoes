-- 017 — "Aguardando Entrega" automático a partir do Omie
--
-- Substitui o campo "Comprado" (antes lançado manualmente em
-- omie_purchase_orders) por um cache alimentado direto dos Pedidos de Compra
-- do Omie: por produto, a soma de (quantidade pedida − quantidade recebida)
-- dos pedidos ainda em aberto/parcial. Guarda também a próxima data prevista
-- e o detalhe de cada pedido (para o popover da tela).

create table if not exists public.omie_purchase_pending (
  codigo text primary key,
  qtd_aguardando numeric not null default 0,
  proxima_previsao date,
  -- [{numero, qtde, recebida, aguardando, previsao, fornecedor, unidade}]
  pedidos jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.omie_purchase_pending enable row level security;

drop policy if exists omie_purchase_pending_select_authenticated on public.omie_purchase_pending;
create policy omie_purchase_pending_select_authenticated
  on public.omie_purchase_pending
  for select
  to authenticated
  using (true);

-- Escrita apenas via service_role (edge function sync-omie-purchase-orders).

-- IMPORTANTE: a troca da view `omie_purchase_suggestions` para usar esta tabela
-- como fonte do "Comprado" foi ADIADA. A reconciliação com dados reais do Omie
-- revelou pedidos de compra antigos largados em aberto (ex.: previsão 2006) que
-- contaminam o "aguardando entrega" e poderiam zerar indevidamente a Sugestão de
-- Compra de itens críticos. A troca só será feita após definir a regra de corte
-- para pedidos vencidos (ver migration 018, pendente de decisão de negócio).
-- Até lá, a view segue com a fonte anterior (lançamento manual).

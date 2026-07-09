-- 018 — Ativa o "Comprado"/"Aguardando Entrega" vindo do Omie, com corte de 6 meses
--
-- Decisão de negócio (usuário): pedidos de compra com previsão de entrega
-- vencida há mais de 6 meses são tratados como "pedido não baixado no Omie"
-- (lixo operacional) e NÃO contam como aguardando — evita que pedidos antigos
-- esquecidos (ex.: previsão 20/02/2006 encontrada na reconciliação) zerem
-- indevidamente a Sugestão de Compra de itens críticos.
--
-- Reconciliação com dados reais (09/07/2026): das ~65.000 unidades em pedidos
-- de compra abertos, apenas ~1.315 (43 produtos) ficam de fora com este corte
-- — a esmagadora maioria (356 produtos) é confiável e passa a valer.

create or replace view public.omie_purchase_pending_valid as
select
  codigo,
  -- soma só os pedidos com previsão dentro da janela (ou sem previsão — não
  -- há como classificar como "vencido"; entram para não subestimar o aguardando)
  coalesce((
    select sum((ped->>'aguardando')::numeric)
    from jsonb_array_elements(p.pedidos) ped
    where (ped->>'previsao') is null
       or (ped->>'previsao')::date >= (current_date - interval '6 months')::date
  ), 0) as qtd_aguardando,
  (
    select min((ped->>'previsao')::date)
    from jsonb_array_elements(p.pedidos) ped
    where (ped->>'previsao') is not null
      and (ped->>'previsao')::date >= (current_date - interval '6 months')::date
  ) as proxima_previsao,
  coalesce((
    select jsonb_agg(ped order by (ped->>'previsao') asc nulls last)
    from jsonb_array_elements(p.pedidos) ped
    where (ped->>'previsao') is null
       or (ped->>'previsao')::date >= (current_date - interval '6 months')::date
  ), '[]'::jsonb) as pedidos,
  p.updated_at
from public.omie_purchase_pending p;

drop view if exists public.omie_purchase_suggestions;
create view public.omie_purchase_suggestions as
select
  c.codigo,
  c.descricao,
  c.estoque_fisico,
  c.estoque_reservado,
  c.estoque_disponivel,
  coalesce(v.estoque_minimo_calculado, c.estoque_minimo) as estoque_minimo,
  coalesce(v.curva, 'D') as curva,
  coalesce(v.qtd_pendente, 0) as qtd_pendente,
  coalesce(p.qtd_aguardando, 0) as comprado,
  p.proxima_previsao,
  coalesce(p.pedidos, '[]'::jsonb) as pedidos,
  greatest(
    0,
    coalesce(v.estoque_minimo_calculado, c.estoque_minimo)
      - c.estoque_disponivel
      + coalesce(v.qtd_pendente, 0)
      - coalesce(p.qtd_aguardando, 0)
  ) as sugestao_compra,
  c.updated_at as estoque_atualizado_em,
  v.updated_at as giro_calculado_em,
  p.updated_at as compras_atualizado_em
from public.omie_stock_cache c
left join public.omie_sales_velocity v on v.codigo = c.codigo
left join public.omie_purchase_pending_valid p on p.codigo = c.codigo;

-- 021 — Sugestão de lote com confiança estatística real (não mais "menor pedido")
--
-- Achado do usuário (reportado ao revisar VP-1875 — Corrimão para Escada
-- Rolante): a versão anterior (migration 020) sugeria o lote/múltiplo de
-- compra como a MENOR quantidade já pedida do produto. Para itens contínuos
-- vendidos por metro (corrimão, cabo de aço cortado por medida), isso é
-- estatisticamente inválido:
--
--   - 63% dos produtos (1144 de 1813) têm só 1 pedido no histórico completo
--     do Omie — impossível inferir "lote do fornecedor" de uma única amostra.
--   - VP-1875 tinha exatamente esse caso: 1 pedido de 79,5m. O sistema
--     sugeria isso como lote/embalagem padrão. Mas produtos irmãos da mesma
--     família (corrimão de escada rolante: VPP-1477, VPP-1699, VPP-1877,
--     VPP-1879) mostram pedidos de 1000-4000m — a quantidade real depende do
--     comprimento da escada de cada obra (corrimão dá a volta completa,
--     2x o comprimento, x2 lados), não de uma embalagem fixa.
--   - Mesmo com 2+ pedidos, se as quantidades nunca se repetem, isso reforça
--     que a variação é por projeto/obra, não por lote do fornecedor.
--
-- Nova regra: só sugere lote/múltiplo quando a MESMA quantidade aparece em
-- 2+ pedidos distintos (moda com frequência >= 2) no histórico completo do
-- Omie (todos os status, sem corte de data) — só aí há evidência real de
-- embalagem/bobina padrão. Validado: de 1813 produtos, apenas 350 (19%) têm
-- essa recorrência; os demais ficam sem sugestão (comprador informa
-- manualmente se souber a negociação com o fornecedor).
--
-- Novas colunas de transparência (expostas na UI): quantos pedidos existem
-- no histórico completo e em quantos a quantidade sugerida se repetiu —
-- para o comprador avaliar a confiança da sugestão em vez de aceitá-la às
-- cegas.

alter table public.omie_purchase_lot_config
  add column if not exists historico_total_pedidos int,
  add column if not exists historico_moda_frequencia int;

comment on column public.omie_purchase_lot_config.historico_total_pedidos is
  'Quantos pedidos de compra distintos existem no histórico completo do Omie para este produto.';
comment on column public.omie_purchase_lot_config.historico_moda_frequencia is
  'Em quantos desses pedidos a quantidade sugerida (sugerido_multiplo) se repetiu igual — só há sugestão quando >= 2.';

-- Recálculo do backfill: para cada produto, busca todo o histórico de
-- Pedidos de Compra do Omie (todos os status, sem corte de 6 meses),
-- calcula a moda (quantidade mais frequente) e só grava sugerido_multiplo/
-- sugerido_lote_minimo quando essa moda se repete >= 2 vezes. Os demais têm
-- os campos zerados (null) e ficam com historico_total_pedidos preenchido
-- para a UI explicar por que não há sugestão.
--
-- Executado via script (buscou ~1700 pedidos / ~4500 itens direto na API do
-- Omie com PesquisarPedCompra, todos os status, paginado) e aplicado como
-- UPSERT em lote — não reproduzido aqui como SQL porque a fonte é a API
-- externa do Omie, não uma tabela local. Resultado: 350 de 1813 produtos
-- (19%) mantiveram sugestão confiável; os demais 1463 (81%) tiveram
-- sugerido_multiplo/sugerido_lote_minimo zerados.
--
-- A view omie_purchase_suggestions foi reescrita (mesma migration, aplicada
-- via MCP) para expor historico_total_pedidos e historico_moda_frequencia —
-- sem mudança na fórmula de sugestao_compra em si (Regras 1 e 3 continuam
-- iguais); só a base de dados por trás de sugerido_multiplo/lote_minimo
-- ficou estatisticamente honesta.

drop view if exists public.omie_purchase_suggestions;
create view public.omie_purchase_suggestions as
with base as (
  select
    c.codigo,
    c.descricao,
    c.estoque_fisico,
    c.estoque_reservado,
    c.estoque_disponivel,
    c.unidade,
    coalesce(c.lead_time_dias, v.lead_time_dias, 0) as lead_time_dias,
    coalesce(v.curva, 'D') as curva,
    coalesce(v.media_mensal_vendas, 0) as media_mensal_vendas,
    coalesce(v.qtd_pendente, 0) as qtd_pendente,
    coalesce(p.qtd_aguardando, 0) as comprado,
    p.proxima_previsao,
    coalesce(p.pedidos, '[]'::jsonb) as pedidos,
    case
      when coalesce(v.curva, 'D') = any (array['A', 'B', 'C'])
           and coalesce(v.media_mensal_vendas, 0) > 0
      then v.media_mensal_vendas * (90 + coalesce(c.lead_time_dias, v.lead_time_dias, 0))::numeric / 30.0
      else coalesce(v.estoque_minimo_calculado, c.estoque_minimo, 0)
    end as estoque_minimo_efetivo,
    lc.multiplo_compra,
    lc.lote_minimo,
    coalesce(lc.confirmado, false) as lote_confirmado,
    lc.sugerido_multiplo,
    lc.sugerido_lote_minimo,
    lc.historico_total_pedidos,
    lc.historico_moda_frequencia,
    c.updated_at as estoque_atualizado_em,
    v.updated_at as giro_calculado_em,
    p.updated_at as compras_atualizado_em
  from public.omie_stock_cache c
    left join public.omie_sales_velocity v on v.codigo = c.codigo
    left join public.omie_purchase_pending_valid p on p.codigo = c.codigo
    left join public.omie_purchase_lot_config lc on lc.codigo = c.codigo
),
calc as (
  select
    base.*,
    greatest(
      0,
      base.estoque_minimo_efetivo - base.estoque_disponivel + base.qtd_pendente - base.comprado
    ) as necessidade_bruta
  from base
)
select
  codigo,
  descricao,
  estoque_fisico,
  estoque_reservado,
  estoque_disponivel,
  ceil(estoque_minimo_efetivo) as estoque_minimo,
  curva,
  qtd_pendente,
  comprado,
  proxima_previsao,
  pedidos,
  unidade,
  lead_time_dias,
  90 + lead_time_dias as cobertura_dias,
  ceil(necessidade_bruta) as sugestao_bruta,
  case
    when necessidade_bruta <= 0 then 0
    when lote_confirmado
         and (coalesce(multiplo_compra, 0) > 0 or coalesce(lote_minimo, 0) > 0)
    then case
      when coalesce(multiplo_compra, 0) > 0
        then ceil(greatest(necessidade_bruta, coalesce(lote_minimo, 0)) / multiplo_compra) * multiplo_compra
      else greatest(ceil(necessidade_bruta), coalesce(lote_minimo, 0))
    end
    else ceil(necessidade_bruta)
  end as sugestao_compra,
  multiplo_compra,
  lote_minimo,
  lote_confirmado,
  sugerido_multiplo,
  sugerido_lote_minimo,
  historico_total_pedidos,
  historico_moda_frequencia,
  (sugerido_multiplo is not null and not lote_confirmado) as lote_pendente_revisao,
  estoque_atualizado_em,
  giro_calculado_em,
  compras_atualizado_em
from calc;

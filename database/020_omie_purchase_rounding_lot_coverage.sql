-- 020 — Sugestão de Compra confiável: arredondamento, lote mínimo/múltiplo e cobertura
--
-- Três regras de negócio integradas para que a tela /estoque-omie possa dirigir
-- compras em massa e ser seguida "cegamente" pela VerticalParts:
--
--  [1] ARREDONDAMENTO (rígido) — nenhum valor fracionário sobrevive na sugestão.
--      Produtos discretos (botão, peça) E contínuos (cabo/corrimão vendidos por
--      metro) são ambos arredondados PARA CIMA com ceil(). Regra de ouro: quando
--      houver dúvida, arredonda para cima — sobra de estoque custa; falta para a
--      produção. Aplica-se ao estoque mínimo efetivo, à necessidade bruta e à
--      sugestão final.
--
--  [2] LOTE MÍNIMO / MÚLTIPLO (com revisão do comprador) — campos configuráveis
--      por produto em omie_purchase_lot_config. Não dá para inferir o lote com
--      segurança do histórico (as quantidades variam muito), então o sistema
--      apenas PRÉ-PREENCHE uma sugestão (menor quantidade já pedida do produto) e
--      o comprador revisa, ajusta e CONFIRMA manualmente. A view só passa a
--      respeitar o lote depois de `confirmado = true`. Enquanto pendente, marca
--      `lote_pendente_revisao` para a UI sinalizar (bolinha laranja).
--
--  [3] COBERTURA parametrizada — o alvo de estoque deixa de ser um mínimo fixo e
--      passa a cobrir a demanda de:  Prazo de Cobertura = 90 dias + Lead Time do
--      Fornecedor. Só vale para itens com curva A/B/C e média de vendas > 0; os
--      demais continuam com o estoque_minimo_calculado/estoque_minimo anterior.

-- ---------------------------------------------------------------------------
-- Unidade de medida do produto (M, PC, KG, ...), usada só para exibição.
-- ---------------------------------------------------------------------------
alter table public.omie_stock_cache add column if not exists unidade text;

-- ---------------------------------------------------------------------------
-- Configuração de lote por produto (revisada/confirmada pelo comprador).
-- ---------------------------------------------------------------------------
create table if not exists public.omie_purchase_lot_config (
  codigo text primary key,
  multiplo_compra numeric,        -- comprar sempre em múltiplos deste valor (ex.: bobina de 700 m)
  lote_minimo numeric,            -- nunca comprar menos que isto
  confirmado boolean not null default false, -- só aplica o lote depois que o comprador confirma
  sugerido_multiplo numeric,      -- pré-preenchimento (histórico) — apenas informativo
  sugerido_lote_minimo numeric,   -- pré-preenchimento (histórico) — apenas informativo
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table public.omie_purchase_lot_config enable row level security;

drop policy if exists omie_lot_config_select_authenticated on public.omie_purchase_lot_config;
create policy omie_lot_config_select_authenticated
  on public.omie_purchase_lot_config
  for select
  to authenticated
  using (true);

drop policy if exists omie_lot_config_write_compradores on public.omie_purchase_lot_config;
create policy omie_lot_config_write_compradores
  on public.omie_purchase_lot_config
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = any (array['admin'::app_role, 'comprador'::app_role, 'almoxarife'::app_role])
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = any (array['admin'::app_role, 'comprador'::app_role, 'almoxarife'::app_role])
    )
  );

-- Backfill do pré-preenchimento: menor quantidade já pedida de cada produto nos
-- pedidos de compra do Omie. É só uma sugestão para o comprador revisar
-- (confirmado permanece false); o valor definitivo é decidido por ele.
insert into public.omie_purchase_lot_config (codigo, sugerido_multiplo, sugerido_lote_minimo)
select
  p.codigo,
  min((ped->>'qtde')::numeric) as sugerido,
  min((ped->>'qtde')::numeric) as sugerido
from public.omie_purchase_pending p,
     lateral jsonb_array_elements(p.pedidos) ped
where (ped->>'qtde')::numeric > 0
group by p.codigo
on conflict (codigo) do update
  set sugerido_multiplo = excluded.sugerido_multiplo,
      sugerido_lote_minimo = excluded.sugerido_lote_minimo
  where public.omie_purchase_lot_config.confirmado = false;

-- ---------------------------------------------------------------------------
-- View da Sugestão de Compra com as 3 regras aplicadas.
-- ---------------------------------------------------------------------------
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
    -- [3] Cobertura: A/B/C com giro usam média × (90 + lead time)/30;
    --     o resto mantém o mínimo calculado anterior.
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
  ceil(estoque_minimo_efetivo) as estoque_minimo,   -- [1] sem casas decimais
  curva,
  qtd_pendente,
  comprado,
  proxima_previsao,
  pedidos,
  unidade,
  lead_time_dias,
  90 + lead_time_dias as cobertura_dias,            -- [3] exposto para a UI
  ceil(necessidade_bruta) as sugestao_bruta,        -- [1] necessidade antes do lote, arredondada
  case
    when necessidade_bruta <= 0 then 0
    -- [2] só aplica o lote quando o comprador confirmou
    when lote_confirmado
         and (coalesce(multiplo_compra, 0) > 0 or coalesce(lote_minimo, 0) > 0)
    then case
      when coalesce(multiplo_compra, 0) > 0
        then ceil(greatest(necessidade_bruta, coalesce(lote_minimo, 0)) / multiplo_compra) * multiplo_compra
      else greatest(ceil(necessidade_bruta), coalesce(lote_minimo, 0))
    end
    else ceil(necessidade_bruta)                    -- [1] fallback: sempre para cima
  end as sugestao_compra,
  multiplo_compra,
  lote_minimo,
  lote_confirmado,
  sugerido_multiplo,
  sugerido_lote_minimo,
  (sugerido_multiplo is not null and not lote_confirmado) as lote_pendente_revisao,
  estoque_atualizado_em,
  giro_calculado_em,
  compras_atualizado_em
from calc;

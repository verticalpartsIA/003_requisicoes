-- 039 — Pedidos de compra por fornecedor (compra fracionada do M1)
--
-- Problema: `purchases` tem UNIQUE(requisition_id), ou seja, UMA compra por
-- ticket, com um só fornecedor/pedido/forma de pagamento/observação — os
-- fornecedores eram juntados numa string. Quando o comprador divide uma
-- requisição entre fornecedores (3 rolos num, o restante noutro, mais caro),
-- não havia onde registrar pagamento e observação de cada um.
--
-- Solução: `purchase_orders` (um por fornecedor) + `purchase_order_items`
-- (item da requisição × quantidade × preço unitário). `purchases` continua
-- existindo como RESUMO do ticket (PDF, analytics, SLA e logs leem dela e da
-- ação PURCHASE_CONFIRMED, que a função abaixo continua gravando).
--
-- Desenho completo: docs/reports/2026-10-15-desenho-compra-multi-fornecedor.md
--
-- ATENÇÃO: aplicar esta migração ANTES de publicar a tela nova. A tela
-- detecta se `purchase_orders` existe e, enquanto não existir, mantém o
-- formulário antigo de compra.

-- ─── Tabelas ────────────────────────────────────────────────────────────────

create table if not exists public.purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  requisition_id    uuid not null references public.requisitions(id) on delete cascade,
  approval_id       uuid references public.approvals(id) on delete set null,
  supplier_name     text not null check (length(btrim(supplier_name)) > 0),
  order_number      text not null check (length(btrim(order_number)) > 0),
  invoice_number    text,
  payment_method    text,
  payment_terms     text,
  expected_delivery date,
  freight_value     numeric(12, 2) not null default 0 check (freight_value >= 0),
  discount_value    numeric(12, 2) not null default 0 check (discount_value >= 0),
  notes             text,
  -- soma das linhas + frete - desconto, mantido por trigger
  total_value       numeric(12, 2) not null default 0,
  requires_receipt  boolean not null default true,
  status            text not null default 'COMPRADO'
    check (status in ('COMPRADO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO')),
  buyer_id          uuid references auth.users(id) on delete set null,
  purchased_at      timestamptz not null default now(),
  received_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (requisition_id, supplier_name, order_number)
);

create index if not exists purchase_orders_requisition_idx
  on public.purchase_orders (requisition_id);

create table if not exists public.purchase_order_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  requisition_item_id uuid not null references public.requisition_items(id) on delete restrict,
  quantity            numeric not null check (quantity > 0),
  unit_price          numeric(14, 4) not null check (unit_price >= 0),
  line_total          numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  received_quantity   numeric not null default 0 check (received_quantity >= 0),
  notes               text,
  unique (purchase_order_id, requisition_item_id),
  check (received_quantity <= quantity)
);

create index if not exists purchase_order_items_item_idx
  on public.purchase_order_items (requisition_item_id);

comment on table public.purchase_orders is
  'Pedido de compra por fornecedor. Uma requisição M1 pode ter vários (compra fracionada).';
comment on table public.purchase_order_items is
  'Itens de cada pedido de compra: item da requisição, quantidade comprada e preço unitário.';

-- ─── Total do pedido = linhas + frete - desconto ────────────────────────────

create or replace function private.purchase_order_recalc_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_value = coalesce(
           (select sum(line_total) from public.purchase_order_items where purchase_order_id = po.id), 0
         ) + po.freight_value - po.discount_value,
         updated_at = now()
   where po.id = v_po;
  return null;
end;
$$;

drop trigger if exists purchase_order_items_total on public.purchase_order_items;
create trigger purchase_order_items_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function private.purchase_order_recalc_total();

-- Frete/desconto alterados direto no pedido também refazem o total.
create or replace function private.purchase_order_recalc_on_header()
returns trigger
language plpgsql
as $$
begin
  new.total_value := coalesce(
      (select sum(line_total) from public.purchase_order_items where purchase_order_id = new.id), 0
    ) + new.freight_value - new.discount_value;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists purchase_orders_header_total on public.purchase_orders;
create trigger purchase_orders_header_total
  before update of freight_value, discount_value on public.purchase_orders
  for each row execute function private.purchase_order_recalc_on_header();

-- ─── RLS (mesma regra de purchases, ver 002) ────────────────────────────────

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using (private.can_view_requisition(requisition_id));

drop policy if exists purchase_orders_manage_comprador on public.purchase_orders;
create policy purchase_orders_manage_comprador on public.purchase_orders
  for all to authenticated
  using (private.has_any_role(array['admin', 'comprador']::public.app_role[]))
  with check (private.has_any_role(array['admin', 'comprador']::public.app_role[]));

drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items
  for select to authenticated
  using (exists (
    select 1 from public.purchase_orders po
     where po.id = purchase_order_id and private.can_view_requisition(po.requisition_id)
  ));

drop policy if exists purchase_order_items_manage_comprador on public.purchase_order_items;
create policy purchase_order_items_manage_comprador on public.purchase_order_items
  for all to authenticated
  using (private.has_any_role(array['admin', 'comprador']::public.app_role[]))
  with check (private.has_any_role(array['admin', 'comprador']::public.app_role[]));

-- ─── Confirmação atômica dos pedidos ────────────────────────────────────────
-- p_orders: [{ supplier_name, order_number, invoice_number, payment_method,
--              payment_terms, expected_delivery, freight_value, discount_value,
--              notes, items: [{ requisition_item_id, quantity, unit_price }] }]
--
-- Regras (todas com mensagem em português, repassada à tela):
--   * só admin/comprador; só M1; só requisição em COMPRA com aprovação aprovada;
--   * todo item APROVADO precisa estar 100% alocado entre os pedidos, e nenhum
--     item não aprovado pode entrar;
--   * a soma das linhas (sem frete/desconto) não pode passar do valor aprovado
--     (tolerância de R$ 0,01 por linha, por arredondamento do preço unitário);
--     acima disso é preciso corrigir o preço na Cotação, o que reabre a
--     aprovação (fluxo existente);
--   * refazer pedidos (ticket voltou a COMPRA após recebimento reprovado) só é
--     permitido se nada foi recebido dos pedidos anteriores.

create or replace function public.confirm_purchase_orders(
  p_requisition_id   uuid,
  p_approval_id      uuid,
  p_orders           jsonb,
  p_requires_receipt boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req        record;
  v_appr       record;
  v_o          jsonb;
  v_it         jsonb;
  v_po         uuid;
  v_gap        record;
  v_lines      integer := 0;
  v_subtotal   numeric := 0;
  v_approved   numeric := 0;
  v_total      numeric := 0;
  v_next       public.requisition_status;
  v_replaced   integer := 0;
begin
  if not private.has_any_role(array['admin', 'comprador']::public.app_role[]) then
    raise exception 'Sem permissão para confirmar compras.';
  end if;

  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if not found then
    raise exception 'Requisição não encontrada.';
  end if;
  if v_req.module <> 'M1' then
    raise exception 'Pedidos de compra por fornecedor estão disponíveis só para o módulo M1.';
  end if;
  if v_req.status <> 'COMPRA' then
    raise exception 'A requisição não está aguardando compra.';
  end if;

  select * into v_appr
    from public.approvals
   where id = p_approval_id and requisition_id = p_requisition_id and decision = 'approved';
  if not found then
    raise exception 'Aprovação inválida para esta requisição.';
  end if;

  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'Informe ao menos um pedido de compra.';
  end if;

  -- Refazer: só se nada foi recebido dos pedidos anteriores.
  if exists (
    select 1 from public.purchase_orders po
     where po.requisition_id = p_requisition_id
       and po.status <> 'CANCELADO'
       and (po.status <> 'COMPRADO'
            or exists (select 1 from public.purchase_order_items i
                        where i.purchase_order_id = po.id and i.received_quantity > 0))
  ) then
    raise exception 'Já há itens recebidos de pedidos anteriores desta requisição; não é possível refazer os pedidos.';
  end if;
  delete from public.purchase_orders where requisition_id = p_requisition_id;
  get diagnostics v_replaced = row_count;

  for v_o in select * from jsonb_array_elements(p_orders) loop
    if nullif(btrim(v_o->>'supplier_name'), '') is null then
      raise exception 'Informe o fornecedor de todos os pedidos.';
    end if;
    if nullif(btrim(v_o->>'order_number'), '') is null then
      raise exception 'Informe o número do pedido de "%".', v_o->>'supplier_name';
    end if;
    if v_o->'items' is null or jsonb_typeof(v_o->'items') <> 'array'
       or jsonb_array_length(v_o->'items') = 0 then
      raise exception 'O pedido de "%" não tem itens.', v_o->>'supplier_name';
    end if;

    insert into public.purchase_orders (
      requisition_id, approval_id, supplier_name, order_number, invoice_number,
      payment_method, payment_terms, expected_delivery, freight_value, discount_value,
      notes, requires_receipt, buyer_id
    ) values (
      p_requisition_id, p_approval_id, btrim(v_o->>'supplier_name'), btrim(v_o->>'order_number'),
      nullif(btrim(coalesce(v_o->>'invoice_number', '')), ''),
      nullif(btrim(coalesce(v_o->>'payment_method', '')), ''),
      nullif(btrim(coalesce(v_o->>'payment_terms', '')), ''),
      nullif(v_o->>'expected_delivery', '')::date,
      coalesce(nullif(v_o->>'freight_value', '')::numeric, 0),
      coalesce(nullif(v_o->>'discount_value', '')::numeric, 0),
      nullif(btrim(coalesce(v_o->>'notes', '')), ''),
      p_requires_receipt, auth.uid()
    ) returning id into v_po;

    for v_it in select * from jsonb_array_elements(v_o->'items') loop
      insert into public.purchase_order_items (purchase_order_id, requisition_item_id, quantity, unit_price)
      values (v_po, (v_it->>'requisition_item_id')::uuid,
              (v_it->>'quantity')::numeric, (v_it->>'unit_price')::numeric);
      v_lines := v_lines + 1;
    end loop;
  end loop;

  -- Cobertura: todo item aprovado 100% alocado.
  for v_gap in
    select ri.description, coalesce(ri.quantity, 1) as pedido,
           coalesce((select sum(poi.quantity)
                       from public.purchase_order_items poi
                       join public.purchase_orders po on po.id = poi.purchase_order_id
                      where poi.requisition_item_id = ri.id
                        and po.requisition_id = p_requisition_id), 0) as alocado
      from public.approval_items ai
      join public.requisition_items ri on ri.id = ai.item_id
     where ai.approval_id = p_approval_id and ai.decision = 'approved'
  loop
    if v_gap.alocado <> v_gap.pedido then
      raise exception 'Item "%": alocado % de %.', v_gap.description, v_gap.alocado, v_gap.pedido;
    end if;
  end loop;

  -- Nenhum item não aprovado (ou de outra requisição) pode entrar.
  if exists (
    select 1
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.purchase_order_id
     where po.requisition_id = p_requisition_id
       and not exists (select 1 from public.approval_items ai
                        where ai.approval_id = p_approval_id
                          and ai.item_id = poi.requisition_item_id
                          and ai.decision = 'approved')
  ) then
    raise exception 'Há item nos pedidos que não foi aprovado.';
  end if;

  select coalesce(sum(poi.line_total), 0) into v_subtotal
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
   where po.requisition_id = p_requisition_id;

  select coalesce(sum(ai.price), 0) into v_approved
    from public.approval_items ai
   where ai.approval_id = p_approval_id and ai.decision = 'approved';
  if v_approved = 0 then
    v_approved := coalesce(v_appr.total_value, 0);
  end if;

  if v_subtotal > v_approved + 0.01 * v_lines then
    raise exception 'O total dos itens (R$ %) excede o valor aprovado (R$ %). Corrija o preço na Cotação para reabrir a aprovação.',
      translate(to_char(v_subtotal, 'FM999,999,990.00'), ',.', '.,'),
      translate(to_char(v_approved, 'FM999,999,990.00'), ',.', '.,');
  end if;

  select coalesce(sum(total_value), 0) into v_total
    from public.purchase_orders where requisition_id = p_requisition_id;

  -- Resumo no formato antigo (PDF, analytics, Omie, SLA leem daqui).
  insert into public.purchases (
    requisition_id, approval_id, supplier_name, supplier_price, purchase_order_number,
    invoice_number, payment_method, notes, requires_receipt, buyer_id, purchased_at
  )
  select p_requisition_id, p_approval_id,
         string_agg(supplier_name, ', ' order by supplier_name),
         v_total,
         string_agg(order_number, ', ' order by supplier_name),
         string_agg(invoice_number, ', ' order by supplier_name),
         string_agg(distinct payment_method, ', '),
         'Compra dividida em ' || count(*) || ' pedido(s) — detalhes nos pedidos de compra.',
         p_requires_receipt, auth.uid(), now()
    from public.purchase_orders where requisition_id = p_requisition_id
  on conflict (requisition_id) do update
     set approval_id = excluded.approval_id,
         supplier_name = excluded.supplier_name,
         supplier_price = excluded.supplier_price,
         purchase_order_number = excluded.purchase_order_number,
         invoice_number = excluded.invoice_number,
         payment_method = excluded.payment_method,
         notes = excluded.notes,
         requires_receipt = excluded.requires_receipt,
         buyer_id = excluded.buyer_id,
         purchased_at = excluded.purchased_at,
         updated_at = now();

  v_next := case when p_requires_receipt then 'RECEBIMENTO' else 'CONCLUÍDO' end;
  update public.requisitions
     set status = v_next,
         completed_at = case when p_requires_receipt then null else now() end
   where id = p_requisition_id;

  -- Sem recebimento (V5): o pedido já nasce recebido.
  if not p_requires_receipt then
    update public.purchase_order_items poi
       set received_quantity = poi.quantity
      from public.purchase_orders po
     where poi.purchase_order_id = po.id and po.requisition_id = p_requisition_id;
    update public.purchase_orders
       set status = 'RECEBIDO', received_at = now()
     where requisition_id = p_requisition_id;
  end if;

  -- Mesma ação de antes (analytics, SLA e logs dependem dela); os pedidos vão em details.
  insert into public.audit_logs (
    requisition_id, ticket_number, action, old_status, new_status, actor_id, details
  ) values (
    p_requisition_id, v_req.ticket_number, 'PURCHASE_CONFIRMED', v_req.status, v_next, auth.uid(),
    jsonb_build_object(
      'purchase_orders', (
        select jsonb_agg(jsonb_build_object(
                 'supplier_name', supplier_name, 'order_number', order_number,
                 'payment_method', payment_method, 'payment_terms', payment_terms,
                 'total_value', total_value) order by supplier_name)
          from public.purchase_orders where requisition_id = p_requisition_id),
      'total_items_value', v_subtotal,
      'total_value', v_total,
      'requires_receipt', p_requires_receipt,
      'replaced_previous_orders', v_replaced
    )
  );

  return jsonb_build_object('new_status', v_next, 'items_total', v_subtotal, 'total', v_total);
end;
$$;

revoke all on function public.confirm_purchase_orders(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.confirm_purchase_orders(uuid, uuid, jsonb, boolean) to authenticated;

-- ─── Compatibilidade com o Recebimento atual (V5) ───────────────────────────
-- O recebimento ainda é por ticket (fase 3 traz por pedido). Enquanto isso,
-- quando o ticket é CONCLUÍDO os pedidos ficam como recebidos, para não
-- aparecerem como pendentes.

create or replace function private.purchase_orders_on_requisition_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'CONCLUÍDO' and old.status is distinct from 'CONCLUÍDO' then
    update public.purchase_order_items poi
       set received_quantity = poi.quantity
      from public.purchase_orders po
     where poi.purchase_order_id = po.id
       and po.requisition_id = new.id and po.status <> 'CANCELADO';
    update public.purchase_orders
       set status = 'RECEBIDO', received_at = coalesce(received_at, now())
     where requisition_id = new.id and status <> 'CANCELADO';
  end if;
  return null;
end;
$$;

drop trigger if exists requisitions_purchase_orders_done on public.requisitions;
create trigger requisitions_purchase_orders_done
  after update of status on public.requisitions
  for each row execute function private.purchase_orders_on_requisition_done();

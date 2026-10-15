# Desenho: cotação e compra com vários fornecedores (pedidos de compra)

Data: 2026-10-15 · Status: **proposta, nada implementado** · Origem: ticket M1-000221
(reprovado por preços suspeitos) e pedido de fracionar a compra entre fornecedores,
cada um com forma de pagamento e observações próprias.

## 1. Situação atual (verificada no código)

| Etapa | Hoje | Limite |
|---|---|---|
| Cotação (V2) | `quoting.tsx:183` começa com `["", "", ""]` e o texto fixa "até 3 fornecedores". `quotation_suppliers` aceita N propostas por item desde a 029, com `is_winner`. | O limite de 3 é só de tela. Um item tem **um** vencedor; não há como dividir a quantidade entre dois fornecedores. |
| Aprovação (V3) | Uma aprovação por ticket, alçada pelo total, decisão por item (`approval_items`). | — |
| Compra (V4) | `purchases.requisition_id UNIQUE`: uma linha por ticket, com um `supplier_name`, um `purchase_order_number`, um `payment_method`, um `notes`. `purchasing.tsx:216` junta os fornecedores numa string. | **Não existe pedido por fornecedor.** |
| Recebimento (V5) | `receipts.requisition_id UNIQUE`; `requisition_items.received_at` marca o item (024). | Recebe por item, mas sem saber de qual pedido nem quanto da quantidade. |

O preço gravado em `quotation_suppliers.price` é o **total da linha** (valor unitário digitado × quantidade,
`quoting.tsx:733`). O M1-000221 mostra o risco: o cabo 3×0,75 saiu a R$ 299 e R$ 437 por unidade, 100× o
esperado nas duas propostas, o que sugere erro de digitação. O campo do valor unitário é `type="number"`, que já normaliza a vírgula, então `parseFloat` **não** é a causa
(correção da hipótese inicial); o erro de 100× é de digitação.

## 2. Modelo proposto

Princípio: **a cotação continua decidindo preço; o pedido de compra decide quem entrega o quê.**

```
requisitions 1─┬─* requisition_items
               ├─* quotation_suppliers (propostas; ganha quantidade ofertada e condição de pagamento)
               ├─1 approvals ─* approval_items
               ├─* purchase_orders        ← NOVO: um por fornecedor
               │     └─* purchase_order_items ← NOVO: item × quantidade × preço unitário
               └─1 purchases              ← legado + resumo do ticket (mantido por compatibilidade)
```

Decisões:
- **`purchases` não é removida.** M2–M6 e todos os tickets antigos continuam nela, e PDF, analytics e Omie
  continuam lendo. Para M1 com pedidos, a função de confirmação grava nela um **resumo** (fornecedores
  concatenados, soma dos valores, primeiro pedido de compra).
- Um item pode ser dividido entre fornecedores (`purchase_order_items.quantity` por linha, soma = quantidade do item).
- Tickets antigos sem pedidos aparecem como hoje (leitura de `purchases`); **não haverá backfill** nesta fase.
- Se o total dos pedidos passar do valor aprovado, **reabre a aprovação**, reaproveitando o fluxo de
  "correção de preço em Compra" que já existe (`quoting.tsx:1699`).

## 3. Migração SQL (rascunho, **não testado**, numerar como `039`)

```sql
-- 039 — Pedidos de compra por fornecedor (compra fracionada)

-- 3.1 Cotação: quantidade ofertada e condição de pagamento por proposta
alter table public.quotation_suppliers
  add column if not exists available_quantity numeric
    check (available_quantity is null or available_quantity > 0),
  add column if not exists payment_terms text;

comment on column public.quotation_suppliers.available_quantity is
  'Quantidade que o fornecedor consegue entregar do item; NULL = toda a quantidade pedida.';
comment on column public.quotation_suppliers.payment_terms is
  'Condição de pagamento oferecida (ex.: 28 dias, à vista); pré-preenche o pedido de compra.';

-- 3.2 Pedido de compra (um por fornecedor)
create table if not exists public.purchase_orders (
  id                    uuid primary key default gen_random_uuid(),
  requisition_id        uuid not null references public.requisitions(id) on delete cascade,
  approval_id           uuid references public.approvals(id) on delete set null,
  supplier_name         text not null check (length(btrim(supplier_name)) > 0),
  supplier_document     text,                       -- CNPJ, opcional
  order_number          text not null check (length(btrim(order_number)) > 0),
  invoice_number        text,
  payment_method        text,                       -- PIX, boleto, cartão...
  payment_terms         text,                       -- 28 dias, entrada + 30...
  expected_delivery     date,
  freight_value         numeric(12,2) not null default 0 check (freight_value >= 0),
  discount_value        numeric(12,2) not null default 0 check (discount_value >= 0),
  notes                 text,                       -- observações deste fornecedor
  total_value           numeric(12,2) not null default 0,   -- mantido por trigger
  requires_receipt      boolean not null default true,
  status                text not null default 'COMPRADO'
    check (status in ('COMPRADO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO')),
  buyer_id              uuid references auth.users(id) on delete set null,
  purchased_at          timestamptz not null default now(),
  received_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (requisition_id, order_number, supplier_name)
);
create index if not exists purchase_orders_requisition_idx on public.purchase_orders (requisition_id);

-- 3.3 Itens do pedido (item da requisição × quantidade × preço unitário)
create table if not exists public.purchase_order_items (
  id                   uuid primary key default gen_random_uuid(),
  purchase_order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  requisition_item_id  uuid not null references public.requisition_items(id) on delete restrict,
  quantity             numeric not null check (quantity > 0),
  unit_price           numeric(14,4) not null check (unit_price >= 0),
  line_total           numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  received_quantity    numeric not null default 0 check (received_quantity >= 0),
  notes                text,
  unique (purchase_order_id, requisition_item_id),
  check (received_quantity <= quantity)
);
create index if not exists purchase_order_items_item_idx on public.purchase_order_items (requisition_item_id);

-- 3.4 total do pedido = soma das linhas + frete - desconto
create or replace function private.purchase_order_recalc_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_value = coalesce((select sum(line_total) from public.purchase_order_items where purchase_order_id = po.id), 0)
                       + po.freight_value - po.discount_value,
         updated_at = now()
   where po.id = v_po;
  return null;
end $$;
create trigger purchase_order_items_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function private.purchase_order_recalc_total();

-- 3.5 RLS: mesma regra de purchases (ver 002)
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
revoke all on public.purchase_orders, public.purchase_order_items from anon;
grant select, insert, update, delete on public.purchase_orders, public.purchase_order_items to authenticated;

create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (private.can_view_requisition(requisition_id));
create policy purchase_orders_manage_comprador on public.purchase_orders for all to authenticated
  using (private.has_any_role(array['admin','comprador']::public.app_role[]))
  with check (private.has_any_role(array['admin','comprador']::public.app_role[]));
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (exists (select 1 from public.purchase_orders po
                 where po.id = purchase_order_id and private.can_view_requisition(po.requisition_id)));
create policy purchase_order_items_manage_comprador on public.purchase_order_items for all to authenticated
  using (private.has_any_role(array['admin','comprador']::public.app_role[]))
  with check (private.has_any_role(array['admin','comprador']::public.app_role[]));

-- 3.6 Confirmação atômica (substitui o upsert em purchases para M1 multi-itens)
-- p_orders: [{ supplier_name, order_number, invoice_number, payment_method, payment_terms,
--              expected_delivery, freight_value, discount_value, notes,
--              items: [{ requisition_item_id, quantity, unit_price }] }]
create or replace function public.confirm_purchase_orders(
  p_requisition_id uuid, p_approval_id uuid, p_orders jsonb, p_requires_receipt boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req record; v_appr record; v_o jsonb; v_it jsonb; v_po uuid;
  v_total numeric := 0; v_next public.requisition_status; v_gap record;
begin
  if not private.has_any_role(array['admin','comprador']::public.app_role[]) then
    raise exception 'Sem permissão para confirmar compras.';
  end if;
  select * into v_req from public.requisitions where id = p_requisition_id for update;
  if not found or v_req.status <> 'COMPRA' then
    raise exception 'A requisição não está em Compra.';
  end if;
  select * into v_appr from public.approvals
   where id = p_approval_id and requisition_id = p_requisition_id and decision = 'approved';
  if not found then raise exception 'Aprovação inválida para esta requisição.'; end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'Informe ao menos um pedido de compra.';
  end if;
  if exists (select 1 from public.purchase_orders where requisition_id = p_requisition_id and status <> 'CANCELADO') then
    raise exception 'Esta requisição já tem pedidos de compra confirmados.';
  end if;

  for v_o in select * from jsonb_array_elements(p_orders) loop
    insert into public.purchase_orders (requisition_id, approval_id, supplier_name, order_number, invoice_number,
      payment_method, payment_terms, expected_delivery, freight_value, discount_value, notes, requires_receipt, buyer_id)
    values (p_requisition_id, p_approval_id, v_o->>'supplier_name', v_o->>'order_number', nullif(v_o->>'invoice_number',''),
      nullif(v_o->>'payment_method',''), nullif(v_o->>'payment_terms',''), nullif(v_o->>'expected_delivery','')::date,
      coalesce((v_o->>'freight_value')::numeric,0), coalesce((v_o->>'discount_value')::numeric,0),
      nullif(v_o->>'notes',''), p_requires_receipt, auth.uid())
    returning id into v_po;
    for v_it in select * from jsonb_array_elements(v_o->'items') loop
      insert into public.purchase_order_items (purchase_order_id, requisition_item_id, quantity, unit_price)
      values (v_po, (v_it->>'requisition_item_id')::uuid, (v_it->>'quantity')::numeric, (v_it->>'unit_price')::numeric);
    end loop;
  end loop;

  -- cobertura: todo item aprovado precisa estar 100% alocado, e nada além de itens aprovados
  for v_gap in
    select ri.id, ri.description, ri.quantity, coalesce(sum(poi.quantity),0) as alocado
      from public.requisition_items ri
      join public.approval_items ai on ai.requisition_item_id = ri.id and ai.approval_id = p_approval_id and ai.decision = 'approved'
      left join public.purchase_order_items poi on poi.requisition_item_id = ri.id
      left join public.purchase_orders po on po.id = poi.purchase_order_id and po.requisition_id = p_requisition_id
     group by ri.id, ri.description, ri.quantity
    having coalesce(sum(poi.quantity),0) <> ri.quantity
  loop
    raise exception 'Item "%": alocado % de %.', v_gap.description, v_gap.alocado, v_gap.quantity;
  end loop;
  if exists (select 1 from public.purchase_order_items poi
               join public.purchase_orders po on po.id = poi.purchase_order_id and po.requisition_id = p_requisition_id
              where not exists (select 1 from public.approval_items ai
                                 where ai.requisition_item_id = poi.requisition_item_id
                                   and ai.approval_id = p_approval_id and ai.decision = 'approved')) then
    raise exception 'Há item no pedido que não foi aprovado.';
  end if;

  select coalesce(sum(total_value),0) into v_total from public.purchase_orders where requisition_id = p_requisition_id;
  -- tolerância de R$ 0,01; acima disso a compra precisa de nova aprovação (fluxo de correção de preço)
  if v_total > coalesce(v_appr.total_value,0) + 0.01 then
    raise exception 'Total dos pedidos (R$ %) excede o aprovado (R$ %). Corrija o preço para reabrir a aprovação.',
      v_total, v_appr.total_value;
  end if;

  -- resumo legado para PDF/analytics/Omie
  insert into public.purchases (requisition_id, approval_id, supplier_name, supplier_price, purchase_order_number,
                                payment_method, notes, requires_receipt, buyer_id, purchased_at)
  select p_requisition_id, p_approval_id, string_agg(supplier_name, ', ' order by supplier_name), sum(total_value),
         min(order_number), string_agg(distinct payment_method, ', '), 'Ver pedidos de compra', p_requires_receipt, auth.uid(), now()
    from public.purchase_orders where requisition_id = p_requisition_id
  on conflict (requisition_id) do update
    set supplier_name = excluded.supplier_name, supplier_price = excluded.supplier_price,
        purchase_order_number = excluded.purchase_order_number, payment_method = excluded.payment_method,
        notes = excluded.notes, purchased_at = excluded.purchased_at, updated_at = now();

  v_next := case when p_requires_receipt then 'RECEBIMENTO' else 'CONCLÍDO' end;
  update public.requisitions set status = v_next,
         completed_at = case when p_requires_receipt then null else now() end
   where id = p_requisition_id;
  if not p_requires_receipt then
    update public.purchase_orders set status = 'RECEBIDO', received_at = now() where requisition_id = p_requisition_id;
  end if;

  insert into public.audit_logs (requisition_id, ticket_number, action, old_status, new_status, actor_id, details)
  values (p_requisition_id, v_req.ticket_number, 'PURCHASE_ORDERS_CONFIRMED', v_req.status, v_next, auth.uid(),
          jsonb_build_object('orders', jsonb_array_length(p_orders), 'total', v_total));
  return jsonb_build_object('new_status', v_next, 'total', v_total);
end $$;
revoke all on function public.confirm_purchase_orders(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.confirm_purchase_orders(uuid, uuid, jsonb, boolean) to authenticated;
```

Pendente na migração (a validar contra o schema real antes de aplicar): nomes exatos das colunas de
`approval_items` (`requisition_item_id`, `decision`), a assinatura de `private.can_view_requisition`, a coluna
`actor_id` de `audit_logs`, e o recebimento (`receive_purchase_order_items`, abaixo).

### Recebimento por pedido

```sql
-- p_items: [{ purchase_order_item_id, received_quantity }]  (valor acumulado, não incremento)
create or replace function public.receive_purchase_order_items(p_purchase_order_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
-- 1. exige papel almoxarife/admin; 2. atualiza received_quantity (<= quantity);
-- 3. status do pedido: RECEBIDO se tudo chegou, senão RECEBIDO_PARCIAL; grava received_at;
-- 4. requisition_items.received_at = now() quando a soma recebida do item == quantity;
-- 5. se todos os pedidos não cancelados estão RECEBIDO: requisitions.status = 'CONCLÍDO',
--    completed_at = now(), e grava o receipts final (condição/entregador informados na última entrega);
-- 6. audit_logs: PURCHASE_ORDER_RECEIVED.
$$;
```

## 4. Telas

### 4.1 Cotação (`quoting.tsx`)
- Fornecedores dinâmicos: começa com 3 colunas; **"+ Fornecedor"** e **"remover"** (mínimo 1). Troca
  `useState(["","",""])` por lista editável.
- Por proposta, além de valor unitário e prazo: **quantidade ofertada** (vazio = tudo) e **condição de pagamento**.
- Vencedor por item passa a aceitar **mais de um fornecedor**: o comprador marca a quantidade de cada um
  (ex.: Santil 3 rolos + Norte 97). O sistema avisa se a soma ≠ quantidade pedida.
- **Validação de preço:** alertar quando a proposta
  estiver > 3× ou < 1/3 da mediana das outras propostas do item ou do último preço comprado (Omie), exigindo
  confirmação. Teria sinalizado o cabo 3×0,75 do M1-000221 antes de chegar ao aprovador.

### 4.2 Aprovação (`approval.tsx` e link do WhatsApp)
- A lista de fornecedores da página rápida passa a mostrar **item, quantidade, fornecedor e preço unitário**,
  não só fornecedor e valor (hoje "SANTIL R$ 468,80" não diz de qual item).
- Linha de alerta quando algum preço unitário fugir do padrão (mesma regra de 4.1).

### 4.3 Compra (`purchasing.tsx`): a mudança principal
Esboço:

```
M1-000221 · aprovado R$ 37.272,10                       [ + Novo fornecedor ]
┌ Santil ─────────────────────────────────────────────────────────────┐
│ Pedido nº [______]  Pagamento [Boleto ▾]  Condição [28 dias]         │
│ Entrega prevista [__/__/__]  Frete [R$ __]  Desconto [R$ __]         │
│ Item                       Qtd   Unit.     Total                     │
│ Cabo flexível 2×0,75 ····· 400   R$ 1,17   R$ 468,80   [mover ▾]    │
│ Cabo 4×6,0 ·············  7      R$ 263,34 R$ 1.843,38 [mover ▾]    │
│ Observações: [____________________________________________]         │
└─────────────────────────────────────────────────────────────────────┘
┌ Norte Dimensional ... (mesmo bloco) ┐
Não alocado: nenhum item ✔        Total dos pedidos R$ 37.272,10 = aprovado ✔
[Confirmar compra]  (desabilitado enquanto sobrar item sem fornecedor ou total > aprovado)
```

- Sugestão inicial automática: um bloco por fornecedor vencedor, com itens, quantidades e preços da cotação.
- O comprador pode **mover** item (ou parte da quantidade) entre fornecedores, **adicionar** fornecedor novo
  (só com nome, para quando a compra sai da cotação) e editar pagamento, entrega, frete e observações por bloco.
- Rodapé com saldo por item (alocado × pedido) e total × aprovado; excedeu → mensagem para corrigir o preço e
  reabrir a aprovação (fluxo existente).
- Chama `confirm_purchase_orders`; erros de negócio do `RAISE EXCEPTION` aparecem como estão.
- Tickets sem pedidos (antigos, M2–M6) mantêm a tela atual.

### 4.4 Recebimento (`receipt.tsx`)
- Agrupar por **pedido de compra** (fornecedor, nº do pedido, entrega prevista), com quantidade recebida por
  item (aceita parcial: 3 de 5 rolos).
- Ticket só vai a CONCLÍDO quando todos os pedidos estiverem recebidos; enquanto isso mostra
  "2 de 3 pedidos recebidos".

### 4.5 Demais pontos
- **PDF** (`pdf/template.ts`): bloco M1 com um quadro por pedido (fornecedor, pagamento, observações, itens).
  Os blocos do template são escritos à mão, então atualizar manualmente.
- **Auditoria** (`audit-actions.ts`): `PURCHASE_ORDERS_CONFIRMED`, `PURCHASE_ORDER_RECEIVED`.
- **WhatsApp**: mensagem de compra confirmada lista os fornecedores; avisar o solicitante a cada pedido recebido.
- **Analytics/Omie**: continuam usando o resumo em `purchases`; adicionar visão por fornecedor depois, a partir de
  `purchase_orders`.
- **Testes**: cálculo de alocação e saldo (função pura em `src/features/purchases/`), validação de preço
  fora do padrão, e a migração em branch descartável do Supabase (cobertura, excedente, papéis, RLS).

## 5. Fases

1. **Rápida (sem migração):** remover o limite de 3 na cotação, alerta
   de preço fora do padrão, item e quantidade na lista de fornecedores da aprovação rápida.
2. **Principal:** migração 039, `confirm_purchase_orders`, nova tela de Compra, PDF e auditoria.
3. **Fechamento:** recebimento por pedido, cotação com quantidade ofertada / vários vencedores por item,
   notificações.

## 6. Decisões em aberto

- **Compra acima do aprovado:** bloquear e reabrir aprovação (proposto) ou aceitar tolerância (ex.: 2%)?
- **Dividir um item entre fornecedores** na Compra, sem ter sido dividido na cotação, exige nova aprovação?
  Pelo texto atual, se o total não passar do aprovado, não.
- **Recebimento com problema** (`condition` ≠ ok): o fluxo atual devolve o ticket inteiro a Compra. Com vários
  pedidos, o proposto é marcar só aquele pedido; precisa de um status `COM_PROBLEMA`.
- **Cadastro de fornecedores:** continua texto livre (como hoje) ou passa a haver tabela com CNPJ e condições?
- **Edição de pedido já confirmado** (trocar fornecedor, cancelar): não coberto; sugerido cancelar o pedido
  (`CANCELADO`) e liberar os itens para novo pedido, com auditoria.

-- 023 — Cotação fracionada por item para M1 multi-itens
--
-- Problema (usuário): uma requisição M1 com 20 itens chegava na Cotação (V2)
-- como um "tijolo" — os 20 produtos viravam um bloco único, com um só
-- fornecedor vencedor e um só preço, quando na prática o comprador cota
-- fracionado (ex.: 20 itens divididos entre 4 fornecedores).
--
-- Solução: reutilizar a máquina por item que o M2 (Viagens) já usa —
-- requisition_items + quotation_suppliers.item_id + approval_items — para o
-- M1 multi-itens:
--   V2: cada produto recebe seu fornecedor/preço/prazo individualmente;
--   V3: a aprovação é UMA só (alçada pelo valor TOTAL da soma), mas o
--       aprovador vê o detalhamento e pode aprovar/reprovar item a item
--       (cortar da lista: 20 → 19 → 18...);
--   V4: aprovado, o ticket "se junta de novo" — segue como uma requisição
--       só, e a tela de Compra mostra o consolidado agrupado por fornecedor.
--
-- O gestor (1º aprovador) já podia remover itens editando a requisição
-- (2ª edição); a sincronização abaixo garante que os requisition_items
-- pendentes acompanhem essas remoções.

alter table public.requisition_items drop constraint requisition_items_item_type_check;
alter table public.requisition_items add constraint requisition_items_item_type_check
  check (item_type = any (array['voo'::text, 'hotel'::text, 'carro'::text, 'produto'::text]));

alter table public.requisition_items
  add column if not exists product_code text,
  add column if not exists quantity numeric;

comment on column public.requisition_items.product_code is
  'Código do produto (Omie) quando item_type = produto — itens do M1 multi-itens.';
comment on column public.requisition_items.quantity is
  'Quantidade solicitada quando item_type = produto.';

-- Itens pendentes podem ser removidos ao sincronizar com module_data.items
-- (ex.: gestor removeu um item na 2ª edição da requisição).
drop policy if exists requisition_items_delete_pending on public.requisition_items;
create policy requisition_items_delete_pending on public.requisition_items
  for delete to authenticated using (status = 'pending');
grant delete on public.requisition_items to authenticated;

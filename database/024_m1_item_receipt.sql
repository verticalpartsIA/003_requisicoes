-- 024 — Recebimento por item para M1 multi-itens
--
-- Problema (usuário): uma requisição M1 com muitos itens é comprada em
-- fornecedores diferentes e chega em ondas — parte hoje, parte no fim de
-- semana. O Recebimento (V5) tratava a requisição inteira como um bloco só
-- (uma linha em `receipts`, sem nenhuma granularidade), então o almoxarifado
-- não tinha como registrar "esses 12 já chegaram, esses 8 ainda não" sem
-- fechar o ticket inteiro.
--
-- Solução: mesma ideia da cotação fracionada (023) — reaproveitar
-- requisition_items, mas sem precisar de uma tabela nova: basta marcar,
-- item a item, quando ele chegou. A finalização do recebimento (condição
-- geral, entregador, conclusão do ticket) continua em `receipts`/`purchases`
-- como já era; isso só adiciona a granularidade de "chegou ou não" por item.

alter table public.requisition_items
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references auth.users(id) on delete set null;

comment on column public.requisition_items.received_at is
  'Quando o item foi confirmado como recebido pelo almoxarifado — permite recebimento parcial no M1 multi-itens conforme os produtos chegam de fornecedores diferentes.';
comment on column public.requisition_items.received_by is
  'Usuário que confirmou o recebimento deste item.';

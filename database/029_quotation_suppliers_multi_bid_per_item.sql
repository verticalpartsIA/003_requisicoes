-- Cotação fracionada do M1 (2+ produtos) hoje só permite 1 linha por item em
-- quotation_suppliers (constraint UNIQUE(quotation_id, item_id) criada em
-- 011_fix_quotation_suppliers_unique_constraint.sql) — ou seja, o comprador
-- atribui direto 1 fornecedor por item, sem comparar propostas.
--
-- Para permitir coletar até 3 propostas (fornecedores) por item e escolher o
-- vencedor item a item (um pode vencer em preço, outro em prazo, fracionando
-- a compra), essa unicidade precisa deixar de ser por item e passar a
-- permitir múltiplas linhas — uma por fornecedor que cotou aquele item.
-- `is_winner` continua marcando qual das propostas foi escolhida.
--
-- A aplicação (src/features/quotations/client.ts) não depende mais de
-- ON CONFLICT (quotation_id, item_id) para gravar — o upsert é feito por
-- `id` explícito, buscado antes da gravação — então remover a constraint é
-- seguro para o fluxo de viagem (M2), que continua com 1 linha por item.
ALTER TABLE public.quotation_suppliers
  DROP CONSTRAINT IF EXISTS quotation_suppliers_quotation_id_item_id_key;

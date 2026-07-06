-- BUG-011: saveM2QuoteClient (cotação de viagem, módulo 2) falha ao salvar com
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- porque o upsert em quotation_suppliers usa onConflict "quotation_id,item_id",
-- mas a coluna item_id foi adicionada em 007_travel_items.sql sem constraint única.

ALTER TABLE public.quotation_suppliers
  ADD CONSTRAINT quotation_suppliers_quotation_id_item_id_key UNIQUE (quotation_id, item_id);

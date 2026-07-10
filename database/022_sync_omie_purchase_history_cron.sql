-- 022 — Agendamento semanal da sincronização de histórico completo de Pedidos de Compra
--
-- Alimenta omie_purchase_order_history (todos os status, sem corte de data)
-- e recalcula omie_purchase_lot_config.sugerido_multiplo/sugerido_lote_minimo
-- com confiança estatística (moda recorrente >= 2 pedidos — ver migration 021).
--
-- Semanal, não diário: é uma consulta pesada (~1700+ pedidos, todos os
-- status) e o histórico de compras muda pouco de uma semana para outra.
-- Roda domingo de madrugada para não concorrer com os syncs diários de
-- estoque/giro/pedidos em aberto.

select cron.schedule(
  'sync-omie-purchase-history-weekly',
  '0 6 * * 0', -- 06:00 UTC domingo = 03:00 BRT
  $$
  select net.http_post(
    url := 'https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/sync-omie-purchase-history',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2Z2NyaHRtenZzc2ZkYXpra3prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDM5NjQsImV4cCI6MjA5MzE3OTk2NH0.NqDfKtEfv5riteRKY3d-jjMfHsNXOyfYg_r-JNP_eUk'
    ),
    body := '{}'::jsonb
  );
  $$
);

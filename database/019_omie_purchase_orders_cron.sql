-- 019 — Agendamento diário da sincronização de Pedidos de Compra do Omie
--
-- Roda às 09:30 (horário de Brasília, UTC-3) todos os dias, 15 minutos depois
-- da sincronização de giro/curva (09:00), para não concorrer com ela nas
-- chamadas ao Omie.

select cron.schedule(
  'sync-omie-purchase-orders-daily',
  '30 12 * * *', -- 12:30 UTC = 09:30 BRT
  $$
  select net.http_post(
    url := 'https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/sync-omie-purchase-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2Z2NyaHRtenZzc2ZkYXpra3prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDM5NjQsImV4cCI6MjA5MzE3OTk2NH0.NqDfKtEfv5riteRKY3d-jjMfHsNXOyfYg_r-JNP_eUk'
    ),
    body := '{}'::jsonb
  );
  $$
);

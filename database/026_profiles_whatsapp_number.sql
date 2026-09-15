-- Número de WhatsApp por colaborador, usado pelas notificações automáticas
-- (ciência do líder, cotação, aprovação por alçada). Formato: DDI+DDD+número,
-- só dígitos (ex.: 5511999999999) — mesmo formato aceito pela Evolution API.
alter table public.profiles
  add column if not exists whatsapp_number text;

comment on column public.profiles.whatsapp_number is
  'Número de WhatsApp do colaborador (DDI+DDD+número, só dígitos) para notificações automáticas de requisições.';

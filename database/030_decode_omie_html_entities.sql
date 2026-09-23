-- A API da Omie devolve a descrição do produto com entidades HTML
-- (`1/4"` chega como `1/4&quot;`) e o M1 gravava esse texto cru em
-- requisitions.title/description e module_data.items[].product_name —
-- aparecendo como `&quot;` na tela, no PDF e na exportação CSV/JSON da
-- auditoria. A aplicação agora decodifica tudo que vem da Omie
-- (src/lib/html-entities.ts, aplicado em omiePost); esta migração limpa os
-- registros já gravados (5 tickets M1 em 2026-09-23: 000121, 000138,
-- 000152, 000168, 000170).
--
-- `&amp;` é decodificado por último para não transformar `&amp;quot;`
-- (texto literal "&quot;") em aspas. No JSONB a aspa vira `\"` (escape JSON
-- válido) — trocar direto por `"` quebraria o documento.
-- Idempotente: rodar de novo não altera nada.

UPDATE public.requisitions
SET
  title = replace(replace(replace(replace(title,
            '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&'),
  description = replace(replace(replace(replace(description,
            '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&'),
  module_data = replace(replace(replace(replace(module_data::text,
            '&quot;', '\"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&')::jsonb
WHERE title ~ '&(quot|#39|apos|amp);'
   OR description ~ '&(quot|#39|apos|amp);'
   OR module_data::text ~ '&(quot|#39|apos|amp);';

UPDATE public.requisition_items
SET description = replace(replace(replace(replace(description,
      '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&')
WHERE description ~ '&(quot|#39|apos|amp);';

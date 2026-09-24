# Aviso automático de requisição vencida (SLA) via WhatsApp

## Contexto

O sistema já calculava SLA por etapa (`STAGE_TARGETS` em
`src/features/analytics/api.ts`, usado no Monitor SLA `/logs` e em
Analytics), mas só sob demanda: alguém precisava abrir a tela pra ver que
um ticket estava vencido. O requisitante nunca era avisado. Pedido: avisar
o requisitante automaticamente quando a etapa atual do ticket dele vencer,
checando a cada 4h e repetindo o aviso diariamente enquanto continuar
vencido.

## Decisão de arquitetura

Duas opções foram consideradas para onde rodar a detecção + o envio:

1. **Supabase Edge Function (Deno) agendada por `pg_cron`**, reescrevendo a
   lógica de "início de etapa + meta em horas" em TypeScript/Deno, chamando
   a Evolution API a partir dali. Precisaria de um novo secret do Supabase
   (`EVOLUTION_APIKEY`) e duplicaria a lógica de cálculo de SLA numa
   terceira linguagem/runtime (já existe em TS no app Node; ver o mesmo
   tipo de duplicação documentado no `CLAUDE.md` para
   `features/pdf/template.ts`).
2. **Tudo em SQL/`pg_cron`/`pg_net`** — a detecção de vencidos vira uma
   função SQL (fonte única de verdade), e o próprio Postgres dispara a
   chamada HTTP pra Evolution API via `pg_net`, sem precisar de Edge
   Function nova nem de outro lugar pra guardar o secret.

Optamos pela opção 2, a pedido explícito do usuário ("usa SQL como fonte de
verdade") e porque é estritamente mais simples: nenhum deploy adicional,
nenhum novo secret em outro sistema, e segue o mesmo padrão que já existe
em `database/019_omie_purchase_orders_cron.sql` (cron chamando uma URL via
`net.http_post` com credencial embutida na função/migração).

## O que foi criado (`database/035_sla_breach_notifications.sql`)

- **`public.sla_notifications`** — dedup: um registro por
  `(requisition_id, stage)` com `last_notified_at`. Evita mandar o mesmo
  aviso a cada execução do cron (a cada 4h) — só reenvia depois de ~20h
  (folga proposital em relação às 24h pedidas, pra tolerar jitter do
  cron).
- **`private.sla_active_breaches()`** — função SQL que espelha
  deliberadamente `currentStageInfo()`/`STAGE_TARGETS` de
  `src/features/analytics/api.ts`: mesmo mapeamento de status → etapa,
  mesmo critério de "início da etapa" (última ocorrência da ação de
  audit_log correspondente), mesmas metas em horas. Se as metas mudarem
  no TS, precisam mudar aqui também — não há um jeito automático de manter
  as duas em sincronia hoje.
- **`private.sla_check_and_notify()`** — para cada vencido ainda não
  notificado nas últimas ~20h: monta a mensagem, chama
  `net.http_post` pra Evolution API (mesmo endpoint/formato de
  `src/features/whatsapp/server.ts::sendWhatsappText`), grava a tentativa
  em `whatsapp_notification_log` (estágio `REQUISITANTE_SLA_VENCIDO`) e
  marca `sla_notifications`.
- **Agendamento**: `select cron.schedule('sla-breach-check-4h', '0 */4 * * *', ...)`.

## Pendência antes de aplicar em produção

A função `private.sla_check_and_notify()` tem `evo_apikey text := '';`
como placeholder — precisa ser preenchida com o valor real do
`EVOLUTION_APIKEY` (o mesmo já usado pelo app Node, configurado como env
var na Hostinger) antes da migração ser aplicada. Sem isso, a função roda
mas todo aviso fica com status `skipped_no_apikey` no
`whatsapp_notification_log` — não quebra nada, só não envia.

## Backlog no primeiro run em produção

Ao testar `private.sla_active_breaches()` em produção antes de deixar o
cron disparar de verdade, apareceram **25 tickets vencidos**, vários com
mais de 1000h (40+ dias) de atraso — provavelmente tickets esquecidos ou
de teste. Mandar "sua requisição está vencida há 63 dias" pro requisitante
não fazia sentido. Decisão (explícita do usuário): a função só considera
vencido um ticket com **até 168h (7 dias) de atraso além da meta da
etapa** — `now() - stage_start <= target_hours + 168h`. Passado isso, o
ticket nunca mais aparece na função (não é retomado depois) a menos que
mude de etapa, o que reinicia o relógio. Reduziu de 25 para 11 tickets no
teste em produção.

## Limitações conhecidas

- `net.http_post` é assíncrono (fire-and-forget via fila do `pg_net`) — o
  `status = 'sent'` gravado no log significa "a chamada HTTP foi
  enfileirada", não "a Evolution API confirmou entrega". Mesma limitação
  que o app Node já tem pra erros de rede não seria diferente aqui, mas
  vale registrar que não há confirmação síncrona.
- A lógica de metas por etapa está duplicada entre `src/features/analytics/api.ts`
  (TS) e esta migração (SQL). Se um dia alguém mudar `STAGE_TARGETS` sem
  saber disso, o aviso de vencido fica dessincronizado com o que o Monitor
  SLA mostra na tela.

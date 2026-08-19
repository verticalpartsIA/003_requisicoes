# Relatório — Tickets M2-M6 sumindo de Movimentações

**Status:** ✅ Resolvido
**PR:** #88

## Problema relatado

Usuário procurou o ticket `M4-000149` em Movimentações e não encontrou —
nem conseguia ver o status dele por lá.

## Investigação

`src/routes/movimentacoes.tsx` monta a lista de tickets agrupando
`overview.entries`, que vem de `getLogsOverview`
(`src/features/logs/api.ts`). Esse payload monta `entries` a partir da
tabela `audit_logs` — **não** da tabela `requisitions` diretamente. Um
ticket só aparece em Movimentações se tiver pelo menos uma linha em
`audit_logs`.

Conferido no banco (Supabase, projeto `vprequisicao`):

```sql
select r.ticket_number, r.status,
  (select count(*) from audit_logs a where a.requisition_id = r.id) as audit_log_count
from requisitions r where r.ticket_number = 'M4-000149';
-- status: GESTOR, audit_log_count: 0
```

Confirmado — `M4-000149` existe, está em `GESTOR`, mas nunca teve nenhum
evento de auditoria.

**Causa raiz:** M1 (Produto) é o único módulo cuja criação passa por uma
server function (`createProductRequisition`,
`src/features/requisitions/api.ts`) que insere a requisição **e** o
evento `REQUISITION_CREATED` em `audit_logs` na mesma chamada. Os módulos
M2-M6 (Viagem, Serviço, Manutenção, Frete, Locação) criam a requisição
direto do client (`supabaseBrowser.from("requisitions").insert(...)`,
em `trips.tsx`/`services.tsx`/`maintenance.tsx`/`freight.tsx`/`rental.tsx`)
e **nunca inseriam** o evento de criação em `audit_logs`. Sem esse
primeiro evento, o ticket fica com zero linhas em `audit_logs` e some de
Movimentações até a primeira ação de alguém (ex.: o gestor dar ciência) —
e mesmo assim seria visto sem o evento de criação na timeline.

Um levantamento no banco confirmou o alcance: `M4-000149` (criado hoje,
0 min antes da consulta) e, por coincidência, `M1-000150` também sem
nenhum log — nesse caso não por falta de código (M1 insere o log), mas
porque a criação da requisição e o insert do log são duas chamadas HTTP
separadas sem transação; se a segunda falhar/atrasar por qualquer motivo
de rede, a requisição já existe sem o log. Isso mostra que mesmo módulos
"corretos" podem ter esse gap ocasionalmente.

M7 (Quadro de Comando) não passa por essa tabela — usa suas próprias
tabelas (`comando_pedidos`, `comando_auditoria`) e por isso nunca deveria
(e nunca apareceu) em Movimentações. O pedido do usuário — "todos os
módulos menos o M7 devem ir para Movimentações" — já era o comportamento
pretendido; o bug era só a lacuna de M2-M6.

## Correção

- **Código — corrige a causa raiz (PR #88):** M2-M6
  (`trips.tsx`, `services.tsx`, `maintenance.tsx`, `freight.tsx`,
  `rental.tsx`) agora inserem `REQUISITION_CREATED` em `audit_logs` logo
  depois de criar a requisição, no mesmo padrão que M1 já usava.
- **Código — rede de segurança (`src/features/logs/api.ts`):**
  `getLogsOverview` agora sintetiza um evento `REQUISITION_CREATED` a
  partir da própria requisição para qualquer uma que apareça sem nenhuma
  linha em `audit_logs` — cobre tanto lacunas antigas quanto uma eventual
  falha futura do segundo insert (as duas chamadas continuam sem
  transação; um ticket nunca mais desaparece de Movimentações por causa
  disso, mesmo que o log real falhe).
- **Dado:** inserido retroativamente o evento `REQUISITION_CREATED` real
  (não sintético) para os dois tickets encontrados sem nenhum log —
  `M4-000149` e `M1-000150`.

## Limitação conhecida

A criação de M2-M6 ainda é dois inserts HTTP separados sem transação
(requisição + audit_logs), então uma falha de rede entre os dois ainda é
possível — mas agora é inofensiva: o ticket aparece em Movimentações via
o evento sintético do `getLogsOverview`, só não guarda um log real da
criação até alguém rodar o backfill manualmente (como feito aqui). Uma
correção mais robusta (RPC transacional no Postgres) resolveria de vez,
mas é uma mudança maior de infraestrutura — fora do escopo deste fix.

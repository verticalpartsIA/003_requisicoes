# Correção de preço de cotação depois de aprovada (V3)

**Caso concreto:** M1-000155 foi cotado com valor errado, aprovado em V3
(R$ 17.523,19, Nível 3) e só então o erro foi percebido, já em Compra (V4).
Não havia caminho no produto para corrigir o preço sem contornar a
aprovação.

## Por que não existia esse caminho

- `approvals` só tinha uma policy de UPDATE (`approvals_update_aprovador`),
  restrita ao `aprovador`/`admin` e só enquanto `decision = 'pending'`. Uma
  vez decidida, a linha fica imutável para todo mundo, inclusive `admin` —
  não existe policy nenhuma que permita alterar uma aprovação já concedida.
- `quotations`/`quotation_suppliers` são editáveis por `comprador`/`admin`
  sem restrição de status nas RLS, mas a fila de cotação
  (`listQuotationQueueClient`) só lista requisições `ABERTO`/`COTAÇÃO` — uma
  vez que a cotação avança para `APROVAÇÃO`/`COMPRA`, ela simplesmente não
  aparece mais na tela de Cotação, então a edição nunca era exposta na UI.
- Pedido do usuário: alçada de edição por etapa, onde quem cotou também
  pudesse editar a compra. Investigação (ver conversa/PR) mostrou que hoje
  o modelo de permissões é só por *role* global — não há noção de "dono do
  registro" (`quotations.buyer_id`/`purchases.buyer_id` existem mas não são
  usados em nenhuma RLS). Implementar alçada por pessoa seria uma mudança de
  arquitetura maior e desnecessária para resolver o problema real, que é
  falta de um fluxo de correção controlado — não falta de permissão.

## Solução

Fluxo de correção que reabre a aprovação em vez de editar valores livremente:

1. `database/025_reopen_quotation_correction.sql` — nova policy
   `approvals_reopen_comprador`: `comprador`/`admin` pode levar uma aprovação
   já `approved` de volta para `pending` (nunca para `approved`/`rejected`
   diretamente — isso continua exclusivo do aprovador). Combinada por OR com
   a policy existente, sem afetar o comportamento do aprovador.
2. `correctQuotationPriceClient` (`src/features/quotations/client.ts`):
   corrige o preço do(s) fornecedor(es) vencedor(es) em `quotation_suppliers`
   (funciona tanto para cotação simples quanto para M1 multi-item/M2, que já
   guardam vários vencedores via `item_id`), resoma o total, recalcula a
   alçada (`getApprovalLevelForValue`) e faz o mesmo reset de aprovação que
   `finalizeQuotationClient` já fazia ao trocar de vencedor: `approvals`
   volta para `decision = 'pending'` e `requisitions.status` volta para
   `APROVAÇÃO`. Como a fila de Compra (`listPendingPurchasesClient`) exige
   `decision = 'approved'` e `status = 'COMPRA'`, a requisição sai
   automaticamente da fila de Compra até ser reaprovada — nenhuma mudança
   necessária em `purchasing.tsx`. Dados já preenchidos em `purchases`
   (PO, nota fiscal) não são apagados.
3. Nova ação de auditoria `QUOTATION_PRICE_CORRECTED`
   (`src/lib/audit-actions.ts`), com o preço antigo/novo e o motivo
   registrados em `audit_logs.details`.
4. UI em `src/routes/quoting.tsx`: seção "Cotações Aprovadas — Corrigir
   Preço", visível só quando há itens em `COMPRA` com aprovação `approved`
   (`listCorrectableQuotationsClient`). Diálogo pede o novo preço de cada
   fornecedor vencedor e um motivo obrigatório.

## Escopo

- Corrigir depois de `RECEBIMENTO`/`CONCLUÍDO` é intencionalmente fora de
  escopo — nesse ponto o ajuste é financeiro pós-fato (nota de crédito etc.),
  não cabe nesse fluxo.
- Corrigir uma aprovação `rejected` também é fora de escopo: o status da
  requisição vira `REJEITADO`, que não está na lista de status editáveis
  por `comprador` em `requisitions_update_comprador` — não dá pra reabrir
  por esse caminho mesmo que quisesse.

# Edição após reprovação do aprovador não devolvia o ticket para a fila

**Caso concreto:** M1-000160 (4 itens — resistores de frenagem) foi
reprovado pelo Diego (aprovador, todos os 4 itens) em 14/09. O requisitante
(Brayn) editou a requisição reduzindo a quantidade de 2 dos 4 itens,
conforme pedido do aprovador, e um admin (Gelson) editou de novo — mas o
ticket continuou em `REJEITADO`, sem voltar pra fila de Cotação.

## Causa raiz — dois bugs distintos

### 1. `updateRequisition` não reabria requisição reprovada pelo aprovador

`src/features/requisitions/api.ts` já tinha lógica para devolver à fila de
Cotação quando o comprador devolve por falta de informação
(`QUOTATION_RETURNED_FOR_INFO` → `status = ABERTO`), mas o próprio código
tinha o comentário explícito: *"não mexe nos casos de reprovação por
Gestor/Aprovação, que seguem o comportamento atual"* — ou seja, era uma
decisão deliberada, não um esquecimento. Um relatório anterior
(`docs/reports/2026-08-25-correcao-preco-cotacao-pos-aprovacao.md`) já
tinha documentado isso como "fora de escopo" ao resolver um problema
relacionado (corrigir preço pós-aprovação).

Sem esse caminho, qualquer requisição reprovada pelo aprovador ficava
travada em `REJEITADO` para sempre, mesmo depois de editada — o
requisitante não tinha como reenviar.

### 2. Quantidade editada nunca chegava em `requisition_items`

Mesmo corrigindo (1), a quantidade editada não apareceria na cotação: o
M1 multi-itens guarda a lista "oficial" em `requisitions.module_data.items`
(o que o formulário edita), mas quem alimenta a cotação por item e a
aprovação fracionada é a tabela `requisition_items`. A sincronização entre
as duas (`listQuotationQueueClient`, em `quotations/client.ts`) casa itens
por `código+descrição` e só trata dois casos: item novo (insere) e item
pendente que sumiu (remove) — **nunca atualiza a quantidade de um item que
já existe com o mesmo código**. Como os 4 produtos continuavam os mesmos
(só a quantidade mudou), a sincronização não fazia nada, e
`requisition_items.quantity` ficava com o valor antigo.

## Correção

**Código (`src/features/requisitions/api.ts`, `updateRequisition`):**
- `resumeStatus` agora também é acionado quando a última rejeição foi
  `APPROVAL_REJECTED` (além de `QUOTATION_RETURNED_FOR_INFO`), voltando
  para `ABERTO` — **não** direto para `APROVAÇÃO`, porque a edição pode
  mudar quantidade/produto e o preço por unidade cotado antes pode não
  valer mais; o comprador confirma de novo antes de reenviar ao aprovador.
  Reprovação do Gestor continua fora de escopo, sem mudança.
- Quando reabre um M1, sincroniza direto `requisition_items` (quantidade,
  descrição, e `status` de volta para `pending`) a partir de
  `module_data.items`, casando por `product_code` — não depende mais da
  sincronização lenta/parcial da fila de Cotação para isso.

**Dado (correção administrativa, fora do PR):** aplicado diretamente no
M1-000160 — quantidades corrigidas em `requisition_items` (25 OHM: 10,
13 OHM: 5, 75 OHM: 5, 40 OHM: 10), status dos itens voltou para `pending`,
e `requisitions.status` voltou para `ABERTO`.

## Escopo

- Reprovação do **Gestor** (ciência) continua sem esse caminho de
  reabertura automática — não foi pedido e é um caso diferente (mais cedo
  no fluxo, antes de qualquer cotação existir).
- Não foi criada uma tela nova nem um fluxo de "reenvio" explícito — a
  correção é no mesmo botão de editar que já existe.

## Continuação — RLS de `approvals` não acompanhou a reabertura

Depois da correção acima, Andréia (comprador) tentou "Finalizar Cotação
Fracionada" no M1-000160 já reaberto e recebeu **"Sem permissão para
realizar esta ação. Contate o administrador do sistema."**

**Causa:** `saveItemQuotes`/`finalizeQuotation`
(`src/features/quotations/client.ts`) fazem upsert em `approvals`
(`onConflict: requisition_id`), o que vira um `UPDATE` na linha já
`rejected`. A policy `approvals_reopen_comprador`
(`database/025_reopen_quotation_correction.sql`) só permitia ao
comprador/admin levar uma aprovação de volta para `pending` quando
`decision = 'approved'` — o caso de origem daquela migration era corrigir
preço pós-aprovação, e reabrir uma **reprovação** foi explicitamente
deixado fora de escopo (ver
`docs/reports/2026-08-25-correcao-preco-cotacao-pos-aprovacao.md`). A
correção de código descrita acima passou a reabrir reprovações do
aprovador, mas o RLS de `approvals` não foi atualizado junto — gap
introduzido pela própria correção anterior.

O trigger `enforce_approvals_reopen_transition` (mesma migration 025) já
tratava `'approved'` e `'rejected'` da mesma forma; só faltava a policy.

**Correção (`database/027_reopen_quotation_after_rejection.sql`):**
recria `approvals_reopen_comprador` com `USING (... and decision in
('approved', 'rejected'))`, mantendo o `WITH CHECK` restrito a
`decision = 'pending'`. Aplicado diretamente em produção (Supabase) antes
do commit, para desbloquear Andréia sem esperar deploy; o arquivo de
migration foi commitado depois, para manter o histórico do repositório
consistente com o estado do banco.

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

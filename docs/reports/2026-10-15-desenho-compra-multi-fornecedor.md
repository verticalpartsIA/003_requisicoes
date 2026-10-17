# Desenho: cotação e compra com vários fornecedores (pedidos de compra)

Data: 2026-10-15 · Status: **proposta, nada implementado** · Origem: ticket M1-000221
(reprovado por preços suspeitos) e pedido de fracionar a compra entre fornecedores,
cada um com forma de pagamento e observações próprias.

## 1. Situação atual (verificada no código)

| Etapa | Hoje | Limite |
|---|---|---|
| Cotação (V2) | `quoting.tsx:183` começa com `["", "", ""]` e o texto fixa "até 3 fornecedores". `quotation_suppliers` aceita N propostas por item desde a 029, com `is_winner`. | O limite de 3 é só de tela. Um item tem **um** vencedor; não há como dividir a quantidade entre dois fornecedores. |
| Aprovação (V3) | Uma aprovação por ticket, alçada pelo total, decisão por item (`approval_items`). | — |
| Compra (V4) | `purchases.requisition_id UNIQUE`: uma linha por ticket, com um `supplier_name`, um `purchase_order_number`, um `payment_method`, um `notes`. `purchasing.tsx:216` junta os fornecedores numa string. | **Não existe pedido por fornecedor.** |
| Recebimento (V5) | `receipts.requisition_id UNIQUE`; `requisition_items.received_at` marca o item (024). | Recebe por item, mas sem saber de qual pedido nem quanto da quantidade. |

O preço gravado em `quotation_suppliers.price` é o **total da linha** (valor unitário digitado × quantidade,
`quoting.tsx:733`). O M1-000221 mostra o risco: o cabo 3×0,75 saiu a R$ 299 e R$ 437 por unidade, 100× o
esperado nas duas propostas, o que sugere erro de digitação. O campo do valor unitário é `type="number"`, que já normaliza a vírgula, então `parseFloat` **não** é a causa
(correção da hipótese inicial); o erro de 100× é de digitação.

## 2. Modelo proposto

Princípio: **a cotação continua decidindo preço; o pedido de compra decide quem entrega o quê.**

```
requisitions 1─┬─* requisition_items
               ├─* quotation_suppliers (propostas; ganha quantidade ofertada e condição de pagamento)
               ├─1 approvals ─* approval_items
               ├─* purchase_orders        ← NOVO: um por fornecedor
               │     └─* purchase_order_items ← NOVO: item × quantidade × preço unitário
               └─1 purchases              ← legado + resumo do ticket (mantido por compatibilidade)
```

Decisões:
- **`purchases` não é removida.** M2–M6 e todos os tickets antigos continuam nela, e PDF, analytics e Omie
  continuam lendo. Para M1 com pedidos, a função de confirmação grava nela um **resumo** (fornecedores
  concatenados, soma dos valores, primeiro pedido de compra).
- Um item pode ser dividido entre fornecedores (`purchase_order_items.quantity` por linha, soma = quantidade do item).
- Tickets antigos sem pedidos aparecem como hoje (leitura de `purchases`); **não haverá backfill** nesta fase.
- Se o total dos pedidos passar do valor aprovado, **reabre a aprovação**, reaproveitando o fluxo de
  "correção de preço em Compra" que já existe (`quoting.tsx:1699`).

## 3. Migração SQL (fase 2 — **implementada em `database/039_purchase_orders.sql`, ainda não aplicada**)

O rascunho que estava aqui virou a migração real, conferida contra o schema de produção (leitura) e testada
em Postgres local (PGlite, com stubs de `auth`/`private`) em 22 cenários: compra dividida entre 3 fornecedores,
pagamento e observação por pedido, resumo em `purchases`, ação `PURCHASE_CONFIRMED`, todos os erros de
validação sem gravar nada, papel de comprador, só M1, refazer pedidos quando nada foi recebido, e conclusão
marcando os pedidos como recebidos. Depois disso foi aplicada numa **branch descartável do Supabase** (`teste-039-pedidos-compra`, ref
`eakguwglyxojfnmlfebg`) e testada com usuários autenticados simulados (comprador, solicitante dono da requisição
e usuário sem vínculo): 21 de 22 verificações passaram na primeira rodada e a restante era erro de conta do
próprio teste (o resumo em `purchases` inclui o frete). O teste no banco real achou **dois defeitos do
rascunho**, já corrigidos em `039`: (1) a grafia `'CONCLÍDO'` (sem o U) em duas linhas — o enum é `'CONCLUÍDO'` e o
gatilho em `requisitions` teria falhado em toda atualização de status; (2) a mensagem de "total acima do aprovado"
saía com número no formato americano. O teste local (PGlite) não pegou o item 1 porque eu tinha criado o enum com
a mesma grafia errada, por isso o teste no banco real foi essencial.

**Limites do teste na branch:** a branch nasceu **vazia** (o schema base de produção, arquivos 001–010, não está no
histórico de migrações do Supabase), então o schema base foi recriado a partir dos arquivos do repositório
(001, helpers de 002, 007, 023/024) — é uma réplica, não produção: não tem as políticas e funções mais novas
(032–038) nem o status `GESTOR` do enum de produção. `receipts` e o fluxo de recebimento não foram exercitados.

O que difere do rascunho original:
- A cotação **não** ganhou `available_quantity`/`payment_terms` (fica para a fase 3).
- A ação de auditoria continua **`PURCHASE_CONFIRMED`** (analytics, SLA e logs dependem dela); os pedidos vão em
  `details.purchase_orders`.
- O limite "não passar do aprovado" compara a **soma dos itens** (sem frete/desconto) com a soma dos
  `approval_items` aprovados, com tolerância de R$ 0,01 por linha. Frete e desconto são registrados por pedido e
  não entram na comparação, porque a cotação nunca os incluiu.
- Refazer pedidos (ticket que volta a COMPRA após recebimento com problema) substitui os anteriores **só se nada
  foi recebido**; senão recusa.
- Um gatilho em `requisitions` marca os pedidos como `RECEBIDO` quando o ticket vai a CONCLUÍDO, para o Recebimento
  atual (por ticket) não deixar pedidos "pendentes" até a fase 3.
- Só M1; M2–M6 seguem no fluxo antigo.

### Como aplicar
1. Aplicar `039` em produção (SQL Editor ou `sb_apply_migration`). A branch de teste já validou o arquivo.
2. Só depois publicar a tela: ela sonda `purchase_orders` e, enquanto a tabela não existir, mantém o formulário
   antigo — então publicar antes é seguro, mas a tela nova só aparece depois da migração.
3. Depois de aplicar, conferir com um ticket M1 de teste (2+ itens, 2 fornecedores) e um usuário sem papel de comprador.

## 4. Telas

### 4.1 Cotação (`quoting.tsx`)
- Fornecedores dinâmicos: começa com 3 colunas; **"+ Fornecedor"** e **"remover"** (mínimo 1). Troca
  `useState(["","",""])` por lista editável.
- Por proposta, além de valor unitário e prazo: **quantidade ofertada** (vazio = tudo) e **condição de pagamento**.
- Vencedor por item passa a aceitar **mais de um fornecedor**: o comprador marca a quantidade de cada um
  (ex.: Santil 3 rolos + Norte 97). O sistema avisa se a soma ≠ quantidade pedida.
- **Validação de preço:** alertar quando a proposta
  estiver > 3× ou < 1/3 da mediana das outras propostas do item ou do último preço comprado (Omie), exigindo
  confirmação. Teria sinalizado o cabo 3×0,75 do M1-000221 antes de chegar ao aprovador.

### 4.2 Aprovação (`approval.tsx` e link do WhatsApp)
- A lista de fornecedores da página rápida passa a mostrar **item, quantidade, fornecedor e preço unitário**,
  não só fornecedor e valor (hoje "SANTIL R$ 468,80" não diz de qual item).
- Linha de alerta quando algum preço unitário fugir do padrão (mesma regra de 4.1).

### 4.3 Compra (`purchasing.tsx`): a mudança principal
Esboço:

```
M1-000221 · aprovado R$ 37.272,10                       [ + Novo fornecedor ]
┌ Santil ─────────────────────────────────────────────────────────────┐
│ Pedido nº [______]  Pagamento [Boleto ▾]  Condição [28 dias]         │
│ Entrega prevista [__/__/__]  Frete [R$ __]  Desconto [R$ __]         │
│ Item                       Qtd   Unit.     Total                     │
│ Cabo flexível 2×0,75 ····· 400   R$ 1,17   R$ 468,80   [mover ▾]    │
│ Cabo 4×6,0 ·············  7      R$ 263,34 R$ 1.843,38 [mover ▾]    │
│ Observações: [____________________________________________]         │
└─────────────────────────────────────────────────────────────────────┘
┌ Norte Dimensional ... (mesmo bloco) ┐
Não alocado: nenhum item ✔        Total dos pedidos R$ 37.272,10 = aprovado ✔
[Confirmar compra]  (desabilitado enquanto sobrar item sem fornecedor ou total > aprovado)
```

- Sugestão inicial automática: um bloco por fornecedor vencedor, com itens, quantidades e preços da cotação.
- O comprador pode **mover** item (ou parte da quantidade) entre fornecedores, **adicionar** fornecedor novo
  (só com nome, para quando a compra sai da cotação) e editar pagamento, entrega, frete e observações por bloco.
- Rodapé com saldo por item (alocado × pedido) e total × aprovado; excedeu → mensagem para corrigir o preço e
  reabrir a aprovação (fluxo existente).
- Chama `confirm_purchase_orders`; erros de negócio do `RAISE EXCEPTION` aparecem como estão.
- Tickets sem pedidos (antigos, M2–M6) mantêm a tela atual.

### 4.4 Recebimento (`receipt.tsx`)
- Agrupar por **pedido de compra** (fornecedor, nº do pedido, entrega prevista), com quantidade recebida por
  item (aceita parcial: 3 de 5 rolos).
- Ticket só vai a CONCLUÍDO quando todos os pedidos estiverem recebidos; enquanto isso mostra
  "2 de 3 pedidos recebidos".

### 4.5 Demais pontos
- **PDF** (`pdf/template.ts`): bloco M1 com um quadro por pedido (fornecedor, pagamento, observações, itens).
  Os blocos do template são escritos à mão, então atualizar manualmente.
- **Auditoria** (`audit-actions.ts`): `PURCHASE_ORDERS_CONFIRMED`, `PURCHASE_ORDER_RECEIVED`.
- **WhatsApp**: mensagem de compra confirmada lista os fornecedores; avisar o solicitante a cada pedido recebido.
- **Analytics/Omie**: continuam usando o resumo em `purchases`; adicionar visão por fornecedor depois, a partir de
  `purchase_orders`.
- **Testes**: cálculo de alocação e saldo (função pura em `src/features/purchases/`), validação de preço
  fora do padrão, e a migração em branch descartável do Supabase (cobertura, excedente, papéis, RLS).

## 5. Fases

1. **Rápida (sem migração):** remover o limite de 3 na cotação, alerta
   de preço fora do padrão, item e quantidade na lista de fornecedores da aprovação rápida.
2. **Principal (feita no código, aguarda aplicar a 039):** migração 039, `confirm_purchase_orders`, nova tela de Compra, PDF e auditoria.
3. **Fechamento:** recebimento por pedido, cotação com quantidade ofertada / vários vencedores por item,
   notificações.

## 6. Decisões em aberto

- **Compra acima do aprovado:** bloquear e reabrir aprovação (proposto) ou aceitar tolerância (ex.: 2%)?
- **Dividir um item entre fornecedores** na Compra, sem ter sido dividido na cotação, exige nova aprovação?
  Pelo texto atual, se o total não passar do aprovado, não.
- **Recebimento com problema** (`condition` ≠ ok): o fluxo atual devolve o ticket inteiro a Compra. Com vários
  pedidos, o proposto é marcar só aquele pedido; precisa de um status `COM_PROBLEMA`.
- **Cadastro de fornecedores:** continua texto livre (como hoje) ou passa a haver tabela com CNPJ e condições?
- **Edição de pedido já confirmado** (trocar fornecedor, cancelar): não coberto; sugerido cancelar o pedido
  (`CANCELADO`) e liberar os itens para novo pedido, com auditoria.

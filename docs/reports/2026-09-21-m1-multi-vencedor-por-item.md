# M1: comparação de até 3 fornecedores por item, com vencedor por item

**Data:** 2026-09-21
**Módulo afetado:** M1 (Produtos), fluxo de cotação fracionada (2+ produtos
na mesma requisição), em `quoting.tsx`.

## O que mudava antes

A cotação fracionada do M1 já permitia fornecedores diferentes por item
(`quotation_suppliers.item_id`), mas era **atribuição direta**: o comprador
digitava 1 fornecedor + 1 valor por item, sem comparar propostas. Não havia
a etapa "cadastre até 3 fornecedores → registre a proposta de cada um por
item → escolha o vencedor por item" que existe no fluxo padrão (3
fornecedores para a requisição inteira).

## O que passa a existir

Na cotação fracionada do M1, o diálogo agora tem 3 fases, mesma lógica do
fluxo padrão só que aplicada item a item:

1. **Fornecedores** — cadastra até 3 fornecedores que vão cotar os itens do
   pedido.
2. **Propostas por Item** — para cada item, registra o valor unitário e o
   prazo de cada um dos fornecedores cadastrados (pode deixar em branco quem
   não cotou aquele item específico).
3. **Vencedor por Item** — para cada item, o comprador escolhe qual das
   propostas ganha (com atalho "Selecionar automaticamente" pelo critério
   escolhido — menor preço / menor prazo / preço+prazo). Fornecedores
   diferentes podem vencer itens diferentes na mesma cotação — ex.: 2 vencem
   em prazo, 1 vence em preço.

## Mudanças técnicas

- **Migração** `database/029_quotation_suppliers_multi_bid_per_item.sql`:
  remove a constraint `UNIQUE(quotation_id, item_id)` — ela só permitia 1
  linha por item, o que impedia guardar as 3 propostas para comparação.
  **Precisa ser aplicada no banco de produção antes do deploy desta
  mudança.**
- `src/features/quotations/client.ts`:
  - `saveItemQuotes` (usado só por M2/viagem agora) deixou de depender de
    `ON CONFLICT (quotation_id, item_id)` — busca o `id` existente antes de
    gravar, então funciona independente da constraint acima.
  - Nova função `saveM1ItemBidsClient` grava todas as propostas (vencedoras
    e não vencedoras) de uma vez, com `is_winner` marcando a escolhida por
    item — o total e o nível de alçada são calculados só a partir dos
    vencedores.
  - `listQuotationQueueClient` agora traz todas as propostas de cada item em
    `TravelItem.bids` (não só a vencedora), usado para reconstruir a
    comparação ao reabrir uma cotação já iniciada.
  - Removida `saveM1ItemQuotesClient` (fluxo de atribuição direta),
    substituída pela nova função acima.
- `src/routes/quoting.tsx`: nova UI de 3 fases para M1 fracionado; M2
  (viagem) continua com o fluxo antigo de 1 fornecedor por item — não faz
  sentido comparar propostas para a mesma passagem/hotel/carro.

## Impacto em Aprovação (V3) e Compra (V4)

Nenhum: `approval_items` continua guardando só o vencedor por item (mesmo
formato de antes), então as telas de Aprovação e Compra não precisaram
mudar. `movimentacoes.tsx` (histórico/auditoria) agora pode listar mais de
uma proposta por cotação fracionada — é o comportamento já existente para o
fluxo padrão (que sempre listou as até 3 propostas), só que agora também se
aplica ao M1 fracionado.

## Fora de escopo

- **M2 (viagem)**: não recebeu comparação de propostas — não faz sentido
  cotar 2 fornecedores para o mesmo voo/hotel/carro.
- **M6 (locação)**: não tem hoje um modelo de itens (é uma requisição de
  linha única — uma `quantity` só para o pedido inteiro). Para ganhar
  "vencedor por item" seria necessário primeiro dar ao M6 um modelo de
  itens como o M1 já tem — fica para uma tarefa separada.

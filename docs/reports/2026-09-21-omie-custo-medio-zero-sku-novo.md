# "Custo Omie (ao vivo)" mostrando R$ 0,00 na Aprovação (M1)

**Data:** 2026-09-21
**Onde:** caixa "Custo Omie (ao vivo)" na tela de Aprovação (V3), visível só
para M1 (produtos) — `src/routes/approval.tsx` + `getOmieProductCost` em
`src/features/omie/api.ts`.

## Sintoma relatado

Na aprovação da requisição M1-000160 (4 itens "RESISTOR DE FRENAGEM"), a
caixa de comparação mostrava "Custo médio: R$ 0,00" para todos os 4
códigos (`VPMP-899` a `VPMP-902`), levantando suspeita de bug — a tela já
mostra corretamente, logo abaixo, o preço e fornecedor reais da cotação
(R$ 8.275,05, OHMIC RESISTORES E REOTATOS LTDA etc.), então o R$ 0,00
parecia inconsistente.

## Investigação

Consultado diretamente na Omie (MCP `VerticalParts_Omie`) para os 4
códigos:

- Os 4 produtos foram **cadastrados na Omie em 24/08/2026** (poucas
  semanas antes da requisição), com `valor_unitario: 0`,
  `quantidade_estoque: 0`, `estoque_minimo: 0` no cadastro.
- `estoque/consulta PosicaoEstoque` retorna `cmc: null` — sem posição de
  estoque calculável.
- `estoque/movimentos` para o código Omie do VPMP-899
  (`9228461111`) retorna **"Não existem registros para a página"** — ou
  seja, **nenhuma movimentação de estoque desses produtos já existiu na
  Omie**, nunca.
- Nenhum Pedido de Compra ou Nota de Entrada na Omie referencia esses
  códigos.

**Conclusão: não é bug.** O "custo médio contábil" (cmc) da Omie é uma
média ponderada calculada a partir de entradas de estoque já recebidas —
como esses SKUs nunca foram comprados/recebidos antes (essa requisição é,
ao que tudo indica, a primeira vez que a empresa pede esses itens), não
existe custo histórico para a Omie devolver. `getOmieProductCost` fazia
`posicao.cmc ?? 0`, então "sem dado" e "custo realmente zero" ficavam
indistinguíveis na tela — daí a leitura de bug.

## Correção

- `OmieProductCost.custoMedio` (api.ts) passou de `number` para
  `number | null` — `posicao.cmc ?? null` em vez de `?? 0`.
- `approval.tsx`: quando `custoMedio` é `null`, a caixa mostra "Sem
  histórico de compra na Omie" (com o fornecedor cacheado, se houver) em
  vez de "Custo médio: R$ 0,00".

## Observação à parte (infraestrutura, fora deste fix)

O servidor MCP `VerticalParts_Omie` usado nesta investigação bloqueia
`estoque/consulta PosicaoEstoque`, `produtos/pedido ConsultarPedido` (via
`omie_produto_ciclo_compra`) e o fallback `omie_chamar_api` para esse
mesmo endpoint com `"Operação de escrita bloqueada por
OMIE_ALLOW_WRITES=false"`, tratando-os como escrita — são leituras. Isso
não afeta a aplicação em produção (que chama a API da Omie direto, com
suas próprias credenciais, sem passar por esse MCP), mas vale reportar a
quem mantém esse MCP para ajustar a classificação desses endpoints.

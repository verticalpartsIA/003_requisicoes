# Cotação fracionada do M1 não multiplicava preço pela quantidade

**Data:** 2026-09-21
**Módulo afetado:** M1 (Produtos) — apenas o fluxo de cotação fracionada
(requisição com 2+ produtos, cada um cotado com um fornecedor próprio em
`quoting.tsx`). M2 (viagem) e o fluxo padrão de cotação (3 fornecedores para
a requisição inteira) não são afetados.

## Causa raiz

No diálogo "Cotação Fracionada", o campo "Valor (R$)" por item era
salvo direto como o valor da linha (`M2ItemQuote.price` →
`quotation_suppliers.price` → `approval_items.price`), sem multiplicar
pela quantidade do produto (`requisition_items.quantity`). Um comprador que
digitasse o preço unitário cotado pelo fornecedor (prática natural, já que
a quantidade aparece ao lado do nome do produto) fazia o sistema registrar
esse valor como se fosse o total da linha — subestimando o valor da compra
em telas de Aprovação (V3) e no nível de alçada calculado
(`getApprovalLevelForValue`), sem qualquer aviso.

Não é um bug de exceção/crash: o formulário aceitava o valor normalmente e
seguia o fluxo até a aprovação com o total errado.

## Correção

`src/routes/quoting.tsx`:
- O campo agora é rotulado "Valor unitário (R$)" e mostra um subtotal
  (`qtd × unitário = total`) abaixo do input quando a quantidade é maior
  que 1.
- Ao montar `itemQuotes` para enviar ao servidor (`handleM2Submit`), o
  preço unitário é multiplicado pela quantidade do item antes de virar
  `M2ItemQuote.price` — o que é persistido continua sendo o total da
  linha (mesma semântica já esperada por `approval_items`, pela tela de
  Aprovação e pelo total da requisição).
- Ao reabrir uma cotação já salva para edição, o valor total salvo é
  dividido pela quantidade para popular de volta o campo como unitário
  (senão reabrir e salvar de novo dobraria o total a cada edição).
- Itens de voo/hotel/carro (M2) não têm quantidade (`quantity` é sempre
  tratado como 1), então o comportamento deles não muda.

## Fora de escopo desta correção

O fluxo *padrão* de cotação (3 fornecedores, um vencedor único para a
requisição inteira, usado por M3–M6 e M1 com um único item) já trabalha
com um valor único por fornecedor — não há quantidade por item nesse
fluxo hoje, então não há bug de multiplicação a corrigir ali.

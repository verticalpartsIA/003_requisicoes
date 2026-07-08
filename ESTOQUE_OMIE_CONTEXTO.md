# Estoque Omie — contexto da sessão (para retomar depois)

> Arquivo de referência rápida. Se você (ou uma nova sessão do Claude) estiver perdido, comece por aqui.

## O que é

Módulo **Estoque Omie** (`/estoque-omie` no VPRequisições, rota `src/routes/estoque-omie.tsx`) que mostra estoque, giro de vendas, Curva ABC/D e Sugestão de Compra de todos os produtos ativos da VerticalParts, sincronizado automaticamente com o Omie via Supabase (projeto `vprequisicao`, id `vvgcrhtmzvssfdazkkzk`).

## Por que existe

A tela batia direto no Omie a cada carregamento — lenta e esbarrava em rate limit. Foi migrada para ler de um cache no Supabase, atualizado automaticamente em segundo plano. Depois, virou também a ferramenta de **sugestão de compra** que a analista de estoque usava manualmente numa planilha.

## Peças que compõem o sistema

### 1. Cache de estoque (sincroniza de hora em hora, 8h–18h seg-sex BRT)
- Tabela: `omie_stock_cache` (codigo, descricao, estoque_fisico, estoque_reservado, estoque_disponivel, estoque_minimo, cmc, lead_time_dias, updated_at)
- Edge Function: `supabase/functions/sync-omie-stock/index.ts`
- Cron: job `sync-omie-stock-business-hours` (`0 11-21 * * 1-5` UTC = 8h-18h BRT)
- Migration: `database/013_omie_stock_cache.sql`

### 2. Giro de vendas / Curva ABC-D / Sugestão de Compra (sincroniza **todo dia às 9h BRT**)
- Tabelas: `omie_sales_velocity` (giro/curva/pendente calculados), `omie_purchase_orders` (lançamentos manuais de "Comprado")
- View: `omie_purchase_suggestions` — combina tudo ao vivo e calcula a Sugestão de Compra
- Edge Function: `supabase/functions/sync-omie-sales-velocity/index.ts`
- Cron: job `sync-omie-sales-velocity-daily` (`0 12 * * *` UTC = 9h BRT)
- Migration: `database/014_omie_purchase_suggestions.sql`

**Regras de negócio (confirmadas com o time de expedição):**
- Estoque Mínimo calculado = média mensal de vendas faturadas dos últimos 4 meses × 3 (90 dias de cobertura).
- Curva ABC pelo volume faturado no período (A ≤80% acumulado, B ≤95%, C ≤100%).
- Curva D (baixo giro/sem histórico): mínimo fixo — 2 unidades se custo médio (cmc) ≤ R$2.500, senão 1 unidade.
- Qtd. Pendente = soma de pedidos de venda ainda não faturados, criados nos últimos 6 meses.
- **Sugestão de Compra = max(0, Estoque Mínimo − Estoque Disponível + Qtd. Pendente − Comprado)**
- Comprado: lançado manualmente na tela (quantidade + data prevista de chegada) por admin/comprador/almoxarife; abate a sugestão até a data prevista passar.

### 3. Frontend (`src/routes/estoque-omie.tsx` + `src/features/omie/client.ts`)
- Tabela com: Código, Descrição, Curva, Estoque Físico, Reservado, Disponível, Mínimo, Sugestão de Compra, Comprado.
- **Linhas coloridas**: vermelha (sugestão > 0, precisa comprar), amarela (disponível no mínimo ou abaixo, mas coberto por pendente/comprado — alerta), branca (ok). Texto sempre preto.
- **Filtros**: por texto (código/descrição), por cor (Todas/Vermelha/Amarela/Branca), por Curva (Todas/A/B/C/D).
- **Contador de linhas** na barra de filtros (reage a todos os filtros).
- **Linha de Total** no rodapé da tabela (soma das colunas numéricas das linhas visíveis).
- Rolagem horizontal funcional (tabela com `min-width`, página usando largura total).

## Problema de infraestrutura corrigido (importante!)

O deploy automático (`.github/workflows/deploy.yml`, dispara em push para `main`) **não rodava `npm run build`** — só dava `git reset --hard` e reiniciava o Passenger. Como `dist/` está no `.gitignore`, o site continuava servindo o build antigo mesmo com deploy "verde". Corrigido adicionando `npm ci && npm run build` no workflow. **Todo push em `main` agora builda de verdade.**

## Issues no GitHub (documentação detalhada de cada etapa)

Repo `verticalpartsIA/003_requisicoes`:
- **#19** — Cache de estoque no Supabase com sincronização horária
- **#20** — Sugestão de Compra, Curva ABC/D e coluna "Comprado"
- **#21** — Correção do deploy que não rodava `npm run build`
- **#22** — Cores por urgência, filtros por cor/curva, totais e correção de rolagem
- **#23** — Mudança da sincronização de Curva/Sugestão de semanal para diária (9h BRT)

## Limitações conhecidas / próximos passos possíveis

- Janela de 6 meses para "pedidos pendentes" é uma aproximação (pedidos abertos há mais tempo não entram na conta).
- `lead_time_dias` (tempo de importação) já é capturado e salvo por produto, mas ainda **não** entra na fórmula da Sugestão de Compra — cogitado como próxima melhoria (ex: aumentar o mínimo para produtos com importação demorada).
- M1 "Estoque" (card de reposição na Nova Requisição) continua usando consulta **ao vivo** no Omie (`getOmieStockPosition`), não o cache — decisão deliberada, pois é uma checagem em tempo real antes de uma compra pontual.

## Onde tudo está

- Branches: trabalho feito em `claude/project-discussion-u9suca`, sempre mesclado (fast-forward) em `main` pra disparar o deploy.
- Site em produção: `https://vprequisicoes.vpsistema.com/estoque-omie`
- Supabase do app: projeto `vprequisicao` (`vvgcrhtmzvssfdazkkzk.supabase.co`)

# Changelog

Histórico do que foi feito no VPRequisições, mais recente no topo. Uma
linha por entrega — para o contexto completo (logs, causa raiz, decisões),
os fixes/features mais investigativos linkam para um relatório em
`docs/reports/`.

Para arquitetura e convenções do projeto, ver `CLAUDE.md`. Para o histórico
de PRs com diff completo, ver a aba *Pull requests* do repositório.

## 2026-08-19

- fix(movimentacoes): tickets de M2-M6 (Viagem, Serviço, Manutenção, Frete, Locação) podiam sumir de Movimentações e ficar sem status visível quando criados sem nenhum evento em `audit_logs` — corrige a causa raiz (M2-M6 agora logam a criação, como M1 já fazia) e adiciona rede de segurança (evento sintético pra qualquer ticket sem log nunca mais desaparecer da lista) — [relatório](docs/reports/2026-08-19-movimentacoes-tickets-invisiveis.md) (#88)
- feat(aprovacao): seção "Aguardando Gestor" em `/approval`, visível só para admin — mostra todas as requisições do sistema travadas na etapa de ciência do gestor (não só a fila do usuário logado), com "Falta aprovação: Gestor `<nome>`" indicando quem está travando cada ticket
- chore(dados): corrige administrativamente 2 requisições do Danilo (M4-000147, M3-000148) que ficaram no limbo em GESTOR desde antes da regra existir — [relatório](docs/reports/2026-08-18-gestor-autoaprovacao-departamento.md#correção-administrativa-de-tickets-em-limbo-2026-08-19)

## 2026-08-18

- chore(dados): limpa designações de gestor órfãs (Expedição, VerticalParts) e o approver_id do Gelson — Diego e Gelson já tinham todos os papéis (poder máximo já concedido via `user_roles`) — [relatório](docs/reports/2026-08-18-gestor-autoaprovacao-departamento.md)
- fix(admin): gestor não via/decidia as próprias requisições por incompatibilidade de texto entre `department_managers` e `profiles.department` — não havia bloqueio proposital de autoaprovação — [relatório](docs/reports/2026-08-18-gestor-autoaprovacao-departamento.md) (#84)
- fix(pdf): rótulos da seção "Viagem — Dados da Viagem" alinhados aos usados na tela de `trips.tsx` (#82)
- fix(pdf): PDF da requisição M2 (Viagem) omitia quase todos os dados da viagem — [relatório](docs/reports/2026-08-18-pdf-m2-viagem-dados-completos.md) (#81)
- diag(deploy): variáveis de ambiente ausentes identificadas como causa do 500 em produção (#80)
- diag(deploy): captura do corpo real do erro (`HTTPError`) e do console.log do app que o Passenger de fato serve (#79)
- diag(deploy): descoberta de que `hbuilds/current` (painel Node.js da Hostinger) é um deploy independente do nosso `deploy.yml` (#78)
- fix(deploy): build quebrado não derruba mais produção — backup/restore de `dist/`, `GOMAXPROCS=2`, workflow falha visivelmente — [relatório do incidente](docs/reports/2026-08-18-deploy-outage-esbuild-envvars.md) (#77)
- feat(comando): baixar o formulário do Quadro de Comando (M7) respondido em PDF (#76)
- docs: reorganização de documentação — `CLAUDE.md`, este `CHANGELOG.md`, `docs/reports/`, relatórios antigos movidos e atualizados

## 2026-08-14

- feat(cotacao): comprador pode devolver requisição por falta de informação (#74)

## 2026-07-28

- feat(admin): visão "Por Departamento" na lista de usuários
- fix(gestor): corrige terminologia — Gestor dá Ciência, não Aprovação
- fix(m1-m6): corrige data voltando 1 dia ao reabrir requisição para edição
- feat(m2): escalona automaticamente aprovador quando viagem é urgente
- feat(m1): código VPCON opcional em Uso e Consumo
- feat(m1): recebimento por item para compras fracionadas entre fornecedores

## 2026-07-25

- feat: rastreamento de atividade cross-sistema (entrada/saída) para a timeline do vpsistema (#67)

## 2026-07-22 – 2026-07-23

- feat(m2,m5,m6): campo obrigatório Número da Obra quando aplicável
- perf(estoque-omie): virtualização da tabela de 1000 linhas, corrige gargalos
- feat(m1-m7): validação inline por campo em todos os wizards; Stepper compartilhado
- feat(m1,m2,m6): etapa de Revisão antes do envio
- feat(m1): grade estilo planilha (Excel style) reutilizável; grade organizada de itens
- fix(gestor): mostra itens (produto/qtd) da requisição M1 na tela do gestor
- Admin: tabela filtrável de usuários com ações destrutivas isoladas
- Analytics: drill-down de métrica até os tickets em Movimentações; corrige zerar histórico pré-período
- V2→V5: filtros consistentes e link direto pro histórico do ticket
- M1 multi-itens: renderiza produtos em tabela no PDF e no painel de detalhe
- feat: tela "Movimentações" dedicada à busca; `/logs` vira "Monitor SLA"
- Permite fracionar cotação/aprovação do M1 multi-itens entre fornecedores
- Diversos fixes de UX: data mínima bloqueando hoje/amanhã, botão "Atualizar agora" inclicável, truncamento silencioso no Estoque Omie, dialogs sem título/descrição acessível
- Aviso de atualização com vídeo de abertura; corrige loop de horário repetido (#55, #58, #59)

## 2026-07-06 – 2026-07-10 — Estoque Omie, Sugestão de Compra e M7

- feat: **módulo Estoque Omie** (`/estoque-omie`) — cache de estoque no Supabase com sync horário, giro de vendas, Curva ABC/D
- feat: **Sugestão de Compra confiável** — arredondamento, lote mínimo/múltiplo com confirmação do comprador, cobertura parametrizada por lead time — [relatório](docs/reports/2026-07-10-sugestao-compra-omie.md) (issue #35)
- feat: seleção em massa e envio de Requisição de Compra ao Omie; ordenação de colunas; filtro "Comprado"
- feat: **M7 — Quadro de Comando** — schema, painel interno, formulário público `/pedido-comando/$token`, envio por WhatsApp
- feat(m2): número do projeto (Obra), dias de carro alugado, opções de voo
- feat(m5): Nº Projeto, recebedor da carga, prazo de descarga, fotos da carga
- feat(m6): seção opcional de Segurança e Documentação (ART)
- fix: remove dependência do reportgen.io — PDF passa a ser gerado no navegador (jsPDF + html2canvas) e salvo no Supabase Storage
- fix(deploy): série de correções no pipeline Hostinger (binário do vite corrompido/sem permissão após install incremental, top-level await quebrando o Passenger/LiteSpeed) — culminou no workflow atual em `.github/workflows/deploy.yml`
- feat: Analytics e Logs com dados 100% reais do banco (sem mock)
- feat(admin): aprovador por colaborador, inativar/excluir usuário
- feat: Dashboard com coluna Pendência e linhas clicáveis
- fix: aprovação respeita as faixas de alçada configuradas no Admin
- docs: relatório da issue #35 e análise da issue #36 (relacionamento ambíguo no MCP) — ambos revisados e movidos para `docs/reports/` em 18/08

## Antes de 2026-07 — Construção inicial

Build inicial do produto via Lovable + integração Supabase completa
(Auth, Postgres, RLS, Storage), formulários V1-V5 (requisição → cotação →
aprovação → compra → recebimento), módulos M1-M6, dashboard, analytics,
painel Admin, deploy Node.js na Hostinger (`server.js`/`boot.cjs` para
compatibilidade com Phusion Passenger), suíte inicial de testes (Vitest +
Testing Library), integração VPClick. O histórico granular desse período
(centenas de commits incrementais, muitos sem mensagem descritiva) fica só
no `git log` — não vale a pena reproduzir aqui linha a linha.

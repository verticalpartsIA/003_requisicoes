# Deploy na Hostinger

> Atualizado em 18/08/2026 após um incidente real de produção — ver
> `docs/reports/2026-08-18-deploy-outage-esbuild-envvars.md` para a
> investigação completa (logs, causa raiz, correções).

## ⚠️ Existem DOIS deploys acontecendo a cada push em `main`

Isso não é óbvio e já causou confusão: um push em `main` dispara **dois
mecanismos independentes**, que competem pelos mesmos recursos (threads/
processos) do servidor compartilhado:

1. **`.github/workflows/deploy.yml`** (GitHub Actions) — conecta via SSH e
   builda em `~/domains/vprequisicoes.vpsistema.com/nodejs/`. Serve como
   *validação* (roda `npm run build`, testa `require('./server.js')`,
   confere `/login` pelo domínio) — mas **esse diretório não é o que o
   Passenger de fato serve**.
2. **O próprio painel "Node.js App" da Hostinger** — puxa o repositório de
   forma independente (webhook do GitHub) e builda em
   `~/domains/.../hbuilds/versions/<uuid>/`, trocando o symlink
   `hbuilds/current` quando termina. **Esse é o diretório que o Passenger
   realmente serve** (confirme com `PassengerAppRoot` no `.htaccess`).

Na prática: o nosso workflow é uma checagem útil (falha visivelmente —
`exit 1` — se o build quebrar, ver seção abaixo), mas quem decide o que
está no ar é o painel da Hostinger. Se `hbuilds/current` não avançar depois
de um push, o site continua na versão anterior mesmo com o nosso workflow
"verde".

## Status atual

O projeto esta pronto para deploy em uma aplicacao Node.js da Hostinger, sem depender do worker do Cloudflare em runtime.

O build continua sendo gerado pelo TanStack Start, e o arquivo `server.js` da raiz sobe um servidor Node fino que:

- serve os arquivos estaticos de `dist/client`
- encaminha as demais rotas para o handler SSR de `dist/server/index.js`

## Requisitos de hospedagem

Fontes oficiais usadas:

- Hostinger informa suporte a Node.js em planos `Business Web Hosting` e `Cloud`:
  [How to add a Node.js Web App in Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- Hostinger informa suporte a Node.js `18.x`, `20.x`, `22.x` e `24.x`:
  [Node.js hosting options at Hostinger](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)

## Configuracao recomendada

- Tipo: `Node.js Web App`
- Deploy: `GitHub` de preferencia
- Node.js: `22.x`
- Build command: `npm run build`
- Start command: `npm run start`
- Entry file: `server.js`
- Output directory: `dist`

## Variaveis de ambiente

Configure no painel da Hostinger, em **Setup Node.js App → variáveis de
ambiente do app** (não é um arquivo `.env` no disco — o painel injeta essas
vars direto no processo). Se faltar uma das 3 primeiras, o site quebra com
`{"status":500,"unhandled":true,"message":"HTTPError"}` em qualquer página
que precise do Supabase (foi exatamente o que aconteceu em 18/08/2026).

**Críticas — sem fallback no código, sem elas o app não funciona:**

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

**Recomendadas:**

```env
PORT=3000
HOST=0.0.0.0
APP_ORIGIN=https://seu-dominio-aqui
DEFAULT_REQUESTER_NAME=Operador VerticalParts
DEFAULT_REQUESTER_EMAIL=operador@verticalparts.com.br
DEFAULT_REQUESTER_DEPARTMENT=Compras
```

**Opcionais** (têm valor padrão fixo no código — só sobrescreva se precisar):
`VITE_TRACK_ACTIVITY_KEY`, `EVOLUTION_URL`/`EVOLUTION_APIKEY`/`EVOLUTION_INSTANCE`
(WhatsApp do Quadro de Comando), `OMIE_APP_KEY`/`OMIE_APP_SECRET`,
`VPCLICK_URL`/`VPCLICK_SERVICE_KEY`/`VPCLICK_LIST_ID`, `VPREQ_BASE_URL`.

Notas:

- `APP_ORIGIN` deve ser o dominio final da aplicacao.
- `SUPABASE_SERVICE_ROLE_KEY` ainda e util para scripts e rotinas administrativas do projeto.
- Os fluxos principais do app ja funcionam com sessao autenticada do usuario e respeitando RLS.

## Problema conhecido: build falha por limite de recursos do servidor

O binário nativo do `esbuild`/Vite pode falhar com um panic do runtime Go
(`runtime.newosproc ... Resource temporarily unavailable`) quando o servidor
compartilhado está sob carga — geralmente porque os dois deploys da seção
acima estão buildando ao mesmo tempo. Mitigações já aplicadas
(`scripts/build.mjs`):

- `GOMAXPROCS=2` ao chamar `vite build`, pra reduzir a criação de threads.
- Backup/restore automático de `dist/` — se o build falhar, a versão
  anterior é restaurada (o site nunca fica sem `dist/server/index.js`).
- `deploy.yml` marca o job como falho (`exit 1`) quando isso acontece, em
  vez de reportar sucesso silenciosamente.

Se acontecer de novo: **não insista em reexecutar o deploy várias vezes em
sequência** — isso agrava a contenção de recursos. Espere alguns minutos ou
dispare manualmente (`workflow_dispatch`) só depois que o painel da
Hostinger (`hbuilds/current`) também tiver tido chance de terminar o dele.

## Ordem sugerida de deploy

1. Confirmar que o dominio novo da Hostinger foi criado.
2. Conectar o repositorio GitHub na Hostinger.
3. Informar as variaveis de ambiente.
4. Selecionar Node `22.x`.
5. Rodar o primeiro deploy.
6. Testar login e o fluxo `Produtos -> Cotacao -> Aprovacao -> Compra -> Recebimento`.

## Validacao minima apos deploy

1. Abrir `/login` e autenticar com um usuario real do Supabase Auth.
2. Criar uma requisicao em `/products`.
3. Confirmar a entrada em `/quoting`.
4. Aprovar em `/approval`.
5. Fechar compra em `/purchasing`.
6. Registrar recebimento em `/receipt`.

## Estado atual (julho/2026)

- Todos os modulos (`products`, `trips`, `services`, `maintenance`, `freight`, `rental`) criam e listam requisicoes reais no Supabase.
- `analytics` e `logs` usam exclusivamente dados reais (agregacoes de `requisitions`, `approvals`, `purchases`, `receipts` e `audit_logs` via server functions); nao ha mais fallback mockado.
- Contas de usuarios sao operacionais reais, gerenciadas pelo painel Admin (papeis, alcadas, aprovador por colaborador, inativar/excluir).

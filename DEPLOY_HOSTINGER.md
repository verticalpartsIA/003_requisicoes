# Deploy na Hostinger

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

Configure no painel da Hostinger:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
HOST=0.0.0.0
APP_ORIGIN=https://seu-dominio-aqui
DEFAULT_REQUESTER_NAME=Operador VerticalParts
DEFAULT_REQUESTER_EMAIL=operador@verticalparts.com.br
DEFAULT_REQUESTER_DEPARTMENT=Compras
```

Notas:

- `APP_ORIGIN` deve ser o dominio final da aplicacao.
- `SUPABASE_SERVICE_ROLE_KEY` ainda e util para scripts e rotinas administrativas do projeto.
- Os fluxos principais do app ja funcionam com sessao autenticada do usuario e respeitando RLS.

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

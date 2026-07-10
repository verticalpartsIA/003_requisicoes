# Conector MCP para o Claude

O VPRequisições expõe um servidor MCP remoto (Streamable HTTP) via Supabase
Edge Function, permitindo que o Claude (claude.ai, Claude Desktop ou Claude
Code) consulte e opere o fluxo de requisições diretamente em conversa.

## Endpoint

```
https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/mcp-server
```

Código-fonte: `supabase/functions/mcp-server/index.ts`.

## Autenticação

O conector personalizado do claude.ai sempre tenta um fluxo **OAuth 2.1**
(com Registro Dinâmico de Cliente) antes de aceitar qualquer coisa — não dá
para simplesmente colar um Bearer token no campo de URL. Por isso a function
implementa também um mini servidor OAuth (migration
`database/022_mcp_oauth.sql`, tabelas `mcp_oauth_clients`, `mcp_oauth_codes`,
`mcp_oauth_tokens`):

1. `/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server`
   — descoberta (RFC9728 / RFC8414), servidos como sub-rota da própria function.
2. `/register` — Registro Dinâmico de Cliente (RFC7591); claude.ai chama isso
   sozinho, sem intervenção manual.
3. `/authorize` — mostra uma tela pedindo o **token de acesso** (a mesma
   credencial de `mcp_api_keys`) como "senha". Se válido, gera um código de
   autorização (PKCE, S256) e redireciona de volta pro claude.ai.
4. `/token` — troca o código por um `access_token` OAuth novo e opaco
   (armazenado como hash em `mcp_oauth_tokens`, válido por 1 ano).

O endpoint MCP em si (`/functions/v1/mcp-server`) aceita tanto o token
estático original (`mcp_api_keys`) quanto qualquer token emitido pelo fluxo
OAuth (`mcp_oauth_tokens`) no header `Authorization: Bearer <token>`.

O valor em texto puro do token de acesso original **nunca é persistido** em
nenhum lugar — nem no banco, nem no repositório (só o hash SHA-256). Guarde-o
em um gerenciador de senhas; é ele que você digita na tela `/authorize`
durante a conexão.

Para gerar um novo token e revogar o antigo:

```sql
-- gerar novo hash localmente antes de rodar (nunca cole o token em texto puro no SQL editor sem necessidade)
update public.mcp_api_keys set active = false where label = 'claude-web-connector';
insert into public.mcp_api_keys (label, token_hash) values ('novo-label', '<sha256-hex-do-novo-token>');
```

## Como conectar no claude.ai

1. Configurações → Conectores → Adicionar conector → Adicionar conector personalizado.
2. **Nome:** `VPRequisições`
3. **URL do servidor MCP remoto:** `https://vvgcrhtmzvssfdazkkzk.supabase.co/functions/v1/mcp-server`
4. Deixe os campos de OAuth Client ID/Secret em branco — o claude.ai se
   registra sozinho via Dynamic Client Registration (`/register`).
5. Ao clicar em "Conectar", o claude.ai abre uma tela de login própria do
   VPRequisições pedindo o **token de acesso** — cole o token fornecido pelo
   administrador do projeto ali (não no formulário de adicionar conector).

## Ferramentas disponíveis

**Leitura:** `list_requisitions`, `get_requisition`, `dashboard_summary`,
`list_pending_approvals`, `list_pending_purchases`, `list_pending_receipts`.

**Escrita:** `create_product_requisition` (módulo M1), `approve_requisition`,
`reject_requisition`, `confirm_purchase`, `register_receipt`.

Todas as ações de escrita usam o `service_role` do Supabase (mesmo padrão do
app) e registram evento em `audit_logs` com `origem: "mcp"`. Não há
diferenciação de papel por usuário nesta versão — qualquer portador do token
pode executar qualquer ferramenta. Trate o token com o mesmo cuidado que uma
credencial de administrador do sistema.

## Limitações desta primeira versão

- Escrita cobre apenas o módulo M1 (Produtos) para criação; os módulos M2–M6
  podem ser criados depois manualmente pelo app.
- Não há diferenciação de papel por usuário (solicitante/comprador/aprovador)
  — é um token único e compartilhado.
- Ações multi-nível de aprovação (tiers 1–3) usam a mesma decisão simples de
  aprovar/rejeitar já usada pelo app; não há lógica adicional de alçada no
  servidor MCP além da que já existe no banco/app.

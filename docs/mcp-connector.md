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

O endpoint exige um header `Authorization: Bearer <token>`. O token não é uma
variável de ambiente Deno — ele é validado contra o hash (SHA-256) guardado na
tabela `public.mcp_api_keys` (migration `database/021_mcp_api_keys.sql`), que
tem RLS habilitado sem policies (só o `service_role`, usado pela própria
function, consegue ler).

O valor em texto puro do token **nunca é persistido** em nenhum lugar — nem no
banco, nem no repositório. Guarde-o em um gerenciador de senhas.

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
4. Deixe os campos de OAuth em branco (a autenticação é por Bearer token, não por OAuth).
5. Depois de adicionar, o Claude perguntará o token na primeira conexão — use o token fornecido pelo administrador do projeto.

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

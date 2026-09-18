# Relatório — Server functions de admin/gestor confiavam no id enviado pelo cliente

**Status:** ✅ Corrigido
**Origem:** análise pedida sobre a tela `/admin`

## Problema encontrado

Analisando `src/routes/admin.tsx` e o que dá suporte a ela, as ações mais
sensíveis do painel — **inativar usuário**, **excluir usuário definitivamente**
— são `createServerFn` (`src/features/admin/server.ts`) que rodam com a
**service-role key** (`supabaseRest`, bypassa RLS por completo). A única
checagem de autorização era `assertIsAdmin(data.adminId)`, e `adminId` vinha
**direto do corpo da requisição**, enviado pelo próprio cliente
(`currentUser.id` no browser) — nunca verificado contra a sessão real de quem
estava chamando.

Como `createServerFn` aqui não lê cookie/header de sessão nenhum (não há
`getWebRequest`/`getCookie`/verificação de JWT em lugar nenhum do repositório
— confirmado por busca completa), isso significa que **qualquer requisição
HTTP direta ao endpoint**, autenticada ou não, que informasse o UUID de um
admin real no campo `adminId` seria aceita como se fosse aquele admin. Um
UUID de admin pode vazar por vários caminhos no próprio app (ex.:
`approver_id`/`actor_id` aparecem em `audit_logs`, `purchases`, `approvals`
para papéis não-admin como comprador/aprovador). O mesmo padrão existia em:

- `src/features/gestor/api.ts` — `getManagerScope`, `listGestorQueue`,
  `listAllGestorPending` (dados sensíveis — todas as requisições GESTOR do
  sistema), `gestorApprove`, `gestorReject` (decide requisições de terceiros)
  — todos recebiam `managerId`/`adminId` do corpo, sem verificação.
- `src/features/requisitions/api.ts::deleteRequisition` — `actorId` do corpo,
  checado contra `user_roles` sem confirmar que é quem está de fato logado.

Ou seja: não é um bug isolado do Admin, é um padrão repetido em toda função
que precisa saber "quem está chamando isso" — nenhuma delas amarra esse id à
sessão HTTP real. `src/features/vpclick/server.ts` e
`src/features/whatsapp/server.ts` não sofrem disso porque são efeitos
colaterais de notificação (nunca lançam erro, sem ação destrutiva atrelada a
um id de ator). `src/features/comando/api.ts` já é intencionalmente
token-gated (formulário público, sem sessão por design) — não é o mesmo
problema.

## Causa raiz

`src/lib/supabase-rest.ts` sempre usa a service-role key — está correto para
as server functions que legitimamente não têm sessão de usuário para
escopar via RLS (ex.: formulário público do M7). O erro foi usar esse mesmo
transporte para ações que **exigem saber quem é o chamador real**, sem
nenhuma camada equivalente de "verificar sessão" — a app nunca tinha essa
peça (nenhum `createMiddleware`/verificação de JWT em lugar nenhum do
projeto).

## Correção

Criado `src/lib/server-auth.ts::verifyAccessToken(accessToken)` — chama
`GET {SUPABASE_URL}/auth/v1/user` com o access token do chamador e retorna o
`id` do usuário **verificado pelo GoTrue**, não o que o cliente alega ser.

No browser, `src/lib/auth-token-client.ts::getAccessToken()` lê o
`access_token` da sessão atual (`supabaseBrowser.auth.getSession()`).

Todas as server functions afetadas trocaram o campo `adminId`/`managerId`/
`actorId` (UUID "confiável" vindo do corpo) por `accessToken`, e resolvem o
id real internamente via `verifyAccessToken` antes de qualquer checagem de
papel:

- `src/features/admin/server.ts` — `setUserActive`, `deleteUserAccount`
- `src/features/gestor/api.ts` — `getManagerScope`, `listGestorQueue`,
  `listAllGestorPending`, `gestorApprove`, `gestorReject`
- `src/features/requisitions/api.ts` — `deleteRequisition`

Os wrappers client-side (`src/features/gestor/client.ts`,
`src/features/requisitions/client.ts`) e os pontos de chamada em
`src/routes/admin.tsx`, `src/routes/approval.tsx` e
`src/routes/movimentacoes.tsx` foram atualizados — não recebem mais o id do
usuário como parâmetro (era usado só pra isso), buscam o access token na
hora da chamada.

## Varredura dos módulos restantes (mesmo dia)

Auditei função a função as demais `createServerFn` do repositório —
`purchases`, `quotations`, `approvals`, `receipts`, `omie`, `dashboard`,
`analytics`, `logs/api.ts` — atrás do mesmo padrão (id de ator vindo do
corpo, usado pra decisão de autorização). **Nenhuma tem esse padrão**:
nenhum schema dessas funções recebe `userId`/`actorId`/`buyerId`/
`approverId` como campo — só ids de recurso (`requisitionId`,
`approvalId`, `quotationId`...) e dados de negócio. `omie/api.ts` só fala
com a API do Omie via credenciais de app, sem identidade de usuário
nenhuma envolvida.

Duas coisas adjacentes apareceram na varredura, fora do padrão original
mas ainda gaps reais de autorização:

- **`getAnalytics` (`analytics/api.ts`) e `getLogsOverview`
  (`logs/api.ts`) não tinham NENHUMA checagem de sessão** — rodam com
  service-role key e, sem `verifyAccessToken`, uma chamada HTTP direta ao
  endpoint, sem estar logado, devolvia dados financeiros/operacionais e o
  audit trail completo da empresa. Corrigido: ambas agora exigem
  `accessToken` válido (sessão real, sem checagem de papel específico —
  a tela nunca restringiu por papel, só por estar logado) antes de rodar.
  Client-side: `src/routes/analytics.tsx`, `src/routes/logs.tsx` e
  `src/routes/movimentacoes.tsx` (usa `getLogsOverview` também) passam a
  enviar `accessToken: await getAccessToken()`.
- **Código morto**: os exports `createServerFn` de `purchases/api.ts`,
  `quotations/api.ts` (parcial), `approvals/api.ts`, `receipts/api.ts` e
  `dashboard/api.ts` não são chamados pela UI atual — cada rota usa uma
  implementação paralela em `client.ts` que fala direto com
  `supabaseBrowser` (RLS). Não corrigido agora: como não têm o padrão de
  id confiável, não são o mesmo tipo de vulnerabilidade, mas valem uma
  decisão futura (apagar ou realmente usar) já que ficam expostas como
  endpoint sem serem exercitadas por nada.

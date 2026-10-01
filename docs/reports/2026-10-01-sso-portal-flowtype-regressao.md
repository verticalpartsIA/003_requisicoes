# SSO do portal continuava quebrado após o fix anterior — regressão de `flowType`

## Sintoma

Colaborador (Vinicius) logado em `vpsistema.com` clicou no card "Requisições"
e caiu de novo em `/login`, mesmo com o fix de
`docs/reports/2026-09-16-sso-portal-vpsistema.md` (PR #103) já em produção.

## O que o fix anterior errou

O PR #103 partiu da suposição de que o portal (`vpsistema.com`) e o
VPRequisições usavam o **mesmo projeto Supabase**, e por isso trocou
`createClient` por `createBrowserClient` (`@supabase/ssr`) com a sessão em
cookie `.vpsistema.com` — pensando em SSO por cookie compartilhado.

Investigação mais a fundo (via API do Supabase, não suposição) confirmou:
são dois projetos **diferentes** (`ubdkoqxfwcraftesgmbw` = vpsistema,
`vvgcrhtmzvssfdazkkzk` = vprequisicao). Cookie compartilhado nunca teria
funcionado — JWT de um projeto não é válido no outro.

## A causa raiz de verdade

O portal **já tinha** um mecanismo de SSO completo e corretamente configurado
para esse exato cenário (dois projetos Supabase distintos), implementado como
edge function `sso-proxy` no projeto do portal (`supabase/functions/sso-proxy`
+ `_shared/apps.ts`, repo `verticalpartsIA/vpsistema`): no clique do card, ela
chama `auth.admin.generateLink({ type: "magiclink" })` no projeto Supabase do
app de destino (usando uma service key própria, `VPREQ_SERVICE_KEY`) e
redireciona o navegador para o link gerado. Esse link, quando aberto, o
próprio servidor de Auth do Supabase do VPRequisições redireciona de volta
para `vprequisicoes.vpsistema.com` com `#access_token=...&refresh_token=...`
no hash da URL — o formato clássico "implicit flow".

A tabela `modules` do portal já tinha `vprequisicoes` cadastrado corretamente
apontando para essa function. O fallback usado **só quando o SSO falha** é a
URL crua cadastrada no banco — que por acaso é
`https://vprequisicoes.vpsistema.com/login?redirect=%2F` (o link ruim visto
no print original do usuário).

O PR #103, ao trocar para `@supabase/ssr` `createBrowserClient`, mudou
silenciosamente o `flowType` padrão do client para `"pkce"`. Em modo PKCE, o
Supabase client só reconhece sessão vinda de `?code=` na URL — **ignora**
completamente o `#access_token=` que o `sso-proxy` do portal gera. Resultado:
o SSO do portal (que já era funcional) parava de funcionar silenciosamente
assim que chegava no VPRequisições, caindo de volta no fallback de `/login`.

## Fix

Revertido `src/lib/supabase-browser.ts` para `createClient` simples de
`@supabase/supabase-js`, com `flowType: "implicit"` explícito (para deixar
claro que é intencional, não só o default) e `detectSessionInUrl: true`.
Dependência `@supabase/ssr` removida — não tinha nenhuma utilidade real neste
app (os dois lados nunca puderam compartilhar cookie).

## Por que não aconteceu antes

O fix do PR #103 nunca foi validado de ponta a ponta em produção antes de
mesclar — o "test plan" do PR marcava a validação manual como pendente,
dependente do lado do portal, que não chegou a ser mexido (o portal já
estava certo). Sem esse teste, a regressão de `flowType` passou despercebida
por duas semanas até o relato do Vinicius.

## Lição para a próxima vez

Antes de declarar um fix de SSO pronto, testar o fluxo real (login no portal
→ clicar no card → chegar autenticado), não só os checks de build/lint/test
do app isolado — nenhum deles exercita o redirect entre os dois sistemas.

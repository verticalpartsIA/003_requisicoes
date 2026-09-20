# SSO do portal (vpsistema.com) não era respeitado — sessão presa em localStorage por origem

## Sintoma

Usuário já logado em `vpsistema.com` (o portal que lista os módulos como
cards) clica no card "Requisições" esperando entrar direto em
`vprequisicoes.vpsistema.com`, mas cai em `/login?redirect=%2F` como se não
estivesse autenticado.

## Causa raiz

`src/lib/supabase-browser.ts` criava o client com `@supabase/supabase-js`
`createClient()` puro, sem `cookieOptions`/`storage` customizados. Nesse
modo, `supabase-js` persiste a sessão em `localStorage`, que é isolado por
**origem** (esquema+host+porta). Mesmo o portal e este app usando o mesmo
projeto Supabase (mesmos usuários, mesmo JWT), a sessão criada em
`vpsistema.com` nunca era visível para `vprequisicoes.vpsistema.com` — são
origens diferentes, cada uma com seu próprio `localStorage`.

Não havia nenhum outro mecanismo de SSO (token via URL, postMessage, cookie
compartilhado) — a única integração cross-sistema existente
(`src/lib/track-activity.ts`) é telemetria de entrada/saída para a timeline
do portal, não troca de credencial.

## Correção

Trocado `createClient` (`@supabase/supabase-js`) por `createBrowserClient`
(`@supabase/ssr`) em `src/lib/supabase-browser.ts`, configurando
`cookieOptions.domain = ".vpsistema.com"` quando o host atual é
`vpsistema.com` ou um subdomínio dele (em `localhost`/dev o cookie continua
host-only, sem domain explícito). Isso move a sessão de `localStorage` para
um cookie escopado ao domínio pai `vpsistema.com`, que **qualquer**
subdomínio consegue ler — exatamente o padrão recomendado pelo Supabase
para SSO entre múltiplos apps/subdomínios do mesmo projeto.

**Isso só funciona de ponta a ponta se o portal (`vpsistema.com`, repo
`verticalpartsIA/vpsistema`) também usar `@supabase/ssr`
`createBrowserClient` com o mesmo `cookieOptions.domain = ".vpsistema.com"`,
o mesmo projeto Supabase (mesma `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)
e servir sobre HTTPS** (cookie `secure`). Esta sessão não tinha acesso ao
repositório do portal para aplicar o lado espelhado — precisa ser replicado
lá manualmente ou em uma sessão à parte com acesso a esse repo. Sem essa
mudança no portal, cada app continua com sua sessão isolada mesmo depois
deste fix.

## Consequência colateral aceita

Cookies têm um limite prático de ~4KB por cookie; `@supabase/ssr`
lida com isso automaticamente fazendo *chunking* do JWT em múltiplos
cookies quando necessário, então não é preciso tratamento manual aqui.

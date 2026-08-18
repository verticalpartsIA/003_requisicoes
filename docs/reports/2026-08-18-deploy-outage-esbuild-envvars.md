# Relatório — Incidente de produção fora do ar (18/08/2026)

**Status:** ✅ Resolvido
**PRs:** #77 (resiliência do build), variáveis de ambiente configuradas manualmente no painel da Hostinger

## Resumo

Depois de um merge de rotina (#76, feature do Quadro de Comando), o site
(`https://vprequisicoes.vpsistema.com`) começou a retornar 500 em qualquer
página. A causa acabou sendo **duas coisas empilhadas**, descobertas nessa
ordem:

1. O build (`vite build`) estava falhando no servidor por falta de recursos,
   e o workflow de deploy não verificava isso — reiniciava o app mesmo com
   `dist/` quebrado/vazio.
2. Depois de corrigir isso, o site ainda dava 500 — porque variáveis de
   ambiente do Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) não estavam configuradas no app real (o que
   o Passenger de fato serve, ver abaixo), causando um `HTTPError` não
   tratado em toda chamada ao Supabase durante o SSR.

## Causa raiz #1 — build falhando sem o deploy notar

Log do build quebrado:

```
thread '<unnamed>' panicked at rayon-core-1.12.1/src/registry.rs:168:
The global thread pool has not been initialized.: ThreadPoolBuildError {
  kind: IOError(Os { code: 11, kind: WouldBlock, message: "Resource temporarily unavailable" })
}
fatal runtime error: failed to initiate panic, error 5
```

Isso é o runtime Go do `esbuild` (usado pelo Vite) tentando criar uma OS
thread e batendo no `ulimit -u` (limite de processos/threads) da conta
compartilhada da Hostinger. `.github/workflows/deploy.yml` não tinha
`set -e` nem checava o exit code de `npm run build` — então, mesmo com o
build falhando, o script seguia adiante e reiniciava o Passenger com
`dist/` inválido (o Vite já tinha limpado a pasta antes de falhar).

**Correção (`scripts/build.mjs`, PR #77):**
- Guarda `dist/` em `dist.bak` antes de buildar; se a build falhar, restaura
  automaticamente — o site nunca fica sem artefato.
- `GOMAXPROCS=2` na chamada do `vite build`, reduzindo a criação de threads
  do binário nativo.
- `deploy.yml` agora marca o job como falho (`exit 1`) quando o build falha,
  em vez de reportar sucesso.

## Descoberta lateral — existem DOIS sistemas de deploy

Durante a investigação, descobrimos que o nosso `deploy.yml` builda em
`~/domains/.../nodejs/`, mas o Passenger reporta
`PassengerAppRoot .../hbuilds/current/nodejs` — um diretório **diferente**,
gerenciado pelo próprio painel "Node.js App" da Hostinger via webhook do
GitHub (`hbuilds/versions/<uuid>/`, com `hbuilds/current` symlinkado pra
versão ativa). Ou seja: nosso workflow é uma validação útil, mas quem
decide o que está de fato no ar é o painel da Hostinger, de forma
independente. Ver `DEPLOY_HOSTINGER.md` para o detalhe operacional.

Isso também explica por que às vezes um push falha no nosso workflow mas o
site continua funcionando (o painel builda com sucesso em paralelo) — os
dois sistemas competem pelos mesmos recursos do servidor, então builds
simultâneos aumentam a chance de um deles bater no limite de threads.

## Causa raiz #2 — variáveis de ambiente ausentes no app real

Depois da correção #1, o build passou a ter sucesso (confirmado nos logs:
`✓ built in Ns`, `REQUIRE OK`), mas `GET /login` continuava 500, com o corpo:

```json
{"status":500,"unhandled":true,"message":"HTTPError"}
```

`src/lib/env.ts` faz `requireEnv()` lançar erro se `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` estiverem ausentes —
e qualquer chamada Supabase durante o SSR de qualquer rota falha com esse
erro. O `.env` que o nosso workflow symlinka (`nodejs/.env`) apontava para
um arquivo que não existe mais em `public_html/.builds/config/.env` — mas
isso nem importa, porque **o app real (`hbuilds/current`) usa as variáveis
de ambiente configuradas direto no painel "Setup Node.js App" da
Hostinger**, não um arquivo `.env`.

**Correção:** configuradas as 3 variáveis críticas no painel. Ver a lista
completa em `DEPLOY_HOSTINGER.md`.

## Linha do tempo (resumida)

| Hora (UTC) | Evento |
|---|---|
| 15:13 | Merge do PR #76 dispara deploy; build falha (esbuild panic); site cai |
| 15:25–15:53 | Diagnóstico via SSH (PRs #77 a #80): build resiliente, descoberta do `hbuilds/`, captura do corpo real do erro |
| ~15:5x | Variáveis de ambiente do Supabase configuradas no painel da Hostinger |
| 17:34 | `GET /login` já responde 307 (redirect normal) — site recuperado |

## Lições para a próxima vez

- **Não insistir em redeploys em sequência** quando o build falhar por
  recurso — agrava a contenção. Espaçar as tentativas.
- O corpo da resposta HTTP (não só o status code) é essencial pra
  diagnosticar — `curl -s` sem `-o /dev/null` no passo de teste do deploy.
- Verificar sempre `PassengerAppRoot` real antes de assumir que o diretório
  que o workflow atualiza é o que está no ar.

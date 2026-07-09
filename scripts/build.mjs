// Build multiplataforma (issue #3): substitui o antigo `sh -c '...'` que
// falhava no Windows. Carrega o .env da Hostinger quando presente (produção)
// e roda o vite build com o limite de memória ampliado.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const HOSTINGER_ENV =
  "/home/u969661049/domains/vprequisicoes.vpsistema.com/public_html/.builds/config/.env";

if (existsSync(HOSTINGER_ENV)) {
  for (const line of readFileSync(HOSTINGER_ENV, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    process.env[match[1]] = value;
  }
  console.log("[build] Variáveis do .env da Hostinger carregadas.");
}

const result = spawnSync("npx", ["vite", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
});

process.exit(result.status ?? 1);

// Build multiplataforma (issue #3): substitui o antigo `sh -c '...'` que
// falhava no Windows. Carrega o .env da Hostinger quando presente (produção)
// e roda o vite build com o limite de memória ampliado.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

// Aviso de atualização (issue de "site desatualizado em aba aberta"): grava o
// horário do build no bundle (build-info.generated.ts, lido em tempo de
// build pelo vite) e num version.json estático (lido em runtime pelo
// cliente) — src/lib/version-check.ts compara os dois.
const buildTime = new Date().toISOString();
let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
} catch {
  // Sem .git disponível (ex.: deploy só com os arquivos) — segue sem commit.
}

writeFileSync(
  join(ROOT, "src/lib/build-info.generated.ts"),
  `// Gerado por scripts/build.mjs em ${buildTime} — não editar manualmente.\n` +
    `export const BUILD_TIME = ${JSON.stringify(buildTime)};\n`,
);
console.log(`[build] build-info.generated.ts gravado (BUILD_TIME=${buildTime}).`);

const result = spawnSync("npx", ["vite", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const clientDir = join(ROOT, "dist", "client");
if (existsSync(clientDir)) {
  writeFileSync(join(clientDir, "version.json"), JSON.stringify({ buildTime, commit }));
  console.log("[build] dist/client/version.json gravado.");
} else {
  console.warn("[build] dist/client não encontrado — version.json não foi gravado.");
}

process.exit(0);

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Captura erros fatais para aparecerem nos logs da Hostinger
process.on("uncaughtException", (err) => {
  console.error("[server] ERRO NAO CAPTURADO:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] PROMISE REJEITADA:", reason);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = Number(process.env.PORT || "3000");
const host = process.env.HOST || "0.0.0.0";
// Usa __dirname para garantir o caminho correto independente do cwd
const clientDir = join(__dirname, "dist", "client");

console.log("[server] Iniciando... PORT=" + port + " cwd=" + process.cwd() + " dir=" + __dirname);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getMimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function loadEnvFile(fileName) {
  const filePath = join(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return;
  }

  const rawContents = readFileSync(filePath, "utf-8");

  for (const line of rawContents.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();

    if (!key || process.env[key]) {
      continue;
    }

    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

console.log("[server] Carregando dist/server/index.js...");
// Sem top-level await: o Passenger/LiteSpeed da Hostinger carrega este arquivo
// via require(), que nao suporta modulo ESM com await no nivel superior
// (ERR_REQUIRE_ASYNC_MODULE) — o processo morreria antes de qualquer log.
const appPromise = import(join(__dirname, "dist", "server", "index.js"))
  .then((mod) => {
    console.log("[server] dist/server/index.js carregado com sucesso.");
    return mod.default;
  })
  .catch((err) => {
    console.error("[server] FALHA ao carregar dist/server/index.js:", err);
    process.exit(1);
  });

function toNodeHeaders(headers) {
  const nodeHeaders = {};

  headers.forEach((value, key) => {
    nodeHeaders[key] = value;
  });

  return nodeHeaders;
}

function toWebRequest(req) {
  // Garante uma origin valida mesmo se APP_ORIGIN estiver errado/ausente
  let origin = "http://localhost:" + port;
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    try {
      origin = new URL(configured).origin;
    } catch {
      // APP_ORIGIN invalido — usa fallback
    }
  } else {
    const host = req.headers.host || req.headers[":authority"];
    if (host) {
      origin = host.startsWith("http") ? host : "https://" + host;
      try { new URL(origin); } catch { origin = "http://localhost:" + port; }
    }
  }
  const rawUrl = req.url || "/";
  const url = new URL(rawUrl.startsWith("http") ? rawUrl : origin + rawUrl);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function sendWebResponse(res, response) {
  res.writeHead(response.status, toNodeHeaders(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

function resolveStaticPath(pathname) {
  const cleanedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(cleanedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(clientDir, normalizedPath);

  if (!absolutePath.startsWith(clientDir)) {
    return null;
  }

  return absolutePath;
}

async function tryServeStatic(req, res) {
  if (!req.url) {
    return false;
  }

  const pathname = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`).pathname;
  const staticPath = resolveStaticPath(pathname);

  if (!staticPath || !existsSync(staticPath)) {
    return false;
  }

  const fileStats = await stat(staticPath).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    return false;
  }

  res.writeHead(200, {
    "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "content-length": String(fileStats.size),
    "content-type": getMimeType(staticPath),
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  createReadStream(staticPath).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (await tryServeStatic(req, res)) {
      return;
    }

    const request = toWebRequest(req);
    const app = await appPromise;
    const response = await app.fetch(request);
    await sendWebResponse(res, response);
  } catch (error) {
    console.error("Erro ao processar requisicao", error);
    const errDetail = error instanceof Error
      ? (error.stack || error.message)
      : String(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("[DEBUG] Erro:\n" + errDetail);
  }
});

server.on("error", (err) => {
  console.error("[server] Erro ao iniciar servidor HTTP:", err);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[server] VP Requisicoes Pro rodando em http://${host}:${port}`);
});

// Wrapper CommonJS para o Passenger/LiteSpeed da Hostinger.
// Use este arquivo como "Arquivo de entrada" caso o require() direto de
// server.js (ESM) nao funcione na versao de Node/loader do servidor.
import("./server.js").catch((err) => {
  console.error("[boot] falha ao iniciar server.js:", err);
  process.exit(1);
});

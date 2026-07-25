// Rastro de acesso cross-sistema: emite eventos "enter"/"exit" para a edge
// function pública `track-activity` do portal central (vpsistema), que
// alimenta uma timeline mostrando quando cada colaborador entra e sai de
// cada sistema satélite. Fire-and-forget por design — nunca deve travar nem
// quebrar a UI se a chamada falhar (rede offline, endpoint fora do ar, etc.).
//
// Não usar para eventos de negócio (ex.: "criou requisição") — isso é
// coberto por outro mecanismo. Aqui só entram os dois eventos de sessão.

const TRACK_ACTIVITY_URL =
  "https://ubdkoqxfwcraftesgmbw.supabase.co/functions/v1/track-activity";
const APP_KEY = "vprequisicoes";
const SESSION_STORAGE_KEY = "vp_track_activity_session_id";

type TrackEventType = "enter" | "exit";

interface TrackActivityPayload {
  app: string;
  event_type: TrackEventType;
  user_email: string;
  user_name: string;
  session_id: string;
  track_key: string;
}

function getTrackKey(): string {
  // Mesmo padrão de leitura de env var usado em src/lib/env.ts, mas sem
  // lançar erro: a ausência da chave deve resultar em no-op silencioso, não
  // em build quebrado ou exceção em runtime.
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const val = (import.meta.env as Record<string, string | undefined>)
      .VITE_TRACK_ACTIVITY_KEY;
    if (val) return val;
  }
  return "";
}

function getOrCreateSessionId(): string | null {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    // sessionStorage indisponível (modo privado, etc.) — sem rastreio nesta aba.
    return null;
  }
}

function buildPayload(
  eventType: TrackEventType,
  userEmail: string,
  userName: string,
  sessionId: string,
  trackKey: string,
): TrackActivityPayload {
  return {
    app: APP_KEY,
    event_type: eventType,
    user_email: userEmail,
    user_name: userName,
    session_id: sessionId,
    track_key: trackKey,
  };
}

/**
 * Deve ser chamada uma única vez, assim que a sessão autenticada resolver
 * (ex.: no root da aplicação, quando `session`/`user` do AuthProvider deixa
 * de ser nulo). Gera (ou reaproveita) um session_id em sessionStorage e
 * dispara o evento "enter" sem bloquear a renderização.
 */
export function trackEnter(userEmail: string | null | undefined, userName: string | null | undefined): void {
  try {
    const trackKey = getTrackKey();
    if (!trackKey) return; // env var não configurada — no-op silencioso

    const sessionId = getOrCreateSessionId();
    if (!sessionId || !userEmail) return;

    const payload = buildPayload("enter", userEmail, userName || userEmail, sessionId, trackKey);

    void fetch(TRACK_ACTIVITY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Falha de rede/endpoint — ignorada de propósito, é apenas telemetria.
    });
  } catch {
    // Nunca deixar o rastreio quebrar a UI.
  }
}

/**
 * Deve ser registrada num listener de `pagehide` (preferível a
 * `beforeunload` por causa do bfcache). Reaproveita o session_id salvo em
 * `trackEnter` e usa `navigator.sendBeacon` porque é a única API confiável
 * para enviar dados durante o descarregamento da página. sendBeacon não
 * aceita headers customizados, por isso o track_key vai no corpo.
 */
export function trackExit(userEmail: string | null | undefined, userName: string | null | undefined): void {
  try {
    const trackKey = getTrackKey();
    if (!trackKey) return;

    if (typeof sessionStorage === "undefined") return;
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId || !userEmail) return;

    const payload = buildPayload("exit", userEmail, userName || userEmail, sessionId, trackKey);

    if (typeof navigator === "undefined" || !navigator.sendBeacon) return;

    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    navigator.sendBeacon(TRACK_ACTIVITY_URL, blob);
  } catch {
    // Nunca deixar o rastreio quebrar a UI.
  }
}

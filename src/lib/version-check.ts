import { toast } from "sonner";
import { BUILD_TIME } from "@/lib/build-info.generated";

// Deploy sobrescreve os arquivos direto no servidor (Hostinger), sem
// invalidação de CDN/versionamento — uma aba deixada aberta pode continuar
// rodando o bundle antigo por horas/dias depois de uma atualização. Este
// módulo verifica periodicamente `version.json` (gerado a cada build por
// scripts/build.mjs) e avisa o usuário quando uma versão mais nova foi
// publicada, sem forçar o reload (evita perder algo que a pessoa esteja
// digitando). O botão do aviso limpa o cache deste site antes de recarregar
// (ver clearSiteCacheAndReload).
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const FIRST_CHECK_DELAY_MS = 15 * 1000; // dá um tempo antes da primeira checagem

// Guarda no localStorage (compartilhado entre abas da mesma origem, e
// sobrevive a um remount acidental do componente) qual buildTime já foi
// avisado — sem isso, quem tem mais de uma aba aberta do site vê o mesmo
// aviso "loopar" de aba em aba (cada aba tem sua própria variável `notified`
// em memória, mas todas comparam contra o mesmo version.json).
const NOTIFIED_BUILD_KEY = "vp_version_notified_build";

function alreadyNotified(buildTime: string): boolean {
  try {
    return localStorage.getItem(NOTIFIED_BUILD_KEY) === buildTime;
  } catch {
    return false;
  }
}

function markNotified(buildTime: string): void {
  try {
    localStorage.setItem(NOTIFIED_BUILD_KEY, buildTime);
  } catch {
    // localStorage indisponível (modo privado etc.) — sem persistência,
    // mas a checagem desta aba continua funcionando normalmente.
  }
}

interface VersionInfo {
  buildTime: string;
  commit: string;
}

function formatUpdateMessage(buildTime: string): string {
  const d = new Date(buildTime);
  if (isNaN(d.getTime())) return "Este site foi atualizado.";
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Este site foi atualizado em ${date} às ${time}h`;
}

// Usado pela AppSidebar pra mostrar "Última atualização: DD/MM/AA HH:MMh" —
// data/hora do build desta aba (BUILD_TIME), não a mais recente publicada
// no servidor (essa é a que o toast acima avisa quando muda).
export function formatBuildTimeShort(buildTime: string): string | null {
  if (buildTime === "dev") return null;
  const d = new Date(buildTime);
  if (isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}h`;
}

/**
 * "Atualizar agora": limpa o cache DESTE site (vprequisicoes) e recarrega.
 *
 * Escopo de propósito restrito à origem atual — o login é SSO vindo do
 * vpsistema.com, então NÃO mexe em cookies, localStorage nem sessionStorage
 * (é lá que fica a sessão). Também não usa o header `Clear-Site-Data`: alguns
 * navegadores aplicam a limpeza ao domínio registrável inteiro
 * (*.vpsistema.com), e aqui só pode afetar este site.
 *
 * 1. Cache Storage da origem (caches.*) — sempre por origem.
 * 2. Service workers da origem (hoje o site não registra nenhum; cobre o futuro).
 * 3. Rebusca a página atual e "/" com `cache: "reload"`, que força a rede e
 *    substitui a cópia guardada no cache HTTP do navegador — os scripts em
 *    /assets/ têm nome com hash, então uma página nova já aponta pros novos.
 * 4. Recarrega.
 */
export async function clearSiteCacheAndReload(
  win: Window & typeof globalThis = window,
): Promise<void> {
  try {
    if ("caches" in win) {
      const keys = await win.caches.keys();
      await Promise.all(keys.map((k) => win.caches.delete(k)));
    }
  } catch {
    // Cache Storage indisponível (ex.: contexto não seguro) — segue.
  }
  try {
    const regs = (await win.navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // Sem suporte a service worker — segue.
  }
  const here = win.location.pathname + win.location.search;
  const urls = Array.from(new Set([here, "/"]));
  // O fetch resolve quando chegam os cabeçalhos, não o corpo — é preciso ler
  // a resposta até o fim, senão o reload() logo em seguida aborta o download
  // e a navegação cai na cópia antiga do cache.
  await Promise.all(
    urls.map((u) =>
      win
        .fetch(u, { cache: "reload", credentials: "same-origin" })
        .then((r) => (r.ok ? r.arrayBuffer() : undefined))
        .catch(() => undefined),
    ),
  );
  win.location.reload();
}

export function startVersionCheck(): () => void {
  let notified = false;

  const check = async () => {
    if (notified || BUILD_TIME === "dev") return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const info: VersionInfo = await res.json();
      if (info.buildTime && info.buildTime !== BUILD_TIME) {
        if (alreadyNotified(info.buildTime)) {
          notified = true;
          return;
        }
        notified = true;
        markNotified(info.buildTime);
        toast.message(formatUpdateMessage(info.buildTime), {
          description: "Atualize a página para usar a versão mais recente.",
          duration: Infinity,
          action: {
            label: "Atualizar agora",
            onClick: () => {
              toast.loading("Limpando o cache e carregando a nova versão…", {
                description: "Seu login continua ativo.",
                duration: Infinity,
              });
              // Rede lenta não pode deixar a pessoa presa no aviso: recarrega
              // de qualquer jeito em até 8s.
              const fallback = setTimeout(() => window.location.reload(), 8000);
              void clearSiteCacheAndReload().finally(() => clearTimeout(fallback));
            },
          },
        });
      }
    } catch {
      // Rede instável/offline — tenta de novo no próximo ciclo, sem incomodar.
    }
  };

  const firstCheckTimer = setTimeout(check, FIRST_CHECK_DELAY_MS);
  const interval = setInterval(check, CHECK_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") check();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", check);

  return () => {
    clearTimeout(firstCheckTimer);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", check);
  };
}

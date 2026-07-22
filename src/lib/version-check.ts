import { toast } from "sonner";
import { BUILD_TIME } from "@/lib/build-info.generated";

// Deploy sobrescreve os arquivos direto no servidor (Hostinger), sem
// invalidação de CDN/versionamento — uma aba deixada aberta pode continuar
// rodando o bundle antigo por horas/dias depois de uma atualização. Este
// módulo verifica periodicamente `version.json` (gerado a cada build por
// scripts/build.mjs) e avisa o usuário quando uma versão mais nova foi
// publicada, sem forçar o reload (evita perder algo que a pessoa esteja
// digitando).
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const FIRST_CHECK_DELAY_MS = 15 * 1000; // dá um tempo antes da primeira checagem

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

export function startVersionCheck(): () => void {
  let notified = false;

  const check = async () => {
    if (notified || BUILD_TIME === "dev") return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const info: VersionInfo = await res.json();
      if (info.buildTime && info.buildTime !== BUILD_TIME) {
        notified = true;
        toast.message(formatUpdateMessage(info.buildTime), {
          description: "Atualize a página para usar a versão mais recente.",
          duration: Infinity,
          action: {
            label: "Atualizar agora",
            onClick: () => window.location.reload(),
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

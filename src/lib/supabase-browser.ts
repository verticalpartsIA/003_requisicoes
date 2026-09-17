import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";

const env = getSupabasePublicEnv();

// SSO entre subdomínios *.vpsistema.com: a sessão é persistida em cookie
// (não em localStorage) com domain=".vpsistema.com", então qualquer app do
// portal que use o mesmo projeto Supabase e a mesma configuração de cookie
// enxerga a sessão já criada em outro subdomínio (ex.: o portal em
// vpsistema.com) sem precisar de troca de token via URL. Em localhost/dev
// (domínio não é vpsistema.com) o cookie fica host-only, o que também é o
// comportamento correto ali.
function getCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const { hostname } = window.location;
  return hostname === "vpsistema.com" || hostname.endsWith(".vpsistema.com")
    ? ".vpsistema.com"
    : undefined;
}

export const supabaseBrowser = createBrowserClient(env.url, env.anonKey, {
  cookieOptions: {
    domain: getCookieDomain(),
    path: "/",
    sameSite: "lax",
    secure: typeof window === "undefined" || window.location.protocol === "https:",
  },
});

import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env";

const env = getSupabasePublicEnv();

// SSO do portal (vpsistema.com): o portal gera um magic link via sua
// edge function sso-proxy (auth.admin.generateLink no projeto Supabase
// DESTE app — vpsistema e VPRequisições são projetos Supabase distintos,
// não dá pra compartilhar sessão por cookie) e redireciona pra cá com
// #access_token=...&refresh_token=... no formato implícito clássico.
// flowType precisa ficar "implicit" (o default do supabase-js puro) para
// detectSessionInUrl reconhecer esse hash — em modo "pkce" (que
// @supabase/ssr usa por padrão) o client só reconhece ?code=, e ignora
// esse link silenciosamente, deixando o usuário preso em /login.
export const supabaseBrowser = createClient(env.url, env.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

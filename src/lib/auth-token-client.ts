import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Access token da sessão atual, para enviar a server functions que precisam
 * verificar quem está de fato chamando (ver `src/lib/server-auth.ts`) — nunca
 * enviar um id de usuário "confiando" que é quem está logado.
 */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabaseBrowser.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return token;
}

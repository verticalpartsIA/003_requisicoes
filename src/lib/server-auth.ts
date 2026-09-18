import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Verifica um access token do Supabase Auth junto ao GoTrue e retorna o id do
 * usuário autenticado. Server functions rodam com a service-role key (bypassa
 * RLS) — o id de quem está chamando não pode vir direto do corpo da
 * requisição (qualquer cliente poderia mandar o UUID de um admin e passar em
 * checagens como `assertIsAdmin`); só é confiável depois de resolvido aqui.
 */
export async function verifyAccessToken(accessToken: string): Promise<string> {
  const { url, anonKey } = getSupabasePublicEnv();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Sessão inválida ou expirada. Faça login novamente.");
  }

  const user = (await response.json()) as { id?: string };
  if (!user.id) {
    throw new Error("Sessão inválida ou expirada. Faça login novamente.");
  }
  return user.id;
}

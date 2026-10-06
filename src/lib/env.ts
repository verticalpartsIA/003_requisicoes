function getEnvValue(name: string): string | undefined {
  // Browser (Vite client bundle): usa import.meta.env
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const val = (import.meta.env as Record<string, string | undefined>)[name];
    if (val) return val;
  }
  // Server-side (Node.js SSR): usa process.env
  if (typeof process !== "undefined" && process.env) {
    const val = process.env[name];
    if (val) return val;
  }
  return undefined;
}

function requireEnv(name: string): string {
  const value = getEnvValue(name);

  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }

  return value;
}

export function getSupabasePublicEnv() {
  return {
    url: requireEnv("VITE_SUPABASE_URL"),
    anonKey: requireEnv("VITE_SUPABASE_ANON_KEY"),
  };
}

export function getSupabaseEnv() {
  return {
    ...getSupabasePublicEnv(),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/** Credenciais do Omie. Sem valor padrão no código: ausência vira erro claro
 *  (lido só quando uma chamada ao Omie acontece, não na importação do módulo). */
export function getOmieEnv() {
  return {
    appKey: requireEnv("OMIE_APP_KEY"),
    appSecret: requireEnv("OMIE_APP_SECRET"),
  };
}

export function getDefaultRequester() {
  return {
    name: getEnvValue("DEFAULT_REQUESTER_NAME") || "Operador VerticalParts",
    email: getEnvValue("DEFAULT_REQUESTER_EMAIL") || "operador@verticalparts.com.br",
    department: getEnvValue("DEFAULT_REQUESTER_DEPARTMENT") || "Compras",
  };
}

// A API da Omie devolve textos de cadastro (descrição de produto, nome de
// fornecedor/vendedor...) com entidades HTML — `1/4"` chega como
// `1/4&quot;`. Sem decodificar, isso era gravado assim em title/module_data
// e aparecia cru na tela, no PDF e na exportação CSV/JSON.
const NAMED: Record<string, string> = {
  quot: '"',
  amp: "&",
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

/** Decodifica entidades HTML nomeadas comuns e numéricas (`&#39;`, `&#x27;`). Passada única. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

/** Aplica decodeHtmlEntities em todas as strings de um valor JSON (objetos/arrays aninhados). */
export function decodeHtmlEntitiesDeep<T>(value: T): T {
  if (typeof value === "string") return decodeHtmlEntities(value) as T;
  if (Array.isArray(value)) return value.map(decodeHtmlEntitiesDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decodeHtmlEntitiesDeep(v)]),
    ) as T;
  }
  return value;
}

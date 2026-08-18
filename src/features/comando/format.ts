/**
 * M7 - Quadro de Comando — helpers de formatação compartilhados entre a tela
 * interna (/comando) e a geração de PDF do formulário respondido.
 */

export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function humanizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => humanizeValue(v)).filter((v): v is string => !!v);
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    // Objeto aninhado inesperado — mostra como JSON compacto.
    try {
      const json = JSON.stringify(value);
      return json === "{}" ? null : json;
    } catch {
      return null;
    }
  }
  return String(value);
}

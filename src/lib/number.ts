/** Converte string numérica em formato pt-BR para number.
 *
 *  O padrão anterior — `Number(s.replace(",", "."))` — quebrava com separador
 *  de milhar: "1.234,56" virava "1.234.56" → NaN → gravado como null no banco
 *  (fornecedor com preço digitado ficava "sem proposta" na escolha do vencedor).
 *
 *  Regras:
 *  - "1.234,56" → 1234.56 (ponto de milhar removido, vírgula vira decimal)
 *  - "1234,56"  → 1234.56
 *  - "1234.56"  → 1234.56 (formato en já aceito — ponto único com casa decimal)
 *  - "1.234"    → 1234    (ponto seguido de exatamente 3 dígitos no fim = milhar)
 *  - "R$ 1.234,56" / "1 234,56" → 1234.56 (moeda/espaços ignorados)
 *  - vazio/inválido → null
 */
export function parseBRLNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  let s = value.trim();
  if (!s) return null;

  // Remove símbolo de moeda e espaços (inclusive NBSP do toLocaleString).
  s = s.replace(/R\$\s?/i, "").replace(/[\s ]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma) {
    // Vírgula presente = decimal pt-BR; todos os pontos são milhar.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0)) {
      // "1.234.567" ou "1.234" → pontos são separador de milhar.
      s = s.replace(/\./g, "");
    }
    // Senão ("1234.56", ".5", "12.3") → ponto já é decimal, mantém.
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

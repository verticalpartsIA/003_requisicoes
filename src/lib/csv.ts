/**
 * Escapa um campo de CSV separado por `;` (padrão do Excel pt-BR): envolve em
 * aspas e dobra as aspas internas sempre que o valor contém `;`, aspas ou
 * quebra de linha — sem isso um título com `;` deslocava todas as colunas
 * seguintes da linha.
 */
export function csvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta uma linha de CSV `;` com cada campo escapado. */
export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(";");
}

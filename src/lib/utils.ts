import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Faz parse de uma string de data "YYYY-MM-DD" (ou um ISO completo, usando só
 * a parte da data) como data LOCAL (meia-noite local), evitando o bug
 * clássico de `new Date("YYYY-MM-DD")` — o ECMAScript interpreta strings
 * "date-only" como UTC, então em fusos negativos (Brasil, UTC-3) a data
 * "volta" um dia quando reaberta para edição/exibição com métodos que usam
 * o fuso local (Calendar, date-fns `format`). Usar sempre que reidratar uma
 * data salva no banco (module_data.*_date, desired_date) de volta num
 * componente de calendário — nunca `new Date(str)` diretamente.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

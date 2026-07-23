import { cn } from "@/lib/utils";

/**
 * Style guide reutilizável para grades de itens (estilo planilha) usadas em
 * telas de detalhe/edição do M1 (Produtos, Movimentações, Gestor, Cotação
 * etc.) e espelhado nos PDFs (ver src/features/pdf/template.ts, que usa os
 * mesmos tons em estilo inline por rodar fora do Tailwind). Zebra striping,
 * cabeçalho contrastado, bordas leves e alinhamento numérico à direita —
 * um único lugar para manter telas e documentos consistentes entre si.
 */
export const excelTable = {
  wrapper: "rounded-lg border border-border overflow-hidden",
  // Classe estática (Tailwind precisa do valor literal para gerar o CSS).
  scrollBody: "overflow-y-auto max-h-[420px]",
  table: "w-full text-xs",
  thead: "sticky top-0 z-10 bg-muted",
  headRow: "border-b border-border",
  th: "text-left p-2 font-semibold text-foreground uppercase tracking-wide text-[10px]",
  thRight: "text-right p-2 font-semibold text-foreground uppercase tracking-wide text-[10px]",
  row: (i: number) => cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/30"),
  td: "p-2 align-top",
  tdRight: "p-2 align-top text-right font-semibold tabular-nums",
  footer: "border-t border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
};

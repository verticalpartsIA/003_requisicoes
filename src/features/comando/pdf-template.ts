// M7 - Quadro de Comando — template HTML do PDF do formulário respondido pelo
// cliente. Segue o mesmo estilo visual do PDF de requisições
// (src/features/pdf/template.ts), mas com o conteúdo específico do M7.

import { humanizeKey, humanizeValue } from "@/features/comando/format";
import {
  COMANDO_SECOES,
  COMANDO_STATUS_LABELS,
  type ComandoAnexo,
  type ComandoPedido,
} from "@/features/comando/types";

const ANEXO_LABELS: Record<string, string> = {
  motor_plaqueta1: "Foto da Plaqueta do Motor",
  motor_plaqueta2: "Foto Adicional da Plaqueta",
  encoder_foto1: "Foto do Encoder",
  encoder_foto2: "Foto da Plaqueta / Etiqueta do Encoder",
  botoeira_logo: "Arquivo do Logo",
};

export interface BuildComandoPdfInput {
  pedido: ComandoPedido;
  anexos: ComandoAnexo[];
  imageUrls: Record<string, string>;
}

export function buildComandoPdfHtml(d: BuildComandoPdfInput): string {
  const { pedido, anexos, imageUrls } = d;
  const f = (v: unknown) => (v != null && v !== "" ? String(v) : "—");
  const fDate = (v: unknown) => {
    if (!v) return "—";
    try {
      return new Date(String(v)).toLocaleString("pt-BR");
    } catch {
      return f(v);
    }
  };
  const now = new Date().toLocaleString("pt-BR");

  const sectionHead = (title: string) =>
    `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #e5e7eb;">${title}</div>`;

  const fld = (label: string, value: string) =>
    `<div style="margin-bottom:5px;"><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px;">${label}</div><div style="font-size:11.5px;font-weight:500;color:#111827;word-break:break-word;white-space:pre-wrap;">${value}</div></div>`;

  const grid2 = (...items: string[]) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${items.join("")}</div>`;

  const card = (content: string) =>
    `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:7px;padding:12px;margin-bottom:8px;">${content}</div>`;

  const imgBox = (url: string, alt: string) =>
    `<div style="margin-top:8px;display:inline-block;margin-right:10px;"><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;margin-bottom:4px;">${alt}</div><img src="${url}" alt="${alt}" crossorigin="anonymous" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid #e5e7eb;object-fit:cover;"/></div>`;

  // ─ Cabeçalho do pedido ───────────────────────────────────────────────────

  const header = `
  ${card(`
    <div style="font-size:14px;font-weight:700;margin-bottom:8px;">${f(pedido.cliente_nome)}</div>
    ${grid2(fld("Telefone", f(pedido.cliente_telefone)), fld("E-mail", f(pedido.cliente_email)))}
    ${grid2(fld("Projeto", f(pedido.projeto_numero)), fld("Status", COMANDO_STATUS_LABELS[pedido.status]))}
    ${grid2(fld("Enviado em", fDate(pedido.enviado_at)), fld("Respondido em", fDate(pedido.respondido_at)))}
    ${pedido.observacoes_internas ? fld("Observações internas", f(pedido.observacoes_internas)) : ""}
  `)}`;

  // ─ Seções de respostas ───────────────────────────────────────────────────

  const respostas = pedido.respostas ?? {};

  const renderAndares = (value: Record<string, unknown>): string => {
    const rows = Object.entries(value)
      .filter(([, v]) => v != null && v !== "")
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([num, v]) => fld(`Distância — Pavimento ${num}`, `${f(v)} mm`))
      .join("");
    return rows;
  };

  const secoesHtml = COMANDO_SECOES.map((secao) => {
    const values = respostas[secao.key];
    if (!values || typeof values !== "object") return "";

    const entriesHtml: string[] = [];
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (k === "andares" && v && typeof v === "object") {
        const andaresHtml = renderAndares(v as Record<string, unknown>);
        if (andaresHtml) entriesHtml.push(andaresHtml);
        continue;
      }
      const humanized = humanizeValue(v);
      if (humanized !== null) entriesHtml.push(fld(humanizeKey(k), humanized));
    }
    if (entriesHtml.length === 0) return "";

    return `${sectionHead(secao.title)}${card(grid2(...entriesHtml))}`;
  }).join("");

  // ─ Anexos (fotos enviadas pelo cliente) ─────────────────────────────────

  let anexosHtml = "";
  if (anexos.length > 0) {
    const boxes = anexos
      .map((a) => {
        const label = (a.secao && ANEXO_LABELS[a.secao]) || a.file_name;
        const url = imageUrls[a.id];
        if (url) return imgBox(url, label);
        return fld(label, a.file_name);
      })
      .join("");
    anexosHtml = `${sectionHead(`Anexos (${anexos.length})`)}${card(boxes)}`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#111827; padding:32px 40px 24px; background:#fff; }
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #FFB800;padding-bottom:14px;margin-bottom:4px;">
  <div>
    <div style="font-size:24px;font-weight:900;letter-spacing:-1px;">Vertical<span style="color:#FFB800;">Parts</span></div>
    <div style="font-size:10px;color:#9ca3af;margin-top:3px;">Formulário de Pedido — Quadro de Comando de Elevador</div>
  </div>
  <div style="text-align:right;">
    <div style="background:#FFB800;color:#1A1A1A;font-weight:700;font-size:13px;padding:5px 14px;border-radius:5px;display:inline-block;">${f(pedido.numero_documento)}</div>
    <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${COMANDO_STATUS_LABELS[pedido.status]}</div>
  </div>
</div>

${header}
${secoesHtml}
${anexosHtml}

<div style="margin-top:24px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
  <span>VerticalParts — Quadro de Comando · Documento confidencial</span>
  <span>Gerado em: ${now}</span>
</div>
</body>
</html>`;
}

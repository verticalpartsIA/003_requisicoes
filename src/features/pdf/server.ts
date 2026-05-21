import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── Ambiente ─────────────────────────────────────────────────────────────────

const SUPA_URL  = () => process.env.VITE_SUPABASE_URL ?? "";
const SUPA_KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const RG_KEY    = () => process.env.REPORTGEN_API_KEY ?? "";
const RG_URL    = "https://reportgen.io/api/v1";

// ─── Supabase REST (service_role — bypassa RLS) ───────────────────────────────

async function db<T>(path: string): Promise<T | null> {
  const key = SUPA_KEY();
  if (!key) return null;
  try {
    const resp = await fetch(`${SUPA_URL()}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch { return null; }
}

// ─── Supabase Storage → Base64 data URI (para embutir no HTML do PDF) ───────

const MAX_IMAGE_BYTES = 1_500_000; // 1.5MB — limite de segurança para o fallback raw

async function fetchImageAsDataUri(bucket: string, path: string): Promise<string | null> {
  const key = SUPA_KEY();
  if (!key || !path) return null;
  try {
    // Tenta via Supabase Image Transform (reduz para 800px — plano Pro)
    // Garante payload pequeno independente do tamanho original do upload
    const transformUrl = `${SUPA_URL()}/storage/v1/render/image/authenticated/${bucket}/${path}?width=800&quality=80&resize=contain`;
    const tr = await fetch(transformUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (tr.ok) {
      const ct = tr.headers.get("content-type") ?? "image/jpeg";
      const buf = await tr.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      return `data:${ct};base64,${b64}`;
    }

    // Fallback: download original (plano Free ou transform indisponível)
    const resp = await fetch(`${SUPA_URL()}/storage/v1/object/${bucket}/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${ct};base64,${b64}`;
  } catch { return null; }
}

// ─── Tradução de ações de auditoria ──────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  REQUISITION_CREATED:   "Requisição criada",
  QUOTATION_STARTED:     "Cotação iniciada",
  QUOTATION_UPDATED:     "Cotação atualizada",
  SUPPLIER_ADDED:        "Fornecedor adicionado",
  SUPPLIER_UPDATED:      "Fornecedor atualizado",
  SUPPLIER_REMOVED:      "Fornecedor removido",
  WINNER_SELECTED:       "Fornecedor vencedor selecionado",
  APPROVAL_REQUESTED:    "Aprovação solicitada",
  APPROVAL_GRANTED:      "Aprovação concedida",
  APPROVAL_REJECTED:     "Aprovação rejeitada",
  PURCHASE_CONFIRMED:    "Compra confirmada",
  PURCHASE_UPDATED:      "Compra atualizada",
  RECEIPT_REGISTERED:    "Recebimento registrado",
  RECEIPT_UPDATED:       "Recebimento atualizado",
  STATUS_CHANGED:        "Status alterado",
  VPCLICK_TASK_CREATED:  "Tarefa criada no VPClick",
  NOTES_ADDED:           "Observação adicionada",
};

function actionLabel(action: string, details?: Record<string, unknown>): string {
  const base = ACTION_LABELS[action] ?? action.replace(/_/g, " ");
  if (action === "STATUS_CHANGED" && details?.to_status)
    return `${base} → ${String(details.to_status)}`;
  return base;
}

// ─── Builder HTML ─────────────────────────────────────────────────────────────

interface BuildInput {
  req: Record<string, unknown>;
  suppliers: Array<Record<string, unknown>>;
  winCriteria: string | null;
  approval: Record<string, unknown> | null;
  purchase: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  auditLogs: Array<Record<string, unknown>>;
  imageUrls: Record<string, string>;
}

function buildHtml(d: BuildInput): string {
  const f  = (v: unknown) => (v != null && v !== "" ? String(v) : "—");
  const fP = (v: unknown) =>
    v != null ? `R$&nbsp;${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";
  const fDate = (v: unknown) => {
    if (!v) return "—";
    try { return new Date(String(v)).toLocaleString("pt-BR"); } catch { return f(v); }
  };
  const now = new Date().toLocaleString("pt-BR");

  const MODULE_LABEL: Record<string, string> = {
    M1: "Produto", M2: "Viagem", M3: "Serviço",
    M4: "Manutenção", M5: "Frete", M6: "Locação",
  };
  const { req } = d;
  const module     = f(req.module);
  const modLabel   = MODULE_LABEL[module] ?? module;
  const ticket     = f(req.ticket_number);
  const status     = f(req.status);
  const moduleData = (req.module_data ?? {}) as Record<string, unknown>;

  // ─ Helpers HTML ────────────────────────────────────────────────────────────

  const stageTag = (label: string, bg: string, fg: string) =>
    `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${bg};color:${fg};font-size:9px;font-weight:700;margin-right:6px;">${label}</span>`;

  const sectionHead = (stage: string, bg: string, fg: string, title: string) =>
    `<div style="display:flex;align-items:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #e5e7eb;">${stageTag(stage, bg, fg)}${title}</div>`;

  const pill = (label: string, bg: string, fg: string) =>
    `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${bg};color:${fg};">${label}</span>`;

  const fld = (label: string, value: string) =>
    `<div style="margin-bottom:5px;"><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:1px;">${label}</div><div style="font-size:11.5px;font-weight:500;color:#111827;word-break:break-word;">${value}</div></div>`;

  const grid2 = (...items: string[]) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${items.join("")}</div>`;

  const card = (content: string, borderColor = "#e5e7eb", bgColor = "#f9fafb") =>
    `<div style="background:${bgColor};border:1px solid ${borderColor};border-radius:7px;padding:12px;margin-bottom:8px;">${content}</div>`;

  const imgBox = (url: string, alt: string) =>
    `<div style="margin-top:8px;"><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;margin-bottom:4px;">${alt}</div><img src="${url}" alt="${alt}" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid #e5e7eb;object-fit:cover;"/></div>`;

  // ─ V1 Requisição ───────────────────────────────────────────────────────────

  const v1 = `
  ${sectionHead("V1", "#dbeafe", "#1d4ed8", "Requisição")}
  ${card(`
    <div style="font-size:14px;font-weight:700;margin-bottom:5px;">${f(req.title)}</div>
    <div style="font-size:11.5px;color:#6b7280;margin-bottom:8px;">${f(req.description)}</div>
    ${req.justification ? `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:5px;padding:7px 10px;font-size:11px;margin-bottom:8px;"><strong>Justificativa:</strong> ${f(req.justification)}</div>` : ""}
    ${grid2(fld("Requisitante", f(req.requester_name)), fld("E-mail", f(req.requester_email)))}
    ${grid2(fld("Departamento", f(req.requester_department)), fld("Módulo", modLabel))}
    ${grid2(fld("Urgência", f(req.urgency)), fld("Data desejada", req.desired_date ? f(req.desired_date) : "—"))}
    ${grid2(fld("Criado em", fDate(req.created_at)), fld(req.completed_at ? "Concluído em" : "Status", req.completed_at ? fDate(req.completed_at) : status))}
  `)}`;

  // ─ Dados do Formulário (module_data) ───────────────────────────────────────

  let mdContent = "";
  if (module === "M1") {
    mdContent += grid2(fld("Quantidade", f(moduleData.quantity)), fld("Local de Entrega", f(moduleData.delivery_location)));
    if (moduleData.technical_specs) mdContent += fld("Especificações Técnicas", f(moduleData.technical_specs));
    if (moduleData.brand_preference || moduleData.model_reference)
      mdContent += grid2(fld("Marca Preferida", f(moduleData.brand_preference)), fld("Ref. Modelo", f(moduleData.model_reference)));
    if (moduleData.online_purchase_suggestion)
      mdContent += fld("Sugestão de Compra Online", f(moduleData.online_purchase_suggestion));
    const rl = moduleData.reference_links as string[] | undefined;
    if (rl?.length) mdContent += fld("Links de Referência", rl.join("<br/>"));
    if (d.imageUrls.photo) mdContent += imgBox(d.imageUrls.photo, "Foto do Produto");
  } else if (module === "M2") {
    const travelers = (moduleData.travelers ?? []) as Array<Record<string, unknown>>;
    if (travelers.length) {
      mdContent += `<div style="font-size:10px;font-weight:600;color:#374151;margin-bottom:6px;">Viajantes (${travelers.length})</div>`;
      travelers.forEach((t, i) => {
        mdContent += card(`
          <div style="font-size:12px;font-weight:600;">${i + 1}. ${f(t.fullName)}</div>
          ${grid2(fld("Tipo de documento", f(t.docType)), fld("Número", f(t.docNumber)))}
          ${d.imageUrls[`traveler_${i}`] ? imgBox(d.imageUrls[`traveler_${i}`], "Documento") : ""}
        `);
      });
    } else {
      mdContent += fld("Viajante", f(moduleData.traveler_name));
    }
    if (moduleData.destination)  mdContent += fld("Destino", f(moduleData.destination));
    if (moduleData.trip_reason)  mdContent += fld("Motivo", f(moduleData.trip_reason));
  } else if (module === "M5") {
    if (moduleData.cargo_description)     mdContent += fld("Descrição da Carga", f(moduleData.cargo_description));
    if (moduleData.unloading_location)    mdContent += fld("Local de Descarregamento", f(moduleData.unloading_location));
    if (moduleData.cargo_photo_description) mdContent += fld("Obs. da Foto", f(moduleData.cargo_photo_description));
    if (d.imageUrls.cargo) mdContent += imgBox(d.imageUrls.cargo, "Foto da Carga");
  } else if (module === "M6") {
    const cats = (moduleData.categories ?? []) as string[];
    if (cats.length) mdContent += fld("Categorias", cats.join(" + "));
    if (moduleData.specs) mdContent += fld("Especificações", f(moduleData.specs));
    mdContent += grid2(fld("Quantidade", f(moduleData.quantity)), fld("Dias de Locação", f(moduleData.rental_days)));
    mdContent += grid2(fld("Início", f(moduleData.start_date)), fld("Término", f(moduleData.end_date)));
    if (moduleData.delivery_location) mdContent += fld("Local de Entrega", f(moduleData.delivery_location));
  } else {
    // Generic: render every non-empty field
    Object.entries(moduleData).forEach(([k, v]) => {
      if (v && k !== "photo_path" && k !== "cargo_photo_path")
        mdContent += fld(k.replace(/_/g, " "), Array.isArray(v) ? v.join(", ") : f(v));
    });
  }

  const mdSection = mdContent
    ? `${sectionHead("M", "#f3f4f6", "#374151", `${modLabel} — Dados do Formulário`)}${card(mdContent)}`
    : "";

  // ─ V2 Cotação (todos os fornecedores) ─────────────────────────────────────

  let v2Section = "";
  if (d.suppliers.length > 0) {
    const received = d.suppliers.filter(s => s.proposal_received).length;
    const cards = d.suppliers.map(s => {
      const win = !!s.is_winner;
      return card(`
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
          <strong style="font-size:12px;">${f(s.supplier_name)}</strong>
          ${win
            ? pill("✓ Vencedor", "#d1fae5", "#065f46")
            : pill("Não selecionado", "#f3f4f6", "#6b7280")}
        </div>
        ${grid2(fld("Preço", fP(s.price)), fld("Prazo", f(s.deadline)))}
        ${grid2(fld("Proposta", s.proposal_received ? "Recebida" : "Pendente"), fld("Observações", f(s.notes)))}
      `, win ? "#86efac" : "#e5e7eb", win ? "#f0fdf4" : "#fafafa");
    }).join("");

    v2Section = `
    ${sectionHead("V2", "#fef3c7", "#b45309",
      `Cotação — ${d.suppliers.length} fornecedor${d.suppliers.length !== 1 ? "es" : ""} · ${received} proposta${received !== 1 ? "s" : ""} recebida${received !== 1 ? "s" : ""}`)}
    ${cards}
    ${d.winCriteria ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px;font-size:11px;color:#b45309;margin-top:4px;"><strong>Critério de seleção:</strong> ${d.winCriteria}</div>` : ""}`;
  }

  // ─ V3 Aprovação ────────────────────────────────────────────────────────────

  let v3Section = "";
  if (d.approval) {
    const a   = d.approval;
    const dec = f(a.decision);
    const [decLabel, decBg, decFg, borderC] =
      dec === "approved" ? ["Aprovado",  "#d1fae5", "#065f46", "#86efac"] :
      dec === "rejected" ? ["Rejeitado", "#fee2e2", "#991b1b", "#fca5a5"] :
                           ["Pendente",  "#f3f4f6", "#6b7280", "#e5e7eb"];
    v3Section = `
    ${sectionHead("V3", "#ede9fe", "#7c3aed", "Aprovação")}
    ${card(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Nível ${f(a.approval_level)}</strong>
        ${pill(decLabel, decBg, decFg)}
      </div>
      ${grid2(fld("Valor Total", fP(a.total_value)), fld("Data da Decisão", fDate(a.decided_at)))}
      ${a.approver_name ? fld("Aprovador", f(a.approver_name)) : ""}
      ${a.justification ? fld("Justificativa", f(a.justification)) : ""}
    `, borderC)}`;
  }

  // ─ V4 Compra ───────────────────────────────────────────────────────────────

  let v4Section = "";
  if (d.purchase) {
    const p = d.purchase;
    v4Section = `
    ${sectionHead("V4", "#dbeafe", "#1d4ed8", "Compra")}
    ${card(`
      ${fld("Fornecedor", f(p.supplier_name))}
      ${grid2(fld("Valor Pago", fP(p.supplier_price)), fld("Forma de Pagamento", f(p.payment_method)))}
      ${grid2(fld("Nº Pedido / NF", f(p.purchase_order_number)), fld("Data da Compra", fDate(p.purchased_at)))}
      ${p.notes ? fld("Observações", f(p.notes)) : ""}
    `)}`;
  }

  // ─ V5 Recebimento ──────────────────────────────────────────────────────────

  let v5Section = "";
  if (d.receipt) {
    const r = d.receipt;
    const cond = f(r.condition);
    const [condLabel, condBg, condFg, condBorder] =
      cond === "ok"       ? ["OK — Conforme", "#d1fae5", "#065f46", "#86efac"] :
      cond === "damaged"  ? ["Danificado",    "#fee2e2", "#991b1b", "#fca5a5"] :
                            ["Divergente",    "#fef3c7", "#b45309", "#fde68a"];
    v5Section = `
    ${sectionHead("V5", "#d1fae5", "#065f46", "Recebimento")}
    ${card(`
      <div style="margin-bottom:8px;">${pill(condLabel, condBg, condFg)}</div>
      ${grid2(fld("Entregador", f(r.deliverer_name)), fld("Data de Recebimento", fDate(r.received_at)))}
      ${r.notes ? fld("Observações", f(r.notes)) : ""}
    `, condBorder)}`;
  }

  // ─ Histórico de Ações ──────────────────────────────────────────────────────

  let histSection = "";
  if (d.auditLogs.length > 0) {
    const entries = d.auditLogs.map(l => {
      const det = (l.details ?? {}) as Record<string, unknown>;
      const detKeys = Object.keys(det).filter(k => k !== "stage" && k !== "vpclick_task_id");
      const detText = detKeys.length
        ? detKeys.map(k => `${k}: ${f(det[k])}`).join(" · ")
        : "";
      return `<div style="padding:5px 0 5px 12px;border-left:2px solid #FFB800;margin-bottom:5px;">
        <div style="font-size:11px;font-weight:600;">${actionLabel(f(l.action), det)}</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${f(l.actor_name)} · ${fDate(l.created_at)}</div>
        ${detText ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${detText}</div>` : ""}
      </div>`;
    }).join("");
    histSection = `
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #e5e7eb;">
      Histórico de Ações (${d.auditLogs.length})
    </div>
    ${entries}`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#111827; padding:32px 40px 24px; }
</style>
</head>
<body>
<!-- Cabeçalho -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #FFB800;padding-bottom:14px;margin-bottom:4px;">
  <div>
    <div style="font-size:24px;font-weight:900;letter-spacing:-1px;">Vertical<span style="color:#FFB800;">Parts</span></div>
    <div style="font-size:10px;color:#9ca3af;margin-top:3px;">Sistema de Requisições — Histórico Completo</div>
  </div>
  <div style="text-align:right;">
    <div style="background:#FFB800;color:#1A1A1A;font-weight:700;font-size:13px;padding:5px 14px;border-radius:5px;display:inline-block;">${ticket}</div>
    <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${modLabel} · ${status}</div>
  </div>
</div>

${v1}
${mdSection}
${v2Section}
${v3Section}
${v4Section}
${v5Section}
${histSection}

<!-- Rodapé -->
<div style="margin-top:24px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
  <span>VerticalParts — VPRequisições · Documento confidencial</span>
  <span>Gerado em: ${now}</span>
</div>
</body>
</html>`;
}

// ─── Server function principal ────────────────────────────────────────────────

export const generateRequisitionPdf = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ticketNumber: z.string() }))
  .handler(async ({ data }) => {
    const apiKey = RG_KEY();
    if (!apiKey) throw new Error("REPORTGEN_API_KEY não configurada no servidor.");

    // 1. Requisição
    const reqs = await db<Array<Record<string, unknown>>>(
      `requisitions?ticket_number=eq.${encodeURIComponent(data.ticketNumber)}&select=*&limit=1`,
    );
    const req = reqs?.[0];
    if (!req) throw new Error(`Requisição ${data.ticketNumber} não encontrada.`);
    const reqId = req.id as string;

    // 2. Cotação + todos os fornecedores (incluindo quem perdeu)
    const quots = await db<Array<Record<string, unknown>>>(
      `quotations?requisition_id=eq.${reqId}&select=*,quotation_suppliers(*)&limit=1`,
    );
    const quot = quots?.[0] ?? null;
    const suppliersRaw = ((quot?.quotation_suppliers ?? []) as Array<Record<string, unknown>>)
      .sort((a, b) => (a.is_winner ? -1 : 1) - (b.is_winner ? -1 : 1)); // vencedor primeiro
    const winCriteria = (quot?.win_criteria ?? null) as string | null;

    // 3. Aprovação
    const apprs = await db<Array<Record<string, unknown>>>(
      `approvals?requisition_id=eq.${reqId}&select=*&order=created_at.desc&limit=1`,
    );
    const approval = apprs?.[0] ?? null;

    // 4. Compra
    const purchs = await db<Array<Record<string, unknown>>>(
      `purchases?requisition_id=eq.${reqId}&select=*&limit=1`,
    );
    const purchase = purchs?.[0] ?? null;

    // 5. Recebimento
    const recs = await db<Array<Record<string, unknown>>>(
      `receipts?requisition_id=eq.${reqId}&select=*&limit=1`,
    );
    const receipt = recs?.[0] ?? null;

    // 6. Logs de auditoria (ordem cronológica)
    const auditLogs = (await db<Array<Record<string, unknown>>>(
      `audit_logs?ticket_number=eq.${encodeURIComponent(data.ticketNumber)}&select=*&order=created_at.asc`,
    )) ?? [];

    // 7. URLs assinadas para imagens
    const moduleData = (req.module_data ?? {}) as Record<string, unknown>;
    const imageUrls: Record<string, string> = {};

    if (req.module === "M1" && moduleData.photo_path) {
      const uri = await fetchImageAsDataUri("travel-docs", String(moduleData.photo_path));
      if (uri) imageUrls.photo = uri;
    }
    if (req.module === "M5" && moduleData.cargo_photo_path) {
      const uri = await fetchImageAsDataUri("travel-docs", String(moduleData.cargo_photo_path));
      if (uri) imageUrls.cargo = uri;
    }
    if (req.module === "M2") {
      const travelers = (moduleData.travelers ?? []) as Array<Record<string, unknown>>;
      for (let i = 0; i < travelers.length; i++) {
        const photoPath = travelers[i].docPhotoPath ?? travelers[i].doc_photo_path;
        if (photoPath) {
          const uri = await fetchImageAsDataUri("travel-docs", String(photoPath));
          if (uri) imageUrls[`traveler_${i}`] = uri;
        }
      }
    }

    // 8. Gerar HTML
    const html = buildHtml({
      req, suppliers: suppliersRaw, winCriteria,
      approval, purchase, receipt,
      auditLogs, imageUrls,
    });

    // 9. Enviar para reportgen.io
    const genResp = await fetch(`${RG_URL}/generate-pdf-async`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ html_template: html, engine: "raw" }),
    });

    if (!genResp.ok) {
      const text = await genResp.text().catch(() => "");
      if (genResp.status === 401)
        throw new Error("reportgen.io: chave de API inválida. Verifique REPORTGEN_API_KEY.");
      throw new Error(`reportgen.io error ${genResp.status}: ${text}`);
    }

    const genJson = (await genResp.json()) as Record<string, unknown>;
    const inner = (genJson.data ?? genJson) as Record<string, unknown>;
    const report_id = (inner.report_id ?? inner.id ?? genJson.report_id ?? genJson.id ?? "") as string;
    if (!report_id)
      throw new Error(`reportgen.io não retornou report_id. Resposta: ${JSON.stringify(genJson)}`);

    console.log(`[pdf] report_id=${report_id} gerado. Iniciando polling...`);

    // 10. Polling do PDF gerado
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const dlResp = await fetch(`${RG_URL}/reports/${report_id}/download`, {
        headers: { "X-API-Key": apiKey },
      });
      if (dlResp.ok) {
        const ct = dlResp.headers.get("content-type") ?? "";
        if (ct.includes("application/pdf"))
          return { base64: Buffer.from(await dlResp.arrayBuffer()).toString("base64") };
        const dlJson = (await dlResp.json()) as Record<string, unknown>;
        const pdfData = (dlJson.data ?? dlJson.url ?? "") as string;
        if (!pdfData) throw new Error(`reportgen.io sem dados. ${JSON.stringify(dlJson)}`);
        if (pdfData.startsWith("http"))
          return { base64: Buffer.from(await (await fetch(pdfData)).arrayBuffer()).toString("base64") };
        return { base64: pdfData };
      }
      if (dlResp.status !== 404 && dlResp.status !== 202) {
        const body = await dlResp.text().catch(() => "");
        throw new Error(`reportgen.io download error ${dlResp.status}: ${body}`);
      }
    }

    throw new Error("PDF generation timed out. Tente novamente.");
  });

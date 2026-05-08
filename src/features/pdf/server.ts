import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function reportgenKey() {
  return process.env.REPORTGEN_API_KEY ?? "I4V9GcdvG9KcAZu8n7qw0_cNBUGwKTdPiIfmnYTqao8=";
}
const REPORTGEN_URL = "https://reportgen.io/api/v1";

function buildHtml(detail: Record<string, unknown>): string {
  const f = (v: unknown) => (v != null && v !== "" ? String(v) : "—");
  const fPrice = (v: unknown) =>
    v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";

  const ticket = f(detail.ticket_id);
  const module = f(detail.module);
  const status = f(detail.status);
  const title = f(detail.title);
  const description = f(detail.description);
  const justification = f(detail.justification);
  const requesterName = f(detail.requester_name);
  const requesterDept = f(detail.requester_department);
  const createdAt = f(detail.created_at);
  const completedAt = f(detail.completed_at);
  const now = new Date().toLocaleString("pt-BR");

  const suppliers = (detail.suppliers as Array<Record<string, unknown>>) ?? [];
  const winCriteria = f(detail.win_criteria);
  const approvalDecision = detail.approval_decision as string | null;
  const approvalLevel = detail.approval_level;
  const approvalValue = detail.approval_value;
  const approvalDate = f(detail.approval_decided_at);
  const approvalJust = f(detail.approval_justification);
  const purchaseSupplier = detail.purchase_supplier as string | null;
  const purchasePrice = detail.purchase_price;
  const purchaseOrder = f(detail.purchase_order_number);
  const paymentMethod = f(detail.payment_method);
  const purchasedAt = f(detail.purchased_at);
  const receiptCondition = detail.receipt_condition as string | null;
  const delivererName = f(detail.deliverer_name);
  const receivedAt = f(detail.received_at);
  const receiptNotes = f(detail.receipt_notes);
  const auditLogs = (detail.ticket_audit_logs as Array<Record<string, unknown>>) ?? [];
  const moduleData = detail.module_data as Record<string, unknown> | null;

  const moduleLabel: Record<string, string> = {
    M1: "Produto", M2: "Viagem", M3: "Serviço",
    M4: "Manutenção", M5: "Frete", M6: "Locação",
  };

  function decisionBadge(d: string | null) {
    if (!d) return "";
    if (d === "approved") return `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">Aprovado</span>`;
    if (d === "rejected") return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">Rejeitado</span>`;
    return `<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:20px;font-size:11px;">Pendente</span>`;
  }

  function receiptBadge(c: string | null) {
    if (c === "ok") return `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">OK — Conforme</span>`;
    if (c === "damaged") return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">Danificado</span>`;
    if (c) return `<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">Divergente</span>`;
    return "";
  }

  function sectionHeader(stage: string, color: string, bg: string, label: string) {
    return `
    <div style="display:flex;align-items:center;gap:8px;margin:24px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${bg};color:${color};font-size:10px;font-weight:700;">${stage}</span>
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">${label}</span>
    </div>`;
  }

  function field(label: string, value: string) {
    return `<div style="margin-bottom:6px;"><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">${label}</div><div style="font-size:12px;font-weight:500;color:#111827;">${value}</div></div>`;
  }

  function twoCol(a: string, b: string) {
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px;">${a}${b}</div>`;
  }

  // ── Module-specific data section ────────────────────────────────────────────
  let moduleDataSection = "";
  if (moduleData && Object.keys(moduleData).length > 0) {
    const rows: string[] = [];

    if (module === "M1") {
      if (moduleData.quantity) rows.push(twoCol(field("Quantidade", f(moduleData.quantity)), field("Local de Entrega", f(moduleData.delivery_location))));
      if (moduleData.technical_specs) rows.push(field("Especificações Técnicas", f(moduleData.technical_specs)));
      if (moduleData.brand_preference) rows.push(twoCol(field("Preferência de Marca", f(moduleData.brand_preference)), field("Referência de Modelo", f(moduleData.model_reference))));
      if (moduleData.online_purchase_suggestion) rows.push(field("Sugestão de Compra Online", f(moduleData.online_purchase_suggestion)));
    } else if (module === "M2") {
      const travelers = (moduleData.travelers as Array<Record<string, unknown>>) ?? [];
      if (travelers.length > 0) {
        rows.push(`<div style="font-size:10px;font-weight:600;color:#374151;margin-bottom:6px;">Viajantes (${travelers.length})</div>`);
        travelers.forEach((t, i) => {
          rows.push(`<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin-bottom:6px;">
            <div style="font-size:11px;font-weight:600;">${i + 1}. ${f(t.fullName)}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:2px;">${f(t.docType)}: ${f(t.docNumber)}</div>
          </div>`);
        });
      } else if (moduleData.traveler_name) {
        rows.push(field("Viajante", f(moduleData.traveler_name)));
      }
    } else if (module === "M5") {
      if (moduleData.cargo_description) rows.push(field("Descrição da Carga", f(moduleData.cargo_description)));
      if (moduleData.unloading_location) rows.push(field("Local de Descarregamento", f(moduleData.unloading_location)));
      if (moduleData.cargo_photo_description) rows.push(field("Observação da Foto", f(moduleData.cargo_photo_description)));
    } else if (module === "M6") {
      const cats = (moduleData.categories as string[]) ?? (moduleData.category ? [String(moduleData.category)] : []);
      if (cats.length > 0) rows.push(field("Categorias", cats.join(" + ")));
      if (moduleData.specs) rows.push(field("Especificações", f(moduleData.specs)));
      rows.push(twoCol(field("Quantidade", f(moduleData.quantity)), field("Dias de Locação", f(moduleData.rental_days))));
      rows.push(twoCol(field("Início", f(moduleData.start_date)), field("Término", f(moduleData.end_date))));
      if (moduleData.delivery_location) rows.push(field("Local de Entrega", f(moduleData.delivery_location)));
    }

    if (rows.length > 0) {
      moduleDataSection = `
      ${sectionHeader("M", "#4b5563", "#f3f4f6", `Dados do Formulário — ${moduleLabel[module] ?? module}`)}
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
        ${rows.join("")}
      </div>`;
    }
  }

  // ── Suppliers section ───────────────────────────────────────────────────────
  let suppliersSection = "";
  if (suppliers.length > 0) {
    const supplierCards = suppliers.map((s) => {
      const winner = s.is_winner;
      return `<div style="background:${winner ? "#f0fdf4" : "#f9fafb"};border:1px solid ${winner ? "#86efac" : "#e5e7eb"};border-radius:6px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:600;color:#111827;">${f(s.name)}</span>
          ${winner ? `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">✓ Vencedor</span>` : ""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;color:#6b7280;">
          <span>Preço: <strong style="color:${winner ? "#065f46" : "#111827"};">${fPrice(s.price)}</strong></span>
          <span>Prazo: <strong style="color:#111827;">${f(s.deadline)}</strong></span>
          <span>Proposta: <strong style="color:#111827;">${s.proposal_received ? "Recebida" : "Pendente"}</strong></span>
        </div>
        ${s.notes ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;font-style:italic;">${f(s.notes)}</div>` : ""}
      </div>`;
    }).join("");

    suppliersSection = `
    ${sectionHeader("V2", "#b45309", "#fef3c7", `Cotação — ${suppliers.length} fornecedor${suppliers.length !== 1 ? "es" : ""}`)}
    ${supplierCards}
    ${winCriteria !== "—" ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px;font-size:11px;color:#b45309;"><strong>Critério:</strong> ${winCriteria}</div>` : ""}`;
  }

  // ── Approval section ────────────────────────────────────────────────────────
  let approvalSection = "";
  if (approvalDecision) {
    approvalSection = `
    ${sectionHeader("V3", "#7c3aed", "#ede9fe", "Aprovação")}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:600;">Nível ${approvalLevel ?? "—"}</span>
        ${decisionBadge(approvalDecision)}
      </div>
      ${twoCol(field("Valor Total", fPrice(approvalValue)), field("Data da Decisão", approvalDate))}
      ${approvalJust !== "—" ? field("Justificativa", approvalJust) : ""}
    </div>`;
  }

  // ── Purchase section ────────────────────────────────────────────────────────
  let purchaseSection = "";
  if (purchaseSupplier) {
    purchaseSection = `
    ${sectionHeader("V4", "#1d4ed8", "#dbeafe", "Compra")}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;">
      ${field("Fornecedor", purchaseSupplier)}
      ${twoCol(field("Valor Pago", fPrice(purchasePrice)), field("Forma de Pagamento", paymentMethod))}
      ${twoCol(field("Nº Pedido", purchaseOrder), field("Data da Compra", purchasedAt))}
    </div>`;
  }

  // ── Receipt section ─────────────────────────────────────────────────────────
  let receiptSection = "";
  if (receiptCondition) {
    receiptSection = `
    ${sectionHeader("V5", "#065f46", "#d1fae5", "Recebimento")}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;">
      <div style="margin-bottom:8px;">${receiptBadge(receiptCondition)}</div>
      ${twoCol(field("Entregador", delivererName), field("Data de Recebimento", receivedAt))}
      ${receiptNotes !== "—" ? field("Observações", receiptNotes) : ""}
    </div>`;
  }

  // ── Audit log section ───────────────────────────────────────────────────────
  let auditSection = "";
  if (auditLogs.length > 0) {
    const logEntries = auditLogs.map((l) =>
      `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;display:flex;gap:12px;align-items:flex-start;">
        <div style="width:1px;background:#e5e7eb;margin-top:4px;"></div>
        <div>
          <div style="font-size:11px;font-weight:600;color:#111827;">${f(l.action).replace(/_/g, " ")}</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${f(l.actor_name)} · ${f(l.created_at)}</div>
        </div>
      </div>`
    ).join("");

    auditSection = `
    <div style="margin-top:24px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Histórico de Ações</span>
    </div>
    ${logEntries}`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#111827; background:#fff; padding:40px; }
</style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #FFB800;padding-bottom:16px;margin-bottom:24px;">
    <div>
      <div style="font-size:26px;font-weight:900;letter-spacing:-1px;line-height:1;">Vertical<span style="color:#FFB800;">Parts</span></div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px;">Sistema de Requisições</div>
    </div>
    <div style="text-align:right;">
      <div style="background:#FFB800;color:#1A1A1A;font-weight:700;font-size:14px;padding:6px 14px;border-radius:6px;display:inline-block;">${ticket}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${moduleLabel[module] ?? module} · ${status}</div>
    </div>
  </div>

  <!-- V1 Requisição -->
  ${sectionHeader("V1", "#1d4ed8", "#dbeafe", "Requisição")}
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
    <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">${title}</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">${description}</div>
    ${justification !== "—" ? `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px;font-size:11px;color:#6b7280;margin-bottom:8px;"><strong style="color:#374151;">Justificativa:</strong> ${justification}</div>` : ""}
    ${twoCol(field("Requisitante", requesterName), field("Departamento", requesterDept))}
    ${twoCol(field("Criado em", createdAt), field(completedAt !== "—" ? "Concluído em" : "Status", completedAt !== "—" ? completedAt : status))}
  </div>

  ${moduleDataSection}
  ${suppliersSection}
  ${approvalSection}
  ${purchaseSection}
  ${receiptSection}
  ${auditSection}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
    <span>VerticalParts — VPRequisições · Documento confidencial</span>
    <span>Gerado em: ${now}</span>
  </div>
</body>
</html>`;
}

export const generateRequisitionPdf = createServerFn({ method: "POST" })
  .inputValidator(z.object({ detail: z.string() }))
  .handler(async ({ data }) => {
    const detail = JSON.parse(data.detail) as Record<string, unknown>;
    const html = buildHtml(detail);

    const apiKey = reportgenKey();
    if (!apiKey) throw new Error("REPORTGEN_API_KEY não configurada no servidor.");

    const genResp = await fetch(`${REPORTGEN_URL}/generate-pdf-async`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ html_template: html, engine: "raw" }),
    });

    if (!genResp.ok) {
      const text = await genResp.text().catch(() => "");
      if (genResp.status === 401) {
        throw new Error("reportgen.io: chave de API inválida ou expirada. Verifique REPORTGEN_API_KEY nas variáveis de ambiente.");
      }
      throw new Error(`reportgen.io error ${genResp.status}: ${text}`);
    }

    const genJson = (await genResp.json()) as Record<string, unknown>;
    // Support nested { data: { report_id } } or flat { report_id } or { id }
    const inner = (genJson.data ?? genJson) as Record<string, unknown>;
    const report_id = (inner.report_id ?? inner.id ?? genJson.report_id ?? genJson.id ?? "") as string;
    if (!report_id) throw new Error(`reportgen.io não retornou report_id. Resposta: ${JSON.stringify(genJson)}`);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const dlResp = await fetch(`${REPORTGEN_URL}/reports/${report_id}/download`, {
        headers: { "X-API-Key": apiKey },
      });
      if (dlResp.ok) {
        const contentType = dlResp.headers.get("content-type") ?? "";
        if (contentType.includes("application/pdf")) {
          // Raw PDF bytes
          const buffer = await dlResp.arrayBuffer();
          return { base64: Buffer.from(buffer).toString("base64") };
        }
        // JSON envelope — .data is a URL or base64 string
        const dlJson = (await dlResp.json()) as Record<string, unknown>;
        const pdfData = (dlJson.data ?? dlJson.url ?? "") as string;
        if (!pdfData) throw new Error(`reportgen.io download sem dados. Resposta: ${JSON.stringify(dlJson)}`);
        if (pdfData.startsWith("http")) {
          // Fetch the actual PDF from the URL
          const pdfResp = await fetch(pdfData);
          const buffer = await pdfResp.arrayBuffer();
          return { base64: Buffer.from(buffer).toString("base64") };
        }
        // Already base64
        return { base64: pdfData };
      }
      if (dlResp.status !== 404 && dlResp.status !== 202) {
        const errText = await dlResp.text().catch(() => "");
        throw new Error(`reportgen.io download error ${dlResp.status}: ${errText}`);
      }
    }

    throw new Error("PDF generation timed out. Tente novamente em alguns segundos.");
  });

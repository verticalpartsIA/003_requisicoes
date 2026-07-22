import { supabaseBrowser } from "@/lib/supabase-browser";
import { buildHtml, type BuildInput } from "./template";

const PDF_BUCKET = "requisition-pdfs";
const IMAGE_BUCKET = "travel-docs";

async function signedImageUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseBrowser.storage.from(IMAGE_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

async function fetchRequisitionPdfData(ticketNumber: string): Promise<BuildInput> {
  const { data: req, error: reqError } = await supabaseBrowser
    .from("requisitions")
    .select("*")
    .eq("ticket_number", ticketNumber)
    .maybeSingle();
  if (reqError) throw new Error(`Falha ao buscar requisição: ${reqError.message}`);
  if (!req) throw new Error(`Requisição ${ticketNumber} não encontrada.`);

  const [{ data: quot }, { data: approval }, { data: purchase }, { data: receipt }, { data: auditLogs }] =
    await Promise.all([
      supabaseBrowser
        .from("quotations")
        .select("win_criteria,quotation_suppliers(*)")
        .eq("requisition_id", req.id)
        .maybeSingle(),
      supabaseBrowser
        .from("approvals")
        .select("*")
        .eq("requisition_id", req.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseBrowser
        .from("purchases")
        .select("*")
        .eq("requisition_id", req.id)
        .maybeSingle(),
      supabaseBrowser
        .from("receipts")
        .select("*")
        .eq("requisition_id", req.id)
        .maybeSingle(),
      supabaseBrowser
        .from("audit_logs")
        .select("*")
        .eq("ticket_number", ticketNumber)
        .order("created_at", { ascending: true }),
    ]);

  const suppliersRaw = ((quot?.quotation_suppliers ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => (a.is_winner ? -1 : 1) - (b.is_winner ? -1 : 1)); // vencedor primeiro

  // URLs assinadas para imagens (bucket travel-docs)
  const moduleData = (req.module_data ?? {}) as Record<string, unknown>;
  const imageUrls: Record<string, string> = {};

  if (req.module === "M1") {
    const items = (moduleData.items ?? []) as Array<Record<string, unknown>>;
    if (items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const photoPath = items[i].photo_path as string | undefined;
        if (photoPath) {
          const url = await signedImageUrl(photoPath);
          if (url) imageUrls[`item_${i}`] = url;
        }
      }
    } else if (moduleData.photo_path) {
      const url = await signedImageUrl(String(moduleData.photo_path));
      if (url) imageUrls.photo = url;
    }
  }
  if (req.module === "M5" && moduleData.cargo_photo_path) {
    const url = await signedImageUrl(String(moduleData.cargo_photo_path));
    if (url) imageUrls.cargo = url;
  }
  if (req.module === "M2") {
    const travelers = (moduleData.travelers ?? []) as Array<Record<string, unknown>>;
    for (let i = 0; i < travelers.length; i++) {
      const photoPath = (travelers[i].docPhotoPath ?? travelers[i].doc_photo_path) as string | undefined;
      if (photoPath) {
        const url = await signedImageUrl(photoPath);
        if (url) imageUrls[`traveler_${i}`] = url;
      }
    }
  }

  return {
    req,
    suppliers: suppliersRaw,
    winCriteria: (quot?.win_criteria ?? null) as string | null,
    approval: approval ?? null,
    purchase: purchase ?? null,
    receipt: receipt ?? null,
    auditLogs: auditLogs ?? [],
    imageUrls,
  };
}

// A4 em pontos (72dpi): 595.28 x 841.89
const A4_WIDTH_PT = 595.28;
const RENDER_WIDTH_PX = 794; // ~A4 a 96dpi, usado como viewport de renderização

export async function renderHtmlToPdfBlob(html: string): Promise<Blob> {
  const [{ jsPDF }, html2canvasPro] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"), // suporta cores oklch/lab do CSS moderno (Tailwind v4); html2canvas puro não suporta
  ]);
  // jsPDF.html() procura window.html2canvas antes de tentar importar o pacote "html2canvas" (que não instalamos)
  (window as unknown as Record<string, unknown>).html2canvas = html2canvasPro.default;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${RENDER_WIDTH_PX}px`;
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Não foi possível preparar a área de renderização do PDF.");
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise<void>((resolve) => {
      if (doc.readyState === "complete") resolve();
      else iframe.addEventListener("load", () => resolve(), { once: true });
    });
    // Pequena espera para imagens (URLs assinadas) terminarem de carregar.
    await new Promise((r) => setTimeout(r, 300));

    // Renderiza como uma única imagem (altura ajustada ao conteúdo) em vez de usar
    // a paginação automática do jsPDF, que corta blocos com fundo colorido no meio
    // da página e deixa uma barra preta indevida.
    const html2canvas = html2canvasPro.default;
    const canvas = await html2canvas(doc.body, {
      useCORS: true,
      windowWidth: RENDER_WIDTH_PX,
      width: RENDER_WIDTH_PX,
      scale: 2,
    });

    const pageHeightPt = (A4_WIDTH_PT * canvas.height) / canvas.width;
    const pdf = new jsPDF({ unit: "pt", format: [A4_WIDTH_PT, pageHeightPt] });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_WIDTH_PT, pageHeightPt);

    return pdf.output("blob");
  } finally {
    document.body.removeChild(iframe);
  }
}

async function uploadRequisitionPdf(ticketNumber: string, blob: Blob): Promise<string> {
  const path = `${ticketNumber}.pdf`;
  const { error: uploadError } = await supabaseBrowser.storage
    .from(PDF_BUCKET)
    .upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`Falha ao salvar PDF no Supabase: ${uploadError.message}`);

  const { data, error: signError } = await supabaseBrowser.storage
    .from(PDF_BUCKET)
    .createSignedUrl(path, 3600);
  if (signError || !data) throw new Error(`Falha ao gerar link do PDF: ${signError?.message ?? "desconhecido"}`);

  return data.signedUrl;
}

export interface GeneratedPdf {
  blob: Blob;
  signedUrl: string;
}

export async function generateAndSaveRequisitionPdf(ticketNumber: string): Promise<GeneratedPdf> {
  const data = await fetchRequisitionPdfData(ticketNumber);
  const html = buildHtml(data);
  const blob = await renderHtmlToPdfBlob(html);
  const signedUrl = await uploadRequisitionPdf(ticketNumber, blob);
  return { blob, signedUrl };
}

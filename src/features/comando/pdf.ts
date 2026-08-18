// M7 - Quadro de Comando — geração do PDF do formulário respondido, 100% no
// navegador (mesmo mecanismo usado para o PDF de requisições em
// src/features/pdf/client.ts), sem depender de serviço externo.

import { supabaseBrowser } from "@/lib/supabase-browser";
import { renderHtmlToPdfBlob } from "@/features/pdf/client";
import { buildComandoPdfHtml } from "@/features/comando/pdf-template";
import type { ComandoAnexo, ComandoPedido } from "@/features/comando/types";

const ANEXOS_BUCKET = "comando-anexos";

function isImage(anexo: ComandoAnexo): boolean {
  return !!anexo.mime_type?.startsWith("image/");
}

async function signedAnexoUrl(path: string): Promise<string | null> {
  const { data } = await supabaseBrowser.storage.from(ANEXOS_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export async function generateComandoPdf(
  pedido: ComandoPedido,
  anexos: ComandoAnexo[],
): Promise<Blob> {
  const imageAnexos = anexos.filter(isImage);
  const signedUrls = await Promise.all(imageAnexos.map((a) => signedAnexoUrl(a.file_path)));

  const imageUrls: Record<string, string> = {};
  imageAnexos.forEach((a, i) => {
    const url = signedUrls[i];
    if (url) imageUrls[a.id] = url;
  });

  const html = buildComandoPdfHtml({ pedido, anexos, imageUrls });
  return renderHtmlToPdfBlob(html);
}

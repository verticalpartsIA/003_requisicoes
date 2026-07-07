import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function omieKey() { return process.env.OMIE_APP_KEY ?? "8463170967"; }
function omieSecret() { return process.env.OMIE_APP_SECRET ?? "69e22b773842044fdb218178521cac59"; }

async function omiePost<T>(endpoint: string, call: string, param: unknown[]): Promise<T> {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: omieKey(), app_secret: omieSecret(), param }),
  });
  const data = await resp.json() as { faultstring?: string } & T;
  if (data.faultstring) throw new Error(`Omie: ${data.faultstring}`);
  return data as T;
}

export const validateOmieOrder = createServerFn({ method: "POST" })
  .inputValidator(z.object({ numeroPedido: z.string().min(1) }))
  .handler(async ({ data }) => {
    type PedidoResp = {
      pedido_venda_produto: {
        cabecalho: { quantidade_itens: number };
        informacoes_adicionais: { codVend: number };
      };
    };

    const pedido = await omiePost<PedidoResp>("produtos/pedido", "ConsultarPedido", [
      { numero_pedido: data.numeroPedido },
    ]);

    const codVend = pedido.pedido_venda_produto?.informacoes_adicionais?.codVend;
    if (!codVend) throw new Error("Vendedor não identificado neste pedido.");

    type VendedorResp = { nome: string };
    const vendedor = await omiePost<VendedorResp>("geral/vendedores", "ConsultarVendedor", [
      { codigo: codVend },
    ]);

    if (!vendedor.nome) throw new Error("Nome do vendedor não retornado pelo Omie.");

    return {
      numeroPedido: data.numeroPedido,
      vendedor: vendedor.nome,
      quantidadeItens: pedido.pedido_venda_produto?.cabecalho?.quantidade_itens ?? 0,
    };
  });

export const validateOmieProduct = createServerFn({ method: "POST" })
  .inputValidator(z.object({ codigoProduto: z.string().min(1) }))
  .handler(async ({ data }) => {
    type ProdutoResp = {
      codigo_produto: number;
      codigo: string;
      descricao: string;
    };

    const produto = await omiePost<ProdutoResp>("geral/produtos", "ConsultarProduto", [
      { codigo: data.codigoProduto },
    ]);

    if (!produto.descricao) throw new Error("Produto não encontrado no Omie.");

    return {
      codigo: produto.codigo || data.codigoProduto,
      descricao: produto.descricao,
    };
  });

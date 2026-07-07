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

export interface OmieStockPosition {
  codigo: string;
  descricao: string;
  estoqueFisico: number;
  estoqueReservado: number;
  estoqueDisponivel: number;
  estoqueMinimo: number;
  /** Quanto ainda pode ser pedido sem passar do mínimo: max(0, mínimo - disponível). */
  quantidadeMaxima: number;
}

export const getOmieStockPosition = createServerFn({ method: "POST" })
  .inputValidator(z.object({ codigoProduto: z.string().min(1) }))
  .handler(async ({ data }): Promise<OmieStockPosition> => {
    type ProdutoResp = {
      codigo_produto: number;
      codigo: string;
      descricao: string;
      inativo: string;
    };
    const produto = await omiePost<ProdutoResp>("geral/produtos", "ConsultarProduto", [
      { codigo: data.codigoProduto },
    ]);
    if (!produto.descricao) throw new Error("Produto não encontrado no Omie.");
    if (produto.inativo === "S") throw new Error("Este produto está inativo no Omie.");

    type PosicaoResp = {
      fisico: number;
      reservado: number;
      estoque_minimo: number;
    };
    const hoje = new Date();
    const dataConsulta = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
    const posicao = await omiePost<PosicaoResp>("estoque/consulta", "PosicaoEstoque", [
      { id_prod: produto.codigo_produto, data: dataConsulta, apenas_saldo: "N" },
    ]);

    const fisico = posicao.fisico ?? 0;
    const reservado = posicao.reservado ?? 0;
    const disponivel = fisico - reservado;
    const minimo = posicao.estoque_minimo ?? 0;

    return {
      codigo: produto.codigo || data.codigoProduto,
      descricao: produto.descricao,
      estoqueFisico: fisico,
      estoqueReservado: reservado,
      estoqueDisponivel: disponivel,
      estoqueMinimo: minimo,
      quantidadeMaxima: Math.max(0, minimo - disponivel),
    };
  });

export interface OmieStockItem {
  codigo: string;
  descricao: string;
  estoqueMinimo: number;
  estoqueMaximo: number | null;
}

export const listOmieActiveStock = createServerFn({ method: "GET" }).handler(async () => {
  type ProdutoItem = {
    codigo: string;
    descricao: string;
    inativo: string; // "S" | "N"
    estoque_minimo?: number;
    // Omie não expõe "estoque máximo" nesta conta — nem em ListarProdutos
    // nem em estoque/consulta ListarPosEstoque (confirmado manualmente).
  };
  type ListarProdutosResp = {
    total_de_paginas: number;
    produto_servico_cadastro: ProdutoItem[];
  };

  const REGISTROS_POR_PAGINA = 500;
  const MAX_PAGINAS = 60; // trava de segurança (~30k produtos)

  const produtos: ProdutoItem[] = [];
  let pagina = 1;
  let totalPaginas = 1;

  do {
    const resp = await omiePost<ListarProdutosResp>("geral/produtos", "ListarProdutos", [
      {
        pagina,
        registros_por_pagina: REGISTROS_POR_PAGINA,
        apenas_importado_api: "N",
        filtrar_apenas_omiepdv: "N",
      },
    ]);
    produtos.push(...(resp.produto_servico_cadastro ?? []));
    totalPaginas = resp.total_de_paginas ?? 1;
    pagina += 1;
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

  return produtos
    .filter((p) => p.inativo !== "S")
    .map((p): OmieStockItem => ({
      codigo: p.codigo,
      descricao: p.descricao,
      estoqueMinimo: p.estoque_minimo ?? 0,
      estoqueMaximo: null,
    }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
});

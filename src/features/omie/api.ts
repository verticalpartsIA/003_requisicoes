import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function omieKey() { return process.env.OMIE_APP_KEY ?? "8463170967"; }
function omieSecret() { return process.env.OMIE_APP_SECRET ?? "69e22b773842044fdb218178521cac59"; }

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// A API do Omie bloqueia rajadas de chamadas com "Consumo redundante
// detectado" (rate limit), inclusive entre páginas de uma mesma listagem
// se disparadas rápido demais. Faz retry com espera crescente nesse caso.
async function omiePost<T>(endpoint: string, call: string, param: unknown[], attempt = 1): Promise<T> {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: omieKey(), app_secret: omieSecret(), param }),
  });
  const data = await resp.json() as { faultstring?: string } & T;
  if (data.faultstring) {
    const isRateLimit = /redundante|redundant/i.test(data.faultstring);
    if (isRateLimit && attempt < 4) {
      await sleep(attempt * 1500);
      return omiePost<T>(endpoint, call, param, attempt + 1);
    }
    throw new Error(`Omie: ${data.faultstring}`);
  }
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
  estoqueFisico: number;
  estoqueReservado: number;
  estoqueDisponivel: number;
  estoqueMinimo: number;
}

const REGISTROS_POR_PAGINA = 200;
const MAX_PAGINAS = 100; // trava de segurança (~20k produtos)
const PAUSA_ENTRE_PAGINAS_MS = 400; // evita "consumo redundante" do Omie

export const listOmieActiveStock = createServerFn({ method: "GET" }).handler(async () => {
  // 1. geral/produtos → tem codigo, descricao e inativo (S/N) — decide quem é ativo.
  type ProdutoItem = { codigo: string; descricao: string; inativo: string };
  type ListarProdutosResp = { total_de_paginas: number; produto_servico_cadastro: ProdutoItem[] };

  const produtos: ProdutoItem[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const resp = await omiePost<ListarProdutosResp>("geral/produtos", "ListarProdutos", [
      { pagina, registros_por_pagina: REGISTROS_POR_PAGINA, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" },
    ]);
    produtos.push(...(resp.produto_servico_cadastro ?? []));
    totalPaginas = resp.total_de_paginas ?? 1;
    pagina += 1;
    if (pagina <= totalPaginas) await sleep(PAUSA_ENTRE_PAGINAS_MS);
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

  const ativos = new Map<string, string>(); // codigo -> descricao
  for (const p of produtos) {
    if (p.inativo !== "S") ativos.set(p.codigo, p.descricao);
  }

  // 2. estoque/consulta ListarPosEstoque → tem fisico, reservado e estoque_minimo
  //    já prontos por produto, sem precisar consultar um por um.
  type PosEstoqueItem = {
    cCodigo: string;
    cDescricao: string;
    fisico: number;
    reservado: number;
    estoque_minimo: number;
  };
  type ListarPosEstoqueResp = { nTotPaginas: number; produtos: PosEstoqueItem[] };

  const posicoes: PosEstoqueItem[] = [];
  let nPagina = 1;
  let totPaginas = 1;
  do {
    const resp = await omiePost<ListarPosEstoqueResp>("estoque/consulta", "ListarPosEstoque", [
      { nPagina, nRegPorPagina: REGISTROS_POR_PAGINA, dDataPosicao: "" },
    ]);
    posicoes.push(...(resp.produtos ?? []));
    totPaginas = resp.nTotPaginas ?? 1;
    nPagina += 1;
    if (nPagina <= totPaginas) await sleep(PAUSA_ENTRE_PAGINAS_MS);
  } while (nPagina <= totPaginas && nPagina <= MAX_PAGINAS);

  const items: OmieStockItem[] = [];
  for (const pos of posicoes) {
    const descricaoAtiva = ativos.get(pos.cCodigo);
    if (descricaoAtiva === undefined) continue; // inativo ou não encontrado no cadastro
    const fisico = pos.fisico ?? 0;
    const reservado = pos.reservado ?? 0;
    items.push({
      codigo: pos.cCodigo,
      descricao: pos.cDescricao || descricaoAtiva,
      estoqueFisico: fisico,
      estoqueReservado: reservado,
      estoqueDisponivel: fisico - reservado,
      estoqueMinimo: pos.estoque_minimo ?? 0,
    });
  }

  return items.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
});

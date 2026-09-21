import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseRest } from "@/lib/supabase-rest";

function omieKey() {
  return process.env.OMIE_APP_KEY ?? "8463170967";
}
function omieSecret() {
  return process.env.OMIE_APP_SECRET ?? "69e22b773842044fdb218178521cac59";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// A API do Omie bloqueia rajadas de chamadas com "Consumo redundante
// detectado" (rate limit), inclusive entre páginas de uma mesma listagem
// se disparadas rápido demais. Faz retry com espera crescente nesse caso.
async function omiePost<T>(
  endpoint: string,
  call: string,
  param: unknown[],
  attempt = 1,
): Promise<T> {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: omieKey(), app_secret: omieSecret(), param }),
  });
  const data = (await resp.json()) as { faultstring?: string } & T;
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

export interface OmieProductCost {
  codigo: string;
  descricao: string;
  /** Custo médio contábil (cmc) do Omie — média ponderada do estoque atual.
   *  null quando a Omie não tem nenhum histórico de compra/entrada para o
   *  produto (comum em SKU recém-cadastrado, nunca comprado antes) — nesse
   *  caso não existe "custo" pra buscar, é diferente de custo zero. */
  custoMedio: number | null;
  /** Fornecedor do pedido de compra pendente mais recente para este produto,
   *  quando disponível no cache de sugestão de compra (Omie não expõe
   *  fornecedor da última compra num único endpoint consultável ao vivo por
   *  produto). Null quando não há pedido pendente cacheado. */
  fornecedor: string | null;
}

/** Custo + fornecedor para comparação na tela de aprovação (M1). Usada ao
 *  vivo (não cacheada) — um único produto por vez, então não esbarra no
 *  rate limit do Omie como uma varredura em massa esbarraria. */
export const getOmieProductCost = createServerFn({ method: "POST" })
  .inputValidator(z.object({ codigoProduto: z.string().min(1) }))
  .handler(async ({ data }): Promise<OmieProductCost> => {
    type ProdutoResp = { codigo_produto: number; codigo: string; descricao: string };
    const produto = await omiePost<ProdutoResp>("geral/produtos", "ConsultarProduto", [
      { codigo: data.codigoProduto },
    ]);
    if (!produto.descricao) throw new Error("Produto não encontrado no Omie.");

    type PosicaoResp = { cmc: number };
    const hoje = new Date();
    const dataConsulta = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
    const posicao = await omiePost<PosicaoResp>("estoque/consulta", "PosicaoEstoque", [
      { id_prod: produto.codigo_produto, data: dataConsulta, apenas_saldo: "N" },
    ]);

    type PedidoDetail = { fornecedor?: string };
    const suggestionResp = await supabaseRest<{ pedidos: PedidoDetail[] | null }[]>(
      `omie_purchase_suggestions?select=pedidos&codigo=eq.${encodeURIComponent(produto.codigo)}&limit=1`,
    );
    const pedidos = suggestionResp.data?.[0]?.pedidos ?? [];
    const fornecedor =
      pedidos.length > 0 ? (pedidos[pedidos.length - 1]?.fornecedor ?? null) : null;

    return {
      codigo: produto.codigo || data.codigoProduto,
      descricao: produto.descricao,
      // A Omie não distingue "sem custo calculável" de "cmc = 0" — devolve o
      // campo zerado nos dois casos, em vez de omiti-lo. Como nenhum produto
      // recebido tem custo real de R$ 0,00, trata 0 como "sem histórico"
      // também (não só null/undefined).
      custoMedio: posicao.cmc || null,
      fornecedor,
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

const PAUSA_ENTRE_ITENS_MS = 350; // evita "consumo redundante" ao resolver vários codProd em sequência

export interface CriarRequisicaoCompraItem {
  codigo: string;
  descricao: string;
  quantidade: number;
}

export interface CriarRequisicaoCompraResultado {
  codReqCompra: number;
  quantidadeItens: number;
  itensComErro: { codigo: string; motivo: string }[];
}

export const criarRequisicaoCompraOmie = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      itens: z
        .array(
          z.object({
            codigo: z.string().min(1),
            descricao: z.string().min(1),
            quantidade: z.number().positive(),
          }),
        )
        .min(1)
        .max(200),
    }),
  )
  .handler(async ({ data }): Promise<CriarRequisicaoCompraResultado> => {
    type ProdutoResp = {
      codigo_produto: number;
      codigo: string;
      descricao: string;
      inativo: string;
    };

    const itensValidos: { codProd: number; qtde: number; obsItem: string }[] = [];
    const itensComErro: { codigo: string; motivo: string }[] = [];

    for (let i = 0; i < data.itens.length; i++) {
      const item = data.itens[i];
      try {
        const produto = await omiePost<ProdutoResp>("geral/produtos", "ConsultarProduto", [
          { codigo: item.codigo },
        ]);
        if (!produto.codigo_produto) throw new Error("Produto não encontrado no Omie.");
        if (produto.inativo === "S") throw new Error("Produto inativo no Omie.");
        itensValidos.push({
          codProd: produto.codigo_produto,
          qtde: item.quantidade,
          obsItem: "Sugestão automática — VPRequisições (Estoque Omie)",
        });
      } catch (e) {
        itensComErro.push({
          codigo: item.codigo,
          motivo: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
      if (i < data.itens.length - 1) await sleep(PAUSA_ENTRE_ITENS_MS);
    }

    if (itensValidos.length === 0) {
      throw new Error("Nenhum item pôde ser resolvido no Omie. Verifique os códigos selecionados.");
    }

    const hoje = new Date();
    const dtSugestao = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;

    type IncluirReqResp = {
      codReqCompra: number;
      codIntReqCompra: string;
      cCodStatus: string;
      cDesStatus: string;
    };
    const resp = await omiePost<IncluirReqResp>("produtos/requisicaocompra", "IncluirReq", [
      {
        codCateg: "2.01.01", // Compras de Mercadorias para Revenda Nacional (mesma categoria usada nas requisições manuais de reposição de estoque)
        codIntReqCompra: `VP-EST-${Date.now()}`,
        dtSugestao,
        obsIntReqCompra: "Reposição de estoque — gerado via Sugestão de Compra (Estoque Omie)",
        ItensReqCompra: itensValidos.map((item) => ({
          codProd: item.codProd,
          qtde: item.qtde,
          precoUnit: 0,
          obsItem: item.obsItem,
        })),
      },
    ]);

    return {
      codReqCompra: resp.codReqCompra,
      quantidadeItens: itensValidos.length,
      itensComErro,
    };
  });

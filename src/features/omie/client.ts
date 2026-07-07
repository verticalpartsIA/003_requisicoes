import { validateOmieOrder, validateOmieProduct, listOmieActiveStock } from "@/features/omie/api";

export async function validateOmieOrderClient(numeroPedido: string) {
  return validateOmieOrder({ data: { numeroPedido } });
}

export async function validateOmieProductClient(codigoProduto: string) {
  return validateOmieProduct({ data: { codigoProduto } });
}

export async function listOmieActiveStockClient() {
  return listOmieActiveStock();
}

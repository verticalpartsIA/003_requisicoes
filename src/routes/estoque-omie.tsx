import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listOmieStockFromCacheClient } from "@/features/omie/client";
import type { OmieStockItem } from "@/features/omie/api";

export const Route = createFileRoute("/estoque-omie")({
  head: () => ({
    meta: [
      { title: "Estoque Omie — VPRequisições" },
      { name: "description", content: "Produtos ativos e posição de estoque, direto do Omie" },
    ],
  }),
  component: EstoqueOmiePage,
});

function EstoqueOmiePage() {
  const [items, setItems] = useState<OmieStockItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: data, lastSyncedAt: syncedAt } = await listOmieStockFromCacheClient();
      setItems(data);
      setLastSyncedAt(syncedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar o estoque.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.codigo.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Boxes className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Estoque Omie</h1>
            <p className="text-sm text-muted-foreground">
              Produtos ativos e posição de estoque, sincronizados a cada hora comercial com o Omie
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Atualizar
          </Button>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Última sincronização: {new Date(lastSyncedAt).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por código ou descrição..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Código do Produto</th>
                  <th className="px-4 py-3">Descrição do Produto</th>
                  <th className="px-4 py-3 text-right">Estoque Físico</th>
                  <th className="px-4 py-3 text-right">Reservado</th>
                  <th className="px-4 py-3 text-right">Estoque Disponível</th>
                  <th className="px-4 py-3 text-right">Estoque Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Carregando produtos do Omie...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.codigo} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-mono text-xs">{item.codigo}</td>
                      <td className="px-4 py-2.5">{item.descricao}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueFisico}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueReservado}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{item.estoqueDisponivel}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{item.estoqueMinimo}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!loading && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} de {items.length} produtos ativos.
        </p>
      )}
    </div>
  );
}

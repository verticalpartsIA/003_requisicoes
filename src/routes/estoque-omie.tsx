import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Boxes, CalendarClock, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  listOmiePurchaseSuggestionsClient,
  type OmiePurchaseSuggestionItem,
} from "@/features/omie/client";

export const Route = createFileRoute("/estoque-omie")({
  head: () => ({
    meta: [
      { title: "Estoque Omie — VPRequisições" },
      { name: "description", content: "Produtos ativos, posição de estoque e sugestão de compra, direto do Omie" },
    ],
  }),
  component: EstoqueOmiePage,
});

function formatarData(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatarNumero(valor: number) {
  return Number(valor.toFixed(2)).toLocaleString("pt-BR");
}

type StatusCor = "vermelha" | "amarela" | "branca";

function statusDoItem(item: OmiePurchaseSuggestionItem): StatusCor {
  if (item.sugestaoCompra > 0) return "vermelha";
  if (item.estoqueDisponivel <= item.estoqueMinimo) return "amarela";
  return "branca";
}

const LINHA_CLASSES: Record<StatusCor, string> = {
  vermelha: "bg-red-300 text-black hover:bg-red-400/80",
  amarela: "bg-yellow-300 text-black hover:bg-yellow-400/80",
  branca: "bg-white text-black hover:bg-neutral-100",
};

function CurvaBadge({ curva }: { curva: OmiePurchaseSuggestionItem["curva"] }) {
  const cores: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-800",
    B: "bg-blue-100 text-blue-800",
    C: "bg-amber-100 text-amber-800",
    D: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${cores[curva]}`}>
      {curva}
    </span>
  );
}

/** Detalhe (somente leitura) dos pedidos de compra em aberto, vindos direto
 *  do Omie — clicável, funciona em desktop e celular (diferente de hover). */
function AguardandoEntregaCell({ item }: { item: OmiePurchaseSuggestionItem }) {
  const [aberto, setAberto] = useState(false);
  if (item.pedidos.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="relative flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground hover:bg-muted"
        title="Ver pedidos de compra em aberto"
      >
        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="tabular-nums">{formatarData(item.proximaPrevisao)}</span>
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-7 z-20 w-80 rounded-md border border-border bg-popover p-3 text-left shadow-lg">
            <p className="mb-2 text-xs font-semibold text-foreground">
              {item.codigo} — Aguardando Entrega ({formatarNumero(item.comprado)})
            </p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {item.pedidos.map((p, i) => (
                <div key={`${p.numero}-${i}`} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs">
                  <div>
                    <span className="font-mono font-medium">Pedido {p.numero}</span>
                    <span className="text-muted-foreground"> · Forn. {p.fornecedor}</span>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums font-semibold">{formatarNumero(p.aguardando)} {p.unidade}</p>
                    <p className="text-[10px] text-muted-foreground">chega {formatarData(p.previsao)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EstoqueOmiePage() {
  const [items, setItems] = useState<OmiePurchaseSuggestionItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastVelocitySyncedAt, setLastVelocitySyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [corFiltro, setCorFiltro] = useState<"todas" | StatusCor>("todas");
  const [curvaFiltro, setCurvaFiltro] = useState<"todas" | OmiePurchaseSuggestionItem["curva"]>("todas");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: data, lastSyncedAt: syncedAt, lastVelocitySyncedAt: velocitySyncedAt } =
        await listOmiePurchaseSuggestionsClient();
      setItems(data);
      setLastSyncedAt(syncedAt);
      setLastVelocitySyncedAt(velocitySyncedAt);
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
    return items.filter((i) => {
      const combinaTexto = !q || i.codigo.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q);
      const combinaCor = corFiltro === "todas" || statusDoItem(i) === corFiltro;
      const combinaCurva = curvaFiltro === "todas" || i.curva === curvaFiltro;
      return combinaTexto && combinaCor && combinaCurva;
    });
  }, [items, search, corFiltro, curvaFiltro]);

  const totais = useMemo(
    () =>
      filtered.reduce(
        (acc, i) => ({
          estoqueFisico: acc.estoqueFisico + i.estoqueFisico,
          estoqueReservado: acc.estoqueReservado + i.estoqueReservado,
          estoqueDisponivel: acc.estoqueDisponivel + i.estoqueDisponivel,
          estoqueMinimo: acc.estoqueMinimo + i.estoqueMinimo,
          sugestaoCompra: acc.sugestaoCompra + i.sugestaoCompra,
          comprado: acc.comprado + i.comprado,
        }),
        { estoqueFisico: 0, estoqueReservado: 0, estoqueDisponivel: 0, estoqueMinimo: 0, sugestaoCompra: 0, comprado: 0 },
      ),
    [filtered],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Boxes className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Estoque Omie</h1>
            <p className="text-sm text-muted-foreground">
              Estoque, giro de vendas e sugestão de compra, sincronizados automaticamente com o Omie
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
              Estoque: {new Date(lastSyncedAt).toLocaleString("pt-BR")}
            </span>
          )}
          {lastVelocitySyncedAt && (
            <span className="text-xs text-muted-foreground">
              Giro/Curva: {new Date(lastVelocitySyncedAt).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(
            [
              { value: "todas", label: "Todas", dot: "bg-transparent border border-border" },
              { value: "vermelha", label: "Vermelha — precisa comprar", dot: "bg-red-400" },
              { value: "amarela", label: "Amarela — alerta", dot: "bg-yellow-400" },
              { value: "branca", label: "Branca — ok", dot: "bg-white border border-border" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCorFiltro(opt.value)}
              title={opt.label}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                corFiltro === opt.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
              {opt.value === "todas" ? "Todas" : opt.label.split(" — ")[0]}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Curva:</span>
          {(["todas", "A", "B", "C", "D"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setCurvaFiltro(opt)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                curvaFiltro === opt
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {opt === "todas" ? "Todas" : opt}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <span className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold text-foreground">
          {filtered.length} {filtered.length === 1 ? "linha" : "linhas"}
        </span>
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
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-[1200px] w-full text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-border bg-card text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
                  <th className="px-4 py-3 whitespace-nowrap bg-card">Código do Produto</th>
                  <th className="px-4 py-3 min-w-[280px] bg-card">Descrição do Produto</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap bg-card">Curva</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Estoque Físico</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Reservado</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Estoque Disponível</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Estoque Mínimo</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Sugestão de Compra</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Comprado</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Aguardando a Entrega</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Carregando produtos do Omie...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const status = statusDoItem(item);
                    return (
                      <tr key={item.codigo} className={`border-b border-border last:border-0 ${LINHA_CLASSES[status]}`}>
                        <td className="px-4 py-2.5 font-mono text-xs">{item.codigo}</td>
                        <td className="px-4 py-2.5">{item.descricao}</td>
                        <td className="px-3 py-2.5 text-center">
                          <CurvaBadge curva={item.curva} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueFisico}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueReservado}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{item.estoqueDisponivel}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueMinimo}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{item.sugestaoCompra || 0}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {item.comprado > 0 ? formatarNumero(item.comprado) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <AguardandoEntregaCell item={item} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && filtered.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                    <td className="px-4 py-2.5" colSpan={3}>
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.estoqueFisico)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.estoqueReservado)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.estoqueDisponivel)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.estoqueMinimo)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.sugestaoCompra)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatarNumero(totais.comprado)}</td>
                    <td className="px-4 py-2.5 text-right"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {!loading && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} de {items.length} produtos ativos. Curva A/B/C calculada pelo giro de vendas dos últimos
          4 meses; Curva D = baixo giro, estoque mínimo fixo.
        </p>
      )}
    </div>
  );
}

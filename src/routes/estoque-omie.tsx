import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, PackagePlus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  listOmiePurchaseSuggestionsClient,
  registrarCompraClient,
  type OmiePurchaseSuggestionItem,
} from "@/features/omie/client";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/estoque-omie")({
  head: () => ({
    meta: [
      { title: "Estoque Omie — VPRequisições" },
      { name: "description", content: "Produtos ativos, posição de estoque e sugestão de compra, direto do Omie" },
    ],
  }),
  component: EstoqueOmiePage,
});

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
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

function ComprarPopover({
  item,
  onSalvo,
}: {
  item: OmiePurchaseSuggestionItem;
  onSalvo: () => void;
}) {
  const { profile, hasRole } = useAuth();
  const podeComprar = hasRole("admin") || hasRole("comprador") || hasRole("almoxarife");
  const [aberto, setAberto] = useState(false);
  const [quantidade, setQuantidade] = useState("");
  const [previsao, setPrevisao] = useState(hojeISO());
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!podeComprar) {
    return item.comprado > 0 ? <span className="tabular-nums">{item.comprado}</span> : <span className="text-muted-foreground">—</span>;
  }

  const salvar = async () => {
    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0) {
      setErro("Informe uma quantidade válida.");
      return;
    }
    if (!previsao) {
      setErro("Informe a previsão de chegada.");
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      await registrarCompraClient({
        codigo: item.codigo,
        quantidade: qtd,
        previsaoChegada: previsao,
        createdBy: profile?.id,
        createdByName: profile?.full_name ?? undefined,
      });
      setQuantidade("");
      setAberto(false);
      onSalvo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao registrar compra.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex items-center justify-end gap-1.5">
      <span className="tabular-nums">{item.comprado || "—"}</span>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Registrar compra"
      >
        <PackagePlus className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <div className="absolute right-0 top-7 z-10 w-64 rounded-md border border-border bg-popover p-3 text-left shadow-md">
          <p className="mb-2 text-xs font-semibold text-foreground">Registrar compra — {item.codigo}</p>
          <label className="mb-1 block text-[11px] text-muted-foreground">Quantidade comprada</label>
          <Input
            type="number"
            min="0"
            step="1"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className="mb-2 h-8 text-sm"
          />
          <label className="mb-1 block text-[11px] text-muted-foreground">Previsão de chegada</label>
          <Input
            type="date"
            value={previsao}
            onChange={(e) => setPrevisao(e.target.value)}
            className="mb-2 h-8 text-sm"
          />
          {erro && <p className="mb-2 text-[11px] text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void salvar()} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
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
      return combinaTexto && combinaCor;
    });
  }, [items, search, corFiltro]);

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
            <table className="min-w-[1200px] w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 whitespace-nowrap">Código do Produto</th>
                  <th className="px-4 py-3 min-w-[280px]">Descrição do Produto</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Curva</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Estoque Físico</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Reservado</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Estoque Disponível</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Estoque Mínimo</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Sugestão de Compra</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Comprado</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Carregando produtos do Omie...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
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
                        <td className="px-4 py-2.5 text-right">
                          <ComprarPopover item={item} onSalvo={() => void load()} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
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

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Boxes, CalendarClock, Loader2, PencilRuler, RefreshCw, Search, Send, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listOmiePurchaseSuggestionsClient,
  salvarLoteConfigClient,
  criarRequisicaoCompraOmieClient,
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

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentOrder,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentOrder: SortOrder;
  onSort: (key: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const isActive = currentSort === sortKey;
  const textAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <th
      className={`px-4 py-3 whitespace-nowrap bg-card cursor-pointer hover:bg-muted/50 transition-colors ${textAlign}`}
      onClick={() => onSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
        <span>{label}</span>
        {isActive && (
          <span className="inline-flex">
            {currentOrder === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5 text-vp-yellow-dark" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 text-vp-yellow-dark" />
            )}
          </span>
        )}
      </div>
    </th>
  );
}

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

/** Célula da Sugestão de Compra com revisão de lote (múltiplo + lote mínimo).
 *  Mostra o valor inteiro sugerido; comprador pode abrir, revisar a sugestão
 *  pré-preenchida pelo histórico, ajustar e confirmar. Após confirmar, a
 *  sugestão passa a respeitar o lote. */
function SugestaoCell({ item, onSalvo }: { item: OmiePurchaseSuggestionItem; onSalvo: () => void }) {
  const { profile, hasRole } = useAuth();
  const podeEditar = hasRole("admin") || hasRole("comprador") || hasRole("almoxarife");
  const [aberto, setAberto] = useState(false);
  const [multiplo, setMultiplo] = useState<string>(
    String(item.multiploCompra ?? item.sugeridoMultiplo ?? ""),
  );
  const [loteMin, setLoteMin] = useState<string>(
    String(item.loteMinimo ?? item.sugeridoLoteMinimo ?? ""),
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precisaRevisar = item.lotePendenteRevisao && item.sugestaoCompra > 0;

  const salvar = async () => {
    const m = multiplo.trim() ? Number(multiplo) : null;
    const l = loteMin.trim() ? Number(loteMin) : null;
    if ((m !== null && (!Number.isFinite(m) || m < 0)) || (l !== null && (!Number.isFinite(l) || l < 0))) {
      setErro("Valores inválidos.");
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      await salvarLoteConfigClient({
        codigo: item.codigo,
        multiploCompra: m,
        loteMinimo: l,
        updatedBy: profile?.id,
        updatedByName: profile?.full_name ?? undefined,
      });
      setAberto(false);
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar lote.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex items-center justify-end gap-1.5">
      <span className="tabular-nums font-semibold">{item.sugestaoCompra || 0}</span>
      {precisaRevisar && (
        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" title="Lote sugerido pelo histórico — revisar" />
      )}
      {podeEditar && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Revisar lote de compra"
        >
          <PencilRuler className="h-3.5 w-3.5" />
        </button>
      )}
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-7 z-20 w-72 rounded-md border border-border bg-popover p-3 text-left shadow-lg">
            <p className="mb-1 text-xs font-semibold text-foreground">Lote de compra — {item.codigo}</p>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Necessidade calculada: <strong>{item.sugestaoBruta}</strong> {item.unidade ?? ""}
              {item.sugeridoLoteMinimo != null && (
                <> · histórico sugere lote <strong>{formatarNumero(item.sugeridoLoteMinimo)}</strong></>
              )}
            </p>
            <label className="mb-1 block text-[11px] text-muted-foreground">Múltiplo de compra</label>
            <Input type="number" min="0" step="1" value={multiplo} onChange={(e) => setMultiplo(e.target.value)} className="mb-2 h-8 text-sm" placeholder="ex.: 700 (bobina)" />
            <label className="mb-1 block text-[11px] text-muted-foreground">Lote mínimo</label>
            <Input type="number" min="0" step="1" value={loteMin} onChange={(e) => setLoteMin(e.target.value)} className="mb-2 h-8 text-sm" placeholder="ex.: 700" />
            {erro && <p className="mb-2 text-[11px] text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAberto(false)}>Cancelar</Button>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void salvar()} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar lote"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
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

type SortKey = "codigo" | "descricao" | "curva" | "estoqueFisico" | "estoqueDisponivel" | "sugestaoCompra" | "comprado";
type SortOrder = "asc" | "desc";

/** Modal de confirmação do envio em massa para o Omie. Mostra os itens que
 *  serão enviados (sugestão > 0) e avisa sobre os que foram ignorados
 *  (sugestão zerada) — o comprador confirma antes de qualquer chamada à API. */
function EnviarRequisicaoDialog({
  aberto,
  onOpenChange,
  itensParaEnviar,
  itensIgnorados,
  onEnviado,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  itensParaEnviar: OmiePurchaseSuggestionItem[];
  itensIgnorados: OmiePurchaseSuggestionItem[];
  onEnviado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    try {
      const resultado = await criarRequisicaoCompraOmieClient(
        itensParaEnviar.map((item) => ({
          codigo: item.codigo,
          descricao: item.descricao,
          quantidade: item.sugestaoCompra,
        })),
      );
      if (resultado.itensComErro.length > 0) {
        toast.warning(
          `Requisição ${resultado.codReqCompra} criada com ${resultado.quantidadeItens} itens. ${resultado.itensComErro.length} não puderam ser incluídos: ${resultado.itensComErro.map((e) => e.codigo).join(", ")}`,
        );
      } else {
        toast.success(`Requisição de compra ${resultado.codReqCompra} criada no Omie com ${resultado.quantidadeItens} itens.`);
      }
      onOpenChange(false);
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar requisição de compra no Omie.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar requisição de compra em massa</DialogTitle>
          <DialogDescription>
            Será criada 1 requisição de compra no Omie com {itensParaEnviar.length}{" "}
            {itensParaEnviar.length === 1 ? "item" : "itens"}, usando a Sugestão de Compra de cada produto.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-1.5">Código</th>
                <th className="px-3 py-1.5">Descrição</th>
                <th className="px-3 py-1.5 text-right">Qtd.</th>
              </tr>
            </thead>
            <tbody>
              {itensParaEnviar.map((item) => (
                <tr key={item.codigo} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">{item.codigo}</td>
                  <td className="px-3 py-1.5">{item.descricao}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{item.sugestaoCompra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {itensIgnorados.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {itensIgnorados.length} {itensIgnorados.length === 1 ? "item selecionado não tem" : "itens selecionados não têm"}{" "}
            sugestão de compra (quantidade zero) e {itensIgnorados.length === 1 ? "foi ignorado" : "foram ignorados"}:{" "}
            {itensIgnorados.map((i) => i.codigo).join(", ")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} disabled={enviando || itensParaEnviar.length === 0}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Confirmar e enviar ao Omie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [sortBy, setSortBy] = useState<SortKey>("descricao");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dialogEnvioAberto, setDialogEnvioAberto] = useState(false);
  const { hasRole } = useAuth();
  const podeEnviarOmie = hasRole("admin") || hasRole("comprador") || hasRole("almoxarife");

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
  };

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
    const result = items.filter((i) => {
      const combinaTexto = !q || i.codigo.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q);
      const combinaCor = corFiltro === "todas" || statusDoItem(i) === corFiltro;
      const combinaCurva = curvaFiltro === "todas" || i.curva === curvaFiltro;
      return combinaTexto && combinaCor && combinaCurva;
    });

    result.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      let comparison = 0;
      if (typeof aVal === "string") {
        comparison = aVal.localeCompare(bVal as string);
      } else {
        comparison = (aVal as number) - (bVal as number);
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [items, search, corFiltro, curvaFiltro, sortBy, sortOrder]);

  const todosFiltradosSelecionados = filtered.length > 0 && filtered.every((i) => selecionados.has(i.codigo));
  const algunsFiltradosSelecionados = filtered.some((i) => selecionados.has(i.codigo));

  const toggleSelecionado = (codigo: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  };

  const toggleSelecionarTodos = () => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosFiltradosSelecionados) {
        filtered.forEach((i) => next.delete(i.codigo));
      } else {
        filtered.forEach((i) => next.add(i.codigo));
      }
      return next;
    });
  };

  const itensSelecionados = items.filter((i) => selecionados.has(i.codigo));
  const itensParaEnviar = itensSelecionados.filter((i) => i.sugestaoCompra > 0);
  const itensIgnorados = itensSelecionados.filter((i) => i.sugestaoCompra <= 0);

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

        {podeEnviarOmie && selecionados.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-vp-yellow-dark/40 bg-vp-yellow-dark/10 px-2.5 py-1.5">
            <span className="text-xs font-semibold text-foreground">
              {selecionados.size} {selecionados.size === 1 ? "produto selecionado" : "produtos selecionados"}
            </span>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setDialogEnvioAberto(true)}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Enviar para Omie
            </Button>
            <button
              type="button"
              onClick={() => setSelecionados(new Set())}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Limpar seleção"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
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
                  {podeEnviarOmie && (
                    <th className="w-10 px-4 py-3 bg-card">
                      <Checkbox
                        checked={todosFiltradosSelecionados ? true : algunsFiltradosSelecionados ? "indeterminate" : false}
                        onCheckedChange={() => toggleSelecionarTodos()}
                        disabled={filtered.length === 0}
                        aria-label="Selecionar todas as linhas filtradas"
                      />
                    </th>
                  )}
                  <SortHeader label="Código do Produto" sortKey="codigo" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 min-w-[280px] bg-card cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleSort("descricao")}>
                    <div className="flex items-center gap-1">
                      <span>Descrição do Produto</span>
                      {sortBy === "descricao" && (
                        <span className="inline-flex">
                          {sortOrder === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-vp-yellow-dark" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-vp-yellow-dark" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                  <SortHeader label="Curva" sortKey="curva" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} align="center" />
                  <SortHeader label="Estoque Físico" sortKey="estoqueFisico" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Reservado</th>
                  <SortHeader label="Estoque Disponível" sortKey="estoqueDisponivel" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Estoque Mínimo</th>
                  <SortHeader label="Sugestão de Compra" sortKey="sugestaoCompra" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} align="right" />
                  <SortHeader label="Comprado" sortKey="comprado" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} align="right" />
                  <th className="px-4 py-3 text-right whitespace-nowrap bg-card">Aguardando a Entrega</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={podeEnviarOmie ? 11 : 10} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Carregando produtos do Omie...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={podeEnviarOmie ? 11 : 10} className="px-4 py-12 text-center text-muted-foreground">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const status = statusDoItem(item);
                    return (
                      <tr key={item.codigo} className={`border-b border-border last:border-0 ${LINHA_CLASSES[status]}`}>
                        {podeEnviarOmie && (
                          <td className="px-4 py-2.5">
                            <Checkbox
                              checked={selecionados.has(item.codigo)}
                              onCheckedChange={() => toggleSelecionado(item.codigo)}
                              aria-label={`Selecionar ${item.codigo}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-2.5 font-mono text-xs">{item.codigo}</td>
                        <td className="px-4 py-2.5">{item.descricao}</td>
                        <td className="px-3 py-2.5 text-center">
                          <CurvaBadge curva={item.curva} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueFisico}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueReservado}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{item.estoqueDisponivel}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.estoqueMinimo}</td>
                        <td className="px-4 py-2.5 text-right">
                          <SugestaoCell item={item} onSalvo={() => void load()} />
                        </td>
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
                    <td className="px-4 py-2.5" colSpan={podeEnviarOmie ? 4 : 3}>
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

      <EnviarRequisicaoDialog
        aberto={dialogEnvioAberto}
        onOpenChange={setDialogEnvioAberto}
        itensParaEnviar={itensParaEnviar}
        itensIgnorados={itensIgnorados}
        onEnviado={() => {
          setSelecionados(new Set());
          void load();
        }}
      />
    </div>
  );
}

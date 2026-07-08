import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ClipboardList,
  Plus,
  Link as LinkIcon,
  MessageCircle,
  Eye,
  Unlock,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { friendlySupabaseError } from "@/lib/supabase-error";
import { useAuth } from "@/features/auth/auth-context";
import {
  listComandoPedidos,
  getComandoPedidoDetalhe,
  createComandoPedido,
  marcarComandoPedidoEnviado,
  reabrirComandoPedido,
  comandoPublicUrl,
  comandoWhatsAppLink,
} from "@/features/comando/client";
import {
  COMANDO_SECOES,
  COMANDO_STATUS_LABELS,
  type ComandoPedido,
  type ComandoPedidoStatus,
  type ComandoAnexo,
  type ComandoAuditoria,
} from "@/features/comando/types";

export const Route = createFileRoute("/comando")({
  head: () => ({
    meta: [
      { title: "M7 Quadro de Comando — VPRequisições" },
      { name: "description", content: "Engenharia de pedidos de quadro de comando de elevador" },
    ],
  }),
  component: ComandoPage,
});

type StatusFilter = ComandoPedidoStatus | "todos";

const STATUS_FILTERS: StatusFilter[] = ["todos", "rascunho", "enviado", "visualizado", "respondido"];

function statusBadgeClass(status: ComandoPedidoStatus): string {
  switch (status) {
    case "rascunho":
      return "bg-gray-100 text-gray-700 border-gray-300";
    case "enviado":
      return "bg-blue-50 text-blue-700 border-blue-300";
    case "visualizado":
      return "bg-amber-50 text-amber-700 border-amber-300";
    case "respondido":
      return "bg-green-50 text-green-700 border-green-300";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function humanizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => humanizeValue(v)).filter((v): v is string => !!v);
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    // Objeto aninhado inesperado — mostra como JSON compacto.
    try {
      const json = JSON.stringify(value);
      return json === "{}" ? null : json;
    } catch {
      return null;
    }
  }
  return String(value);
}

const AUDITORIA_LABELS: Record<ComandoAuditoria["evento"], string> = {
  criado: "Pedido criado",
  enviado: "Link enviado ao cliente",
  visualizado: "Cliente visualizou o formulário",
  respondido: "Cliente respondeu o formulário",
  reaberto: "Reaberto para nova resposta",
};

function StorageDownloadLink({ path, fileName }: { path: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) return;
    setUrl(null);
    supabaseBrowser.storage
      .from("comando-anexos")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (active && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (!url) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Paperclip className="h-3.5 w-3.5" /> {fileName}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
    >
      <Paperclip className="h-3.5 w-3.5" /> {fileName}
    </a>
  );
}

function ComandoPage() {
  const { user } = useAuth();

  const [pedidos, setPedidos] = useState<ComandoPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");

  const [createOpen, setCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clienteNome, setClienteNome] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [projetoNumero, setProjetoNumero] = useState("");
  const [observacoesInternas, setObservacoesInternas] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPedido, setDetailPedido] = useState<ComandoPedido | null>(null);
  const [detailAnexos, setDetailAnexos] = useState<ComandoAnexo[]>([]);
  const [detailAuditoria, setDetailAuditoria] = useState<ComandoAuditoria[]>([]);
  const [detailActionLoading, setDetailActionLoading] = useState(false);

  const loadPedidos = async () => {
    setLoading(true);
    try {
      const data = await listComandoPedidos();
      setPedidos(data);
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPedidos();
  }, []);

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      todos: pedidos.length,
      rascunho: 0,
      enviado: 0,
      visualizado: 0,
      respondido: 0,
    };
    for (const p of pedidos) base[p.status] += 1;
    return base;
  }, [pedidos]);

  const filteredPedidos = useMemo(() => {
    if (statusFilter === "todos") return pedidos;
    return pedidos.filter((p) => p.status === statusFilter);
  }, [pedidos, statusFilter]);

  const resetCreateForm = () => {
    setClienteNome("");
    setClienteTelefone("");
    setClienteEmail("");
    setProjetoNumero("");
    setObservacoesInternas("");
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetailPedido(null);
    setDetailAnexos([]);
    setDetailAuditoria([]);
    try {
      const { pedido, anexos, auditoria } = await getComandoPedidoDetalhe(id);
      setDetailPedido(pedido);
      setDetailAnexos(anexos);
      setDetailAuditoria(auditoria);
    } catch (err) {
      toast.error(friendlySupabaseError(err));
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id: string) => {
    try {
      const { pedido, anexos, auditoria } = await getComandoPedidoDetalhe(id);
      setDetailPedido(pedido);
      setDetailAnexos(anexos);
      setDetailAuditoria(auditoria);
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    }
  };

  const handleCreate = async () => {
    if (!clienteNome.trim()) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    if (!clienteTelefone.trim()) {
      toast.error("Informe o telefone do cliente.");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await createComandoPedido({
        clienteNome: clienteNome.trim(),
        clienteTelefone: clienteTelefone.trim(),
        clienteEmail: clienteEmail.trim() || null,
        projetoNumero: projetoNumero.trim() || null,
        observacoesInternas: observacoesInternas.trim() || null,
      });
      toast.success("Pedido criado!", { description: created.numero_documento });
      setCreateOpen(false);
      resetCreateForm();
      await loadPedidos();
      await openDetail(created.id);
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!detailPedido) return;
    const url = comandoPublicUrl(detailPedido.token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  const handleSendWhatsApp = async () => {
    if (!detailPedido) return;
    setDetailActionLoading(true);
    try {
      let pedido = detailPedido;
      if (pedido.status === "rascunho") {
        if (!user?.id) {
          toast.error("Usuário não autenticado.");
          return;
        }
        pedido = await marcarComandoPedidoEnviado(pedido.id, user.id);
        await loadPedidos();
        await refreshDetail(pedido.id);
      }
      const url = comandoPublicUrl(pedido.token);
      const link = comandoWhatsAppLink(pedido.cliente_telefone, url, pedido.numero_documento);
      window.open(link, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    } finally {
      setDetailActionLoading(false);
    }
  };

  const handleOpenPublicForm = () => {
    if (!detailPedido) return;
    const url = comandoPublicUrl(detailPedido.token);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleReabrir = async () => {
    if (!detailPedido) return;
    if (!user?.id) {
      toast.error("Usuário não autenticado.");
      return;
    }
    setDetailActionLoading(true);
    try {
      await reabrirComandoPedido(detailPedido.id, user.id);
      toast.success("Pedido reaberto para o cliente.");
      await loadPedidos();
      await refreshDetail(detailPedido.id);
    } catch (err) {
      toast.error(friendlySupabaseError(err));
    } finally {
      setDetailActionLoading(false);
    }
  };

  const closeDetail = (open: boolean) => {
    if (!open) {
      setDetailId(null);
      setDetailPedido(null);
      setDetailAnexos([]);
      setDetailAuditoria([]);
    }
  };

  const anexosBySecao = useMemo(() => {
    const map = new Map<string, ComandoAnexo[]>();
    for (const anexo of detailAnexos) {
      const key = anexo.secao ?? "_sem_secao";
      const list = map.get(key) ?? [];
      list.push(anexo);
      map.set(key, list);
    }
    return map;
  }, [detailAnexos]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <ClipboardList className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">M7 — Quadro de Comando</h1>
            <p className="text-sm text-muted-foreground">Engenharia de pedidos de quadro de comando de elevador</p>
          </div>
        </div>
        <Button
          variant="vp"
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Pedido
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => {
          const label = s === "todos" ? "Todos" : COMANDO_STATUS_LABELS[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
                  : "border-border hover:border-muted-foreground/40 text-muted-foreground",
              )}
            >
              {label}
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-full min-w-[1.25rem] h-5 px-1 text-[10px] font-semibold",
                  active ? "bg-vp-yellow text-vp-dark" : "bg-muted text-foreground",
                )}
              >
                {counts[s]}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Expira em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!loading && filteredPedidos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                filteredPedidos.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => void openDetail(p.id)}
                  >
                    <TableCell className="font-mono text-xs">{p.numero_documento}</TableCell>
                    <TableCell className="font-medium">{p.cliente_nome}</TableCell>
                    <TableCell>{p.cliente_telefone}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border",
                          statusBadgeClass(p.status),
                        )}
                      >
                        {COMANDO_STATUS_LABELS[p.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(p.expires_at)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog: Novo Pedido */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Pedido — Quadro de Comando</DialogTitle>
            <DialogDescription>
              Informe os dados básicos do cliente. O link do formulário técnico será enviado a seguir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome do Cliente *</label>
              <Input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Nome completo ou razão social" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Telefone do Cliente (WhatsApp) *</label>
              <Input value={clienteTelefone} onChange={(e) => setClienteTelefone(e.target.value)} placeholder="(11) 91234-5678" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">E-mail do Cliente</label>
              <Input type="email" value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} placeholder="cliente@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Número do Projeto</label>
              <Input value={projetoNumero} onChange={(e) => setProjetoNumero(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Observações internas</label>
              <Textarea
                value={observacoesInternas}
                onChange={(e) => setObservacoesInternas(e.target.value)}
                placeholder="Notas visíveis apenas internamente..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button variant="vp" onClick={() => void handleCreate()} disabled={isSubmitting}>
              {isSubmitting ? "Criando..." : "Criar Pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Detalhe do Pedido */}
      <Dialog open={!!detailId} onOpenChange={closeDetail}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {detailLoading && <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>}
          {!detailLoading && detailPedido && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{detailPedido.numero_documento}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border",
                      statusBadgeClass(detailPedido.status),
                    )}
                  >
                    {COMANDO_STATUS_LABELS[detailPedido.status]}
                  </span>
                </DialogTitle>
                <DialogDescription>{detailPedido.cliente_nome}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{detailPedido.cliente_nome}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-medium">{detailPedido.cliente_telefone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">E-mail</p>
                  <p className="font-medium">{detailPedido.cliente_email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Projeto</p>
                  <p className="font-medium">{detailPedido.projeto_numero || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Criado em</p>
                  <p className="font-medium">{fmtDateTime(detailPedido.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expira em</p>
                  <p className="font-medium">{fmtDateTime(detailPedido.expires_at)}</p>
                </div>
                {detailPedido.observacoes_internas && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Observações internas</p>
                    <p className="font-medium whitespace-pre-wrap">{detailPedido.observacoes_internas}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => void handleCopyLink()}>
                  <LinkIcon className="h-4 w-4 mr-1" /> Copiar link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSendWhatsApp()}
                  disabled={detailActionLoading}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  {detailPedido.status === "rascunho" ? "Enviar via WhatsApp" : "Reenviar via WhatsApp"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleOpenPublicForm}>
                  <Eye className="h-4 w-4 mr-1" /> Abrir formulário público
                </Button>
                {detailPedido.status === "respondido" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleReabrir()}
                    disabled={detailActionLoading}
                  >
                    <Unlock className="h-4 w-4 mr-1" /> Reabrir para o cliente
                  </Button>
                )}
              </div>

              {/* Timeline */}
              <div className="border-t pt-3">
                <h3 className="text-sm font-semibold mb-2">Histórico</h3>
                {detailAuditoria.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum evento registrado ainda.</p>
                )}
                <ol className="space-y-2">
                  {detailAuditoria.map((ev) => (
                    <li key={ev.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-1 h-2 w-2 rounded-full bg-vp-yellow shrink-0" />
                      <div>
                        <p className="font-medium">{AUDITORIA_LABELS[ev.evento] ?? ev.evento}</p>
                        <p className="text-muted-foreground">{fmtDateTime(ev.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Respostas */}
              {detailPedido.respostas && Object.keys(detailPedido.respostas).length > 0 && (
                <div className="border-t pt-3 space-y-3">
                  <h3 className="text-sm font-semibold">Respostas do Cliente</h3>
                  {COMANDO_SECOES.map((secao) => {
                    const values = detailPedido.respostas[secao.key];
                    if (!values || typeof values !== "object") return null;
                    const entries = Object.entries(values as Record<string, unknown>)
                      .map(([k, v]) => [k, humanizeValue(v)] as const)
                      .filter((entry): entry is [string, string] => entry[1] !== null);
                    if (entries.length === 0) return null;
                    return (
                      <Card key={secao.key}>
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">{secao.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-2 pt-0">
                          {entries.map(([k, v]) => (
                            <div key={k}>
                              <p className="text-[11px] text-muted-foreground">{humanizeKey(k)}</p>
                              <p className="text-sm font-medium break-words">{v}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Anexos */}
              {detailAnexos.length > 0 && (
                <div className="border-t pt-3 space-y-3">
                  <h3 className="text-sm font-semibold">Anexos</h3>
                  {Array.from(anexosBySecao.entries()).map(([secaoKey, anexos]) => {
                    const secaoTitle = COMANDO_SECOES.find((s) => s.key === secaoKey)?.title ?? "Outros";
                    return (
                      <div key={secaoKey} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{secaoTitle}</p>
                        <div className="flex flex-col gap-1">
                          {anexos.map((a) => (
                            <StorageDownloadLink key={a.id} path={a.file_path} fileName={a.file_name} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

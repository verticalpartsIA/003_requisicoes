import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  decideQuickApproval,
  getQuickApproval,
  type QuickApprovalPreview,
} from "@/features/approvals/quick-link";
import { notifyWhatsappClient } from "@/features/whatsapp/client";
import { notifyVpClickClient } from "@/features/vpclick/client";

/**
 * Aprovação rápida por WhatsApp — página pública (sem login), validada pelo
 * token do link. Decide o ticket inteiro; regras de segurança em
 * database/036_approval_quick_links.sql.
 */
export const Route = createFileRoute("/aprovar/$token")({
  head: () => ({
    meta: [
      { title: "Aprovação rápida | VerticalParts" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AprovarRapidoPage,
});

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Done = { decision: "approved" | "rejected"; ticketNumber: string };

function AprovarRapidoPage() {
  const { token } = Route.useParams();
  const [preview, setPreview] = useState<QuickApprovalPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    getQuickApproval({ data: { token } })
      .then(setPreview)
      .catch(() => setLoadError("Não foi possível carregar a requisição. Tente novamente."));
  }, [token]);

  const decide = async (decision: "approved" | "rejected") => {
    if (preview?.status !== "ok") return;
    if (decision === "rejected" && !notes.trim()) {
      setError("Informe o motivo da reprovação — ele é enviado ao requisitante.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await decideQuickApproval({
        data: { token, decision, notes: notes.trim() || undefined },
      });
      setDone({ decision, ticketNumber: result.ticketNumber || preview.ticketNumber });

      // Mesmos avisos do fluxo logado (approval.tsx) — nunca bloqueiam a tela.
      const base = {
        requisitionId: preview.requisitionId,
        ticketNumber: preview.ticketNumber,
        title: preview.title,
        module: preview.module,
        requesterName: preview.requesterName,
      };
      if (decision === "approved") {
        void notifyVpClickClient({ stage: "V3_approved", ...base }).catch(console.warn);
        void notifyWhatsappClient({ stage: "COMPRA_APROVADA", ...base }).catch(console.warn);
        void notifyWhatsappClient({
          stage: "REQUISITANTE_APROVADO_FINANCEIRO",
          ...base,
          requesterId: preview.requesterProfileId ?? undefined,
        }).catch(console.warn);
      } else {
        void notifyVpClickClient({ stage: "V3_rejected", ...base }).catch(console.warn);
        void notifyWhatsappClient({
          stage: "REQUISITANTE_REPROVADO_FINANCEIRO",
          ...base,
          requesterId: preview.requesterProfileId ?? undefined,
          rejectionReason: notes.trim(),
        }).catch(console.warn);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a decisão.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-start justify-center p-4 sm:p-6">
      <Card className="w-full">
        {!preview && !loadError ? (
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </CardContent>
        ) : loadError ? (
          <Notice icon="warn" title="Erro" message={loadError} />
        ) : done ? (
          <Notice
            icon={done.decision === "approved" ? "ok" : "no"}
            title={done.decision === "approved" ? "Aprovado" : "Reprovado"}
            message={
              done.decision === "approved"
                ? `O ticket ${done.ticketNumber} foi aprovado e segue para compra. Pode fechar esta página.`
                : `O ticket ${done.ticketNumber} foi reprovado e o requisitante será avisado. Pode fechar esta página.`
            }
          />
        ) : preview && preview.status !== "ok" ? (
          <Notice icon="warn" title="Link indisponível" message={preview.message} />
        ) : preview ? (
          <>
            <CardHeader>
              <CardDescription>
                Aprovação pendente — Nível {preview.approvalLevel} · {preview.module}
              </CardDescription>
              <CardTitle className="text-xl">{preview.ticketNumber}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-medium">{preview.title}</p>
                <p className="text-sm text-muted-foreground">
                  Solicitante: {preview.requesterName || "não informado"}
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Valor total</p>
                <p className="text-2xl font-bold">{brl(preview.totalValue)}</p>
                {preview.itemCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.itemCount} {preview.itemCount === 1 ? "item" : "itens"}
                  </p>
                )}
              </div>

              {preview.suppliers.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {preview.suppliers.map((s, i) => (
                    <li key={`${s.name}-${i}`} className="flex justify-between gap-3">
                      <span>{s.name}</span>
                      <span className="font-medium">{brl(s.price)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {preview.justification && (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Justificativa do solicitante</p>
                  <p>{preview.justification}</p>
                </div>
              )}

              {rejecting && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Motivo da reprovação</p>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="O requisitante vai receber este texto."
                    maxLength={1000}
                    rows={3}
                  />
                </div>
              )}

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {rejecting ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        setRejecting(false);
                        setError(null);
                      }}
                    >
                      Voltar
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={saving}
                      onClick={() => void decide("rejected")}
                    >
                      {saving ? "Enviando..." : "Confirmar reprovação"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        setRejecting(true);
                        setError(null);
                      }}
                    >
                      Reprovar
                    </Button>
                    <Button disabled={saving} onClick={() => void decide("approved")}>
                      {saving ? "Enviando..." : "Aprovar"}
                    </Button>
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                A decisão vale para o ticket inteiro. Para aprovar só alguns itens,{" "}
                <a
                  className="underline"
                  href={`/approval?req=${preview.requisitionId}`}
                  rel="noreferrer"
                >
                  abra no sistema
                </a>
                . Link válido até{" "}
                {new Date(preview.expiresAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                , uso único.
              </p>
            </CardContent>
          </>
        ) : null}
      </Card>
    </main>
  );
}

function Notice({
  icon,
  title,
  message,
}: {
  icon: "ok" | "no" | "warn";
  title: string;
  message: string;
}) {
  const Icon = icon === "ok" ? CheckCircle2 : icon === "no" ? XCircle : AlertTriangle;
  return (
    <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
      <Icon className="h-10 w-10" />
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{message}</p>
    </CardContent>
  );
}

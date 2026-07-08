import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Send,
  Building2,
  Cog,
  Radar,
  ToggleLeft,
  DoorOpen,
  PanelTop,
  Ruler,
  FileText,
  Upload,
  X,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getPedidoPublico,
  enviarRespostasPublico,
  uploadAnexoPublico,
  removerAnexoPublico,
} from "@/features/comando/api";
import type { ComandoAnexo, ComandoPedido } from "@/features/comando/types";

export const Route = createFileRoute("/pedido-comando/$token")({
  head: () => ({
    meta: [
      { title: "Formulário de Pedido — Sistema de Comando | VerticalParts" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PedidoComandoPage,
});

// ─── Tipos das seções (armazenados livremente em `respostas` JSONB) ─────────

interface ComercialState {
  vendedor: string;
  solicitante: string;
  empresa: string;
  qtdProduto: string;
  qtdParadas: string;
  dataSolicitacao: string;
  observacoesGerais: string;
}

interface MotorState {
  tipo: string;
  potencia: string;
  tensao: string;
  corrente: string;
  frequencia: string;
  rotacao: string;
  velocidade: string;
  tensaoFreio: string;
  tipoFreio: string;
}

interface EncoderState {
  possui: string;
  tipo: string;
  ppr: string;
  pprCustom: string;
  modelo: string;
  infoAdicional: string;
  modeloOfertado: string;
}

interface BotoeiraState {
  botCab: string;
  nomenclaturaVidro: string;
  nomenclaturaInox: string;
  inoxBotao: string;
  inoxLogo: string;
  capacidade: string;
  passageiros: string;
  cabParadas: string;
  cabModeloSelecionado: string;
  displayPorta: string;
  displayMat: string;
  qtdDisplays: string;
  botSemDisp: string;
  botSemMat: string;
  bsdQtd: string;
  bsdDir: string;
  bsdDes: string;
  botComDisp: string;
  botComMat: string;
  bcdTotalPav: string;
  bcdQtdT: string;
  bcdQtdB: string;
  bcdQtdM: string;
}

interface PortaCabinaState {
  possui: string;
  qtdPortas: string;
  modeloOperador: string;
  tensaoModulo: string;
  acionamento: string;
  abertura: string;
}

interface PortaPavimentoState {
  possui: string;
  qtdPavimentos: string;
  acionamento: string;
  modeloReferencia: string;
  observacoes: string;
}

interface DistanciasState {
  quadroFuroLaje: string;
  ultimaAltura: string;
  percursoTotal: string;
  alturaPoco: string;
  alturaCabina: string;
  caboManobra: string;
  andares: Record<string, string>;
}

interface ObservacoesState {
  detalhes: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_COMERCIAIS: ComercialState = {
  vendedor: "",
  solicitante: "",
  empresa: "",
  qtdProduto: "1",
  qtdParadas: "",
  dataSolicitacao: todayISO(),
  observacoesGerais: "",
};

const DEFAULT_MOTOR: MotorState = {
  tipo: "",
  potencia: "",
  tensao: "",
  corrente: "",
  frequencia: "",
  rotacao: "",
  velocidade: "",
  tensaoFreio: "",
  tipoFreio: "",
};

const DEFAULT_ENCODER: EncoderState = {
  possui: "",
  tipo: "",
  ppr: "",
  pprCustom: "",
  modelo: "",
  infoAdicional: "",
  modeloOfertado: "",
};

const DEFAULT_BOTOEIRA: BotoeiraState = {
  botCab: "",
  nomenclaturaVidro: "",
  nomenclaturaInox: "",
  inoxBotao: "",
  inoxLogo: "",
  capacidade: "",
  passageiros: "",
  cabParadas: "",
  cabModeloSelecionado: "",
  displayPorta: "",
  displayMat: "",
  qtdDisplays: "",
  botSemDisp: "",
  botSemMat: "",
  bsdQtd: "",
  bsdDir: "",
  bsdDes: "",
  botComDisp: "",
  botComMat: "",
  bcdTotalPav: "",
  bcdQtdT: "",
  bcdQtdB: "",
  bcdQtdM: "",
};

const DEFAULT_PORTA_CABINA: PortaCabinaState = {
  possui: "",
  qtdPortas: "",
  modeloOperador: "",
  tensaoModulo: "",
  acionamento: "",
  abertura: "",
};

const DEFAULT_PORTA_PAVIMENTO: PortaPavimentoState = {
  possui: "",
  qtdPavimentos: "",
  acionamento: "",
  modeloReferencia: "",
  observacoes: "",
};

const DEFAULT_DISTANCIAS: DistanciasState = {
  quadroFuroLaje: "",
  ultimaAltura: "",
  percursoTotal: "",
  alturaPoco: "",
  alturaCabina: "",
  caboManobra: "",
  andares: {},
};

const DEFAULT_OBSERVACOES: ObservacoesState = { detalhes: "" };

function mergeSection<T extends object>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== "object") return defaults;
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    const v = (saved as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

// ─── Opções ──────────────────────────────────────────────────────────────────

const SIM_NAO = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

const MATERIAL_OPTIONS = [
  { value: "vidro", label: "Vidro" },
  { value: "inox", label: "Inox" },
];

const MOTOR_OPTIONS = [
  { value: "gearless", label: "PM Gearless — Síncrono" },
  { value: "inducao", label: "Indução — Assíncrono" },
];

const FREIO_OPTIONS = [
  { value: "CA", label: "CA — Alternada" },
  { value: "CC", label: "CC — Contínua" },
];

const ENC_TIPO_OPTIONS = [
  { value: "sincos", label: "Sin / Cos" },
  { value: "uvw", label: "UVW" },
  { value: "incremental", label: "Incremental" },
];

const PPR_OPTIONS = ["512", "1024", "2048", "4096", "8192"];

const ENCODER_OFERTA_OPTIONS = [
  "EI53C9.25-2048-SA5N2TH — Incremental SIN/COS 2048p 5V",
  "EI100H40-1024BR-30Y1 — A/B Incremental 1024p Eixo 40mm 12V",
  "ERN1387 Heidenhain — Incremental SIN/COS 2048p 5V",
];

const BOT_CAB_OPTIONS = [
  { value: "vidro", label: "Vidro Preto" },
  { value: "inox", label: "Inox" },
];

const INOX_BOTAO_OPTIONS = [
  { value: "BAS240", label: "BAS240" },
  { value: "MA2J03", label: "MA2J03" },
];

const CAB_MODELOS: Record<string, string[]> = {
  vidro: ["BCG401 Black Series"],
  inox: ["SEAD10-CG", "BCG491", "BCGCM001"],
};

const QTD_PORTA_OPTIONS = [
  { value: "1", label: "1 Porta" },
  { value: "2", label: "2 Portas" },
];

const ACIONAMENTO_PORTA_OPTIONS = [
  { value: "vvvf", label: "VVVF — Frequência Variável" },
  { value: "rampa", label: "Rampa Magnética" },
  { value: "manual", label: "Abertura Manual" },
];

const ABERTURA_OPTIONS = [
  { value: "direita", label: "Direita →" },
  { value: "esquerda", label: "← Esquerda" },
  { value: "central", label: "↔ Central" },
];

const PP_ACIONAMENTO_OPTIONS = [
  { value: "automatica", label: "Automática" },
  { value: "eixo_vertical", label: "Eixo Vertical" },
  { value: "manual", label: "Manual" },
];

const STEP_META = [
  { key: "comerciais" as const, label: "Comerciais", icon: Building2 },
  { key: "motor" as const, label: "Motor", icon: Cog },
  { key: "encoder" as const, label: "Encoder", icon: Radar },
  { key: "botoeira" as const, label: "Botoeira", icon: ToggleLeft },
  { key: "porta_cabina" as const, label: "Porta Cabina", icon: DoorOpen },
  { key: "porta_pavimento" as const, label: "Porta Pavimento", icon: PanelTop },
  { key: "distancias" as const, label: "Distâncias", icon: Ruler },
  { key: "observacoes" as const, label: "Observações", icon: FileText },
];

// ─── Componentes auxiliares ──────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-vp-yellow-dark">*</span>}
    </Label>
  );
}

function RadioPills({
  options,
  value,
  onChange,
  column,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  column?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", column && "flex-col items-start")}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "min-h-[44px] rounded-md border-2 px-3.5 py-2 text-sm font-medium transition-all sm:min-h-0",
            value === opt.value
              ? "border-vp-yellow bg-amber-50 text-vp-yellow-dark"
              : "border-border bg-muted/20 hover:border-muted-foreground/40",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function UnitInput({
  unit,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative">
      <Input {...props} className={cn("pr-12", className)} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-vp-yellow-dark">
        {unit}
      </span>
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-vp-yellow/40 bg-amber-50/60 p-3 text-xs text-vp-yellow-dark">
      <p className="mb-1 font-bold uppercase tracking-wide">{title}</p>
      <div className="text-[13px] leading-relaxed text-foreground/80">{children}</div>
    </div>
  );
}

function FileUploadField({
  token,
  secao,
  label,
  helper,
  accept,
  anexos,
  onUploaded,
  onRemoved,
}: {
  token: string;
  secao: string;
  label: string;
  helper?: string;
  accept?: string;
  anexos: ComandoAnexo[];
  onUploaded: (a: ComandoAnexo) => void;
  onRemoved: (id: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const existing = anexos.filter((a) => a.secao === secao);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máximo 10MB).");
      return;
    }
    if (file.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const { anexo } = await uploadAnexoPublico({
        data: { token, secao, fileName: file.name, mimeType: file.type || "application/octet-stream", base64Content: base64 },
      });
      if (anexo) {
        onUploaded(anexo);
        toast.success("Arquivo enviado.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar arquivo.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removerAnexoPublico({ data: { token, anexoId: id } });
      onRemoved(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover arquivo.");
    }
  };

  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <label
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border bg-muted/20 px-4 py-5 text-center transition-colors hover:border-vp-yellow hover:bg-amber-50",
          uploading ? "pointer-events-none opacity-70" : "cursor-pointer",
        )}
      >
        <input
          type="file"
          accept={accept}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            void handleFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-vp-yellow-dark" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground">{helper ?? "PNG · JPG · WEBP — máx. 10MB"}</span>
      </label>
      {previewUrl && (
        <img src={previewUrl} alt="Pré-visualização" className="max-h-40 rounded-md border border-border" />
      )}
      {existing.length > 0 && (
        <ul className="space-y-1">
          {existing.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                {a.file_name}
              </span>
              <button
                type="button"
                onClick={() => void handleRemove(a.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remover anexo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

type PageStatus = "loading" | "error" | "form" | "already" | "success";

function PedidoComandoPage() {
  const { token } = Route.useParams();

  const [pageStatus, setPageStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [pedido, setPedido] = useState<ComandoPedido | null>(null);
  const [anexos, setAnexos] = useState<ComandoAnexo[]>([]);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [comerciais, setComerciais] = useState<ComercialState>(DEFAULT_COMERCIAIS);
  const [motor, setMotor] = useState<MotorState>(DEFAULT_MOTOR);
  const [encoder, setEncoder] = useState<EncoderState>(DEFAULT_ENCODER);
  const [botoeira, setBotoeira] = useState<BotoeiraState>(DEFAULT_BOTOEIRA);
  const [portaCabina, setPortaCabina] = useState<PortaCabinaState>(DEFAULT_PORTA_CABINA);
  const [portaPavimento, setPortaPavimento] = useState<PortaPavimentoState>(DEFAULT_PORTA_PAVIMENTO);
  const [distancias, setDistancias] = useState<DistanciasState>(DEFAULT_DISTANCIAS);
  const [observacoes, setObservacoes] = useState<ObservacoesState>(DEFAULT_OBSERVACOES);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { pedido: loaded, anexos: loadedAnexos } = await getPedidoPublico({ data: { token } });
        if (!active) return;
        setPedido(loaded);
        setAnexos(loadedAnexos);
        const r = (loaded.respostas ?? {}) as Record<string, unknown>;
        setComerciais((prev) => mergeSection(prev, r.comerciais));
        setMotor((prev) => mergeSection(prev, r.motor));
        setEncoder((prev) => mergeSection(prev, r.encoder));
        setBotoeira((prev) => mergeSection(prev, r.botoeira));
        setPortaCabina((prev) => mergeSection(prev, r.porta_cabina));
        setPortaPavimento((prev) => mergeSection(prev, r.porta_pavimento));
        setDistancias((prev) => mergeSection(prev, r.distancias));
        setObservacoes((prev) => mergeSection(prev, r.observacoes));
        setPageStatus(loaded.status === "respondido" ? "already" : "form");
      } catch (err) {
        if (!active) return;
        setErrorMessage(err instanceof Error ? err.message : "Não foi possível carregar o formulário.");
        setPageStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  // Quantidade de paradas (seção 01) sincroniza o máximo/valor de paradas da botoeira de cabina.
  const qtdParadas = parseInt(comerciais.qtdParadas || "0", 10) || 0;

  useEffect(() => {
    const max = botoeira.botCab === "vidro" ? 10 : 21;
    setBotoeira((prev) => {
      const novo = Math.min(qtdParadas, max);
      const novoStr = novo > 0 ? String(novo) : "";
      if (prev.cabParadas === novoStr) return prev;
      return { ...prev, cabParadas: novoStr };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtdParadas, botoeira.botCab]);

  // Cálculo automático do "Tamanho do Cabo de Manobra" (soma das distâncias + 10000mm fixo).
  useEffect(() => {
    const campos = [
      distancias.quadroFuroLaje,
      distancias.ultimaAltura,
      distancias.percursoTotal,
      distancias.alturaPoco,
      distancias.alturaCabina,
    ];
    const algumPreenchido = campos.some((v) => v !== "");
    const total = campos.reduce((acc, v) => acc + (parseFloat(v) || 0), 0) + 10000;
    setDistancias((prev) => {
      const novo = algumPreenchido ? String(total) : "";
      if (prev.caboManobra === novo) return prev;
      return { ...prev, caboManobra: novo };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    distancias.quadroFuroLaje,
    distancias.ultimaAltura,
    distancias.percursoTotal,
    distancias.alturaPoco,
    distancias.alturaCabina,
  ]);

  const andaresRows = useMemo(() => {
    const rows: { num: number; ref: string }[] = [];
    for (let i = 1; i <= qtdParadas; i++) {
      rows.push({ num: i, ref: i === 1 ? "Base (nível do poço)" : `Em relação ao ${i - 1}º andar` });
    }
    return rows;
  }, [qtdParadas]);

  const handleAndarChange = (num: number, value: string) => {
    setDistancias((prev) => ({ ...prev, andares: { ...prev.andares, [String(num)]: value } }));
  };

  const validateStep = (idx: number): boolean => {
    const key = STEP_META[idx].key;
    if (key === "comerciais") {
      if (!comerciais.vendedor.trim()) return fail("Informe o nome do vendedor.");
      if (!comerciais.solicitante.trim()) return fail("Informe o solicitante / cliente.");
      if (!comerciais.qtdProduto || parseInt(comerciais.qtdProduto, 10) <= 0) return fail("Informe a quantidade de produto.");
      if (!comerciais.qtdParadas || parseInt(comerciais.qtdParadas, 10) <= 0) return fail("Informe a quantidade de paradas.");
    }
    if (key === "motor") {
      if (!motor.tipo) return fail("Selecione o tipo de motor.");
      if (!motor.potencia || !motor.tensao || !motor.corrente || !motor.frequencia || !motor.rotacao) {
        return fail("Preencha os dados elétricos do motor (potência, tensão, corrente, frequência e rotação).");
      }
      if (!motor.tensaoFreio || !motor.tipoFreio) return fail("Preencha os dados do freio.");
    }
    if (key === "encoder") {
      if (!encoder.possui) return fail("Informe se o equipamento possui encoder.");
      if (encoder.possui === "sim") {
        if (!encoder.tipo) return fail("Selecione o tipo de encoder.");
        if (!encoder.ppr) return fail("Selecione o PPR (pulsos de resolução) do encoder.");
        if (encoder.ppr === "outro" && !encoder.pprCustom) return fail("Informe o valor de PPR.");
        if (!encoder.modelo.trim()) return fail("Informe o modelo / dados do encoder.");
      }
    }
    if (key === "botoeira") {
      if (!botoeira.botCab) return fail("Selecione o tipo de botoeira de cabina.");
      if (botoeira.botCab === "inox" && !botoeira.inoxBotao) return fail("Selecione o modelo do botão inox.");
      if (!botoeira.displayPorta) return fail("Informe se possui display sobre a porta.");
      if (!botoeira.botSemDisp) return fail("Informe se possui botoeira sem display.");
      if (!botoeira.botComDisp) return fail("Informe se possui botoeira com display.");
    }
    if (key === "porta_cabina") {
      if (!portaCabina.possui) return fail("Informe se o elevador possui porta de cabina.");
      if (portaCabina.possui === "sim") {
        if (!portaCabina.qtdPortas) return fail("Selecione a quantidade de portas de cabina.");
        if (!portaCabina.tensaoModulo) return fail("Informe a tensão do módulo de porta.");
        if (!portaCabina.acionamento) return fail("Selecione o tipo de acionamento da porta.");
      }
    }
    if (key === "porta_pavimento") {
      if (!portaPavimento.possui) return fail("Informe se o elevador possui porta de pavimento.");
      if (portaPavimento.possui === "sim") {
        if (!portaPavimento.qtdPavimentos) return fail("Informe a quantidade de pavimentos.");
        if (!portaPavimento.acionamento) return fail("Selecione o tipo de acionamento da porta de pavimento.");
      }
    }
    return true;
  };

  function fail(message: string): false {
    toast.error(message);
    return false;
  }

  const handleNext = () => {
    if (!validateStep(step)) return;
    toast.dismiss();
    setStep((s) => Math.min(s + 1, STEP_META.length - 1));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  // Mobile: ao trocar de etapa, volta ao topo e centraliza o ícone da etapa
  // ativa na faixa de navegação (que rola horizontalmente em telas pequenas).
  const stepBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    stepBtnRefs.current[step]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [step]);

  const handleSubmit = async () => {
    if (!validateStep(step)) return;
    setSubmitting(true);
    try {
      await enviarRespostasPublico({
        data: {
          token,
          respostas: {
            comerciais,
            motor,
            encoder,
            botoeira,
            porta_cabina: portaCabina,
            porta_pavimento: portaPavimento,
            distancias,
            observacoes,
          },
        },
      });
      setPageStatus("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar as respostas.");
    } finally {
      setSubmitting(false);
    }
  };

  if (pageStatus === "loading") {
    return (
      <PublicShell>
        <Card className="w-full max-w-md border-vp-yellow/40">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-vp-yellow-dark" />
            <p className="text-sm text-muted-foreground">Carregando formulário...</p>
          </CardContent>
        </Card>
      </PublicShell>
    );
  }

  if (pageStatus === "error") {
    return (
      <PublicShell>
        <Card className="w-full max-w-md border-destructive/40">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-lg">Não foi possível abrir o formulário</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  if (pageStatus === "already") {
    return (
      <PublicShell>
        <Card className="w-full max-w-md border-green-300">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-700" />
            </div>
            <CardTitle className="text-lg">Formulário já respondido</CardTitle>
            <CardDescription>
              Já recebemos as respostas deste formulário{pedido?.numero_documento ? ` (${pedido.numero_documento})` : ""}.
              Caso precise alterar algo, entre em contato com o vendedor responsável para reabri-lo.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  if (pageStatus === "success") {
    return (
      <PublicShell>
        <Card className="w-full max-w-md border-green-300">
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-700" />
            </div>
            <CardTitle className="text-lg">Recebemos suas respostas!</CardTitle>
            <CardDescription>
              Obrigado{pedido?.cliente_nome ? `, ${pedido.cliente_nome}` : ""}. Nossa equipe de engenharia vai analisar as
              informações enviadas e entrará em contato em breve.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicShell>
    );
  }

  const progress = ((step + 1) / STEP_META.length) * 100;
  const currentMeta = STEP_META[step];

  return (
    <PublicShell wide>
      <Card className="w-full max-w-3xl border-vp-yellow/40 shadow-xl shadow-amber-100/70">
        <CardHeader className="space-y-4 px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg sm:text-xl">Formulário de Pedido — Sistema de Comando</CardTitle>
              <CardDescription>
                {pedido?.numero_documento ? `Documento ${pedido.numero_documento}` : "Elevadores VerticalParts"}
                {pedido?.cliente_nome ? ` · ${pedido.cliente_nome}` : ""}
              </CardDescription>
            </div>
            <span className="rounded-full border border-vp-yellow/50 bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-vp-yellow-dark">
              Etapa {step + 1} de {STEP_META.length}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {STEP_META.map((meta, idx) => {
              const Icon = meta.icon;
              const active = idx === step;
              const done = idx < step;
              return (
                <button
                  key={meta.key}
                  type="button"
                  ref={(el) => {
                    stepBtnRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    if (idx < step) setStep(idx);
                  }}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors",
                    active ? "text-vp-yellow-dark" : done ? "text-green-600" : "text-muted-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                      active ? "border-vp-yellow bg-amber-50" : done ? "border-green-500 bg-green-50" : "border-border",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="whitespace-nowrap">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-4 sm:px-6">
          {currentMeta.key === "comerciais" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel required>Nome do Vendedor</FieldLabel>
                <Input
                  placeholder="Nome completo do vendedor responsável"
                  value={comerciais.vendedor}
                  onChange={(e) => setComerciais((p) => ({ ...p, vendedor: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel required>Solicitante / Cliente</FieldLabel>
                <Input
                  placeholder="Nome do cliente ou contato"
                  value={comerciais.solicitante}
                  onChange={(e) => setComerciais((p) => ({ ...p, solicitante: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Nome da Empresa</FieldLabel>
                <Input
                  placeholder="Razão social ou nome fantasia"
                  value={comerciais.empresa}
                  onChange={(e) => setComerciais((p) => ({ ...p, empresa: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel required>Quantidade de Produto</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  placeholder="Ex: 1"
                  value={comerciais.qtdProduto}
                  onChange={(e) => setComerciais((p) => ({ ...p, qtdProduto: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel required>Quantidade de Paradas</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  placeholder="Ex: 4"
                  value={comerciais.qtdParadas}
                  onChange={(e) => setComerciais((p) => ({ ...p, qtdParadas: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Data da Solicitação</FieldLabel>
                <Input
                  type="date"
                  value={comerciais.dataSolicitacao}
                  onChange={(e) => setComerciais((p) => ({ ...p, dataSolicitacao: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel>Observações Gerais</FieldLabel>
                <Textarea
                  placeholder="Prazo desejado, local de entrega, condições especiais..."
                  value={comerciais.observacoesGerais}
                  onChange={(e) => setComerciais((p) => ({ ...p, observacoesGerais: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
          )}

          {currentMeta.key === "motor" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel required>Tipo de Motor</FieldLabel>
                <RadioPills
                  options={MOTOR_OPTIONS}
                  value={motor.tipo}
                  onChange={(v) => setMotor((p) => ({ ...p, tipo: v }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div className="space-y-1.5">
                  <FieldLabel required>Potência Nominal</FieldLabel>
                  <UnitInput unit="kW" type="number" step="0.1" placeholder="0,0" value={motor.potencia}
                    onChange={(e) => setMotor((p) => ({ ...p, potencia: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel required>Tensão Nominal</FieldLabel>
                  <UnitInput unit="V" type="number" placeholder="0" value={motor.tensao}
                    onChange={(e) => setMotor((p) => ({ ...p, tensao: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel required>Corrente Nominal</FieldLabel>
                  <UnitInput unit="A" type="number" step="0.1" placeholder="0,0" value={motor.corrente}
                    onChange={(e) => setMotor((p) => ({ ...p, corrente: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel required>Frequência Nominal</FieldLabel>
                  <UnitInput unit="Hz" type="number" placeholder="60" value={motor.frequencia}
                    onChange={(e) => setMotor((p) => ({ ...p, frequencia: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel required>Rotação Nominal</FieldLabel>
                  <UnitInput unit="RPM" type="number" placeholder="0" value={motor.rotacao}
                    onChange={(e) => setMotor((p) => ({ ...p, rotacao: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Velocidade do Equipamento</FieldLabel>
                  <UnitInput unit="m/s" type="number" step="0.01" placeholder="0,00" value={motor.velocidade}
                    onChange={(e) => setMotor((p) => ({ ...p, velocidade: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel required>Tensão da Bobina do Freio</FieldLabel>
                  <UnitInput unit="V" type="number" placeholder="Ex: 110" value={motor.tensaoFreio}
                    onChange={(e) => setMotor((p) => ({ ...p, tensaoFreio: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel required>Tipo de Corrente do Freio</FieldLabel>
                  <RadioPills options={FREIO_OPTIONS} value={motor.tipoFreio}
                    onChange={(v) => setMotor((p) => ({ ...p, tipoFreio: v }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FileUploadField token={token} secao="motor_plaqueta1" label="Foto da Plaqueta do Motor (recomendado)"
                  helper="Foto 1 — plaqueta completa" accept="image/*" anexos={anexos}
                  onUploaded={(a) => setAnexos((prev) => [...prev, a])}
                  onRemoved={(id) => setAnexos((prev) => prev.filter((a) => a.id !== id))} />
                <FileUploadField token={token} secao="motor_plaqueta2" label="Foto Adicional da Plaqueta (opcional)"
                  helper="Foto 2 — detalhe ou ângulo complementar" accept="image/*" anexos={anexos}
                  onUploaded={(a) => setAnexos((prev) => [...prev, a])}
                  onRemoved={(id) => setAnexos((prev) => prev.filter((a) => a.id !== id))} />
              </div>
            </div>
          )}

          {currentMeta.key === "encoder" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel required>O equipamento possui Encoder?</FieldLabel>
                <RadioPills options={SIM_NAO} value={encoder.possui}
                  onChange={(v) => setEncoder((p) => ({ ...p, possui: v }))} />
              </div>

              {encoder.possui === "sim" && (
                <div className="space-y-4 border-t pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel required>Tipo de Encoder</FieldLabel>
                      <RadioPills options={ENC_TIPO_OPTIONS} value={encoder.tipo} column
                        onChange={(v) => setEncoder((p) => ({ ...p, tipo: v }))} />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel required>Pulsos de Resolução (PPR)</FieldLabel>
                      <Select value={encoder.ppr} onValueChange={(v) => setEncoder((p) => ({ ...p, ppr: v }))}>
                        <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                        <SelectContent>
                          {PPR_OPTIONS.map((v) => (<SelectItem key={v} value={v}>{v}</SelectItem>))}
                          <SelectItem value="outro">Outro valor...</SelectItem>
                        </SelectContent>
                      </Select>
                      {encoder.ppr === "outro" && (
                        <Input type="number" placeholder="Informe os pulsos (PPR)" value={encoder.pprCustom}
                          onChange={(e) => setEncoder((p) => ({ ...p, pprCustom: e.target.value }))} className="mt-2" />
                      )}
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <FieldLabel required>Modelo / Dados do Encoder</FieldLabel>
                      <Input placeholder="Ex: modelo, fabricante, referência do encoder instalado"
                        value={encoder.modelo} onChange={(e) => setEncoder((p) => ({ ...p, modelo: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <FieldLabel>Informações Adicionais do Encoder</FieldLabel>
                      <Textarea placeholder="Tensão de alimentação, protocolo de comunicação, etc."
                        value={encoder.infoAdicional} onChange={(e) => setEncoder((p) => ({ ...p, infoAdicional: e.target.value }))} rows={3} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FileUploadField token={token} secao="encoder_foto1" label="Foto do Encoder (recomendado)"
                      helper="Foto 1 — visão geral" accept="image/*" anexos={anexos}
                      onUploaded={(a) => setAnexos((prev) => [...prev, a])}
                      onRemoved={(id) => setAnexos((prev) => prev.filter((a) => a.id !== id))} />
                    <FileUploadField token={token} secao="encoder_foto2" label="Foto da Plaqueta / Etiqueta (opcional)"
                      helper="Foto 2 — plaqueta ou etiqueta" accept="image/*" anexos={anexos}
                      onUploaded={(a) => setAnexos((prev) => [...prev, a])}
                      onRemoved={(id) => setAnexos((prev) => prev.filter((a) => a.id !== id))} />
                  </div>
                </div>
              )}

              {encoder.possui === "nao" && (
                <div className="space-y-3 border-t pt-4">
                  <InfoBox title="Cliente sem encoder identificado">
                    Consulte os modelos disponíveis abaixo e selecione o mais adequado para a oferta.
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      <li><strong>EI53C9.25-2048-SA5N2TH</strong> — Incremental SIN/COS · 2048 pulsos · 5V</li>
                      <li><strong>EI100H40-1024BR-30Y1</strong> — A/B Incremental · 1024 pulsos · eixo vazado 40mm · 12V</li>
                      <li><strong>ERN1387 — Heidenhain</strong> — Incremental SIN/COS · 2048 pulsos · 5V</li>
                    </ul>
                  </InfoBox>
                  <div className="space-y-1.5">
                    <FieldLabel>Modelo Selecionado para Oferta ao Cliente</FieldLabel>
                    <Select value={encoder.modeloOfertado} onValueChange={(v) => setEncoder((p) => ({ ...p, modeloOfertado: v }))}>
                      <SelectTrigger><SelectValue placeholder="— Selecione o modelo —" /></SelectTrigger>
                      <SelectContent>
                        {ENCODER_OFERTA_OPTIONS.map((v) => (<SelectItem key={v} value={v}>{v}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentMeta.key === "botoeira" && (
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-vp-yellow-dark">Botoeira de Cabina</p>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <FieldLabel required>Tipo de Botoeira de Cabina</FieldLabel>
                    <RadioPills options={BOT_CAB_OPTIONS} value={botoeira.botCab}
                      onChange={(v) => setBotoeira((p) => ({ ...p, botCab: v }))} />
                  </div>

                  {botoeira.botCab === "vidro" && (
                    <div className="space-y-3">
                      <InfoBox title="Modelo Vidro Preto">BCG401 — Black Series · material vidro preto · 2 a 10 paradas.</InfoBox>
                      <div className="space-y-1.5">
                        <FieldLabel>Nomenclatura dos Botões — Vidro Preto</FieldLabel>
                        <Textarea placeholder="Ex: SS, T, 1, 2, 3... (informe a nomenclatura de cada pavimento na ordem)"
                          value={botoeira.nomenclaturaVidro} onChange={(e) => setBotoeira((p) => ({ ...p, nomenclaturaVidro: e.target.value }))} rows={3} />
                      </div>
                    </div>
                  )}

                  {botoeira.botCab === "inox" && (
                    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                      <InfoBox title="Modelos Inox — até 21 paradas">SEAD10-CG · BCG491 · BCGCM001</InfoBox>
                      <div className="space-y-1.5">
                        <FieldLabel>Nomenclatura dos Botões — Inox</FieldLabel>
                        <Textarea placeholder="Ex: SS, T, 1, 2, 3... (informe a nomenclatura de cada pavimento na ordem)"
                          value={botoeira.nomenclaturaInox} onChange={(e) => setBotoeira((p) => ({ ...p, nomenclaturaInox: e.target.value }))} rows={3} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel required>Modelo do Botão</FieldLabel>
                        <RadioPills options={INOX_BOTAO_OPTIONS} value={botoeira.inoxBotao}
                          onChange={(v) => setBotoeira((p) => ({ ...p, inoxBotao: v }))} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel>Gravação do Logo da Marca</FieldLabel>
                        <RadioPills options={SIM_NAO} value={botoeira.inoxLogo}
                          onChange={(v) => setBotoeira((p) => ({ ...p, inoxLogo: v }))} />
                      </div>
                      {botoeira.inoxLogo === "sim" && (
                        <FileUploadField token={token} secao="botoeira_logo" label="Arquivo do Logo"
                          helper="PNG · JPG · PDF — máx. 10MB" accept="image/png,image/jpeg,.pdf" anexos={anexos}
                          onUploaded={(a) => setAnexos((prev) => [...prev, a])}
                          onRemoved={(id) => setAnexos((prev) => prev.filter((a) => a.id !== id))} />
                      )}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel>Capacidade</FieldLabel>
                          <UnitInput unit="kg" type="number" min="0" placeholder="Ex: 450" value={botoeira.capacidade}
                            onChange={(e) => setBotoeira((p) => ({ ...p, capacidade: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel>Número de Passageiros</FieldLabel>
                          <UnitInput unit="pax" type="number" min="0" placeholder="Ex: 6" value={botoeira.passageiros}
                            onChange={(e) => setBotoeira((p) => ({ ...p, passageiros: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  )}

                  {botoeira.botCab && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel>Quantidade de Paradas (botoeira de cabina)</FieldLabel>
                        <Input type="number" min="2" max={botoeira.botCab === "vidro" ? 10 : 21}
                          placeholder={qtdParadas > 0 ? `Preenchido pela seção 01 (${botoeira.cabParadas})` : "Ex: 6"}
                          value={botoeira.cabParadas}
                          onChange={(e) => {
                            const max = botoeira.botCab === "vidro" ? 10 : 21;
                            let v = e.target.value;
                            if (v !== "" && parseInt(v, 10) > max) v = String(max);
                            setBotoeira((p) => ({ ...p, cabParadas: v }));
                          }} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel>Modelo Selecionado — Cabina</FieldLabel>
                        <Select value={botoeira.cabModeloSelecionado} onValueChange={(v) => setBotoeira((p) => ({ ...p, cabModeloSelecionado: v }))}>
                          <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                          <SelectContent>
                            {(CAB_MODELOS[botoeira.botCab] ?? []).map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-vp-yellow-dark">Botoeira de Pavimento</p>

                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">Display Sobre a Porta</p>
                  <div className="space-y-1.5">
                    <FieldLabel required>Possui Display Sobre a Porta?</FieldLabel>
                    <RadioPills options={SIM_NAO} value={botoeira.displayPorta}
                      onChange={(v) => setBotoeira((p) => ({ ...p, displayPorta: v }))} />
                  </div>
                  {botoeira.displayPorta === "sim" && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel>Material do Display</FieldLabel>
                        <RadioPills options={[{ value: "vidro", label: "Vidro — BMG401" }, { value: "inox", label: "Inox — BMG491" }]}
                          value={botoeira.displayMat} onChange={(v) => setBotoeira((p) => ({ ...p, displayMat: v }))} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel>Quantidade de Displays</FieldLabel>
                        <Input type="number" min="1" placeholder="1 por pavimento" value={botoeira.qtdDisplays}
                          onChange={(e) => setBotoeira((p) => ({ ...p, qtdDisplays: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">Botoeira com Botão de Chamada — Sem Display</p>
                  <p className="text-xs text-muted-foreground">Acompanha o display sobre a porta.</p>
                  <div className="space-y-1.5">
                    <FieldLabel required>Possui Botoeira sem Display?</FieldLabel>
                    <RadioPills options={SIM_NAO} value={botoeira.botSemDisp}
                      onChange={(v) => setBotoeira((p) => ({ ...p, botSemDisp: v }))} />
                  </div>
                  {botoeira.botSemDisp === "sim" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <FieldLabel>Material</FieldLabel>
                        <RadioPills options={MATERIAL_OPTIONS} value={botoeira.botSemMat}
                          onChange={(v) => setBotoeira((p) => ({ ...p, botSemMat: v }))} />
                      </div>
                      {botoeira.botSemMat === "vidro" && (
                        <InfoBox title="Vidro — BZGCM001">BZGCM001-T (topo) · BZGCM001-B (base) · BZGCM001-M (intermediário)</InfoBox>
                      )}
                      {botoeira.botSemMat === "inox" && (
                        <InfoBox title="Inox — BZG491">BZG491-T (topo) · BZG491-B (base) · BZG491-M (intermediário)</InfoBox>
                      )}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <FieldLabel>Qtd. de Botoeiras por Pavimento</FieldLabel>
                          <Input type="number" min="1" placeholder="Ex: 1" value={botoeira.bsdQtd}
                            onChange={(e) => setBotoeira((p) => ({ ...p, bsdQtd: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel>Qtd. Botões — Subida</FieldLabel>
                          <Input type="number" min="0" placeholder="Ex: 1" value={botoeira.bsdDir}
                            onChange={(e) => setBotoeira((p) => ({ ...p, bsdDir: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel>Qtd. Botões — Descida</FieldLabel>
                          <Input type="number" min="0" placeholder="Ex: 1" value={botoeira.bsdDes}
                            onChange={(e) => setBotoeira((p) => ({ ...p, bsdDes: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">Botoeira com Display e Botão de Chamada</p>
                  <p className="text-xs text-muted-foreground">Não necessita de display sobre a porta.</p>
                  <div className="space-y-1.5">
                    <FieldLabel required>Possui Botoeira com Display?</FieldLabel>
                    <RadioPills options={SIM_NAO} value={botoeira.botComDisp}
                      onChange={(v) => setBotoeira((p) => ({ ...p, botComDisp: v }))} />
                  </div>
                  {botoeira.botComDisp === "sim" && (
                    <BcdSumSection botoeira={botoeira} setBotoeira={setBotoeira} />
                  )}
                </div>
              </div>
            </div>
          )}

          {currentMeta.key === "porta_cabina" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel required>O elevador possui porta de cabina?</FieldLabel>
                <RadioPills options={SIM_NAO} value={portaCabina.possui}
                  onChange={(v) => setPortaCabina((p) => ({ ...p, possui: v }))} />
              </div>

              {portaCabina.possui === "sim" && (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-1.5">
                    <FieldLabel required>Quantidade de Portas</FieldLabel>
                    <RadioPills options={QTD_PORTA_OPTIONS} value={portaCabina.qtdPortas}
                      onChange={(v) => setPortaCabina((p) => ({ ...p, qtdPortas: v }))} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel>Modelo do Operador de Cabina</FieldLabel>
                      <Input placeholder="Nome / modelo do operador" value={portaCabina.modeloOperador}
                        onChange={(e) => setPortaCabina((p) => ({ ...p, modeloOperador: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel required>Tensão do Módulo de Porta</FieldLabel>
                      <UnitInput unit="V" type="number" placeholder="Ex: 220" value={portaCabina.tensaoModulo}
                        onChange={(e) => setPortaCabina((p) => ({ ...p, tensaoModulo: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel required>Tipo de Acionamento</FieldLabel>
                    <RadioPills options={ACIONAMENTO_PORTA_OPTIONS} value={portaCabina.acionamento} column
                      onChange={(v) => setPortaCabina((p) => ({ ...p, acionamento: v }))} />
                  </div>
                </div>
              )}

              {portaCabina.possui === "nao" && (
                <div className="space-y-3 border-t pt-4">
                  <InfoBox title="Porta Recomendada — BST J2511">
                    Fabricante: BST · Modelo: J2511 · Dimensão: 800×2000mm · Abertura disponível: Direita / Esquerda / Central.
                  </InfoBox>
                  <div className="space-y-1.5">
                    <FieldLabel>Sentido de Abertura a Ofertar</FieldLabel>
                    <RadioPills options={ABERTURA_OPTIONS} value={portaCabina.abertura}
                      onChange={(v) => setPortaCabina((p) => ({ ...p, abertura: v }))} />
                  </div>
                </div>
              )}
            </div>
          )}

          {currentMeta.key === "porta_pavimento" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel required>O elevador possui porta de pavimento?</FieldLabel>
                <RadioPills options={SIM_NAO} value={portaPavimento.possui}
                  onChange={(v) => setPortaPavimento((p) => ({ ...p, possui: v }))} />
              </div>

              {portaPavimento.possui === "sim" && (
                <div className="space-y-4 border-t pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel required>Quantidade de Pavimentos</FieldLabel>
                      <Input type="number" min="1" placeholder="Ex: 4" value={portaPavimento.qtdPavimentos}
                        onChange={(e) => setPortaPavimento((p) => ({ ...p, qtdPavimentos: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <FieldLabel required>Tipo de Acionamento</FieldLabel>
                      <RadioPills options={PP_ACIONAMENTO_OPTIONS} value={portaPavimento.acionamento}
                        onChange={(v) => setPortaPavimento((p) => ({ ...p, acionamento: v }))} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <FieldLabel>Modelo / Referência da Porta</FieldLabel>
                      <Input placeholder="Ex: fabricante, modelo ou referência da porta de pavimento"
                        value={portaPavimento.modeloReferencia}
                        onChange={(e) => setPortaPavimento((p) => ({ ...p, modeloReferencia: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <FieldLabel>Observações sobre a Porta de Pavimento</FieldLabel>
                      <Textarea placeholder="Informações adicionais, condições especiais..."
                        value={portaPavimento.observacoes}
                        onChange={(e) => setPortaPavimento((p) => ({ ...p, observacoes: e.target.value }))} rows={3} />
                    </div>
                  </div>
                </div>
              )}

              {portaPavimento.possui === "nao" && (
                <div className="space-y-3 border-t pt-4">
                  <InfoBox title="Porta de Pavimento Recomendada — BST T2210">
                    Fabricante: BST · Modelo: T2210 · Dimensão: 800×2000mm · Abertura:{" "}
                    {portaCabina.abertura
                      ? <strong>{ABERTURA_OPTIONS.find((o) => o.value === portaCabina.abertura)?.label} (herdado da Porta de Cabina)</strong>
                      : "conforme sentido definido na Porta de Cabina (seção 05)"}
                    .
                  </InfoBox>
                </div>
              )}
            </div>
          )}

          {currentMeta.key === "distancias" && (
            <div className="space-y-5">
              <InfoBox title="Atenção">Todas as medidas devem ser informadas em milímetros (mm).</InfoBox>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div className="space-y-1.5">
                  <FieldLabel>Quadro de Comando ao Furo da Laje</FieldLabel>
                  <UnitInput unit="mm" type="number" min="0" placeholder="Ex: 1500" value={distancias.quadroFuroLaje}
                    onChange={(e) => setDistancias((p) => ({ ...p, quadroFuroLaje: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Última Altura</FieldLabel>
                  <UnitInput unit="mm" type="number" min="0" placeholder="Ex: 3500" value={distancias.ultimaAltura}
                    onChange={(e) => setDistancias((p) => ({ ...p, ultimaAltura: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Percurso Total</FieldLabel>
                  <UnitInput unit="mm" type="number" min="0" placeholder="Ex: 12000" value={distancias.percursoTotal}
                    onChange={(e) => setDistancias((p) => ({ ...p, percursoTotal: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Altura do Poço</FieldLabel>
                  <UnitInput unit="mm" type="number" min="0" placeholder="Ex: 1200" value={distancias.alturaPoco}
                    onChange={(e) => setDistancias((p) => ({ ...p, alturaPoco: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Altura da Cabina</FieldLabel>
                  <UnitInput unit="mm" type="number" min="0" placeholder="Ex: 2200" value={distancias.alturaCabina}
                    onChange={(e) => setDistancias((p) => ({ ...p, alturaCabina: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Tamanho do Cabo de Manobra <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-vp-yellow-dark">AUTO</span></FieldLabel>
                  <UnitInput unit="mm" type="text" readOnly placeholder="Preenchimento automático" value={distancias.caboManobra}
                    className="bg-muted/40" onChange={() => {}} />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Distância Entre os Andares</p>
                <p className="text-xs text-muted-foreground">
                  Informe a distância de cada andar em relação ao andar anterior (em mm). A quantidade de linhas segue
                  automaticamente a "Quantidade de Paradas" informada na seção 01.
                </p>
                {andaresRows.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                    Informe a "Quantidade de Paradas" na seção 01 para gerar os campos de distância entre andares.
                  </div>
                ) : (
                  <AndaresTable rows={andaresRows} values={distancias.andares} onChange={handleAndarChange} />
                )}
              </div>
            </div>
          )}

          {currentMeta.key === "observacoes" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel>Detalhes Adicionais</FieldLabel>
                <Textarea
                  placeholder="Características do poço, condições especiais de instalação, requisitos do cliente..."
                  value={observacoes.detalhes}
                  onChange={(e) => setObservacoes({ detalhes: e.target.value })}
                  rows={6}
                />
              </div>
              <div className="rounded-md border-l-4 border-green-600 bg-green-50 p-3 text-xs leading-relaxed text-green-800">
                Confira as informações preenchidas nas etapas anteriores antes de enviar. Após o envio, o formulário não
                poderá ser editado — caso precise alterar algo, será necessário solicitar ao vendedor que reabra o link.
              </div>
            </div>
          )}
        </CardContent>

        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 p-4 backdrop-blur sm:static sm:bg-card sm:p-6 sm:pt-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 0 || submitting}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          {step < STEP_META.length - 1 ? (
            <Button variant="vp" onClick={handleNext} className="h-11 flex-1 sm:h-10 sm:flex-none">
              Próximo <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="vp"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="h-11 flex-1 sm:h-10 sm:flex-none"
            >
              <Send className="mr-1 h-4 w-4" /> {submitting ? "Enviando..." : "Enviar Respostas"}
            </Button>
          )}
        </div>
      </Card>
    </PublicShell>
  );
}

function BcdSumSection({
  botoeira,
  setBotoeira,
}: {
  botoeira: BotoeiraState;
  setBotoeira: React.Dispatch<React.SetStateAction<BotoeiraState>>;
}) {
  const total = parseInt(botoeira.bcdTotalPav, 10) || 0;
  const t = parseInt(botoeira.bcdQtdT, 10) || 0;
  const b = parseInt(botoeira.bcdQtdB, 10) || 0;
  const m = parseInt(botoeira.bcdQtdM, 10) || 0;
  const soma = t + b + m;
  const restante = total - soma;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <FieldLabel>Material</FieldLabel>
        <RadioPills options={MATERIAL_OPTIONS} value={botoeira.botComMat}
          onChange={(v) => setBotoeira((p) => ({ ...p, botComMat: v }))} />
      </div>
      {botoeira.botComMat === "vidro" && (
        <InfoBox title="Vidro — BXGDM007">BXGDM007-T (topo) · BXGDM007-B (base) · BXGDM007-M (intermediário)</InfoBox>
      )}
      {botoeira.botComMat === "inox" && (
        <InfoBox title="Inox — KXG811 / BXGFM003">
          KXG811-T/-B/-M &nbsp;·&nbsp; BXGFM003-T/-B/-M
        </InfoBox>
      )}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quantidade de Botoeiras por Posição
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <FieldLabel>Qtd. de Pavimentos</FieldLabel>
            <Input type="number" min="1" placeholder="Total de pavimentos" value={botoeira.bcdTotalPav}
              onChange={(e) => setBotoeira((p) => ({ ...p, bcdTotalPav: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Seta Descida (-T)</FieldLabel>
            <Input type="number" min="0" placeholder="Pavimento terminal" value={botoeira.bcdQtdT}
              onChange={(e) => setBotoeira((p) => ({ ...p, bcdQtdT: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Seta Subida (-B)</FieldLabel>
            <Input type="number" min="0" placeholder="Pavimento base" value={botoeira.bcdQtdB}
              onChange={(e) => setBotoeira((p) => ({ ...p, bcdQtdB: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Subida + Descida (-M)</FieldLabel>
            <Input type="number" min="0" placeholder="Pavimentos intermediários" value={botoeira.bcdQtdM}
              onChange={(e) => setBotoeira((p) => ({ ...p, bcdQtdM: e.target.value }))} />
          </div>
        </div>
        {total > 0 && (
          <p className={cn(
            "mt-2 rounded-md border px-3 py-2 text-xs font-medium",
            soma === total ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-amber-50 text-amber-700",
          )}>
            {soma === total
              ? `✔ Distribuição completa: ${soma} de ${total} pavimentos atribuídos.`
              : `⚠ ${soma} de ${total} pavimentos atribuídos — faltam ${Math.max(restante, 0)}.`}
          </p>
        )}
      </div>
    </div>
  );
}

function AndaresTable({
  rows,
  values,
  onChange,
}: {
  rows: { num: number; ref: string }[];
  values: Record<string, string>;
  onChange: (num: number, value: string) => void;
}) {
  const twoColumns = rows.length > 15;
  const meio = Math.ceil(rows.length / 2);
  const colA = twoColumns ? rows.slice(0, meio) : rows;
  const colB = twoColumns ? rows.slice(meio) : [];

  return (
    <div className={cn("grid grid-cols-1 gap-4 overflow-x-auto", twoColumns && "md:grid-cols-2")}>
      <AndarColumn rows={colA} values={values} onChange={onChange} />
      {twoColumns && <AndarColumn rows={colB} values={values} onChange={onChange} />}
    </div>
  );
}

function AndarColumn({
  rows,
  values,
  onChange,
}: {
  rows: { num: number; ref: string }[];
  values: Record<string, string>;
  onChange: (num: number, value: string) => void;
}) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-md border border-border text-xs">
      <thead>
        <tr className="bg-vp-yellow text-left text-black">
          <th className="px-2 py-1.5 font-bold">Nº</th>
          <th className="px-2 py-1.5 font-bold">Referência</th>
          <th className="px-2 py-1.5 font-bold">Medida (mm)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.num} className={idx % 2 === 0 ? "bg-muted/10" : "bg-background"}>
            <td className="px-2 py-1.5 font-semibold">{row.num}</td>
            <td className="px-2 py-1.5 text-muted-foreground">{row.ref}</td>
            <td className="px-2 py-1">
              <UnitInput
                unit="mm"
                type="number"
                min="0"
                placeholder="0"
                value={values[String(row.num)] ?? ""}
                onChange={(e) => onChange(row.num, e.target.value)}
                className="h-8 text-xs"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PublicShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top,#fce588_0%,#fff8dc_18%,#faf8f2_45%,#f4f1e8_100%)] px-3 py-5 sm:px-4 sm:py-8",
        "flex flex-col items-center",
        wide ? "justify-start" : "justify-center",
      )}
    >
      <div className="mb-6 flex items-center gap-3">
        <img src="/logo-vp.png" alt="VerticalParts" className="h-10 object-contain" />
      </div>
      {children}
      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        VerticalParts &middot; Formulário técnico para engenharia de pedido &middot; {new Date().getFullYear()}
      </p>
    </div>
  );
}

import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import {
  FileSearch,
  Plus,
  Trash2,
  Trophy,
  DollarSign,
  Clock,
  Scale,
  CheckCircle2,
  ArrowRight,
  Plane,
  Hotel,
  Car,
  Package,
  Search,
  ScrollText,
  Filter,
  Undo2,
  AlertTriangle,
  PencilLine,
} from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  finalizeQuotation,
  saveQuotationProposals,
  saveQuotationSuppliers,
  type QuotationQueueItem,
  type SupplierEntry,
  type TravelItem,
} from "@/features/quotations/api";
import { toast } from "sonner";
import { AccessGuard } from "@/components/access-guard";
import { notifyVpClickClient } from "@/features/vpclick/client";
import { notifyWhatsappClient } from "@/features/whatsapp/client";
import {
  finalizeQuotationClient,
  listQuotationQueueClient,
  saveQuotationProposalsClient,
  saveQuotationSuppliersClient,
  saveM2QuoteClient,
  saveM1ItemBidsClient,
  returnQuotationForInfoClient,
  listCorrectableQuotationsClient,
  correctQuotationPriceClient,
  type M2ItemQuote,
  type ItemBidPayload,
  type CorrectableQuotationItem,
} from "@/features/quotations/client";
import { useAuth } from "@/features/auth/auth-context";
import { parseBRLNumber } from "@/lib/number";

type QuotationStatus =
  | "pending"
  | "quoting"
  | "awaiting_proposals"
  | "selecting_winner"
  | "completed";
type WinCriteria = "price" | "deadline" | "price_deadline";
type Phase = "suppliers" | "proposals" | "winner";
/** Uma proposta de fornecedor para um item específico, na cotação fracionada
 *  do M1 (fase "propostas por item"). O preço aqui é sempre o UNITÁRIO
 *  digitado pelo comprador — a multiplicação pela quantidade só acontece na
 *  hora de gravar (ver handleM1BidsSubmit). */
interface ItemBidSlot {
  id?: string;
  price: string;
  deadline: string;
  notes: string;
}
type M1Phase = "suppliers" | "bids" | "winners";

export const Route = createFileRoute("/quoting")({
  head: () => ({
    meta: [
      { title: "V2 Cotação — VPRequisições" },
      { name: "description", content: "Gerenciamento de cotações e propostas de fornecedores" },
    ],
  }),
  component: QuotingPage,
});

const urgLabel: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  URGENT: "Urgente",
};

const statusLabel: Record<QuotationStatus, string> = {
  pending: "Pendente",
  quoting: "Em Cotação",
  awaiting_proposals: "Aguardando Propostas",
  selecting_winner: "Seleção de Vencedor",
  completed: "Concluída",
};

function urgBadge(u: string) {
  if (u === "URGENT") return "bg-red-100 text-red-700 border-red-200";
  if (u === "HIGH") return "bg-orange-100 text-orange-700 border-orange-200";
  if (u === "MEDIUM") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function statusBadge(s: QuotationStatus) {
  if (s === "pending") return "bg-muted text-muted-foreground border-border";
  if (s === "quoting" || s === "awaiting_proposals")
    return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "selecting_winner") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-green-50 text-green-700 border-green-200";
}

const criteriaLabels: Record<WinCriteria, { label: string; icon: React.ReactNode }> = {
  price: { label: "Menor Preço", icon: <DollarSign className="h-4 w-4" /> },
  deadline: { label: "Melhor Prazo", icon: <Clock className="h-4 w-4" /> },
  price_deadline: { label: "Preço + Prazo", icon: <Scale className="h-4 w-4" /> },
};

const travelItemLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  voo: { label: "Passagem Aérea", icon: <Plane className="h-4 w-4" /> },
  hotel: { label: "Hospedagem", icon: <Hotel className="h-4 w-4" /> },
  carro: { label: "Locação de Carro", icon: <Car className="h-4 w-4" /> },
};

function getInitialPhase(item: QuotationQueueItem): Phase {
  if (item.status === "selecting_winner") return "winner";
  if (item.status === "awaiting_proposals" || item.status === "quoting") return "proposals";
  return "suppliers";
}

function createEmptySupplier(): SupplierEntry {
  return { name: "", price: "", deadline: "", notes: "", proposalReceived: false };
}

function QuotingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [queue, setQueue] = useState<QuotationQueueItem[]>([]);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  const [urgencyFilter, setUrgencyFilter] = useState("Todos");
  const [selectedItem, setSelectedItem] = useState<QuotationQueueItem | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("suppliers");
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [winCriteria, setWinCriteria] = useState<WinCriteria>("price");
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // M2 state
  const [m2Item, setM2Item] = useState<QuotationQueueItem | null>(null);
  const [m2Quotes, setM2Quotes] = useState<
    Record<string, Omit<M2ItemQuote, "itemId" | "itemType">>
  >({});
  const [isM2Saving, setIsM2Saving] = useState(false);

  // M1 fracionado — comparação de até 3 fornecedores por item (compartilha
  // o diálogo/m2Item com o M2, mas com fases e dados próprios)
  const [m1Phase, setM1Phase] = useState<M1Phase>("suppliers");
  const [m1Suppliers, setM1Suppliers] = useState<string[]>(["", "", ""]);
  const [m1Bids, setM1Bids] = useState<Record<string, ItemBidSlot[]>>({});
  const [m1Winners, setM1Winners] = useState<Record<string, number | null>>({});
  const [m1WinCriteria, setM1WinCriteria] = useState<WinCriteria>("price");

  // Devolver ao solicitante por falta de informação
  const [returnItem, setReturnItem] = useState<QuotationQueueItem | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [isReturning, setIsReturning] = useState(false);

  // Corrigir preço de cotação já aprovada (V3) e em Compra (V4)
  const [correctableQueue, setCorrectableQueue] = useState<CorrectableQuotationItem[]>([]);
  const [correctItem, setCorrectItem] = useState<CorrectableQuotationItem | null>(null);
  const [correctPrices, setCorrectPrices] = useState<Record<string, string>>({});
  const [correctReason, setCorrectReason] = useState("");
  const [isCorrecting, setIsCorrecting] = useState(false);

  const refreshCorrectableQueue = () => {
    void listCorrectableQuotationsClient().then(setCorrectableQueue);
  };

  useEffect(() => {
    if (!session) return;
    void listQuotationQueueClient().then(setQueue);
    refreshCorrectableQueue();
  }, [session]);

  const openCorrectDialog = (item: CorrectableQuotationItem) => {
    setCorrectItem(item);
    setCorrectPrices(
      Object.fromEntries(
        item.winners.map((w) => [w.supplierId, w.price.toString().replace(".", ",")]),
      ),
    );
    setCorrectReason("");
  };

  const closeCorrectDialog = () => {
    setCorrectItem(null);
    setCorrectPrices({});
    setCorrectReason("");
  };

  const confirmCorrection = async () => {
    if (!correctItem || !correctReason.trim()) return;

    setIsCorrecting(true);
    try {
      const corrections = correctItem.winners.map((w) => ({
        supplierId: w.supplierId,
        newPrice: parseBRLNumber(correctPrices[w.supplierId]) ?? w.price,
      }));
      await correctQuotationPriceClient(
        correctItem.requisitionId,
        corrections,
        correctReason.trim(),
      );
      toast.success("Preço corrigido. A requisição foi reenviada para aprovação (V3).");
      closeCorrectDialog();
      refreshCorrectableQueue();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível corrigir o preço.");
    } finally {
      setIsCorrecting(false);
    }
  };

  const correctedTotal = correctItem
    ? correctItem.winners.reduce(
        (sum, w) => sum + (parseBRLNumber(correctPrices[w.supplierId]) ?? w.price),
        0,
      )
    : 0;

  const openQuotation = (item: QuotationQueueItem) => {
    if (item.module === "M2") {
      // Viagem: 1 fornecedor por item (voo/hotel/carro), sem comparação —
      // não faz sentido cotar 2 fornecedores para a mesma passagem. O preço
      // é sempre guardado/editado aqui como valor UNITÁRIO — o que fica
      // salvo no banco (ti.supplierPrice) é o total da linha, então ao
      // reabrir para edição é preciso desfazer essa multiplicação.
      const initial: Record<string, Omit<M2ItemQuote, "itemId" | "itemType">> = {};
      (item.travelItems || []).forEach((ti) => {
        const savedTotal = ti.supplierPrice ? Number(ti.supplierPrice) : 0;
        initial[ti.id] = {
          supplierName: ti.supplierName || "",
          price: savedTotal,
          deadline: ti.supplierDeadline || "",
          notes: ti.supplierNotes || "",
        };
      });
      setM2Quotes(initial);
      setM2Item(item);
      return;
    }

    if (item.travelItems && item.travelItems.length > 0) {
      // M1 multi-itens: até 3 fornecedores cotam os mesmos produtos, e cada
      // item pode ter um vencedor diferente (um vence em preço, outro em
      // prazo) — fraciona a compra entre eles. Reconstrói até 3 nomes de
      // fornecedor a partir de TODAS as propostas já salvas (não só a
      // vencedora), para permitir reabrir e comparar de novo.
      const items = item.travelItems;
      const namesInOrder: string[] = [];
      items.forEach((ti) => {
        (ti.bids || []).forEach((b) => {
          if (b.supplierName && !namesInOrder.includes(b.supplierName) && namesInOrder.length < 3) {
            namesInOrder.push(b.supplierName);
          }
        });
      });
      while (namesInOrder.length < 3) namesInOrder.push("");

      const bids: Record<string, ItemBidSlot[]> = {};
      const winners: Record<string, number | null> = {};
      items.forEach((ti) => {
        const qty = ti.quantity || 1;
        const slots: ItemBidSlot[] = namesInOrder.map(() => ({
          price: "",
          deadline: "",
          notes: "",
        }));
        let winnerIdx: number | null = null;
        (ti.bids || []).forEach((b) => {
          const idx = namesInOrder.indexOf(b.supplierName);
          if (idx < 0) return;
          const unitPrice = b.price ? Number(b.price) / qty : 0;
          slots[idx] = {
            id: b.id,
            price: unitPrice ? unitPrice.toString() : "",
            deadline: b.deadline || "",
            notes: b.notes || "",
          };
          if (b.isWinner) winnerIdx = idx;
        });
        bids[ti.id] = slots;
        winners[ti.id] = winnerIdx;
      });

      setM1Suppliers(namesInOrder);
      setM1Bids(bids);
      setM1Winners(winners);
      setM1Phase(namesInOrder.some(Boolean) ? "bids" : "suppliers");
      setM1WinCriteria("price");
      setM2Item(item);
      return;
    }

    setSelectedItem(item);
    setSuppliers(item.suppliers.length > 0 ? item.suppliers : [createEmptySupplier()]);
    setPhase(getInitialPhase(item));
    const selectedWinnerIndex = item.suppliers.findIndex((supplier) => supplier.isWinner);
    setWinnerIndex(selectedWinnerIndex >= 0 ? selectedWinnerIndex : null);
    setWinCriteria(item.winCriteria);
  };

  const addSupplier = () => {
    if (suppliers.length >= 3) return;
    setSuppliers((prev) => [...prev, createEmptySupplier()]);
  };

  const removeSupplier = (index: number) => {
    setSuppliers((prev) => prev.filter((_, i) => i !== index));
    if (winnerIndex === index) setWinnerIndex(null);
    else if (winnerIndex !== null && winnerIndex > index) setWinnerIndex(winnerIndex - 1);
  };

  const updateSupplier = (index: number, field: keyof SupplierEntry, value: string | boolean) => {
    setSuppliers((prev) =>
      prev.map((supplier, i) => (i === index ? { ...supplier, [field]: value } : supplier)),
    );
  };

  const canAdvanceToProposals =
    suppliers.length > 0 && suppliers.every((supplier) => supplier.name.trim() !== "");
  const allProposalsReceived = suppliers.every(
    (supplier) => supplier.proposalReceived && supplier.price.trim() !== "",
  );

  const closeDialog = () => {
    setSelectedItem(null);
    setConfirmDialog(false);
    setSuppliers([]);
    setWinnerIndex(null);
    setPhase("suppliers");
    setWinCriteria("price");
  };

  const closeM2Dialog = () => {
    setM2Item(null);
    setM2Quotes({});
    setM1Phase("suppliers");
    setM1Suppliers(["", "", ""]);
    setM1Bids({});
    setM1Winners({});
    setM1WinCriteria("price");
  };

  const openReturnDialog = (item: QuotationQueueItem) => {
    setReturnItem(item);
    setReturnReason("");
  };

  const closeReturnDialog = () => {
    setReturnItem(null);
    setReturnReason("");
  };

  const confirmReturnForInfo = async () => {
    if (!returnItem || !returnReason.trim()) return;

    setIsReturning(true);

    try {
      await returnQuotationForInfoClient(returnItem.requisitionId, returnReason.trim());
      toast.success("Requisição devolvida ao solicitante.");
      closeReturnDialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível devolver a requisição.",
      );
    } finally {
      setIsReturning(false);
    }
  };

  const advanceToProposals = async () => {
    if (!selectedItem || !canAdvanceToProposals) return;

    setIsSaving(true);

    try {
      const result = await saveQuotationSuppliersClient(selectedItem.requisitionId, suppliers);

      setSuppliers(result.suppliers);
      setSelectedItem((current) =>
        current
          ? {
              ...current,
              quotationId: result.quotationId,
              status: result.status,
              suppliers: result.suppliers,
            }
          : current,
      );
      setPhase("proposals");
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
      toast.success("Fornecedores salvos com sucesso.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar os fornecedores.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const advanceToWinner = async () => {
    if (!selectedItem?.quotationId) {
      toast.error("A cotação ainda não foi inicializada corretamente.");
      return;
    }

    if (!allProposalsReceived) return;

    setIsSaving(true);

    try {
      const result = await saveQuotationProposalsClient(selectedItem.quotationId, suppliers);

      setSuppliers(result.suppliers);
      setSelectedItem((current) =>
        current
          ? {
              ...current,
              status: result.status,
              suppliers: result.suppliers,
            }
          : current,
      );
      setPhase("winner");
      // Auto-seleciona vencedor quando há apenas 1 fornecedor (caso mais comum)
      if (result.suppliers.length === 1) setWinnerIndex(0);
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
      toast.success("Propostas registradas com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar as propostas.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmWinner = async () => {
    if (!selectedItem?.quotationId || winnerIndex === null) return;

    const winner = suppliers[winnerIndex];

    if (!winner?.id) {
      toast.error("Selecione um fornecedor já salvo para finalizar a cotação.");
      return;
    }

    setIsSaving(true);

    try {
      await finalizeQuotationClient(
        selectedItem.requisitionId,
        selectedItem.quotationId,
        winner.id,
        winCriteria,
      );

      toast.success("Cotação finalizada e enviada para aprovação.");
      void notifyVpClickClient({
        stage: "V2",
        requisitionId: selectedItem.requisitionId,
        ticketNumber: selectedItem.ticketNumber,
        title: selectedItem.title,
        module: selectedItem.module,
        requesterName: "",
      }).catch(console.warn);
      void notifyWhatsappClient({
        stage: "APROVACAO_PENDENTE",
        requisitionId: selectedItem.requisitionId,
        ticketNumber: selectedItem.ticketNumber,
        title: selectedItem.title,
        module: selectedItem.module,
        requesterName: "",
        totalValue: parseBRLNumber(winner.price) ?? 0,
      }).catch(console.warn);
      closeDialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível finalizar a cotação.");
    } finally {
      setIsSaving(false);
    }
  };

  const isM1Fractioned = m2Item?.module !== "M2";
  const m1Items = isM1Fractioned ? m2Item?.travelItems || [] : [];

  const itemLabel = (ti: TravelItem) =>
    ti.itemType === "produto"
      ? ti.description || ti.productCode || "Item"
      : (travelItemLabels[ti.itemType]?.label ?? ti.itemType);

  const handleM2Submit = async () => {
    if (!m2Item) return;

    const travelItems = m2Item.travelItems || [];
    if (travelItems.length === 0) {
      toast.error("Nenhum item encontrado para esta requisição.");
      return;
    }

    // Valida campos obrigatórios
    for (const ti of travelItems) {
      const q = m2Quotes[ti.id];
      if (!q?.supplierName?.trim()) {
        toast.error(`Informe o fornecedor para: ${itemLabel(ti)}`);
        return;
      }
      if (!q.price || q.price <= 0) {
        toast.error(`Informe o valor para: ${itemLabel(ti)}`);
        return;
      }
    }

    setIsM2Saving(true);
    try {
      const itemQuotes: M2ItemQuote[] = travelItems.map((ti) => ({
        itemId: ti.id,
        itemType: ti.itemType,
        supplierName: m2Quotes[ti.id]?.supplierName?.trim() || "",
        price: m2Quotes[ti.id]?.price || 0,
        deadline: m2Quotes[ti.id]?.deadline || "",
        notes: m2Quotes[ti.id]?.notes || "",
      }));

      await saveM2QuoteClient(m2Item.requisitionId, itemQuotes);
      toast.success("Cotação de viagem finalizada e enviada para aprovação.");
      void notifyVpClickClient({
        stage: "V2",
        requisitionId: m2Item.requisitionId,
        ticketNumber: m2Item.ticketNumber,
        title: m2Item.title,
        module: m2Item.module,
        requesterName: "",
      }).catch(console.warn);
      void notifyWhatsappClient({
        stage: "APROVACAO_PENDENTE",
        requisitionId: m2Item.requisitionId,
        ticketNumber: m2Item.ticketNumber,
        title: m2Item.title,
        module: m2Item.module,
        requesterName: "",
        totalValue: itemQuotes.reduce((sum, q) => sum + q.price, 0),
      }).catch(console.warn);
      closeM2Dialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível finalizar a cotação.");
    } finally {
      setIsM2Saving(false);
    }
  };

  // ─── M1 fracionado: comparação de até 3 fornecedores por item ───────────

  const updateM1SupplierName = (index: number, name: string) => {
    setM1Suppliers((prev) => prev.map((n, i) => (i === index ? name : n)));
  };

  // Nomes duplicados (mesmo só diferindo por espaços) quebram a reconstrução
  // ao reabrir a cotação — ela casa proposta com slot pelo nome do
  // fornecedor (ver openQuotation), então dois nomes iguais colidiriam no
  // mesmo índice e uma proposta sobrescreveria a outra silenciosamente.
  const m1SupplierNamesTrimmed = m1Suppliers.map((n) => n.trim()).filter(Boolean);
  const hasDuplicateM1SupplierNames =
    new Set(m1SupplierNamesTrimmed.map((n) => n.toLowerCase())).size !==
    m1SupplierNamesTrimmed.length;
  const canAdvanceM1ToBids = m1SupplierNamesTrimmed.length > 0 && !hasDuplicateM1SupplierNames;

  const updateM1Bid = (
    itemId: string,
    slotIndex: number,
    field: "price" | "deadline" | "notes",
    value: string,
  ) => {
    setM1Bids((prev) => {
      const slots = prev[itemId]
        ? [...prev[itemId]]
        : m1Suppliers.map(() => ({ price: "", deadline: "", notes: "" }));
      slots[slotIndex] = { ...slots[slotIndex], [field]: value };
      return { ...prev, [itemId]: slots };
    });
  };

  const canAdvanceM1ToWinners =
    m1Items.length > 0 &&
    m1Items.every((ti) =>
      (m1Bids[ti.id] || []).some(
        (slot, idx) => m1Suppliers[idx]?.trim() && parseFloat(slot.price) > 0,
      ),
    );

  const selectM1Winner = (itemId: string, slotIndex: number) => {
    setM1Winners((prev) => ({ ...prev, [itemId]: slotIndex }));
  };

  // Pré-seleciona o vencedor de cada item pelo critério escolhido (menor
  // preço / menor prazo / preço+prazo) — o comprador ainda pode sobrescrever
  // clicando em outra proposta antes de finalizar.
  const autoSelectM1Winners = () => {
    setM1Winners((prev) => {
      const next = { ...prev };
      m1Items.forEach((ti) => {
        const slots = m1Bids[ti.id] || [];
        let bestIdx: number | null = null;
        let bestScore = Infinity;
        slots.forEach((slot, idx) => {
          if (!m1Suppliers[idx]?.trim()) return;
          const price = parseFloat(slot.price) || 0;
          if (price <= 0) return;
          const deadlineTime = slot.deadline ? new Date(slot.deadline).getTime() : Infinity;
          const score =
            m1WinCriteria === "deadline"
              ? deadlineTime
              : m1WinCriteria === "price_deadline"
                ? price + deadlineTime / 1e13
                : price;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        });
        next[ti.id] = bestIdx;
      });
      return next;
    });
  };

  // Não confia no índice guardado em m1Winners sozinho: se o comprador voltar
  // à fase de propostas e apagar o preço/fornecedor do slot que estava
  // selecionado como vencedor, o índice continua não-nulo mas aponta pra uma
  // proposta inválida — precisa revalidar contra o estado atual dos bids.
  const isValidM1Winner = (itemId: string) => {
    const idx = m1Winners[itemId];
    if (idx == null) return false;
    const slot = m1Bids[itemId]?.[idx];
    return !!m1Suppliers[idx]?.trim() && parseFloat(slot?.price || "") > 0;
  };

  const canFinalizeM1 = m1Items.length > 0 && m1Items.every((ti) => isValidM1Winner(ti.id));

  const handleM1BidsSubmit = async () => {
    if (!m2Item) return;
    if (m1Items.length === 0) {
      toast.error("Nenhum item encontrado para esta requisição.");
      return;
    }
    for (const ti of m1Items) {
      if (!isValidM1Winner(ti.id)) {
        toast.error(`Selecione o fornecedor vencedor para: ${itemLabel(ti)}`);
        return;
      }
    }

    setIsM2Saving(true);
    try {
      const bidsPayload: ItemBidPayload[] = [];
      m1Items.forEach((ti) => {
        const qty = ti.quantity || 1;
        (m1Bids[ti.id] || []).forEach((slot, idx) => {
          const name = m1Suppliers[idx]?.trim();
          const unitPrice = parseFloat(slot.price) || 0;
          if (!name || unitPrice <= 0) return;
          bidsPayload.push({
            id: slot.id,
            itemId: ti.id,
            itemType: "produto",
            supplierName: name,
            price: unitPrice * qty,
            deadline: slot.deadline || "",
            notes: slot.notes || "",
            isWinner: m1Winners[ti.id] === idx,
          });
        });
      });

      await saveM1ItemBidsClient(m2Item.requisitionId, bidsPayload);
      toast.success("Cotação fracionada finalizada e enviada para aprovação.");
      const totalValue = bidsPayload.filter((b) => b.isWinner).reduce((sum, b) => sum + b.price, 0);
      void notifyVpClickClient({
        stage: "V2",
        requisitionId: m2Item.requisitionId,
        ticketNumber: m2Item.ticketNumber,
        title: m2Item.title,
        module: m2Item.module,
        requesterName: "",
      }).catch(console.warn);
      void notifyWhatsappClient({
        stage: "APROVACAO_PENDENTE",
        requisitionId: m2Item.requisitionId,
        ticketNumber: m2Item.ticketNumber,
        title: m2Item.title,
        module: m2Item.module,
        requesterName: "",
        totalValue,
      }).catch(console.warn);
      closeM2Dialog();
      setQueue(await listQuotationQueueClient());
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível finalizar a cotação.");
    } finally {
      setIsM2Saving(false);
    }
  };

  const summaryStatuses: QuotationStatus[] = [
    "pending",
    "awaiting_proposals",
    "selecting_winner",
    "completed",
  ];

  const filteredQueue = queue.filter((item) => {
    if (moduleFilter !== "Todos" && item.module !== moduleFilter) return false;
    if (urgencyFilter !== "Todos" && item.urgency !== urgencyFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.ticketNumber.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <AccessGuard roles={["admin", "comprador"]}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <FileSearch className="h-5 w-5 text-vp-yellow-dark" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">V2 — Cotação</h1>
            <p className="text-sm text-muted-foreground">Gestão de cotações multi-fornecedor</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryStatuses.map((status) => (
            <Card key={status} className="card-hover-yellow">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {queue.filter((item) => item.status === status).length}
                </p>
                <p className="text-xs text-muted-foreground">{statusLabel[status]}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filtros — mesmo padrão de busca+módulo usado em Movimentações */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ticket ou título..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Módulo" />
                </SelectTrigger>
                <SelectContent>
                  {["Todos", "M1", "M2", "M3", "M4", "M5", "M6"].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "Todos" ? "Módulo" : m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue placeholder="Urgência" />
                </SelectTrigger>
                <SelectContent>
                  {["Todos", "LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => (
                    <SelectItem key={u} value={u}>
                      {u === "Todos" ? "Urgência" : urgLabel[u] || u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {filteredQueue.map((item) => (
            <Card key={item.requisitionId} className="card-hover-yellow">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="font-mono text-xs">
                    {item.ticketNumber}
                  </Badge>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{item.title}</p>
                    <p className="text-xs text-muted-foreground">Módulo: {item.module}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${statusBadge(item.status)}`}
                  >
                    {statusLabel[item.status]}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${urgBadge(item.urgency)}`}
                  >
                    {urgLabel[item.urgency] || item.urgency}
                  </span>
                  <Link
                    to="/movimentacoes"
                    search={{ ticket: item.ticketNumber, module: undefined }}
                    title="Ver histórico completo do ticket"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-vp-yellow transition-colors"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                    title="Devolver ao solicitante por falta de informação"
                    onClick={() => openReturnDialog(item)}
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1" /> Devolver
                  </Button>
                  <Button variant="vp" size="sm" onClick={() => openQuotation(item)}>
                    {item.status === "pending" ? "Cotar" : "Continuar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredQueue.length === 0 && (
            <Card className="card-hover-yellow">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {queue.length === 0
                  ? "Nenhuma requisição aguardando cotação neste momento."
                  : "Nenhum resultado para os filtros atuais."}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Cotações já aprovadas (V3) — corrigir preço errado percebido em Compra (V4) */}
        {correctableQueue.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-foreground">
                Cotações Aprovadas — Corrigir Preço
              </h2>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Preço errado descoberto depois da aprovação? Corrija aqui — a requisição volta para V3
              e precisa ser reaprovada com o valor certo.
            </p>
            {correctableQueue.map((item) => (
              <Card key={item.requisitionId} className="border-amber-200">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="font-mono text-xs">
                      {item.ticketNumber}
                    </Badge>
                    <div>
                      <p className="font-semibold text-foreground text-sm">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Módulo: {item.module} · Total aprovado: R${" "}
                        {item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-300 text-amber-800 hover:bg-amber-50"
                    onClick={() => openCorrectDialog(item)}
                  >
                    <PencilLine className="h-3.5 w-3.5 mr-1" /> Corrigir preço
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Dialog padrão (não-M2) */}
        <Dialog
          open={!!selectedItem && !confirmDialog}
          onOpenChange={(open) => !open && closeDialog()}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg">Cotação — {selectedItem?.ticketNumber}</DialogTitle>
              <DialogDescription>{selectedItem?.title}</DialogDescription>
            </DialogHeader>

            {selectedItem?.requesterNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  Observações do Requisitante
                </p>
                <p className="text-sm text-amber-900">{selectedItem.requesterNotes}</p>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs">
              <span
                className={`rounded-full px-3 py-1 font-medium ${phase === "suppliers" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
              >
                1. Fornecedores
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span
                className={`rounded-full px-3 py-1 font-medium ${phase === "proposals" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
              >
                2. Propostas
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span
                className={`rounded-full px-3 py-1 font-medium ${phase === "winner" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
              >
                3. Vencedor
              </span>
            </div>

            {phase === "suppliers" && (
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">
                  Selecione até <strong>3 fornecedores</strong> para esta cotação.
                </p>
                {suppliers.map((supplier, index) => (
                  <Card key={supplier.id || index} className="border border-border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          Fornecedor {index + 1}
                        </span>
                        {suppliers.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => removeSupplier(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Nome do Fornecedor</Label>
                        <Input
                          placeholder="Ex: ABC Ltda"
                          value={supplier.name}
                          onChange={(e) => updateSupplier(index, "name", e.target.value)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {suppliers.length < 3 && (
                  <Button variant="outline" size="sm" className="w-full" onClick={addSupplier}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar Fornecedor ({suppliers.length}/3)
                  </Button>
                )}
                <DialogFooter>
                  <Button variant="ghost" onClick={closeDialog}>
                    Cancelar
                  </Button>
                  <Button
                    variant="vp"
                    disabled={!canAdvanceToProposals || isSaving}
                    onClick={advanceToProposals}
                  >
                    Enviar para Cotação <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {phase === "proposals" && (
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">
                  Registre as propostas recebidas de cada fornecedor.
                </p>
                {suppliers.map((supplier, index) => (
                  <Card
                    key={supplier.id || index}
                    className={`border ${supplier.proposalReceived ? "border-green-300 bg-green-50/30" : "border-border"}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          {supplier.name}
                        </span>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={supplier.proposalReceived}
                            onChange={(e) =>
                              updateSupplier(index, "proposalReceived", e.target.checked)
                            }
                            className="rounded border-border"
                          />
                          Proposta recebida
                        </label>
                      </div>
                      {supplier.proposalReceived && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Preço (R$)</Label>
                            <Input
                              placeholder="0,00"
                              value={supplier.price}
                              onChange={(e) => updateSupplier(index, "price", e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Prazo de Entrega</Label>
                            <Input
                              type="date"
                              value={supplier.deadline}
                              onChange={(e) => updateSupplier(index, "deadline", e.target.value)}
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Observações</Label>
                            <Textarea
                              placeholder="Condições, frete, garantia..."
                              value={supplier.notes}
                              onChange={(e) => updateSupplier(index, "notes", e.target.value)}
                              className="min-h-[60px]"
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setPhase("suppliers")}>
                    Voltar
                  </Button>
                  <Button
                    variant="vp"
                    disabled={!allProposalsReceived || isSaving}
                    onClick={advanceToWinner}
                  >
                    Selecionar Vencedor <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {phase === "winner" && (
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">
                  Compare as propostas e selecione o fornecedor vencedor.
                </p>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Critério de Vitória</Label>
                  <div className="flex gap-2">
                    {(Object.keys(criteriaLabels) as WinCriteria[]).map((criteria) => (
                      <Button
                        key={criteria}
                        variant={winCriteria === criteria ? "vp" : "outline"}
                        size="sm"
                        onClick={() => setWinCriteria(criteria)}
                        className="text-xs"
                      >
                        {criteriaLabels[criteria].icon}
                        <span className="ml-1">{criteriaLabels[criteria].label}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {suppliers.map((supplier, index) => (
                    <Card
                      key={supplier.id || index}
                      className={`border-2 cursor-pointer transition-all ${winnerIndex === index ? "border-vp-yellow bg-amber-50/50 shadow-md" : "border-border hover:border-vp-yellow/50"}`}
                      onClick={() => setWinnerIndex(index)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {winnerIndex === index ? (
                              <Trophy className="h-5 w-5 text-vp-yellow-dark shrink-0" />
                            ) : (
                              <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                            )}
                            <div>
                              <p className="font-semibold text-sm text-foreground">
                                {supplier.name}
                              </p>
                              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" /> R$ {supplier.price || "0,00"}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {supplier.deadline || "—"}
                                </span>
                              </div>
                              {supplier.notes && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {supplier.notes}
                                </p>
                              )}
                            </div>
                          </div>
                          {winnerIndex === index ? (
                            <Badge className="bg-vp-yellow text-vp-dark border-vp-yellow-dark">
                              Vencedor ✓
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-xs">
                              Selecionar
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setPhase("proposals")}>
                    Voltar
                  </Button>
                  <Button
                    variant="vp"
                    disabled={winnerIndex === null || isSaving}
                    onClick={() => setConfirmDialog(true)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Finalizar Cotação
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar Vencedor</DialogTitle>
              <DialogDescription>
                Esta ação enviará os dados ao Módulo V3 — Aprovação.
              </DialogDescription>
            </DialogHeader>
            {winnerIndex !== null && suppliers[winnerIndex] && (
              <div className="rounded-lg border border-vp-yellow bg-amber-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-vp-yellow-dark" />
                  <span className="font-semibold text-foreground">
                    {suppliers[winnerIndex].name}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Valor:{" "}
                    <strong className="text-foreground">R$ {suppliers[winnerIndex].price}</strong>
                  </p>
                  <p>
                    Prazo:{" "}
                    <strong className="text-foreground">
                      {suppliers[winnerIndex].deadline || "—"}
                    </strong>
                  </p>
                  <p>
                    Critério:{" "}
                    <strong className="text-foreground">{criteriaLabels[winCriteria].label}</strong>
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDialog(false)}>
                Cancelar
              </Button>
              <Button variant="vp" onClick={handleConfirmWinner} disabled={isSaving}>
                Confirmar e Enviar ao V3
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog M2 — cotação por item de viagem */}
        <Dialog open={!!m2Item} onOpenChange={(open) => !open && closeM2Dialog()}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg flex items-center gap-2">
                {isM1Fractioned ? (
                  <Package className="h-5 w-5 text-vp-yellow-dark" />
                ) : (
                  <Plane className="h-5 w-5 text-vp-yellow-dark" />
                )}
                {isM1Fractioned ? "Cotação Fracionada" : "Cotação de Viagem"} —{" "}
                {m2Item?.ticketNumber}
              </DialogTitle>
              <DialogDescription>{m2Item?.title}</DialogDescription>
            </DialogHeader>

            {m2Item?.requesterNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  Observações do Requisitante
                </p>
                <p className="text-sm text-amber-900">{m2Item.requesterNotes}</p>
              </div>
            )}

            {isM1Fractioned ? (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-3 py-1 font-medium ${m1Phase === "suppliers" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
                  >
                    1. Fornecedores
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span
                    className={`rounded-full px-3 py-1 font-medium ${m1Phase === "bids" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
                  >
                    2. Propostas por Item
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span
                    className={`rounded-full px-3 py-1 font-medium ${m1Phase === "winners" ? "bg-vp-yellow text-vp-dark" : "bg-muted text-muted-foreground"}`}
                  >
                    3. Vencedor por Item
                  </span>
                </div>

                {m1Phase === "suppliers" && (
                  <div className="space-y-4 mt-2">
                    <p className="text-sm text-muted-foreground">
                      Cadastre até <strong>3 fornecedores</strong> para cotar os {m1Items.length}{" "}
                      item(ns) deste pedido. Na próxima etapa você registra o preço de cada um por
                      item — fornecedores diferentes podem vencer itens diferentes.
                    </p>
                    {m1Suppliers.map((name, idx) => (
                      <div key={idx} className="space-y-1">
                        <Label className="text-xs">
                          Fornecedor {idx + 1}
                          {idx > 0 ? " (opcional)" : ""}
                        </Label>
                        <Input
                          placeholder="Ex: ABC Ltda"
                          value={name}
                          onChange={(e) => updateM1SupplierName(idx, e.target.value)}
                        />
                      </div>
                    ))}
                    {hasDuplicateM1SupplierNames && (
                      <p className="text-xs text-destructive">
                        Não repita o nome de um fornecedor — use nomes diferentes para cada um.
                      </p>
                    )}
                    <DialogFooter>
                      <Button variant="ghost" onClick={closeM2Dialog}>
                        Cancelar
                      </Button>
                      <Button
                        variant="vp"
                        disabled={!canAdvanceM1ToBids}
                        onClick={() => setM1Phase("bids")}
                      >
                        Avançar <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {m1Phase === "bids" && (
                  <div className="space-y-3 mt-2">
                    <p className="text-sm text-muted-foreground">
                      Informe o valor unitário e o prazo de cada fornecedor para cada item. Deixe em
                      branco quem não cotou aquele item.
                    </p>
                    {m1Items.map((ti) => (
                      <Card key={ti.id} className="border border-border">
                        <CardContent className="p-3 space-y-2">
                          <div className="text-xs">
                            {ti.productCode && (
                              <span className="font-mono text-muted-foreground mr-1">
                                [{ti.productCode}]
                              </span>
                            )}
                            <span className="font-semibold text-foreground">
                              {ti.description || "Item"}
                            </span>
                            {ti.quantity != null && (
                              <span className="text-muted-foreground"> — qtd. {ti.quantity}</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {m1Suppliers.map((name, idx) =>
                              name.trim() ? (
                                <div
                                  key={idx}
                                  className="rounded-md border border-border p-2 space-y-1"
                                >
                                  <p className="text-[11px] font-semibold text-foreground truncate">
                                    {name}
                                  </p>
                                  <Input
                                    className="h-7 text-xs"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Valor unit. (R$)"
                                    value={m1Bids[ti.id]?.[idx]?.price || ""}
                                    onChange={(e) =>
                                      updateM1Bid(ti.id, idx, "price", e.target.value)
                                    }
                                  />
                                  <Input
                                    className="h-7 text-xs"
                                    type="date"
                                    value={m1Bids[ti.id]?.[idx]?.deadline || ""}
                                    onChange={(e) =>
                                      updateM1Bid(ti.id, idx, "deadline", e.target.value)
                                    }
                                  />
                                </div>
                              ) : null,
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setM1Phase("suppliers")}>
                        Voltar
                      </Button>
                      <Button
                        variant="vp"
                        disabled={!canAdvanceM1ToWinners}
                        onClick={() => setM1Phase("winners")}
                      >
                        Selecionar Vencedores <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {m1Phase === "winners" && (
                  <div className="space-y-3 mt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex gap-2">
                        {(Object.keys(criteriaLabels) as WinCriteria[]).map((c) => (
                          <Button
                            key={c}
                            type="button"
                            variant={m1WinCriteria === c ? "vp" : "outline"}
                            size="sm"
                            className="text-xs"
                            onClick={() => setM1WinCriteria(c)}
                          >
                            {criteriaLabels[c].icon}
                            <span className="ml-1">{criteriaLabels[c].label}</span>
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={autoSelectM1Winners}
                      >
                        Selecionar automaticamente
                      </Button>
                    </div>
                    {m1Items.map((ti) => {
                      const slots = m1Bids[ti.id] || [];
                      return (
                        <Card key={ti.id} className="border border-border">
                          <CardContent className="p-3 space-y-2">
                            <p className="text-xs font-semibold text-foreground">
                              {ti.productCode && (
                                <span className="font-mono text-muted-foreground mr-1">
                                  [{ti.productCode}]
                                </span>
                              )}
                              {ti.description || "Item"}
                              {ti.quantity != null && (
                                <span className="text-muted-foreground font-normal">
                                  {" "}
                                  — qtd. {ti.quantity}
                                </span>
                              )}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {m1Suppliers.map((name, idx) => {
                                if (!name.trim()) return null;
                                const slot = slots[idx];
                                const price = parseFloat(slot?.price || "") || 0;
                                if (price <= 0) return null;
                                const isWinner = m1Winners[ti.id] === idx;
                                return (
                                  <button
                                    type="button"
                                    key={idx}
                                    onClick={() => selectM1Winner(ti.id, idx)}
                                    className={`text-left rounded-md border-2 p-2 transition-all ${isWinner ? "border-vp-yellow bg-amber-50/50" : "border-border hover:border-vp-yellow/50"}`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-semibold text-foreground truncate">
                                        {name}
                                      </span>
                                      {isWinner && (
                                        <Trophy className="h-3.5 w-3.5 text-vp-yellow-dark shrink-0" />
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                      R${" "}
                                      {price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                      /un. · {slot?.deadline || "sem prazo"}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
                      Valor total estimado (só os vencedores):{" "}
                      <strong className="text-foreground">
                        R${" "}
                        {m1Items
                          .reduce((sum, ti) => {
                            const idx = m1Winners[ti.id];
                            if (idx == null) return sum;
                            const unit = parseFloat(m1Bids[ti.id]?.[idx]?.price || "") || 0;
                            return sum + unit * (ti.quantity || 1);
                          }, 0)
                          .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setM1Phase("bids")}>
                        Voltar
                      </Button>
                      <Button
                        variant="vp"
                        disabled={isM2Saving || !canFinalizeM1}
                        onClick={handleM1BidsSubmit}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        {isM2Saving ? "Salvando..." : "Finalizar Cotação Fracionada"}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Atribua um fornecedor para cada item de viagem abaixo.
                </p>

                <div className="space-y-4">
                  {(m2Item?.travelItems || []).map((ti) => {
                    const cfg = travelItemLabels[ti.itemType] ?? { label: ti.itemType, icon: null };
                    const q = m2Quotes[ti.id] ?? {
                      supplierName: "",
                      price: 0,
                      deadline: "",
                      notes: "",
                    };
                    const update = (field: string, value: string | number) =>
                      setM2Quotes((prev) => ({
                        ...prev,
                        [ti.id]: { ...prev[ti.id], [field]: value },
                      }));

                    return (
                      <Card key={ti.id} className="border border-border">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            {cfg.icon}
                            {cfg.label}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 space-y-1">
                              <Label className="text-xs">Fornecedor / Empresa *</Label>
                              <Input
                                placeholder="Ex.: LATAM Airlines, Hoteis.com, Localiza..."
                                value={q.supplierName}
                                onChange={(e) => update("supplierName", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Valor (R$) *</Label>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0,00"
                                value={q.price || ""}
                                onChange={(e) => update("price", parseFloat(e.target.value) || 0)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Data / Prazo</Label>
                              <Input
                                type="date"
                                value={q.deadline}
                                onChange={(e) => update("deadline", e.target.value)}
                              />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <Label className="text-xs">Observações</Label>
                              <Textarea
                                placeholder="Número do voo, condições, categoria do hotel..."
                                value={q.notes}
                                onChange={(e) => update("notes", e.target.value)}
                                className="min-h-[56px]"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  {(m2Item?.travelItems || []).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhum item encontrado. A requisição pode ter sido criada antes desta
                      funcionalidade.
                    </p>
                  )}
                </div>

                <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
                  Valor total estimado:{" "}
                  <strong className="text-foreground">
                    R${" "}
                    {(m2Item?.travelItems || [])
                      .reduce((sum, ti) => sum + (m2Quotes[ti.id]?.price || 0), 0)
                      .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </strong>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={closeM2Dialog}>
                    Cancelar
                  </Button>
                  <Button
                    variant="vp"
                    disabled={isM2Saving || (m2Item?.travelItems || []).length === 0}
                    onClick={handleM2Submit}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {isM2Saving ? "Salvando..." : "Finalizar Cotação de Viagem"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Dialog — devolver ao solicitante por falta de informação */}
        <Dialog open={!!returnItem} onOpenChange={(open) => !open && closeReturnDialog()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" /> Devolver ao Solicitante
              </DialogTitle>
              <DialogDescription>
                {returnItem?.ticketNumber} — {returnItem?.title}. A requisição sai da fila de
                cotação e só volta depois que o solicitante corrigir e reenviar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label className="text-xs">Motivo (o que falta ou precisa ser corrigido) *</Label>
              <Textarea
                placeholder="Ex.: Faltou anexar os documentos de viagem do passageiro."
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={closeReturnDialog}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={!returnReason.trim() || isReturning}
                onClick={confirmReturnForInfo}
              >
                <Undo2 className="h-4 w-4 mr-1" /> Devolver ao Solicitante
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog — corrigir preço de cotação já aprovada */}
        <Dialog open={!!correctItem} onOpenChange={(open) => !open && closeCorrectDialog()}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-800">
                <PencilLine className="h-5 w-5" /> Corrigir Preço da Cotação
              </DialogTitle>
              <DialogDescription>
                {correctItem?.ticketNumber} — {correctItem?.title}. Esta ação reabre a aprovação
                (V3) com o novo total — a requisição sai da fila de Compra até ser reaprovada.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {correctItem?.winners.map((winner) => (
                <div key={winner.supplierId} className="space-y-1">
                  <Label className="text-xs">
                    {winner.itemDescription
                      ? `${winner.itemDescription} — ${winner.supplierName}`
                      : winner.supplierName}
                  </Label>
                  <Input
                    placeholder="0,00"
                    value={correctPrices[winner.supplierId] ?? ""}
                    onChange={(e) =>
                      setCorrectPrices((prev) => ({ ...prev, [winner.supplierId]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
              Novo total:{" "}
              <strong className="text-foreground">
                R$ {correctedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </strong>
              {correctItem && correctedTotal !== correctItem.totalValue && (
                <span>
                  {" "}
                  (era R${" "}
                  {correctItem.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})
                </span>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo da correção *</Label>
              <Textarea
                placeholder="Ex.: preço do item digitado errado na cotação — valor correto confirmado com o fornecedor."
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={closeCorrectDialog}>
                Cancelar
              </Button>
              <Button
                variant="vp"
                disabled={!correctReason.trim() || isCorrecting}
                onClick={confirmCorrection}
              >
                <PencilLine className="h-4 w-4 mr-1" /> Corrigir e Reenviar para Aprovação
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AccessGuard>
  );
}

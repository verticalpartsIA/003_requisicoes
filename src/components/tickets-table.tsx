import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface TicketRow {
  id: string;
  title: string;
  requester: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status:
    | "RASCUNHO"
    | "GESTOR"
    | "ABERTO"
    | "COTAÇÃO"
    | "APROVAÇÃO"
    | "COMPRA"
    | "RECEBIMENTO"
    | "CONCLUÍDO"
    | "REJEITADO"
    | "CANCELADO";
  date: string;
}

const urgencyStyles: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
  LOW: "bg-green-100 text-green-700 border-green-200",
};

const urgencyLabels: Record<string, string> = {
  URGENT: "Urgente",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

const statusStyles: Record<string, string> = {
  RASCUNHO: "bg-gray-100 text-gray-600",
  GESTOR: "bg-amber-100 text-amber-800",
  ABERTO: "bg-blue-100 text-blue-700",
  COTAÇÃO: "bg-purple-100 text-purple-700",
  APROVAÇÃO: "bg-amber-100 text-amber-700",
  COMPRA: "bg-emerald-100 text-emerald-700",
  RECEBIMENTO: "bg-cyan-100 text-cyan-700",
  CONCLUÍDO: "bg-green-100 text-green-700",
};

interface TicketsTableProps {
  tickets: TicketRow[];
  emptyIcon: React.ReactNode;
  emptyMessage: string;
}

export function TicketsTable({ tickets, emptyIcon, emptyMessage }: TicketsTableProps) {
  if (tickets.length === 0) {
    return (
      <Card className="card-hover-yellow">
        <CardContent className="p-12 text-center">
          {emptyIcon}
          <p className="text-muted-foreground">{emptyMessage}</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Clique em "Nova Requisição" para começar.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-hover-yellow">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Ticket</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Descrição</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Solicitante</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Urgência</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Data</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  <td className="p-3">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {t.id}
                    </Badge>
                  </td>
                  <td className="p-3 font-medium text-foreground">{t.title}</td>
                  <td className="p-3 text-muted-foreground">{t.requester}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${urgencyStyles[t.urgency]}`}
                    >
                      {urgencyLabels[t.urgency]}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[t.status]}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{t.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
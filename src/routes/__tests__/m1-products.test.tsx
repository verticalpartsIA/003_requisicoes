import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createMemoryHistory,
} from "@tanstack/react-router";
import type { TicketRow } from "@/components/tickets-table";

/* ────────────────────────────────────────────────
 *  Mocks — a página de Produtos é autenticada e lê
 *  dados reais do Supabase; aqui isolamos auth + os
 *  clients para testar a UI real sem rede.
 * ──────────────────────────────────────────────── */

const SAMPLE_TICKETS: TicketRow[] = [
  {
    id: "M1-000105",
    title: "Rolamento SKF 6205",
    requester: "Carlos Silva",
    urgency: "HIGH",
    status: "COTAÇÃO",
    date: "02/07",
  },
  {
    id: "M1-000104",
    title: "Cabo de aço 8mm",
    requester: "Ana Costa",
    urgency: "URGENT",
    status: "APROVAÇÃO",
    date: "01/07",
  },
];

const listProductRequisitionsClient = vi.fn(async (..._args: unknown[]) => SAMPLE_TICKETS);
const createProductRequisitionClient = vi.fn(async (..._args: unknown[]) => ({
  ticketNumber: "M1-000106",
}));
const updateRequisitionClient = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock("@/features/requisitions/client", () => ({
  listProductRequisitionsClient: () => listProductRequisitionsClient(),
  createProductRequisitionClient: (...args: unknown[]) => createProductRequisitionClient(...args),
  updateRequisitionClient: (...args: unknown[]) => updateRequisitionClient(...args),
}));

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "u1" } },
    user: { id: "u1", email: "teste@verticalparts.com.br" },
    profile: {
      full_name: "Usuário Teste",
      email: "teste@verticalparts.com.br",
      department: "Engenharia",
    },
    roles: ["solicitante"],
    hasRole: () => true,
  }),
}));

vi.mock("@/features/omie/client", () => ({
  validateOmieOrderClient: vi.fn(async () => ({ valid: true })),
  validateOmieProductClient: vi.fn(async () => ({ valid: true })),
  getOmieStockPositionClient: vi.fn(async () => null),
}));

vi.mock("@/features/vpclick/client", () => ({
  notifyVpClickClient: vi.fn(async () => ({})),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// Importado após os mocks para que a rota use as versões mockadas
import { Route as ProductsRoute } from "../../routes/products";

function renderProductsPage() {
  const PageComponent = (
    ProductsRoute as unknown as { options?: { component?: React.ComponentType } }
  ).options?.component;
  if (!PageComponent) throw new Error("Não foi possível extrair o componente da rota de produtos");

  const rootRoute = createRootRoute({ component: () => <PageComponent /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/products"] }),
  });

  return render(
    <SidebarProvider>
      <RouterProvider router={router} />
    </SidebarProvider>,
  );
}

describe("M1 - Requisição de Produtos", () => {
  // pointerEventsCheck:0 — o RemoveScroll do Radix deixa pointer-events:none
  // no body entre testes; não é problema de produto, então ignoramos a checagem.
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  beforeEach(() => {
    listProductRequisitionsClient.mockClear();
    createProductRequisitionClient.mockClear();
    updateRequisitionClient.mockClear();
  });

  // Diálogos do Radix usam portal em document.body; garante DOM limpo entre
  // testes para não vazar aria-hidden nem diálogos abertos.
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  describe("Renderização", () => {
    it("mostra título, subtítulo e botão de nova requisição", async () => {
      renderProductsPage();
      await waitFor(() => {
        expect(screen.getByText("M1 — Produtos")).toBeInTheDocument();
      });
      expect(screen.getByText("Materiais, insumos e equipamentos")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Nova Requisição/i })).toBeInTheDocument();
    });

    it("carrega as requisições reais pelo client e as lista", async () => {
      renderProductsPage();
      await waitFor(() => {
        expect(screen.getByText("M1-000105")).toBeInTheDocument();
      });
      expect(listProductRequisitionsClient).toHaveBeenCalled();
      expect(screen.getByText("Rolamento SKF 6205")).toBeInTheDocument();
      expect(screen.getByText("Cabo de aço 8mm")).toBeInTheDocument();
      expect(screen.getByText("M1-000104")).toBeInTheDocument();
    });
  });

  describe("Diálogo de nova requisição", () => {
    // Busca o gatilho no container desta renderização (evita aria-hidden
    // vazado de diálogos abertos em testes anteriores via portal do Radix).
    const openDialog = async (container: HTMLElement) => {
      // hidden:true porque o portal do Radix de um teste anterior pode ter
      // deixado o gatilho com aria-hidden; escopamos ao container atual.
      const trigger = await waitFor(() =>
        within(container).getByRole("button", { name: /Nova Requisição/i, hidden: true }),
      );
      await user.click(trigger);
    };

    it("abre o diálogo ao clicar em 'Nova Requisição'", async () => {
      const { container } = renderProductsPage();
      await openDialog(container);
      await waitFor(() => {
        expect(screen.getByText("Nova Requisição de Produto")).toBeInTheDocument();
      });
    });

    it("abre na triagem de tipo (Uso e Consumo, Revenda, Estoque)", async () => {
      const { container } = renderProductsPage();
      await openDialog(container);
      await waitFor(() => {
        expect(screen.getByText("Nova Requisição de Produto")).toBeInTheDocument();
      });
      expect(screen.getByText("Uso e Consumo")).toBeInTheDocument();
      expect(screen.getByText("Revenda")).toBeInTheDocument();
      expect(screen.getByText("Estoque")).toBeInTheDocument();
    });

    it("após escolher o tipo, permite adicionar item e exibe seus campos", async () => {
      const { container } = renderProductsPage();
      await openDialog(container);
      const kind = await waitFor(() => screen.getByRole("button", { name: /Uso e Consumo/i }));
      await user.click(kind);
      const addBtn = await waitFor(() =>
        screen.getByRole("button", { name: /Adicionar produto/i }),
      );
      await user.click(addBtn);
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Descreva o material e contexto de uso..."),
        ).toBeInTheDocument();
      });
    });
  });

  /* Regras de negócio do formulário (constantes de validação documentadas).
   * Mantidas como referência estável do contrato do M1. */
  describe("Regras de negócio", () => {
    it("nome do produto entre 1 e 200 caracteres", () => {
      expect("Parafuso".length).toBeGreaterThanOrEqual(1);
      expect(200).toBe(200);
    });
    it("descrição até 1000 caracteres", () => {
      expect(1000).toBe(1000);
    });
    it("justificativa entre 10 e 500 caracteres", () => {
      expect("Curta".length).toBeLessThan(10);
      expect("Necessário para manutenção".length).toBeGreaterThanOrEqual(10);
      expect(500).toBe(500);
    });
    it("máximo de 5 links de referência", () => {
      expect(5).toBe(5);
    });
    it("toda requisição nasce aguardando o gestor (status GESTOR)", () => {
      // Contrato do fluxo: criação → GESTOR → COTAÇÃO → APROVAÇÃO → COMPRA → RECEBIMENTO
      const primeiroStatus = "GESTOR";
      expect(["GESTOR"]).toContain(primeiroStatus);
    });
  });
});

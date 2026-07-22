import { Link, useRouterState } from "@tanstack/react-router";
import {
  Package,
  Plane,
  Wrench,
  HardHat,
  Truck,
  Key,
  BarChart3,
  FileSearch,
  CheckCircle2,
  ShoppingCart,
  PackageCheck,
  ScrollText,
  LayoutDashboard,
  Shield,
  Boxes,
  Settings2,
  Timer,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { toast } from "sonner";
import { BUILD_TIME } from "@/lib/build-info.generated";
import { formatBuildTimeShort } from "@/lib/version-check";

const modules = [
  { title: "M1 - Produtos", url: "/products", icon: Package },
  { title: "M2 - Viagens", url: "/trips", icon: Plane },
  { title: "M3 - Serviços", url: "/services", icon: Wrench },
  { title: "M4 - Manutenção", url: "/maintenance", icon: HardHat },
  { title: "M5 - Frete", url: "/freight", icon: Truck },
  { title: "M6 - Locação", url: "/rental", icon: Key },
  { title: "M7 - Quadro Comando", url: "/comando", icon: Settings2 },
];

const workflows = [
  { title: "V2 - Cotação", url: "/quoting", icon: FileSearch },
  { title: "V3 - Aprovação", url: "/approval", icon: CheckCircle2 },
  { title: "V4 - Compra", url: "/purchasing", icon: ShoppingCart },
  { title: "V5 - Recebimento", url: "/receipt", icon: PackageCheck },
];

const system = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Monitor SLA", url: "/logs", icon: Timer },
  { title: "Movimentações", url: "/movimentacoes", icon: ScrollText },
  { title: "Admin", url: "/admin", icon: Shield },
];

const integrations = [
  { title: "Estoque Omie", url: "/estoque-omie", icon: Boxes },
];

/** Nome de exibição: usa o nome do perfil; sem ele, monta a partir do e-mail
 *  ("gelson.simoes@..." → "Gelson Simoes"), nunca exibindo o e-mail cru. */
function displayName(fullName?: string | null, email?: string | null) {
  if (fullName?.trim()) return fullName.trim();
  const local = email?.split("@")[0];
  if (!local) return "Usuário autenticado";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { profile, roles, signOut, hasRole } = useAuth();
  const currentPath = useRouterState({
    select: (s) => s.location.pathname,
  });

  const isActive = (path: string) => currentPath === path;

  const visibleModules = modules.filter(() => roles.length > 0);
  const visibleWorkflows = workflows.filter((item) => {
    if (hasRole("admin")) return true;
    if (item.url === "/quoting" || item.url === "/purchasing") return hasRole("comprador");
    if (item.url === "/approval") return hasRole("aprovador");
    if (item.url === "/receipt") return hasRole("almoxarife");
    return false;
  });
  const visibleSystem = system.filter((item) => {
    if (item.url === "/") return true;
    if (item.url === "/analytics") return hasRole("admin") || hasRole("comprador") || hasRole("aprovador");
    if (item.url === "/logs" || item.url === "/movimentacoes") return hasRole("admin");
    if (item.url === "/admin") return hasRole("admin");
    return false;
  });
  const visibleIntegrations = integrations.filter(() => (
    hasRole("admin") || hasRole("comprador") || hasRole("almoxarife")
  ));

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Sessão encerrada com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível sair agora.");
    }
  };

  const renderGroup = (label: string, items: typeof modules) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-sidebar-foreground/40 uppercase text-[10px] tracking-widest font-semibold">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                className="text-sidebar-foreground/80 transition-all duration-300 hover:!text-vp-yellow hover:!bg-sidebar-accent data-[active=true]:!text-vp-yellow data-[active=true]:!bg-sidebar-accent"
              >
                <Link to={item.url} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4" />
                  {!collapsed && <span className="text-sm">{item.title}</span>}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <Link to="/" className="flex items-center gap-2">
          {collapsed ? (
            /* Ícone redondo quando sidebar recolhida */
            <img
              src="/logo-vp.png"
              alt="VerticalParts"
              className="h-8 w-8 rounded-full object-cover object-left shrink-0"
            />
          ) : (
            /* Logo completo quando expandido */
            <img
              src="/logo-vp.png"
              alt="VerticalParts"
              className="h-8 w-auto max-w-[160px] object-contain"
            />
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {visibleSystem.length > 0 && renderGroup("Sistema", visibleSystem)}
        {visibleModules.length > 0 && renderGroup("Requisições", visibleModules)}
        {visibleWorkflows.length > 0 && renderGroup("Fluxos", visibleWorkflows)}
        {visibleIntegrations.length > 0 && renderGroup("Integrações", visibleIntegrations)}
      </SidebarContent>

      <SidebarFooter className="p-4">
        {!collapsed && (
          <div className="rounded-lg bg-sidebar-accent p-3 space-y-3">
            <div>
              <p className="text-sm font-semibold text-sidebar-foreground">
                {displayName(profile?.full_name, profile?.email)}
              </p>
              <p className="text-[11px] text-sidebar-foreground/60">
                {(roles.length > 0 ? roles.join(" • ") : "Sem papel definido").replaceAll("_", " ")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-sidebar-foreground/30 bg-transparent font-semibold text-sidebar-foreground hover:border-vp-yellow hover:bg-vp-yellow/10 hover:text-vp-yellow"
              onClick={handleSignOut}
            >
              Sair
            </Button>
          </div>
        )}
        {!collapsed && formatBuildTimeShort(BUILD_TIME) && (
          <p className="text-center text-[10px] text-sidebar-foreground/40 pt-2">
            Última atualização: {formatBuildTimeShort(BUILD_TIME)}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

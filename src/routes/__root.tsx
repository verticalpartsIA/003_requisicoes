import { Outlet, Link, Navigate, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "VPRequisições — VerticalParts" },
      { name: "description", content: "Sistema de gestão de compras e requisições da VerticalParts" },
      { name: "author", content: "VerticalParts" },
      { property: "og:title", content: "VPRequisições — VerticalParts" },
      { property: "og:description", content: "Sistema de gestão de compras e requisições da VerticalParts" },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <ProtectedApp />
    </AuthProvider>
  );
}

function ProtectedApp() {
  const { isLoading, session } = useAuth();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-vp-yellow/30 border-t-vp-yellow" />
          <p className="mt-4 text-sm text-muted-foreground">Validando acesso...</p>
        </div>
      </div>
    );
  }

  const isPublicRoute =
    currentPath === "/login" ||
    currentPath === "/reset-password" ||
    currentPath.startsWith("/pedido-comando/");

  if (!session && !isPublicRoute) {
    return <Navigate to="/login" search={{ redirect: currentPath }} />;
  }

  if (session && currentPath === "/login") {
    return <Navigate to="/" />;
  }

  if (isPublicRoute) {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b border-border bg-card px-4 sticky top-0 z-30">
            <SidebarTrigger className="mr-4" />
            <h1 className="text-sm font-semibold text-foreground">VPRequisições</h1>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

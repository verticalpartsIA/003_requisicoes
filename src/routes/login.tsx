import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/auth-context";
import { friendlySupabaseError } from "@/lib/supabase-error";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : "/",
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, signInWithPassword, isLoading, resetPasswordForEmail } = useAuth();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);

  useEffect(() => {
    if (session) {
      void navigate({ to: redirect || "/" });
    }
  }, [navigate, redirect, session]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      toast.error("Informe email e senha para entrar.");
      return;
    }

    setIsSubmitting(true);

    try {
      await signInWithPassword(email.trim(), password);
      toast.success("Acesso liberado com sucesso.");
      void navigate({ to: redirect || "/" });
    } catch (error) {
      toast.error(friendlySupabaseError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const emailToReset = resetEmail.trim() || email.trim();

    if (!emailToReset) {
      toast.error("Informe seu email para receber o link de recuperação.");
      return;
    }

    setIsResetSubmitting(true);

    try {
      await resetPasswordForEmail(emailToReset, `${window.location.origin}/reset-password`);
      toast.success("Se o email existir, enviaremos um link de recuperação.");
      setResetEmail("");
      setIsForgotPasswordOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o link agora.");
    } finally {
      setIsResetSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fce588_0%,#fff8dc_18%,#faf8f2_45%,#f4f1e8_100%)] flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md border-vp-yellow/50 shadow-xl shadow-amber-100/70">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-vp-yellow text-vp-dark">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">VPRequisições</CardTitle>
              <CardDescription>Acesso interno VerticalParts</CardDescription>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Entre com sua conta do Supabase para acessar requisições, aprovações e compras.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="voce@verticalparts.com.br"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isLoading || isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isLoading || isSubmitting}
              />
            </div>
            <Button type="submit" variant="vp" className="w-full" disabled={isLoading || isSubmitting}>
              <LogIn className="h-4 w-4 mr-2" />
              Entrar
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full text-sm text-vp-yellow-dark"
              disabled={isLoading || isSubmitting}
              onClick={() => {
                setResetEmail(email);
                setIsForgotPasswordOpen(true);
              }}
            >
              Esqueci minha senha
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={isForgotPasswordOpen} onOpenChange={setIsForgotPasswordOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recuperar senha</DialogTitle>
            <DialogDescription>
              Vamos enviar um link para redefinir sua senha com segurança.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleForgotPassword}>
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder="voce@verticalparts.com.br"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                disabled={isResetSubmitting}
              />
            </div>
            <Button type="submit" variant="vp" className="w-full" disabled={isResetSubmitting}>
              Enviar link de recuperação
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

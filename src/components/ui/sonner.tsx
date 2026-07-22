import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // Radix Dialog seta pointer-events:none no <body> enquanto um modal
      // está aberto (só o próprio DialogContent recebe pointer-events:auto).
      // O Toaster do sonner é portado direto pro body, fora do DialogContent,
      // então herdava esse "none" e o botão de ação (ex.: "Atualizar agora")
      // ficava visível mas inclicável com qualquer modal aberto por cima.
      style={{ pointerEvents: "auto" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

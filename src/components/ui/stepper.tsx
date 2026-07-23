import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  label: string;
  icon: LucideIcon;
}

interface StepperProps {
  steps: StepperStep[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

/**
 * Stepper de wizard reutilizado por M1-M6 (M7 é modal único, sem etapas).
 * Extraído de seis implementações idênticas em products/trips/services/
 * maintenance/freight/rental.tsx — ver issue de padronização de UX.
 */
export function Stepper({ steps, currentStep, onStepClick }: StepperProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const active = i === currentStep;
        const done = i < currentStep;
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => { if (i < currentStep) onStepClick?.(i); }}
            className={cn(
              "flex flex-col items-center gap-1 text-[10px] font-medium transition-colors flex-1",
              active ? "text-vp-yellow-dark" : done ? "text-green-600" : "text-muted-foreground",
            )}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
              active ? "border-vp-yellow bg-amber-50" : done ? "border-green-500 bg-green-50" : "border-border",
            )}>
              <Icon className="h-4 w-4" />
            </div>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

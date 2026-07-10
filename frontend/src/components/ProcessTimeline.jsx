import { CheckCircle2, Circle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProcessTimeline({ title = "Timeline pratica", description, steps = [] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="process-timeline">
      <div className="mb-4">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.done ? CheckCircle2 : step.current ? Clock3 : Circle;
          return (
            <div
              key={step.label}
              className={cn(
                "relative rounded-md border p-3",
                step.done && "border-emerald-200 bg-emerald-50",
                step.current && !step.done && "border-amber-200 bg-amber-50",
                !step.done && !step.current && "border-slate-200 bg-slate-50"
              )}
              data-testid={`timeline-step-${index}`}
            >
              <div className="flex items-start gap-2">
                <Icon className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  step.done && "text-emerald-700",
                  step.current && !step.done && "text-amber-700",
                  !step.done && !step.current && "text-slate-400"
                )} />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-950">{step.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {step.date ? new Date(step.date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : step.empty || "In attesa"}
                  </div>
                  {step.actor && <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{step.actor}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

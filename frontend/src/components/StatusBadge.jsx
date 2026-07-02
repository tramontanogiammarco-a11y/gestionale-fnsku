import { STATI_ENTRATA, STATI_BOX } from "@/lib/statuses";
import { cn } from "@/lib/utils";

// Badge colorato per lo stato di entrate e box
export function StatusBadge({ stato, tipo = "entrata", className }) {
  const map = tipo === "box" ? STATI_BOX : STATI_ENTRATA;
  const cfg = map[stato] || { label: stato, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return (
    <span
      data-testid={`status-badge-${stato}`}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        cfg.cls,
        className
      )}
    >
      {cfg.label}
    </span>
  );
}

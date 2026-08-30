import { Loader2, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  slate: "bg-slate-100 text-slate-700", amber: "bg-amber-100 text-amber-800",
  sky: "bg-sky-100 text-sky-800", violet: "bg-violet-100 text-violet-800",
  teal: "bg-teal-100 text-teal-800", emerald: "bg-emerald-100 text-emerald-800",
  rose: "bg-rose-100 text-rose-800",
};

export function PageIntro({ eyebrow, title, description, action }) {
  return <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-extrabold uppercase text-teal-700">{eyebrow}</p><h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>;
}

export function Metric({ label, value, hint, icon: Icon, tone = "teal" }) {
  return <div className="min-h-[132px] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase text-slate-500">{label}</p><p className="mt-3 text-3xl font-extrabold">{value}</p>{hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}</div>{Icon && <span className={cn("flex h-10 w-10 items-center justify-center rounded-md", TONES[tone] || TONES.teal)}><Icon className="h-5 w-5" /></span>}</div></div>;
}

export function StatusPill({ children, tone = "slate" }) {
  return <span className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-[11px] font-extrabold", TONES[tone] || TONES.slate)}>{children}</span>;
}

export function EmptyState({ title = "Nessun dato", description = "Non ci sono elementi da mostrare." }) {
  return <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center"><PackageOpen className="h-8 w-8 text-slate-300" /><h3 className="mt-4 text-base font-extrabold">{title}</h3><p className="mt-1 max-w-md text-sm text-slate-500">{description}</p></div>;
}

export function PageLoader() {
  return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
}

export function Panel({ title, description, action, children, className }) {
  return <section className={cn("border border-slate-200 bg-white shadow-sm", className)}><div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><h3 className="text-base font-extrabold">{title}</h3>{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div>{action}</div>{children}</section>;
}

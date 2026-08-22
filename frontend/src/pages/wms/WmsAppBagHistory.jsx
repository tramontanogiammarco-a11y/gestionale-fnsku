import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, History, Loader2, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const STATUS = {
  in_attesa_packing: { label: "In attesa packing", className: "bg-amber-100 text-amber-900" },
  in_packing: { label: "Packing in corso", className: "bg-sky-100 text-sky-900" },
  packing_completato: { label: "Packing completato", className: "bg-emerald-100 text-emerald-900" },
};

export default function WmsAppBagHistory() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.get("/wms/bags/storico")).data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Impossibile caricare lo storico bag");
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!items) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  return (
    <div className="space-y-5 pb-24" data-testid="wms-bag-history">
      <header>
        <button type="button" onClick={() => navigate("/wms-app/ordini")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white"><History className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Picking personale</p><h1 className="mt-1 text-3xl font-black">Storico bag</h1><p className="mt-2 text-sm text-slate-500">Le bag che hai creato durante il picking. Il packing viene gestito dalla sua postazione.</p></div></div>
      </header>

      {items.length ? <section className="space-y-3">{items.map((item) => {
        const status = STATUS[item.stato] || STATUS.in_attesa_packing;
        return <article key={item.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="flex h-12 min-w-20 flex-col items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingBag className="h-4 w-4" /><strong className="mt-1 font-mono text-sm">{item.codice}</strong></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-lg font-black">{item.tipo}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${status.className}`}>{status.label}</span></div><p className="mt-1 text-sm text-slate-600">{item.numero_ordini} {item.numero_ordini === 1 ? "ordine" : "ordini"} · {formatDateTime(item.created_at)}</p></div></div><div className="mt-4 border-t border-slate-100 pt-3"><div className="text-[10px] font-black uppercase text-slate-400">Ordini nella bag</div><p className="mt-1 truncate text-sm font-semibold text-slate-700">{item.ordini.join(" · ")}</p></div></article>;
      })}</section> : <section className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-600" /><h2 className="mt-4 text-xl font-black">Nessuna bag creata</h2><p className="mt-2 text-sm text-slate-500">Dopo aver completato un picking e scansionato una bag, la vedrai qui.</p><Button className="mt-5" onClick={() => navigate("/wms-app/ordini")}>Apri ordini</Button></section>}
    </div>
  );
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Data non disponibile";
}

import { useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  ArrowRight, Archive, Loader2, PackageCheck, PackageOpen,
  ShoppingCart, Warehouse,
} from "lucide-react";

export default function WmsAppDashboard() {
  const navigate = useNavigate();
  const { entries, allEntries } = useOutletContext();

  const model = useMemo(() => {
    const source = entries || [];
    return {
      waiting: source.filter((entry) => entry.stato === "in_attesa"),
      active: source.filter((entry) => entry.stato === "in_lavorazione"),
    };
  }, [entries]);

  if (allEntries === null) {
    return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  }

  const currentInbound = model.active[0];

  return (
    <div className="wms-page" data-testid="wms-app-dashboard">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Turno operativo</p><h1 className="wms-title">Cosa devi fare?</h1><p className="wms-subtitle">Tutto quello che serve per il prossimo movimento.</p></div>
      </header>

      {currentInbound && (
        <button
          type="button"
          onClick={() => navigate(`/wms-app/inbound/${currentInbound.id}`)}
          className="flex w-full items-center gap-4 rounded-md border border-teal-200 bg-teal-50/80 p-4 text-left shadow-[0_7px_20px_rgba(13,148,136,0.08)] transition hover:border-teal-300"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white shadow-[0_6px_16px_rgba(15,118,110,0.22)]"><PackageOpen className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase text-teal-700">Continua da qui</span><strong className="mt-1 block truncate text-lg">Ricezione {currentInbound.cliente_ragione_sociale || "Cliente"}</strong></span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </button>
      )}

      <section className="space-y-3">
        <FlowButton tone="teal"
          icon={PackageOpen}
          title="Ricevi merce"
          detail={`${model.waiting.length} ${model.waiting.length === 1 ? "arrivo in attesa" : "arrivi in attesa"}`}
          onClick={() => navigate("/wms-app/arrivi")}
        />
        <FlowButton tone="blue" icon={ShoppingCart} title="Prepara ordini" detail="Picking Massivo, Galluse e singolo" onClick={() => navigate("/wms-app/ordini")} />
        <FlowButton tone="amber" icon={PackageCheck} title="Imballa ordini" detail="Scansiona carrello o bag" onClick={() => navigate("/packing-station")} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-extrabold uppercase text-slate-500">Gestione magazzino</h2>
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton icon={Warehouse} label="Stock" onClick={() => navigate("/wms-app/ubicazioni")} />
          <SecondaryButton icon={Archive} label="Inventario" onClick={() => navigate("/wms-app/inventario")} />
        </div>
      </section>
    </div>
  );
}

function FlowButton({ icon: Icon, title, detail, onClick, tone = "teal" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-800",
    blue: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
  };
  return (
    <button type="button" onClick={onClick} className="wms-action-row">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><strong className="block text-[17px] font-extrabold">{title}</strong><span className="mt-1 block text-sm font-medium text-slate-500">{detail}</span></span>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
    </button>
  );
}

function SecondaryButton({ icon: Icon, label, onClick }) {
  return <button type="button" onClick={onClick} className="flex min-h-20 items-center gap-3 rounded-md border border-slate-200/75 bg-white p-4 text-left font-extrabold shadow-[0_4px_16px_rgba(15,23,42,0.035)] transition hover:border-slate-300"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100"><Icon className="h-[18px] w-[18px] text-teal-700" /></span>{label}</button>;
}

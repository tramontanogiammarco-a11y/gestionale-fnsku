import { useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ArrowRight, Loader2, PackageCheck, PackageOpen, ShoppingCart, Warehouse } from "lucide-react";

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
        <div><p className="wms-eyebrow">Operazioni</p><h1 className="wms-title">Inizia da qui</h1></div>
      </header>

      {currentInbound && (
        <button
          type="button"
          onClick={() => navigate(`/wms-app/inbound/${currentInbound.id}`)}
          className="flex w-full items-center gap-3 rounded-md border border-teal-300 bg-teal-50 p-3.5 text-left transition hover:border-teal-500"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"><PackageOpen className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase text-teal-700">Continua da qui</span><strong className="mt-1 block truncate text-lg">Ricezione {currentInbound.cliente_ragione_sociale || "Cliente"}</strong></span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </button>
      )}

      <section className="space-y-2">
        <FlowButton tone="teal"
          icon={PackageOpen}
          title="Ricevi merce"
          detail={`${model.waiting.length} ${model.waiting.length === 1 ? "arrivo in attesa" : "arrivi in attesa"}`}
          onClick={() => navigate("/wms-app/arrivi")}
        />
        <FlowButton tone="blue" icon={ShoppingCart} title="Prepara ordini" detail="Picking Massivo, Galluse e singolo" onClick={() => navigate("/wms-app/ordini")} />
        <FlowButton tone="amber" icon={PackageCheck} title="Imballa ordini" detail="Scansiona carrello o bag" onClick={() => navigate("/packing-station")} />
      </section>

      <button type="button" onClick={() => navigate("/wms-app/ubicazioni")} className="flex min-h-14 w-full items-center gap-3 border-t border-slate-200 px-1 pt-4 text-left"><Warehouse className="h-5 w-5 text-slate-500" /><span className="flex-1 font-semibold">Stock e ubicazioni</span><ArrowRight className="h-4 w-4 text-slate-400" /></button>
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
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><strong className="block text-base font-bold">{title}</strong><span className="mt-0.5 block text-xs font-medium text-slate-500">{detail}</span></span>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
    </button>
  );
}

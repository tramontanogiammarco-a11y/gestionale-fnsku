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
    <div className="space-y-6" data-testid="wms-app-dashboard">
      <header>
        <p className="text-xs font-extrabold uppercase text-teal-700">Aimago Prep Center</p>
        <h1 className="mt-1 text-3xl font-black">Cosa devi fare?</h1>
      </header>

      {currentInbound && (
        <button
          type="button"
          onClick={() => navigate(`/wms-app/inbound/${currentInbound.id}`)}
          className="flex w-full items-center gap-4 rounded-md border-2 border-teal-600 bg-teal-50 p-4 text-left"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"><PackageOpen className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase text-teal-700">Continua da qui</span><strong className="mt-1 block truncate text-lg">Ricezione {currentInbound.cliente_ragione_sociale || "Cliente"}</strong></span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </button>
      )}

      <section className="space-y-3">
        <FlowButton
          icon={PackageOpen}
          title="Ricevi merce"
          detail={`${model.waiting.length} ${model.waiting.length === 1 ? "arrivo in attesa" : "arrivi in attesa"}`}
          onClick={() => navigate("/wms-app/arrivi")}
        />
        <FlowButton icon={ShoppingCart} title="Prepara ordini" detail="Picking Massivo, Galluse e singolo" onClick={() => navigate("/wms-app/ordini")} />
        <FlowButton icon={PackageCheck} title="Imballa ordini" detail="Scansiona carrello o bag" onClick={() => navigate("/packing-station")} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-black uppercase text-slate-500">Gestione magazzino</h2>
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton icon={Warehouse} label="Stock" onClick={() => navigate("/wms-app/ubicazioni")} />
          <SecondaryButton icon={Archive} label="Inventario" onClick={() => navigate("/wms-app/inventario")} />
        </div>
      </section>
    </div>
  );
}

function FlowButton({ icon: Icon, title, detail, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 w-full items-center gap-4 rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-slate-50">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white"><Icon className="h-6 w-6" /></span>
      <span className="min-w-0 flex-1"><strong className="block text-lg">{title}</strong><span className="mt-1 block text-sm text-slate-500">{detail}</span></span>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
    </button>
  );
}

function SecondaryButton({ icon: Icon, label, onClick }) {
  return <button type="button" onClick={onClick} className="flex min-h-20 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-left font-black"><Icon className="h-5 w-5 text-teal-700" />{label}</button>;
}

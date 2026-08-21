import { useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Archive, ArrowRight, Boxes, CheckCircle2, Loader2,
  PackageCheck, PackageOpen, RefreshCw, ScanLine, ShoppingCart, Warehouse,
} from "lucide-react";

export default function WmsAppDashboard() {
  const navigate = useNavigate();
  const { entries, allEntries, loadEntries } = useOutletContext();
  const [tab, setTab] = useState("pending");

  const model = useMemo(() => {
    const source = entries || [];
    const waiting = source.filter((entry) => entry.stato === "in_attesa");
    const active = source.filter((entry) => entry.stato === "in_lavorazione");
    const completed = source.filter((entry) => !["in_attesa", "in_lavorazione"].includes(entry.stato));
    return {
      waiting,
      active,
      completed,
      waitingPieces: [...waiting, ...active].reduce((sum, entry) => sum + entryPieces(entry), 0),
    };
  }, [entries]);

  if (allEntries === null) {
    return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  }

  return (
    <div className="space-y-5" data-testid="wms-app-dashboard">
      <section className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase text-teal-700">Aimago Prep Center</p>
          <h1 className="mt-1 text-3xl font-black">Magazzino</h1>
        </div>
        <button type="button" onClick={loadEntries} className="wms-icon-button" aria-label="Aggiorna attività">
          <RefreshCw className="h-5 w-5" />
        </button>
      </section>

      <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Vista attività">
        <button type="button" onClick={() => setTab("pending")} className={`wms-segment ${tab === "pending" ? "wms-segment-active" : ""}`}>Attività in sospeso</button>
        <button type="button" onClick={() => setTab("operations")} className={`wms-segment ${tab === "operations" ? "wms-segment-active" : ""}`}>Operativa magazzino</button>
      </div>

      {tab === "pending" ? (
        <>
          <button type="button" onClick={() => navigate("/wms-app/arrivi?view=open")} className="flex min-h-16 w-full items-center gap-4 rounded-md border border-slate-200 bg-white px-5 text-left shadow-sm transition hover:border-teal-300">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700"><PackageOpen className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><strong className="block text-lg">Ricevi merce</strong><span className="block text-sm text-slate-500">{model.waiting.length} arrivi in attesa</span></span>
            <ArrowRight className="h-5 w-5 text-slate-400" />
          </button>

          <div className="grid grid-cols-2 gap-3">
            <OperationCard icon={PackageOpen} title="Da ricevere" value={model.waiting.length} unit="arrivi" tone="teal" onClick={() => navigate("/wms-app/arrivi?view=open")} />
            <OperationCard icon={ScanLine} title="In corso" value={model.active.length} unit="ricezioni" tone="amber" onClick={() => navigate("/wms-app/arrivi?view=active")} />
            <OperationCard icon={Boxes} title="Da ubicare" value={model.waitingPieces} unit="pezzi" tone="blue" onClick={() => navigate("/wms-app/arrivi?view=open")} />
            <OperationCard icon={CheckCircle2} title="Completati" value={model.completed.length} unit="inbound" tone="green" onClick={() => navigate("/wms-app/arrivi?view=history")} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <OperationCard icon={Warehouse} title="Ubicazioni" value={200} unit="posizioni" tone="teal" onClick={() => navigate("/wms-app/ubicazioni")} />
          <OperationCard icon={Archive} title="Inventario" value="Apri" unit="conteggio posizioni" tone="blue" onClick={() => navigate("/wms-app/inventario")} />
          <OperationCard icon={ShoppingCart} title="Ordini" value="Apri" unit="giornata operativa" tone="amber" onClick={() => navigate("/wms-app/ordini")} />
          <OperationCard icon={PackageCheck} title="Packing" value="Apri" unit="verifica e chiudi colli" tone="green" onClick={() => navigate("/wms-app/packing")} />
        </div>
      )}
    </div>
  );
}

function OperationCard({ icon: Icon, title, value, unit, tone, onClick }) {
  const tones = {
    teal: "border-teal-100 bg-teal-50 text-teal-900",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    blue: "border-sky-100 bg-sky-50 text-sky-950",
    green: "border-emerald-100 bg-emerald-50 text-emerald-950",
  };
  return (
    <button type="button" onClick={onClick} className={`flex min-h-48 flex-col rounded-md border p-4 text-left transition active:scale-[0.99] ${tones[tone]} ${onClick ? "hover:brightness-[0.98]" : "cursor-default"}`}>
      <Icon className="h-8 w-8" strokeWidth={1.7} />
      <h2 className="mt-6 text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm opacity-70">{unit}</p>
      <strong className="mt-auto pt-5 text-3xl font-black">{value}</strong>
    </button>
  );
}

function entryPieces(entry) {
  return (entry.righe || []).reduce((sum, row) => sum + Number(row.quantita || 0), 0);
}

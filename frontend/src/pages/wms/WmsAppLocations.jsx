import { Boxes, ChevronRight, Layers3, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function WmsAppLocations() {
  return (
    <div className="space-y-5" data-testid="wms-app-locations">
      <header>
        <p className="text-xs font-extrabold uppercase text-teal-700">Stock</p>
        <h1 className="mt-1 text-3xl font-black">Ubicazioni</h1>
        <p className="mt-2 text-sm text-slate-500">Posizioni operative del magazzino Aimago.</p>
      </header>

      <LocationCard
        icon={Boxes}
        title="Pallet"
        range="P1+A1 — P1+A100"
        count="100 posizioni"
        onClick={() => toast.info("Dettaglio pallet: prossimo collegamento operativo")}
      />
      <LocationCard
        icon={Layers3}
        title="Slot"
        range="S1+A1 — S1+A100"
        count="100 posizioni"
        onClick={() => toast.info("Dettaglio slot: prossimo collegamento operativo")}
      />
    </div>
  );
}

function LocationCard({ icon: Icon, title, range, count, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-64 w-full flex-col items-center justify-center rounded-md border border-slate-200 bg-white px-6 text-center shadow-sm transition hover:border-teal-300">
      <span className="flex h-16 w-16 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Icon className="h-9 w-9" strokeWidth={1.6} /></span>
      <h2 className="mt-5 text-2xl font-black">{title}</h2>
      <p className="mt-2 font-mono text-sm text-slate-500">{range}</p>
      <div className="mt-7 flex items-center gap-2 text-sm font-bold text-teal-700"><MapPin className="h-4 w-4" /> {count} <ChevronRight className="h-4 w-4" /></div>
    </button>
  );
}

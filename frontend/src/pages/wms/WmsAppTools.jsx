import { useNavigate } from "react-router-dom";
import {
  Archive, ChevronRight, MapPinned, PackageSearch, Printer,
  QrCode, ScanLine, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

export default function WmsAppTools() {
  const navigate = useNavigate();
  const tools = [
    { icon: Printer, title: "Codici stampabili", subtitle: "Etichette e codici di magazzino", action: () => toast.info("Stampe: prossimo collegamento operativo") },
    { icon: MapPinned, title: "Ubicazioni magazzino", subtitle: "Pallet e slot censiti", action: () => navigate("/wms-app/ubicazioni") },
    { icon: Archive, title: "Inventario", subtitle: "Conta e rettifica una posizione", action: () => navigate("/wms-app/inventario") },
    { icon: QrCode, title: "Crea codice posizione", subtitle: "Genera un barcode per una posizione", action: () => toast.info("Generazione barcode: prossimo collegamento operativo") },
    { icon: PackageSearch, title: "Cerca prodotto", subtitle: "Cerca per SKU, EAN, FNSKU o cliente", action: () => navigate("/wms-app/cerca-prodotto") },
    { icon: ScanLine, title: "Calibrare lo scanner", subtitle: "Configura uno scanner USB o Bluetooth", badge: "Non calibrato", action: () => toast.info("Calibrazione scanner: prossimo collegamento operativo") },
  ];
  return (
    <div className="space-y-5" data-testid="wms-app-tools">
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-extrabold uppercase text-teal-700">Operativa</p><h1 className="mt-1 text-3xl font-black">Strumenti</h1></div>
        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-white"><SlidersHorizontal className="h-5 w-5" /></span>
      </header>
      <div className="space-y-3">
        {tools.map((item) => (
          <button key={item.title} type="button" onClick={item.action} className="flex min-h-28 w-full items-center gap-4 rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-950"><item.icon className="h-7 w-7" strokeWidth={1.7} /></span>
            <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="text-lg">{item.title}</strong>{item.badge && <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{item.badge}</span>}</span><span className="mt-1 block text-sm text-slate-500">{item.subtitle}</span></span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

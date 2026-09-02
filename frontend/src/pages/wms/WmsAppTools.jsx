import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive, ArrowLeftRight, ChevronRight, DatabaseZap, MapPinned, PackageSearch, Printer,
  QrCode, ScanLine, ShoppingBag, ShoppingCart, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export default function WmsAppTools() {
  const navigate = useNavigate();
  const location = useLocation();
  const [resettingStock, setResettingStock] = useState(false);
  const [emptyingBags, setEmptyingBags] = useState(false);
  const showStockReset = new URLSearchParams(location.search).get("stock") === "home";
  const showBagEmpty = new URLSearchParams(location.search).get("bags") === "empty";
  const tools = [
    { icon: ArrowLeftRight, title: "Movimenta stock", subtitle: "Sposta quantita, rifornisci slot o svuota una posizione", action: () => navigate("/wms-app/movimenta-stock") },
    { icon: ShoppingCart, title: "Carrelli / Bag", subtitle: "Scansiona un carrello e configura la griglia delle bag", action: () => navigate("/wms-app/carrelli-bag") },
    { icon: Printer, title: "Barcode imballaggi", subtitle: "Stampa scatola piccola, media, grande e busta corriere", action: () => navigate("/wms-app/barcode-imballaggi") },
    { icon: MapPinned, title: "Ubicazioni magazzino", subtitle: "Pallet e slot censiti", action: () => navigate("/wms-app/ubicazioni") },
    { icon: Archive, title: "Inventario", subtitle: "Conta e rettifica una posizione", action: () => navigate("/wms-app/inventario") },
    { icon: QrCode, title: "Crea codice posizione", subtitle: "Genera un barcode per una posizione", action: () => toast.info("Generazione barcode: prossimo collegamento operativo") },
    { icon: PackageSearch, title: "Cerca prodotto", subtitle: "Cerca per SKU, EAN, FNSKU o cliente", action: () => navigate("/wms-app/cerca-prodotto") },
    { icon: ScanLine, title: "Calibrare lo scanner", subtitle: "Configura uno scanner USB o Bluetooth", badge: "Non calibrato", action: () => toast.info("Calibrazione scanner: prossimo collegamento operativo") },
  ];
  const resetHomeStock = async () => {
    if (resettingStock) return;
    const confirmed = window.confirm("Azzero tutte le scorte WMS e carico 50 prodotti casa: 30 pezzi nel 50% degli slot S1 e 100 pezzi nei pallet P1 sparsi?");
    if (!confirmed) return;
    try {
      setResettingStock(true);
      const response = await api.post("/wms/stock/home-catalog-reset", {});
      toast.success(`Stock casa pronto: ${response.data.referenze} referenze, ${response.data.pezzi_totali} pezzi.`);
      navigate("/wms-app/ubicazioni");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Reset stock non riuscito");
    } finally {
      setResettingStock(false);
    }
  };
  const emptyBags = async () => {
    if (emptyingBags) return;
    const confirmed = window.confirm("Svuoto tutte le bag: elimino il contenuto operativo e le rendo disponibili?");
    if (!confirmed) return;
    try {
      setEmptyingBags(true);
      const response = await api.post("/wms/bags/svuota", {});
      toast.success(`Bag svuotate: ${response.data.packing_sessions} sessioni packing rimosse.`);
      navigate("/packing-station");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Svuotamento bag non riuscito");
    } finally {
      setEmptyingBags(false);
    }
  };
  return (
    <div className="wms-page" data-testid="wms-app-tools">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Operativa</p><h1 className="wms-title">Strumenti</h1><p className="wms-subtitle">Azioni tecniche e manutenzione dati.</p></div>
        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-white"><SlidersHorizontal className="h-5 w-5" /></span>
      </header>
      {showStockReset && (
        <button type="button" onClick={resetHomeStock} disabled={resettingStock} className="flex min-h-28 w-full items-center gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-left shadow-sm transition hover:border-amber-500 disabled:cursor-wait disabled:opacity-70">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-900"><DatabaseZap className="h-7 w-7" strokeWidth={1.7} /></span>
          <span className="min-w-0 flex-1">
            <strong className="text-lg text-amber-950">{resettingStock ? "Reset stock in corso" : "Reset stock casa"}</strong>
            <span className="mt-1 block text-sm text-amber-900">Azzera tutto, poi carica 50 prodotti: 30 pezzi in 50 slot S1 e lo stesso prodotto con 100 pezzi in 50 pallet P1 sparsi.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-amber-700" />
        </button>
      )}
      {showBagEmpty && (
        <button type="button" onClick={emptyBags} disabled={emptyingBags} className="flex min-h-28 w-full items-center gap-4 rounded-md border border-rose-300 bg-rose-50 p-4 text-left shadow-sm transition hover:border-rose-500 disabled:cursor-wait disabled:opacity-70">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-rose-100 text-rose-900"><ShoppingBag className="h-7 w-7" strokeWidth={1.7} /></span>
          <span className="min-w-0 flex-1">
            <strong className="text-lg text-rose-950">{emptyingBags ? "Svuotamento bag in corso" : "Svuota tutte le bag"}</strong>
            <span className="mt-1 block text-sm text-rose-900">Libera tutte le bag e cancella il lavoro operativo collegato a picking e packing.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-rose-700" />
        </button>
      )}
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

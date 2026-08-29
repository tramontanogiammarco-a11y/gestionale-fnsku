import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  AlertCircle, Boxes, CircleCheck, Layers3,
  Loader2, MapPin, PackageSearch, RefreshCw, Search, Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

const REFRESH_INTERVAL = 15000;

export default function WmsAppLocations() {
  const { clientId } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stock, setStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("products");
  const [search, setSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const query = new URLSearchParams();
      if (clientId && clientId !== "all") query.set("cliente_id", clientId);
      const response = await api.get(`/wms/stock${query.toString() ? `?${query.toString()}` : ""}`);
      setStock(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Stock non disponibile");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => load({ quiet: true }), REFRESH_INTERVAL);
    if (!supabase) return () => window.clearInterval(interval);
    let timer;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load({ quiet: true }), 350);
    };
    const channel = supabase.channel(`wms-stock-${clientId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wms_inbound_movements" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "wms_locations" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "entrate_righe" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "preparazioni_righe" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "box" }, schedule)
      .subscribe();
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code || !stock) return;
    const location = stock.locations.find((item) => normalize(item.codice) === normalize(code));
    if (!location) return;
    setSelectedLocation(location);
    setTab(location.tipo === "slot" ? "slots" : "pallets");
  }, [searchParams, stock]);

  const filteredProducts = useMemo(() => {
    const needle = normalize(search);
    return (stock?.products || []).filter((product) => product.disponibile > 0 && (!needle || [product.titolo, product.ean, product.fnsku, product.cliente]
      .some((value) => normalize(value).includes(needle))));
  }, [search, stock]);

  const filteredLocations = useMemo(() => {
    const type = tab === "slots" ? "slot" : "pallet";
    const needle = normalize(search);
    return (stock?.locations || []).filter((location) => location.tipo === type && (!needle || [location.codice, location.zona, ...location.contenuto.flatMap((item) => [item.titolo, item.ean, item.fnsku, item.cliente])]
      .some((value) => normalize(value).includes(needle))));
  }, [search, stock, tab]);

  const closeLocation = () => {
    setSelectedLocation(null);
    if (searchParams.has("code")) {
      const next = new URLSearchParams(searchParams);
      next.delete("code");
      setSearchParams(next, { replace: true });
    }
  };

  if (loading && !stock) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const summary = stock?.summary || {};
  return (
    <div className="wms-page" data-testid="wms-app-stock">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Inventario live</p><h1 className="wms-title">Stock</h1><p className="wms-subtitle">Prodotti, pallet e slot in tempo reale.</p></div>
        <Button type="button" size="icon" variant="outline" onClick={() => load()} disabled={refreshing} aria-label="Aggiorna stock">{refreshing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}</Button>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Kpi icon={Boxes} label="Pezzi disponibili" value={summary.unita_disponibili || 0} tone="teal" />
        <Kpi icon={PackageSearch} label="Referenze" value={summary.referenze_disponibili || 0} tone="ink" />
        <Kpi icon={Warehouse} label="Posizioni occupate" value={`${summary.ubicazioni_occupate || 0}/${summary.ubicazioni_totali || 0}`} tone="blue" />
        <Kpi icon={AlertCircle} label="Da ubicare" value={summary.non_ubicato || 0} tone={summary.non_ubicato > 0 ? "amber" : "green"} />
      </section>

      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="font-bold">Aggiornamento automatico</span><span className="ml-auto">{formatUpdated(stock?.generated_at)}</span>
      </div>

      <section className="space-y-3">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Vista stock">
          <TabButton active={tab === "products"} onClick={() => setTab("products")} icon={Boxes}>Prodotti</TabButton>
          <TabButton active={tab === "pallets"} onClick={() => setTab("pallets")} icon={Warehouse}>Pallet</TabButton>
          <TabButton active={tab === "slots"} onClick={() => setTab("slots")} icon={Layers3}>Slot</TabButton>
        </div>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 pl-10" placeholder={tab === "products" ? "Cerca titolo, EAN o FNSKU" : "Cerca posizione o prodotto"} /></div>
      </section>

      {tab === "products" ? (
        <section>
          <SectionTitle title="Giacenze disponibili" count={filteredProducts.length} />
          {filteredProducts.length ? <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">{filteredProducts.map((product) => <ProductRow key={`${product.cliente_id}:${product.fnsku || product.ean}`} product={product} onLocation={setSelectedLocationFromCode(stock, setSelectedLocation)} />)}</div> : <EmptyState icon={Boxes} title="Nessuna giacenza" text={search ? "Nessun prodotto corrisponde alla ricerca." : "Non risultano pezzi disponibili."} />}
        </section>
      ) : (
        <section>
          <SectionTitle title={tab === "pallets" ? "Posizioni pallet" : "Posizioni slot"} count={filteredLocations.length} />
          {filteredLocations.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{filteredLocations.map((location) => <LocationTile key={location.id} location={location} onClick={() => setSelectedLocation(location)} />)}</div> : <EmptyState icon={MapPin} title="Nessuna posizione" text="Nessuna posizione corrisponde alla ricerca." />}
        </section>
      )}

      <LocationSheet location={selectedLocation} open={Boolean(selectedLocation)} onOpenChange={(open) => { if (!open) closeLocation(); }} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }) {
  const tones = { teal: "border-teal-200 bg-teal-50 text-teal-950", ink: "border-slate-900 bg-slate-950 text-white", blue: "border-sky-200 bg-sky-50 text-sky-950", amber: "border-amber-200 bg-amber-50 text-amber-950", green: "border-emerald-200 bg-emerald-50 text-emerald-950" };
  return <div className={`min-h-32 rounded-md border p-4 ${tones[tone]}`}><Icon className="h-5 w-5" /><strong className="mt-4 block text-2xl font-black">{value}</strong><span className="mt-1 block text-xs font-bold opacity-70">{label}</span></div>;
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-bold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Icon className="h-4 w-4" />{children}</button>;
}

function SectionTitle({ title, count }) {
  return <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">{title}</h2><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{count}</span></div>;
}

function ProductRow({ product, onLocation }) {
  return (
    <div className="p-4">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Boxes className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h3 className="font-black">{product.titolo}</h3><p className="mt-1 text-xs text-slate-500">{product.cliente}</p><p className="mt-2 break-all font-mono text-xs text-slate-500">{product.ean || "EAN assente"} · {product.fnsku || "FNSKU assente"}</p></div><div className="text-right"><strong className="text-2xl">{product.disponibile}</strong><span className="block text-[10px] font-bold uppercase text-slate-400">pezzi</span></div></div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{product.ubicazioni.map((location) => <button key={location.id} type="button" onClick={() => onLocation(location.codice)} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1.5 text-xs font-bold"><MapPin className="h-3.5 w-3.5 text-teal-700" /><span className="font-mono">{location.codice}</span><span>· {location.quantita}</span></button>)}{product.non_ubicato > 0 && <span className="rounded-md bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-800">Da ubicare · {product.non_ubicato}</span>}</div>
    </div>
  );
}

function LocationTile({ location, onClick }) {
  return <button type="button" onClick={onClick} className={`min-h-36 rounded-md border p-4 text-left ${location.occupata ? "border-teal-200 bg-white" : "border-slate-200 bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><span className={`flex h-9 w-9 items-center justify-center rounded-md ${location.occupata ? "bg-teal-50 text-teal-700" : "bg-white text-slate-400"}`}><MapPin className="h-5 w-5" /></span>{location.stato === "bloccata" ? <span className="rounded-md bg-red-50 px-1.5 py-1 text-[9px] font-black uppercase text-red-700">Bloccata</span> : location.occupata ? <CircleCheck className="h-4 w-4 text-emerald-600" /> : null}</div><div className="mt-4 font-mono text-base font-black">{location.codice}</div><div className="mt-1 text-xs text-slate-500">{location.occupata ? `${location.quantita} pezzi` : "Libera"}</div></button>;
}

function LocationSheet({ location, open, onOpenChange }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="mx-auto max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0"><SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left"><SheetTitle className="flex items-center gap-2 text-xl font-black"><MapPin className="h-5 w-5 text-teal-700" /><span className="font-mono">{location?.codice}</span></SheetTitle><SheetDescription>{location?.tipo ? `${capitalize(location.tipo)} · ${location.zona || "Magazzino"}` : "Dettaglio posizione"}</SheetDescription></SheetHeader>{location?.contenuto?.length ? <div className="divide-y divide-slate-100 pb-[max(24px,env(safe-area-inset-bottom))]">{location.contenuto.map((item) => <div key={`${item.cliente_id}:${item.fnsku || item.ean}`} className="p-5"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Boxes className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h3 className="font-black">{item.titolo}</h3><p className="mt-1 text-xs text-slate-500">{item.cliente}</p><p className="mt-2 break-all font-mono text-xs text-slate-500">EAN {item.ean || "assente"}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">FNSKU {item.fnsku || "assente"}</p></div><strong className="text-xl">{item.quantita} pz</strong></div></div>)}</div> : <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center"><CircleCheck className="h-9 w-9 text-emerald-600" /><h3 className="mt-3 font-black">Posizione libera</h3><p className="mt-1 text-sm text-slate-500">Può essere utilizzata per un nuovo inbound.</p></div>}</SheetContent></Sheet>;
}

function EmptyState({ icon: Icon, title, text }) {
  return <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-6 text-center"><Icon className="h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">{title}</h3><p className="mt-1 text-sm text-slate-500">{text}</p></div>;
}

function setSelectedLocationFromCode(stock, setter) {
  return (code) => setter(stock?.locations.find((location) => normalize(location.codice) === normalize(code)) || null);
}

function normalize(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, ""); }
function capitalize(value) { const text = String(value || ""); return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ""; }
function formatUpdated(value) { return value ? `Aggiornato ${new Date(value).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "In aggiornamento"; }

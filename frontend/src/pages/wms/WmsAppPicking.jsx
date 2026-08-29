import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Barcode, Boxes, Camera, CheckCircle2, Loader2,
  MapPin, Navigation, PackageCheck, Play, Route, ScanLine, Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import CameraScanner from "@/components/wms/CameraScanner";

export default function WmsAppPicking() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [bagCode, setBagCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/wms/picking/${orderId}`);
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Missione picking non disponibile");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const focus = () => window.setTimeout(() => inputRef.current?.focus(), 60);
    window.addEventListener("wms-focus-scanner", focus);
    return () => window.removeEventListener("wms-focus-scanner", focus);
  }, []);

  const current = data?.current_line || null;
  const needsLocation = current && !current.location_confirmed_at;
  const bagConfirmation = data?.task?.stato === "da_confermare_bag";
  const remaining = current ? Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0) : 0;
  useEffect(() => { setQuantity(Math.max(1, remaining)); setCode(""); }, [current?.id, current?.location_confirmed_at, remaining]);
  const scannerMode = bagConfirmation ? "bag" : needsLocation ? "location" : null;
  const openScanner = useCallback(() => {
    setScannerSession((value) => value + 1);
    setCameraOpen(true);
  }, []);
  useEffect(() => {
    if (!scannerMode) { setCameraOpen(false); return undefined; }
    const timer = window.setTimeout(openScanner, 80);
    return () => window.clearTimeout(timer);
  }, [scannerMode, current?.id, openScanner]);

  const routeStops = useMemo(() => {
    const stops = [];
    for (const line of data?.lines || []) {
      const previous = stops[stops.length - 1];
      if (previous?.location_id === line.location_id) previous.lines.push(line);
      else stops.push({ location_id: line.location_id, location: line.location, lines: [line] });
    }
    return stops;
  }, [data?.lines]);

  const start = async () => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/picking/${orderId}/avvia`, {});
      setData(response.data);
      toast.success("Missione creata e stock riservato");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Picking non avviato");
    } finally {
      setWorking(false);
    }
  };

  const replenish = async (item) => {
    if (!item.target_slot) return;
    setWorking(true);
    try {
      await api.post("/wms/rifornimenti", {
        order_id: orderId,
        cliente_id: item.cliente_id,
        product_key: item.product_key,
        target_location_id: item.target_slot.id,
        quantita: item.quantita,
      });
      toast.success(`${item.quantita} pezzi spostati in ${item.target_slot.codice}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Rifornimento non completato");
    } finally {
      setWorking(false);
    }
  };

  const scan = async (rawCode) => {
    const value = String(rawCode || code).trim();
    if (!value || !data?.task) return;
    setWorking(true);
    try {
      const locationResponse = await api.post(`/wms/picking/${data.task.id}/scan`, {
        codice: value,
        quantita: needsLocation ? undefined : Number(quantity),
      });
      let response = locationResponse;
      if (needsLocation && locationResponse.data.current_line?.id === current?.id && locationResponse.data.current_line.location_confirmed_at) {
        response = await api.post(`/wms/picking/${data.task.id}/scan`, { quantita: remaining });
      }
      setData(response.data);
      setCode("");
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);
      toast.success(needsLocation ? `Prelevati ${remaining} pezzi, vai al prossimo slot` : "Prelievo registrato");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Scansione non valida");
      if (navigator.vibrate) navigator.vibrate(180);
      window.setTimeout(() => inputRef.current?.select(), 60);
    } finally {
      setWorking(false);
    }
  };
  const confirmBag = async (rawCode) => {
    const value = String(rawCode || bagCode).trim().toUpperCase();
    if (!data?.task || !/^B-[0-9]{5}$/.test(value)) {
      toast.error("Scansiona una bag nel formato B-12345.");
      return;
    }
    setWorking(true);
    try {
      const response = await api.post(`/wms/picking/${data.task.id}/scan`, { codice: value });
      setData(response.data);
      setBagCode("");
      toast.success("Bag confermata: ordine inviato al packing");
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Bag non valida");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally { setWorking(false); }
  };

  if (loading) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  if (!data) return null;
  const complete = data.task?.stato === "completata";
  const scannerContext = needsLocation && current ? {
    location: current.location?.codice,
    title: current.titolo,
    imageUrl: current.foto_url ? fileUrl(current.foto_url) : null,
    requested: remaining,
    completedLines: (data.lines || []).filter((line) => Number(line.quantita_prelevata || 0) >= Number(line.quantita_attesa || 0)).length,
    totalLines: (data.lines || []).length,
    picked: data.summary.picked,
    expected: data.summary.expected,
  } : null;

  return (
    <div className="space-y-5 pb-24" data-testid="wms-picking-mission">
      <header>
        <button type="button" onClick={() => navigate("/wms-app/ordini")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase text-teal-700">Missione picking</p><h1 className="mt-1 text-3xl font-black">{data.order.order_name}</h1><p className="mt-1 text-sm text-slate-500">{data.order.cliente_ragione_sociale}</p></div>
          {data.task && <span className={`rounded-md px-3 py-2 text-xs font-black uppercase ${complete ? "bg-emerald-100 text-emerald-900" : "bg-sky-100 text-sky-900"}`}>{complete ? "Completata" : "In corso"}</span>}
        </div>
      </header>

      {!data.task ? (
        <>
          {(data.replenishment || []).length > 0 && (
            <section className="rounded-md border border-amber-300 bg-amber-50 p-5">
              <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-md bg-white text-amber-800"><Warehouse className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-amber-800">Prima del picking</p><h2 className="text-xl font-black text-amber-950">Rifornisci gli slot</h2></div></div>
              <p className="mt-3 text-sm text-amber-900">Il prelievo parte esclusivamente dagli slot. Sposta dai pallet la merce necessaria all'ordine.</p>
              <div className="mt-4 space-y-3">
                {data.replenishment.map((item) => (
                  <div key={item.product_key} className="rounded-md border border-amber-200 bg-white p-4">
                    <strong className="block text-sm">{item.titolo}</strong>
                    <div className="mt-1 font-mono text-xs text-slate-500">{item.fnsku || item.ean}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Da spostare" value={item.quantita} /><Metric label="Nei pallet" value={item.pallet_available} /><Metric label="Slot" value={item.target_slot?.codice || "-"} /></div>
                    <div className="mt-2 text-xs text-slate-500">Origine: {item.pallet_sources.map((source) => `${source.codice} (${source.quantita})`).join(" · ") || "nessun pallet"}</div>
                    <Button className="mt-3 h-12 w-full font-black" onClick={() => replenish(item)} disabled={working || !item.can_replenish}>
                      {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Warehouse className="mr-2 h-4 w-4" />} Rifornisci {item.target_slot?.codice || "slot"}
                    </Button>
                    {!item.can_replenish && <p className="mt-2 text-xs font-bold text-red-700">{!item.target_slot ? "Nessuno slot libero disponibile." : `Stock pallet insufficiente: mancano ${Math.max(0, item.quantita - item.pallet_available)} pezzi.`}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="rounded-md border border-slate-200 bg-white p-5">
            <Route className="h-8 w-8 text-teal-700" />
            <h2 className="mt-4 text-xl font-black">Crea la rotta slot</h2>
            <div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Righe" value={data.order.items?.length || 0} /><Metric label="Pezzi" value={(data.order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0)} /></div>
            <Button className="mt-5 h-14 w-full text-base font-black" onClick={start} disabled={working || !data.can_start}>{working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Avvia picking</Button>
            {!data.can_start && <p className="mt-3 text-center text-xs font-bold text-slate-500">Il picking si abilita quando tutte le quantità sono disponibili negli slot.</p>}
          </section>
        </>
      ) : complete ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" />
          <h2 className="mt-4 text-2xl font-black text-emerald-950">Picking completato</h2>
          <p className="mt-2 text-sm text-emerald-800">{data.summary.picked} pezzi registrati nella bag {data.task.bag_code}. Il packing li gestisce dalla sua postazione.</p>
          <Button className="mt-5 h-14 w-full" onClick={() => navigate("/wms-app/bag-storico")}><CheckCircle2 className="mr-2 h-5 w-5" /> Apri storico bag</Button>
        </section>
      ) : bagConfirmation ? (
        <section className="border-2 border-slate-950 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><Barcode className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Prelievo completato</p><h2 className="text-xl font-black">Scansiona la bag</h2></div></div>
          <p className="mt-3 text-sm text-slate-600">Metti tutti i prodotti dell'ordine in una bag libera e scansionala per inviarla alla packing station.</p>
          <Button type="button" className="mt-4 h-14 w-full text-base font-black" onClick={openScanner} disabled={working}><Camera className="mr-2 h-5 w-5" /> Scansiona bag</Button>
          <form onSubmit={(event) => { event.preventDefault(); confirmBag(); }} className="mt-4 flex gap-2"><Input value={bagCode} onChange={(event) => setBagCode(event.target.value.toUpperCase().replace(/[^B0-9-]/g, "").slice(0, 7))} placeholder="B-73846" className="h-14 flex-1 font-mono text-xl tracking-widest" autoFocus /><Button type="submit" className="h-14 px-5" disabled={!/^B-[0-9]{5}$/.test(bagCode) || working}><Barcode className="h-5 w-5" /></Button></form>
        </section>
      ) : (
        <>
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-end justify-between"><div><div className="text-xs font-bold uppercase text-slate-500">Avanzamento</div><div className="mt-1 text-3xl font-black">{data.summary.picked}<span className="text-lg text-slate-400">/{data.summary.expected}</span></div></div><strong className="text-teal-700">{data.summary.progress}%</strong></div>
            <Progress value={data.summary.progress} className="mt-3 h-2" />
            <div className="mt-3 text-xs font-semibold text-slate-500">{data.summary.stops} tappe ordinate dalla mappa magazzino</div>
          </section>

          {current && (
            <section className="border-2 border-teal-500 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-800">{needsLocation ? <MapPin className="h-6 w-6" /> : <Boxes className="h-6 w-6" />}</span>
                <div className="min-w-0 flex-1"><div className="text-xs font-black uppercase text-teal-700">{needsLocation ? "Prossima posizione" : "Prodotto da prelevare"}</div><h2 className="mt-1 truncate text-xl font-black">{needsLocation ? current.location?.codice : current.titolo}</h2></div>
              </div>
              {current.foto_url && <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white p-2"><img src={fileUrl(current.foto_url)} alt={current.titolo} className="h-44 w-full object-contain" /></div>}
              {needsLocation ? <><Button className="mt-4 h-16 w-full text-base font-black" onClick={openScanner} disabled={working}><Camera className="mr-2 h-6 w-6" /> Scansiona posizione</Button><form onSubmit={(event) => { event.preventDefault(); scan(); }} className="mt-3 flex gap-2"><Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} placeholder={current.location?.codice} className="h-12 flex-1 font-mono" autoComplete="off" /><Button type="submit" size="icon" variant="outline" className="h-12 w-12" disabled={!code.trim() || working} aria-label="Conferma posizione"><Barcode className="h-5 w-5" /></Button></form></> : <><div className="mt-4 grid grid-cols-[1fr_110px] gap-3"><div className="rounded-md bg-slate-50 p-3"><div className="font-mono text-xs text-slate-500">{current.fnsku || current.ean || current.sku}</div><div className="mt-1 text-sm font-bold">Da prelevare: {remaining}</div></div><label><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Quantità</span><Input type="number" min="1" max={remaining} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-12 text-lg font-black" /></label></div><Button className="mt-4 h-14 w-full text-base font-black" onClick={() => scan("")} disabled={working || Number(quantity) < 1 || Number(quantity) > remaining}><PackageCheck className="mr-2 h-5 w-5" /> Conferma prelievo</Button></>}
            </section>
          )}
        </>
      )}

      {routeStops.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2"><Navigation className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-black">Percorso</h2></div>
          <div className="space-y-2">{routeStops.map((stop, index) => { const done = stop.lines.every((line) => Number(line.quantita_prelevata) >= Number(line.quantita_attesa)); const active = stop.lines.some((line) => line.id === current?.id); return <div key={stop.location_id} className={`flex items-center gap-3 rounded-md border p-3 ${active ? "border-teal-500 bg-teal-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${done ? "bg-emerald-600 text-white" : active ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}>{done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}</span><div className="min-w-0 flex-1"><strong>{stop.location?.codice}</strong><div className="mt-1 truncate text-xs text-slate-500">{stop.lines.map((line) => line.titolo).join(" · ")}</div></div>{active && <ScanLine className="h-5 w-5 text-teal-700" />}</div>; })}</div>
        </section>
      )}

      {cameraOpen && <CameraScanner key={`pick-${scannerSession}`} open onOpenChange={setCameraOpen} purpose={bagConfirmation ? "bag" : "location"} context={scannerContext} onDetected={(value) => { setCameraOpen(false); if (bagConfirmation) confirmBag(value); else scan(value); }} />}
    </div>
  );
}

function Metric({ label, value }) { return <div className="rounded-md bg-slate-50 p-3"><strong className="block text-2xl font-black">{value}</strong><span className="mt-1 block text-[10px] font-black uppercase text-slate-500">{label}</span></div>; }

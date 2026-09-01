import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Barcode, Grid3X3, Layers3, Link2, Loader2, Minus, Plus, Printer, ScanLine, ShoppingBag, ShoppingCart, Trash2, Unplug, Warehouse, Wifi } from "lucide-react";
import { toast } from "sonner";
import { api, normalizeScannerCode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";
import { supabase } from "@/lib/supabase";
import { createPrintJobId, getPairedPrintStationCode, normalizePrintStationCode, pairPrintStation, printStationChannelName, unpairPrintStation } from "@/lib/printStation";
import { printZebraLocationLabels } from "@/lib/zebraPrinter";

const DEFAULT_CART = "CARRELLO-01";

export default function WmsAppCartBags() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const printChannelRef = useRef(null);
  const pendingPrintJobRef = useRef("");
  const printTimeoutRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [cartCode, setCartCode] = useState("");
  const [bagCode, setBagCode] = useState("");
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [scanner, setScanner] = useState(null);
  const [working, setWorking] = useState(false);
  const [draftGrid, setDraftGrid] = useState({ righe: 2, colonne: 5 });
  const [locationDraft, setLocationDraft] = useState({ tipo: "slot", blocco: "101", bloccoFine: "101", livelli: 5, ubicazioni: 5 });
  const [generatedLocations, setGeneratedLocations] = useState([]);
  const [printingLocations, setPrintingLocations] = useState(false);
  const [pairedStation, setPairedStation] = useState(getPairedPrintStationCode);
  const [stationOnline, setStationOnline] = useState(false);

  useEffect(() => {
    const stationFromQr = normalizePrintStationCode(searchParams.get("station"));
    if (!stationFromQr || stationFromQr === pairedStation) return;
    pairPrintStation(stationFromQr);
    setPairedStation(stationFromQr);
    toast.success("Packing Station associata. Ora puoi stampare slot e pallet dal telefono.");
  }, [pairedStation, searchParams]);

  useEffect(() => {
    if (!supabase || !pairedStation) {
      setStationOnline(false);
      printChannelRef.current = null;
      return undefined;
    }
    const channel = supabase.channel(printStationChannelName(pairedStation), {
      config: { broadcast: { ack: true }, presence: { key: `mobile-${Date.now()}` } },
    });
    printChannelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const devices = Object.values(channel.presenceState()).flat();
        setStationOnline(devices.some((device) => device.role === "station"));
      })
      .on("broadcast", { event: "print-result" }, ({ payload }) => {
        if (!payload?.jobId || payload.jobId !== pendingPrintJobRef.current) return;
        window.clearTimeout(printTimeoutRef.current);
        pendingPrintJobRef.current = "";
        setPrintingLocations(false);
        if (payload.ok) toast.success(`${payload.count} etichette stampate su ${payload.printer || "Zebra"}`);
        else toast.error(payload.message || "La Packing Station non ha completato la stampa");
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ role: "mobile", pairedAt: new Date().toISOString() });
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setStationOnline(false);
      });
    return () => {
      printChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [pairedStation]);

  useEffect(() => () => window.clearTimeout(printTimeoutRef.current), []);

  const applySnapshot = useCallback((next) => {
    setSnapshot(next);
    setCartCode(next.cart.codice);
    setDraftGrid({ righe: Number(next.cart.righe), colonne: Number(next.cart.colonne) });
  }, []);

  const loadDefault = useCallback(async () => {
    try {
      const response = await api.get(`/wms/carrelli/${DEFAULT_CART}`);
      applySnapshot(response.data);
    } catch (error) {
      if (error.response?.status !== 404) toast.error(error.response?.data?.detail || "Carrello non disponibile");
    }
  }, [applySnapshot]);
  useEffect(() => { loadDefault(); }, [loadDefault]);

  const scanCart = async (rawValue) => {
    const codice = normalizeScannerCode(rawValue || cartCode);
    if (!codice) return toast.error("Scansiona prima il carrello.");
    setWorking(true);
    try {
      const response = await api.post("/wms/carrelli/scansiona", { codice });
      applySnapshot(response.data);
      setScanner(null);
      toast.success(`Carrello ${response.data.cart.codice} pronto da configurare`);
      navigator.vibrate?.([50, 30, 50]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Carrello non valido");
      navigator.vibrate?.(160);
    } finally { setWorking(false); }
  };

  const saveGrid = async () => {
    if (!snapshot) return;
    setWorking(true);
    try {
      const response = await api.put(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}`, draftGrid);
      applySnapshot(response.data);
      toast.success("Griglia carrello aggiornata");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Griglia non aggiornata");
    } finally { setWorking(false); }
  };

  const assignBag = async (rawValue) => {
    const codice = normalizeScannerCode(rawValue || bagCode);
    if (!snapshot || !selectedPosition) return;
    if (!codice) return toast.error("Scansiona la bag da inserire.");
    setWorking(true);
    try {
      const response = await api.post(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}/bag`, { posizione: selectedPosition, bag_code: codice });
      applySnapshot(response.data);
      setBagCode("");
      setScanner(null);
      toast.success(`Bag ${codice} inserita in posizione ${selectedPosition}`);
      navigator.vibrate?.([50, 30, 50]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Bag non assegnata");
      navigator.vibrate?.(160);
    } finally { setWorking(false); }
  };

  const removeBag = async (position) => {
    if (!snapshot || !window.confirm(`Liberare la posizione ${position}?`)) return;
    setWorking(true);
    try {
      const response = await api.post(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}/rimuovi-bag`, { posizione: position });
      applySnapshot(response.data);
      toast.success("Bag rimossa dalla griglia");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Bag non rimossa");
    } finally { setWorking(false); }
  };

  const positionMap = useMemo(() => Object.fromEntries((snapshot?.positions || []).map((item) => [Number(item.posizione), item])), [snapshot]);
  const configured = snapshot?.positions?.length || 0;
  const capacity = Number(snapshot?.capacity || 0);
  const scannerPurpose = scanner === "cart" ? "cart" : "bag";
  const locationPreview = useMemo(() => buildLocationPreview(locationDraft), [locationDraft]);
  const physicalLocationLabels = Math.ceil(generatedLocations.length / 3);
  const updateLocationDraft = (next) => {
    setLocationDraft((current) => ({ ...current, ...next }));
    setGeneratedLocations([]);
  };

  const generateLocations = async () => {
    setWorking(true);
    try {
      const response = await api.post("/wms/ubicazioni/genera", {
        tipo: locationDraft.tipo,
        blocco: locationDraft.blocco,
        blocco_fine: locationDraft.bloccoFine,
        livelli: locationDraft.livelli,
        ubicazioni_per_livello: locationDraft.ubicazioni,
      });
      const printableLocations = response.data.locations?.length
        ? response.data.locations
        : locationPreview.map((location) => ({ ...location, tipo: locationDraft.tipo }));
      setGeneratedLocations(printableLocations);
      if (response.data.create > 0) {
        toast.success(`${response.data.create} posizioni create, ${response.data.esistenti} già esistenti. Tutte pronte per la stampa.`);
      } else {
        toast.success(`${response.data.esistenti} posizioni già esistenti: blocco caricato per la ristampa.`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Posizioni non generate");
    } finally {
      setWorking(false);
    }
  };

  const printLocations = async (locations = generatedLocations) => {
    if (!locations.length || printingLocations) return;
    setPrintingLocations(true);
    try {
      const labels = locations.map((location) => ({
        code: location.codice,
        displayCode: String(location.codice).replace(/^[SP]/, ""),
        type: location.tipo,
        qrData: location.codice,
      }));
      if (pairedStation && stationOnline && printChannelRef.current) {
        const jobId = createPrintJobId();
        pendingPrintJobRef.current = jobId;
        const result = await printChannelRef.current.send({
          type: "broadcast",
          event: "print-location-labels",
          payload: { jobId, locations: labels },
        });
        if (result !== "ok") throw new Error("Invio alla Packing Station non riuscito");
        toast.message("Etichette inviate alla Packing Station");
        printTimeoutRef.current = window.setTimeout(() => {
          if (pendingPrintJobRef.current !== jobId) return;
          pendingPrintJobRef.current = "";
          setPrintingLocations(false);
          toast.error("La Packing Station non ha risposto. Controlla Zebra Browser Print sul PC.");
        }, 20000);
        return;
      }
      const printer = await printZebraLocationLabels(labels);
      toast.success(`${labels.length} etichette stampate direttamente su ${printer.name || "Zebra"}`);
    } catch (error) {
      pendingPrintJobRef.current = "";
      toast.error(pairedStation && !stationOnline
        ? "Packing Station offline e Zebra locale non raggiungibile. Apri la Packing Station sul PC oppure avvia Zebra Browser Print qui."
        : error.message || "Zebra non raggiungibile. Avvia Browser Print e riprova.");
    } finally {
      if (!pendingPrintJobRef.current) setPrintingLocations(false);
    }
  };

  const disconnectPrintStation = () => {
    unpairPrintStation();
    setPairedStation("");
    setStationOnline(false);
    toast.success("Packing Station scollegata");
  };

  return <div className="wms-page pb-24" data-testid="wms-cart-bags">
    <header>
      <button type="button" onClick={() => navigate("/wms-app/strumenti")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli strumenti"><ArrowLeft className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingCart className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Configurazione operativa</p><h1 className="mt-1 text-3xl font-black">Carrelli / Bag</h1><p className="mt-2 text-sm text-slate-500">Scansiona il carrello, scegli la griglia e poi assegna una bag a ogni casella.</p></div></div>
    </header>

    <section className="border-2 border-slate-950 bg-white p-4">
      <p className="text-xs font-black uppercase text-teal-700">1. Carrello</p>
      <h2 className="mt-1 text-xl font-black">Scansiona il master del carrello</h2>
      <div className="mt-4 flex gap-2"><Input value={cartCode} onChange={(event) => setCartCode(normalizeScannerCode(event.target.value))} placeholder={DEFAULT_CART} className="h-14 flex-1 font-mono text-lg" autoComplete="off" /><Button type="button" className="h-14 px-4" onClick={() => setScanner("cart")} disabled={working} aria-label="Apri fotocamera carrello"><ScanLine className="h-5 w-5" /></Button></div>
      <Button type="button" variant="outline" className="mt-2 h-11 w-full" onClick={() => scanCart()} disabled={!cartCode.trim() || working}>Apri carrello</Button>
    </section>

    {snapshot && <>
      <section className="rounded-md border border-teal-200 bg-teal-50 p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-teal-700">Carrello attivo</p><h2 className="mt-1 font-mono text-2xl font-black text-teal-950">{snapshot.cart.codice}</h2></div><span className="rounded-md bg-white px-3 py-2 text-sm font-black text-teal-800">{configured}/{capacity} bag</span></div>
        {snapshot.cart.codice === DEFAULT_CART && <p className="mt-3 text-xs font-semibold text-teal-900">Le prime 10 caselle sono le bag fisse del Metodo Galluse.</p>}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2"><Grid3X3 className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-black">2. Griglia del carrello</h2></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><GridStepper label="Righe" value={draftGrid.righe} onChange={(righe) => setDraftGrid((current) => ({ ...current, righe }))} min={1} max={6} /><GridStepper label="Colonne" value={draftGrid.colonne} onChange={(colonne) => setDraftGrid((current) => ({ ...current, colonne }))} min={1} max={10} /></div>
        <Button type="button" variant="outline" className="mt-4 h-11 w-full" onClick={saveGrid} disabled={working || (draftGrid.righe === Number(snapshot.cart.righe) && draftGrid.colonne === Number(snapshot.cart.colonne))}>Salva griglia {draftGrid.righe} x {draftGrid.colonne}</Button>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase text-teal-700">3. Bag</p><h2 className="mt-1 text-lg font-black">Tocca una casella e scansionala</h2></div><ShoppingBag className="h-6 w-6 text-slate-500" /></div>
        <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Number(snapshot.cart.colonne)}, minmax(0, 1fr))` }}>
          {Array.from({ length: capacity }, (_, index) => index + 1).map((position) => {
            const item = positionMap[position];
            const active = selectedPosition === position;
            return <div key={position} className={`relative min-h-24 overflow-hidden rounded-md border transition ${active ? "border-teal-700 bg-teal-50 ring-2 ring-teal-200" : item ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50 hover:border-teal-400"}`}>
              <button type="button" onClick={() => { setSelectedPosition(position); setBagCode(""); }} className="h-full min-h-24 w-full p-2 pr-8 text-left">
                <span className="block text-[10px] font-black uppercase text-slate-500">Pos. {position}</span>
                {item ? <><strong className="mt-2 block truncate font-mono text-sm">{item.bag_code}</strong><span className="mt-1 block text-[10px] font-bold text-emerald-700">{item.bag?.stato === "disponibile" ? "Libera" : item.bag?.stato || "Configurata"}</span></> : <span className="mt-3 flex items-center gap-1 text-xs font-bold text-slate-400"><Plus className="h-3.5 w-3.5" /> Bag</span>}
              </button>
              {item && <button type="button" onClick={() => removeBag(position)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-white text-rose-600" aria-label={`Rimuovi ${item.bag_code}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>;
          })}
        </div>
        {selectedPosition && <div className="mt-4 rounded-md border-2 border-teal-500 bg-teal-50 p-3"><div className="flex items-center justify-between"><span className="text-sm font-black text-teal-950">Posizione {selectedPosition}</span><button type="button" onClick={() => setSelectedPosition(null)} className="text-xs font-bold text-slate-500">Annulla</button></div><div className="mt-3 flex gap-2"><Input value={bagCode} onChange={(event) => setBagCode(normalizeScannerCode(event.target.value))} placeholder="B-12345" className="h-12 flex-1 font-mono" autoComplete="off" /><Button type="button" className="h-12 px-4" onClick={() => setScanner("bag")} disabled={working} aria-label="Scansiona bag"><ScanLine className="h-5 w-5" /></Button></div><Button type="button" variant="outline" className="mt-2 h-10 w-full bg-white" onClick={() => assignBag()} disabled={!bagCode.trim() || working}>Assegna bag alla posizione {selectedPosition}</Button></div>}
      </section>
    </>}

    <section className="rounded-md border border-slate-200 bg-white p-4" data-testid="wms-location-generator">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white"><Barcode className="h-5 w-5" /></span>
        <div><p className="text-xs font-black uppercase text-teal-700">Ubicazioni stampabili</p><h2 className="mt-1 text-xl font-black">Genera slot e pallet</h2><p className="mt-1 text-sm text-slate-500">Crea un blocco completo, salvalo nel WMS e stampa le etichette Zebra.</p></div>
      </div>

      <div className={`mt-4 flex items-center gap-3 rounded-md border p-3 ${pairedStation && stationOnline ? "border-emerald-300 bg-emerald-50" : pairedStation ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${pairedStation && stationOnline ? "bg-emerald-700 text-white" : "bg-white text-slate-500"}`}>{pairedStation && stationOnline ? <Wifi className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm">{pairedStation ? stationOnline ? "Packing Station collegata" : "Packing Station non raggiungibile" : "Nessuna Packing Station associata"}</strong>
          <span className="block truncate font-mono text-[11px] text-slate-600">{pairedStation || "Scansiona il QR mostrato sul PC della station"}</span>
        </div>
        {pairedStation && <button type="button" onClick={disconnectPrintStation} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-current/20 bg-white text-slate-600" aria-label="Scollega Packing Station"><Unplug className="h-4 w-4" /></button>}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
        <button type="button" onClick={() => updateLocationDraft({ tipo: "slot", livelli: 5 })} className={`flex h-12 items-center justify-center gap-2 rounded-md text-sm font-black ${locationDraft.tipo === "slot" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Layers3 className="h-5 w-5" /> Slot</button>
        <button type="button" onClick={() => updateLocationDraft({ tipo: "pallet", livelli: 3 })} className={`flex h-12 items-center justify-center gap-2 rounded-md text-sm font-black ${locationDraft.tipo === "pallet" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Warehouse className="h-5 w-5" /> Pallet</button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs font-black uppercase text-slate-500">Blocco iniziale</span><Input value={locationDraft.blocco} onChange={(event) => updateLocationDraft({ blocco: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="101" inputMode="numeric" className="mt-2 h-12 font-mono text-xl font-black" /></label>
        <label className="block"><span className="text-xs font-black uppercase text-slate-500">Blocco finale</span><Input value={locationDraft.bloccoFine} onChange={(event) => updateLocationDraft({ bloccoFine: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="110" inputMode="numeric" className="mt-2 h-12 font-mono text-xl font-black" /></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <GridStepper label="Livelli" value={locationDraft.livelli} onChange={(livelli) => updateLocationDraft({ livelli })} min={1} max={locationDraft.tipo === "pallet" ? 3 : 5} />
        <GridStepper label="Posti per livello" value={locationDraft.ubicazioni} onChange={(ubicazioni) => updateLocationDraft({ ubicazioni })} min={1} max={20} />
      </div>

      <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
        <strong className="block">{locationDraft.tipo === "pallet" ? "Livelli dall'alto: Z, Y, X" : "Livelli dal basso: A, B, C, D, E"}</strong>
        <span className="mt-1 block text-xs">Il prefisso {locationDraft.tipo === "pallet" ? "P" : "S"} resta nel barcode per distinguere il tipo, ma non appare nel testo grande dell'etichetta.</span>
      </div>

      <div className="mt-4 flex items-center justify-between"><h3 className="font-black">Anteprima blocchi {locationDraft.blocco || "-"}{locationDraft.bloccoFine !== locationDraft.blocco ? `-${locationDraft.bloccoFine || "-"}` : ""}</h3><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black">{locationPreview.length} posizioni</span></div>
      <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
        {locationPreview.slice(0, 60).map((location) => <div key={location.codice} className="rounded-md border border-slate-200 bg-slate-50 p-3"><span className="block text-[10px] font-black uppercase text-slate-500">Barcode {location.codice}</span><strong className="mt-2 block font-mono text-xl text-slate-950">{location.displayCode}</strong><span className="mt-1 block text-xs text-slate-500">Livello {location.livello} · posto {location.ubicazione}</span></div>)}
      </div>
      {locationPreview.length > 60 && <p className="mt-2 text-xs font-semibold text-slate-500">Mostrate le prime 60 posizioni. Verranno comunque generate e stampate tutte le {locationPreview.length} posizioni.</p>}

      <Button type="button" className="mt-4 h-12 w-full font-black" onClick={generateLocations} disabled={working || !locationDraft.blocco || !locationDraft.bloccoFine || !locationPreview.length}>{working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Plus className="mr-2 h-5 w-5" />} Genera e salva {locationPreview.length} posizioni</Button>
      <Button type="button" variant="outline" className="mt-2 h-12 w-full bg-white font-black" onClick={() => printLocations()} disabled={!generatedLocations.length || printingLocations}>{printingLocations ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Printer className="mr-2 h-5 w-5" />} {pairedStation && stationOnline ? "Invia tutto alla station" : pairedStation ? "Stampa direttamente da questo dispositivo" : "Stampa tutto in blocco"} {generatedLocations.length > 0 ? `· ${generatedLocations.length} posizioni` : ""}</Button>
      {generatedLocations.length > 0 && <p className="mt-2 text-center text-xs font-semibold text-slate-500">Formato Zebra 10 x 15 cm: 3 posizioni da 10 x 5 cm per etichetta · {physicalLocationLabels} {physicalLocationLabels === 1 ? "etichetta fisica" : "etichette fisiche"}</p>}

      {generatedLocations.length > 0 && <div className="mt-4 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-md border border-emerald-200 bg-emerald-50">
        {generatedLocations.map((location) => <div key={location.codice} className="flex items-center gap-3 p-3"><span className="min-w-0 flex-1"><strong className="block font-mono">{String(location.codice).replace(/^[SP]/, "")}</strong><span className="block text-xs text-emerald-800">Salvata come {location.codice}</span></span><button type="button" onClick={() => printLocations([location])} disabled={printingLocations} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-300 bg-white text-emerald-800 disabled:opacity-40" aria-label={`Stampa ${location.codice}`}><Printer className="h-4 w-4" /></button></div>)}
      </div>}
    </section>

    {scanner && <CameraScanner open onOpenChange={(open) => { if (!open) setScanner(null); }} purpose={scannerPurpose} onDetected={(value) => { if (scanner === "cart") scanCart(value); else assignBag(value); }} />}
    {working && <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center"><span className="flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-xl"><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio</span></div>}
  </div>;
}

function buildLocationPreview(draft) {
  const rawStart = String(draft.blocco || "").trim();
  const rawEnd = String(draft.bloccoFine || "").trim();
  if (!/^\d{1,5}$/.test(rawStart) || !/^\d{1,5}$/.test(rawEnd)) return [];
  const blockStart = Number(rawStart);
  const blockEnd = Number(rawEnd);
  if (blockEnd < blockStart || blockEnd - blockStart > 99) return [];
  const levels = draft.tipo === "pallet" ? ["Z", "Y", "X"] : ["A", "B", "C", "D", "E"];
  const prefix = draft.tipo === "pallet" ? "P" : "S";
  const blocks = Array.from({ length: blockEnd - blockStart + 1 }, (_, index) => String(blockStart + index));
  const locations = blocks.flatMap((block) => levels.slice(0, Number(draft.livelli) || 0).flatMap((livello) => Array.from({ length: Number(draft.ubicazioni) || 0 }, (_, index) => ({
      codice: `${prefix}${block}+${livello}${index + 1}`,
      displayCode: `${block}+${livello}${index + 1}`,
      livello,
      ubicazione: index + 1,
    }))));
  return locations.length <= 1000 ? locations : [];
}

function GridStepper({ label, value, onChange, min, max }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><span className="block text-xs font-black uppercase text-slate-500">{label}</span><div className="mt-2 flex items-center justify-between"><Button type="button" variant="outline" size="icon" className="h-9 w-9 bg-white" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}><Minus className="h-4 w-4" /></Button><strong className="font-mono text-2xl">{value}</strong><Button type="button" variant="outline" size="icon" className="h-9 w-9 bg-white" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}><Plus className="h-4 w-4" /></Button></div></div>;
}

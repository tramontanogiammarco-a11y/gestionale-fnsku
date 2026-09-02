import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  ArrowLeft, ArrowLeftRight, Boxes, Camera, Check, ChevronRight, Loader2,
  MapPin, PackagePlus, RotateCcw, ScanLine, Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";

const MODES = {
  move: { label: "Sposta", title: "Sposta quantita", help: "Da slot o pallet verso un'altra posizione." },
  replenish: { label: "Rifornisci", title: "Rifornisci slot", help: "Porta stock da un pallet a uno slot." },
};

export default function WmsAppStockMovement() {
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const inputRef = useRef(null);
  const [mode, setMode] = useState("move");
  const [code, setCode] = useState("");
  const [source, setSource] = useState(null);
  const [item, setItem] = useState(null);
  const [target, setTarget] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState(null);

  const stage = !source ? "source" : !item ? "product" : !target ? "target" : "quantity";
  const maxQuantity = Number(item?.quantita || 0);
  const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 40);

  useEffect(() => { focusInput(); }, [stage, mode]);
  useEffect(() => {
    const focus = () => focusInput();
    window.addEventListener("wms-focus-scanner", focus);
    return () => window.removeEventListener("wms-focus-scanner", focus);
  }, []);

  const reset = (nextMode = mode) => {
    setMode(nextMode);
    setCode("");
    setSource(null);
    setItem(null);
    setTarget(null);
    setQuantity(1);
    setCompleted(null);
    focusInput();
  };

  const scan = async (rawCode) => {
    const value = String(rawCode || "").trim();
    if (!value || loading || working || stage === "quantity") return;
    setCode(value);
    setLoading(true);
    try {
      const query = new URLSearchParams({ code: value });
      if (clientId && clientId !== "all") query.set("cliente_id", clientId);
      const response = await api.get(`/wms/scan?${query.toString()}`);
      if (response.data.kind !== "location") throw new Error("Scansiona il codice di uno slot o di un pallet.");
      const location = response.data.location;
      if (stage === "source") {
        if (!location.contenuto?.length) throw new Error(`${location.codice} e vuota.`);
        if (mode === "replenish" && location.tipo !== "pallet") throw new Error("Per il rifornimento scansiona prima un pallet.");
        setSource(location);
        if (location.contenuto.length === 1) setItem(location.contenuto[0]);
        toast.success(`${location.codice} impostata come origine`);
      } else {
        if (location.id === source.id) throw new Error("Origine e destinazione devono essere diverse.");
        if (mode === "replenish" && location.tipo !== "slot") throw new Error("La destinazione del rifornimento deve essere uno slot.");
        const incompatible = (location.contenuto || []).some((row) => row.cliente_id !== item.cliente_id || productKey(row) !== productKey(item));
        if (incompatible) throw new Error(`${location.codice} contiene gia un altro prodotto.`);
        setTarget(location);
        setQuantity(Math.min(1, Number(item.quantita || 0)));
        toast.success(`${location.codice} impostata come destinazione`);
      }
      setCode("");
      navigator.vibrate?.(70);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Scansione non riuscita");
      setCode("");
    } finally {
      setLoading(false);
      focusInput();
    }
  };

  const submitScan = (event) => {
    event.preventDefault();
    scan(code);
  };

  const confirm = async () => {
    const amount = Math.floor(Number(quantity));
    if (!source || !target || !item || amount < 1 || amount > maxQuantity) return;
    setWorking(true);
    try {
      const endpoint = mode === "replenish" ? "/wms/stock/pallet-slot" : "/wms/stock/sposta";
      await api.post(endpoint, {
        source_location_id: source.id,
        target_location_id: target.id,
        cliente_id: item.cliente_id,
        product_key: productKey(item),
        quantita: amount,
      });
      setCompleted({ source: source.codice, target: target.codice, title: item.titolo, quantity: amount });
      toast.success(`${amount} pezzi spostati in ${target.codice}`);
      navigator.vibrate?.([80, 50, 80]);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Movimento non riuscito");
    } finally {
      setWorking(false);
    }
  };

  const progress = stage === "source" || stage === "product" ? 1 : stage === "target" ? 2 : 3;
  const scanLabel = stage === "source" ? (mode === "replenish" ? "Scansiona il pallet origine" : "Scansiona l'origine") : "Scansiona la destinazione";

  if (completed) return (
    <div className="wms-page" data-testid="wms-stock-movement-complete">
      <header className="wms-page-header"><div><p className="wms-eyebrow">Movimento registrato</p><h1 className="wms-title">Stock spostato</h1></div></header>
      <section className="rounded-md border border-emerald-300 bg-emerald-50 p-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-600 text-white"><Check className="h-7 w-7" /></span>
        <h2 className="mt-4 text-xl font-black">{completed.quantity} pezzi trasferiti</h2>
        <p className="mt-1 text-sm font-semibold text-emerald-900">{completed.title}</p>
        <div className="mt-5 flex items-center gap-3 rounded-md border border-emerald-200 bg-white p-4">
          <LocationCode code={completed.source} label="Origine" /><ChevronRight className="h-5 w-5 shrink-0 text-emerald-700" /><LocationCode code={completed.target} label="Destinazione" />
        </div>
      </section>
      <Button type="button" className="h-14 w-full text-base font-black" onClick={() => reset()}><RotateCcw className="mr-2 h-5 w-5" /> Nuovo movimento</Button>
      <Button type="button" variant="outline" className="h-12 w-full bg-white font-bold" onClick={() => navigate("/wms-app/ubicazioni")}>Controlla stock</Button>
    </div>
  );

  return (
    <div className="wms-page" data-testid="wms-stock-movement">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Stock operativo</p><h1 className="wms-title">Movimenta stock</h1><p className="wms-subtitle">Scansiona origine e destinazione.</p></div>
        <Button type="button" size="icon" variant="outline" onClick={() => navigate("/wms-app/ubicazioni")} aria-label="Torna allo stock"><ArrowLeft className="h-5 w-5" /></Button>
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Tipo movimento">
        {Object.entries(MODES).map(([key, option]) => <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => reset(key)} className={`min-h-12 rounded-md px-3 text-sm font-black ${mode === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{option.label}</button>)}
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">{mode === "replenish" ? <PackagePlus className="h-6 w-6" /> : <ArrowLeftRight className="h-6 w-6" />}</span><div><h2 className="font-black">{MODES[mode].title}</h2><p className="mt-1 text-sm text-slate-500">{MODES[mode].help}</p></div></div>
      </section>

      <StepBar current={progress} />
      {source && <LocationSummary location={source} label="Origine" selectedItem={item} onReset={() => reset()} />}

      {stage === "product" && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-black text-amber-950">Scegli la referenza da spostare</h2>
          <div className="mt-3 space-y-2">{source.contenuto.map((row) => <button key={`${row.cliente_id}:${productKey(row)}`} type="button" onClick={() => { setItem(row); focusInput(); }} className="flex w-full items-center gap-3 rounded-md border border-amber-200 bg-white p-3 text-left"><Boxes className="h-5 w-5 text-amber-700" /><span className="min-w-0 flex-1"><strong className="block truncate">{row.titolo}</strong><span className="block font-mono text-xs text-slate-500">{row.ean || row.fnsku}</span></span><strong>{row.quantita} pz</strong></button>)}</div>
        </section>
      )}

      {(stage === "source" || stage === "target") && (
        <section className="rounded-md border-2 border-teal-600 bg-white p-4">
          <div className="flex items-center gap-3"><ScanLine className="h-6 w-6 text-teal-700" /><div><p className="text-xs font-black uppercase text-teal-700">Scanner pronto</p><h2 className="text-lg font-black">{scanLabel}</h2></div></div>
          <form onSubmit={submitScan} className="mt-4 flex gap-2">
            <Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" className="h-14 min-w-0 flex-1 text-center font-mono text-lg font-black" placeholder={stage === "source" ? "S... oppure P..." : "Scansiona destinazione"} disabled={loading} />
            <Button type="button" size="icon" className="h-14 w-14 shrink-0" onClick={() => setCameraOpen(true)} aria-label="Apri fotocamera"><Camera className="h-5 w-5" /></Button>
          </form>
          {loading && <div className="mt-3 flex items-center justify-center text-sm font-bold text-teal-700"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Controllo posizione</div>}
        </section>
      )}

      {target && <LocationSummary location={target} label="Destinazione" />}

      {stage === "quantity" && (
        <section className="rounded-md border border-slate-300 bg-white p-4">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase text-teal-700">Quantita da spostare</p><h2 className="mt-1 text-lg font-black">{item.titolo}</h2></div><span className="shrink-0 text-sm font-bold text-slate-500">max {maxQuantity}</span></div>
          <Input value={String(quantity)} onChange={(event) => setQuantity(clampQuantity(event.target.value, maxQuantity))} inputMode="numeric" className="mt-4 h-16 text-center text-3xl font-black" />
          <div className="mt-3 grid grid-cols-4 gap-2">{[1, 5, 10].map((amount) => <Button key={amount} type="button" variant="outline" className="h-12 bg-white font-black" onClick={() => setQuantity((current) => Math.min(maxQuantity, Number(current || 0) + amount))}>+{amount}</Button>)}<Button type="button" variant="outline" className="h-12 bg-amber-50 px-2 text-xs font-black text-amber-900" onClick={() => setQuantity(maxQuantity)}>Tutto</Button></div>
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm"><strong>Svuota origine</strong><span className="mt-1 block text-xs text-slate-500">Usa “Tutto”: i pezzi vengono trasferiti, non cancellati.</span></div>
          <Button type="button" className="mt-4 h-14 w-full text-base font-black" onClick={confirm} disabled={working || quantity < 1 || quantity > maxQuantity}>{working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ArrowLeftRight className="mr-2 h-5 w-5" />} Conferma movimento</Button>
          <Button type="button" variant="ghost" className="mt-2 h-11 w-full font-bold" onClick={() => { setTarget(null); setQuantity(1); focusInput(); }} disabled={working}>Cambia destinazione</Button>
        </section>
      )}

      <button type="button" onClick={() => navigate("/wms-app/inventario")} className="flex w-full items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-left"><Warehouse className="h-5 w-5 text-slate-600" /><span className="min-w-0 flex-1"><strong className="block">Quantita fisica diversa?</strong><span className="mt-1 block text-xs text-slate-500">Apri Inventario per contare e rettificare.</span></span><ChevronRight className="h-4 w-4" /></button>

      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="location" onDetected={(value) => { setCameraOpen(false); scan(value); }} />
    </div>
  );
}

function StepBar({ current }) {
  const steps = ["Origine", "Destinazione", "Quantita"];
  return <div className="grid grid-cols-3 gap-2">{steps.map((label, index) => { const number = index + 1; return <div key={label} className={`rounded-md border px-2 py-2 text-center text-[11px] font-black ${number === current ? "border-teal-600 bg-teal-50 text-teal-800" : number < current ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400"}`}><span className="mr-1">{number < current ? "✓" : number}.</span>{label}</div>; })}</div>;
}

function LocationSummary({ location, label, selectedItem, onReset }) {
  const shownItem = selectedItem || (location.contenuto || [])[0];
  return <section className="rounded-md border border-slate-200 bg-slate-950 p-4 text-white"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/10"><MapPin className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase text-teal-300">{label} · {location.tipo}</p><h2 className="mt-1 font-mono text-2xl font-black">{location.codice}</h2>{shownItem && <p className="mt-2 truncate text-sm font-semibold text-slate-200">{shownItem.titolo} · {shownItem.quantita} pz</p>}</div>{onReset && <Button type="button" size="sm" variant="secondary" onClick={onReset}>Cambia</Button>}</div></section>;
}

function LocationCode({ code, label }) {
  return <div className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase text-slate-500">{label}</span><strong className="mt-1 block truncate font-mono text-sm">{code}</strong></div>;
}

function productKey(row = {}) {
  const fnsku = String(row.fnsku || "").trim().toLowerCase();
  const ean = String(row.ean || "").trim().toLowerCase();
  const sku = String(row.sku || "").trim().toLowerCase();
  return fnsku ? `fnsku:${fnsku}` : ean ? `ean:${ean}` : sku ? `sku:${sku}` : null;
}

function clampQuantity(value, max) {
  const number = Math.floor(Number(String(value || "").replace(/\D/g, "")) || 0);
  return Math.max(0, Math.min(Number(max || 0), number));
}

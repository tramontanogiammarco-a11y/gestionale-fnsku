import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  ArrowDown, Camera, CheckCircle2, Loader2, PackageOpen, RefreshCw, Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import CameraScanner from "@/components/wms/CameraScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function scanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[’'`]/g, "-").replace(/\s+/g, "");
}

function clampQuantity(value, max) {
  const quantity = Math.floor(Number(String(value || "").replace(/\D/g, "")) || 0);
  return Math.max(0, Math.min(Number(max || 0), quantity));
}

export default function WmsAppRefill() {
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [step, setStep] = useState("source");
  const [quantity, setQuantity] = useState(0);
  const [working, setWorking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);

  const load = useCallback(async (synchronize = false) => {
    const query = new URLSearchParams();
    if (clientId && clientId !== "all") query.set("cliente_id", clientId);
    if (synchronize) await api.post("/wms/order-gate/recheck", { include_ready: true, limit: 500, cliente_id: clientId !== "all" ? clientId : null });
    const response = await api.get(`/wms/refill${query.toString() ? `?${query}` : ""}`);
    setData(response.data);
    setStep("source");
  }, [clientId]);

  useEffect(() => {
    load(true).catch((error) => toast.error(error.response?.data?.detail || "Coda refill non disponibile"));
  }, [load]);

  const current = data?.queue?.[0] || null;
  const requiredQuantity = Math.floor(Number(current?.quantita || 0));
  const maximumQuantity = Math.floor(Number(current?.maximum_quantity ?? current?.source?.quantita ?? 0));
  const expected = step === "source" ? current?.source?.codice : current?.target?.codice;
  const quantityValid = quantity >= requiredQuantity && quantity <= maximumQuantity;

  useEffect(() => {
    setQuantity(requiredQuantity);
  }, [current?.order?.id, current?.product?.product_key, requiredQuantity]);

  const openScanner = useCallback(() => {
    if (!current || working) return;
    setScannerSession((value) => value + 1);
    setCameraOpen(true);
  }, [current, working]);

  useEffect(() => {
    window.addEventListener("wms-focus-scanner", openScanner);
    return () => window.removeEventListener("wms-focus-scanner", openScanner);
  }, [openScanner]);

  const reopenScanner = () => window.setTimeout(openScanner, 250);

  const handleDetected = async (rawCode) => {
    if (!current || working) return;
    setCameraOpen(false);
    if (scanCode(rawCode) !== scanCode(expected)) {
      toast.error(`Posizione errata. Scansiona ${expected}.`);
      if (navigator.vibrate) navigator.vibrate(180);
      reopenScanner();
      return;
    }
    if (step === "source") {
      setStep("target");
      if (navigator.vibrate) navigator.vibrate(60);
      toast.success(`Pallet confermato. Sposta ${quantity} pezzi nello slot ${current.target.codice}.`);
      reopenScanner();
      return;
    }
    if (!quantityValid) {
      toast.error(`Scegli una quantità tra ${requiredQuantity} e ${maximumQuantity} pezzi.`);
      return;
    }
    setWorking(true);
    try {
      await api.post("/wms/rifornimenti", {
        cliente_id: current.order.cliente_id,
        order_id: current.order.id,
        product_key: current.product.product_key,
        source_location_id: current.source.id,
        target_location_id: current.target.id,
        quantita: quantity,
      });
      toast.success(`${quantity} pezzi spostati in ${current.target.codice}.`);
      if (navigator.vibrate) navigator.vibrate([70, 35, 70]);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Rifornimento non registrato");
      reopenScanner();
    } finally {
      setWorking(false);
    }
  };

  if (!data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const scannerContext = current ? {
    eyebrow: step === "source" ? "Pallet origine" : "Slot destinazione",
    progressText: step === "source" ? "Passaggio 1 di 2" : "Passaggio 2 di 2",
    location: expected,
    requested: quantity,
    title: current.product.titolo,
  } : null;

  return (
    <div className="wms-page" data-testid="wms-refill">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Rifornimento picking</p><h1 className="wms-title">Refill</h1><p className="wms-subtitle">Scansiona pallet e slot, poi sposta la quantità scelta.</p></div>
        <Button size="icon" variant="outline" onClick={() => load(true)} disabled={working} aria-label="Aggiorna"><RefreshCw className={`h-5 w-5 ${working ? "animate-spin" : ""}`} /></Button>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Ordini in attesa" value={data.orders_waiting || 0} />
        <Metric label="Attività refill" value={data.tasks || 0} />
      </div>

      {!current ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-7 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" />
          <h2 className="mt-4 text-xl font-black text-emerald-950">Nessun refill in attesa</h2>
          <p className="mt-2 text-sm text-emerald-800">Gli ordini coperti dagli slot possono entrare nel picking.</p>
        </section>
      ) : (
        <>
          <section className="border-2 border-slate-950 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-[11px] font-black uppercase text-teal-700">Prossima attività</p><h2 className="mt-1 text-xl font-black">{current.product.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.product.fnsku || current.product.ean}</p></div>
              <span className="shrink-0 rounded-md bg-amber-100 px-3 py-2 text-sm font-black text-amber-900">min {requiredQuantity}</span>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_36px_1fr] items-stretch gap-2">
              <Location label="Preleva dal pallet" code={current.source.codice} active={step === "source"} icon={PackageOpen} />
              <div className="flex items-center justify-center"><ArrowDown className="h-6 w-6 text-slate-400" /></div>
              <Location label="Porta allo slot" code={current.target.codice} active={step === "target"} icon={Warehouse} />
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500">Ordine {current.order.order_name} · {current.order.cliente_ragione_sociale}</p>
          </section>

          <section className="rounded-md border border-slate-300 bg-white p-4">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[11px] font-black uppercase text-teal-700">Quantità da spostare</p><h3 className="mt-1 text-lg font-black">Scegli anche più del necessario</h3></div><span className="shrink-0 text-xs font-bold text-slate-500">max {maximumQuantity}</span></div>
            <Input type="number" inputMode="numeric" min={requiredQuantity} max={maximumQuantity} value={quantity} onChange={(event) => setQuantity(clampQuantity(event.target.value, maximumQuantity))} className="mt-4 h-16 text-center text-3xl font-black" disabled={working || step === "target"} />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1, 5, 10].map((amount) => <Button key={amount} type="button" variant="outline" className="h-12 bg-white font-black" onClick={() => setQuantity((value) => Math.min(maximumQuantity, Number(value || 0) + amount))} disabled={working || step === "target"}>+{amount}</Button>)}
              <Button type="button" variant="outline" className="h-12 bg-amber-50 px-2 text-xs font-black text-amber-900" onClick={() => setQuantity(maximumQuantity)} disabled={working || step === "target"}>Tutto</Button>
            </div>
            <p className={`mt-3 text-xs font-bold ${quantityValid ? "text-slate-500" : "text-red-700"}`}>{quantityValid ? `Servono ${requiredQuantity} pezzi; sul pallet ce ne sono ${maximumQuantity}.` : `Inserisci almeno ${requiredQuantity} pezzi.`}</p>
          </section>

          <section className="border-2 border-teal-500 bg-white p-4">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-white"><Camera className="h-6 w-6" /></span><div><p className="text-[11px] font-black uppercase text-teal-700">Fotocamera</p><h3 className="text-lg font-black">Scansiona {expected}</h3></div></div>
            <Button type="button" className="mt-4 h-14 w-full text-base font-black" onClick={openScanner} disabled={working || !quantityValid}><Camera className="mr-2 h-5 w-5" /> Scansiona {step === "source" ? "pallet" : "slot"}</Button>
            {step === "target" && <p className="mt-3 text-center text-xs font-bold text-slate-500">Pallet verificato · {quantity} pezzi da portare nello slot</p>}
          </section>
        </>
      )}

      {cameraOpen && <CameraScanner key={`refill-${scannerSession}`} open onOpenChange={setCameraOpen} purpose="location" context={scannerContext} allowManual={false} onDetected={handleDetected} />}
    </div>
  );
}

function Metric({ label, value }) { return <div className="rounded-md border border-slate-200 bg-white p-4"><strong className="text-2xl font-black">{value}</strong><span className="mt-1 block text-[10px] font-black uppercase text-slate-500">{label}</span></div>; }
function Location({ label, code, active, icon: Icon }) { return <div className={`min-w-0 rounded-md border p-3 ${active ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50"}`}><Icon className={`h-5 w-5 ${active ? "text-teal-800" : "text-slate-500"}`} /><span className="mt-3 block text-[10px] font-black uppercase text-slate-500">{label}</span><strong className="mt-1 block break-all font-mono text-lg">{code}</strong></div>; }

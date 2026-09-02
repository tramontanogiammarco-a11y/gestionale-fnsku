import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowDown, Barcode, CheckCircle2, Loader2, PackageOpen, RefreshCw, Warehouse } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function scanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[’'`]/g, "-").replace(/\s+/g, "");
}

export default function WmsAppRefill() {
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [step, setStep] = useState("source");
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async (synchronize = false) => {
    const query = new URLSearchParams();
    if (clientId && clientId !== "all") query.set("cliente_id", clientId);
    if (synchronize) await api.post("/wms/order-gate/recheck", { include_ready: true, limit: 500, cliente_id: clientId !== "all" ? clientId : null });
    const response = await api.get(`/wms/refill${query.toString() ? `?${query}` : ""}`);
    setData(response.data);
    setStep("source");
    setCode("");
  }, [clientId]);

  useEffect(() => {
    load(true).catch((error) => toast.error(error.response?.data?.detail || "Coda refill non disponibile"));
  }, [load]);
  useEffect(() => { inputRef.current?.focus(); }, [data, step, working]);

  const current = data?.queue?.[0] || null;
  const expected = step === "source" ? current?.source?.codice : current?.target?.codice;

  const submit = async (event) => {
    event.preventDefault();
    if (!current || working) return;
    const scanned = scanCode(code);
    if (scanned !== scanCode(expected)) {
      toast.error(`Posizione errata. Scansiona ${expected}.`);
      setCode("");
      inputRef.current?.focus();
      return;
    }
    if (step === "source") {
      setStep("target");
      setCode("");
      if (navigator.vibrate) navigator.vibrate(60);
      toast.success("Pallet confermato. Porta la merce allo slot indicato.");
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
        quantita: current.quantita,
      });
      toast.success(`${current.quantita} pezzi spostati in ${current.target.codice}.`);
      if (navigator.vibrate) navigator.vibrate([70, 35, 70]);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Rifornimento non registrato");
      setCode("");
    } finally {
      setWorking(false);
    }
  };

  if (!data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  return (
    <div className="wms-page" data-testid="wms-refill">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Rifornimento picking</p><h1 className="wms-title">Refill</h1><p className="wms-subtitle">Porta negli slot la merce già disponibile a pallet.</p></div>
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
              <div><p className="text-[11px] font-black uppercase text-teal-700">Prossima attività</p><h2 className="mt-1 text-xl font-black">{current.product.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.product.fnsku || current.product.ean}</p></div>
              <span className="rounded-md bg-amber-100 px-3 py-2 text-sm font-black text-amber-900">{current.quantita} pz</span>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_36px_1fr] items-stretch gap-2">
              <Location label="Preleva dal pallet" code={current.source.codice} active={step === "source"} icon={PackageOpen} />
              <div className="flex items-center justify-center"><ArrowDown className="h-6 w-6 text-slate-400" /></div>
              <Location label="Porta allo slot" code={current.target.codice} active={step === "target"} icon={Warehouse} />
            </div>
            <p className="mt-3 text-xs font-bold text-slate-500">Ordine {current.order.order_name} · {current.order.cliente_ragione_sociale}</p>
          </section>

          <form onSubmit={submit} className="border-2 border-teal-500 bg-white p-4">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-white"><Barcode className="h-6 w-6" /></span><div><p className="text-[11px] font-black uppercase text-teal-700">Scanner pronto</p><h3 className="text-lg font-black">Scansiona {expected}</h3></div></div>
            <Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" className="mt-4 h-14 text-center font-mono text-xl font-black" placeholder={expected} disabled={working} />
            <Button type="submit" className="mt-3 h-12 w-full font-black" disabled={!code.trim() || working}>{working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Barcode className="mr-2 h-5 w-5" />}Conferma scansione</Button>
          </form>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }) { return <div className="rounded-md border border-slate-200 bg-white p-4"><strong className="text-2xl font-black">{value}</strong><span className="mt-1 block text-[10px] font-black uppercase text-slate-500">{label}</span></div>; }
function Location({ label, code, active, icon: Icon }) { return <div className={`min-w-0 rounded-md border p-3 ${active ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50"}`}><Icon className={`h-5 w-5 ${active ? "text-teal-800" : "text-slate-500"}`} /><span className="mt-3 block text-[10px] font-black uppercase text-slate-500">{label}</span><strong className="mt-1 block break-all font-mono text-lg">{code}</strong></div>; }

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Barcode, CheckCircle2, ChevronRight, Layers3, Loader2, MapPin, PackageCheck, Play, ScanLine, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import CameraScanner from "@/components/wms/CameraScanner";

const CART_MASTER_CODE = "CARRELLO-01";

export default function WmsAppGalluse() {
  const { batchId } = useParams();
  return batchId ? <GalluseMission batchId={batchId} /> : <GalluseQueue />;
}

function GalluseQueue() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    try {
      const query = clientId && clientId !== "all" ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
      setData((await api.get(`/wms/picking-galluse${query}`)).data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Metodo Galluse non disponibile");
      setData({ candidates: [], rounds: [], batches: [] });
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const active = (data?.batches || []).filter((batch) => ["da_associare_bag", "in_corso"].includes(batch.stato));
  const round = (data?.rounds || [])[0] || null;
  const start = async () => {
    if (!round) return;
    setWorking(true);
    try {
      const response = await api.post("/wms/picking-galluse/avvia", { cliente_id: round.cliente_id, offset: round.offset });
      toast.success(`Compito 1: ${response.data.summary.orders} ordini caricati sul carrello`);
      navigate(`/wms-app/picking-galluse/${response.data.batch.id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Missione Galluse non avviata");
    } finally {
      setWorking(false);
    }
  };
  const seedAiDemo = async () => {
    setWorking(true);
    try {
      const response = await api.post("/wms/picking-galluse/demo-a-i", {});
      toast.success(`${response.data.created} ordini creati: ${response.data.referenze} referenze, ${response.data.pezzi} pezzi`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Prova packing non creata");
    } finally {
      setWorking(false);
    }
  };
  const cancel = async () => {
    const batch = active[0];
    if (!batch || !window.confirm("Annullare questo carrello? Le bag saranno liberate e i suoi ordini torneranno disponibili.")) return;
    setWorking(true);
    try {
      await api.post(`/wms/picking-galluse/${batch.id}/annulla`, {});
      toast.success("Carrello annullato: bag e ordini sono stati liberati");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Carrello non annullato");
    } finally {
      setWorking(false);
    }
  };

  if (!data) return <Loading />;
  return <div className="space-y-5 pb-24" data-testid="wms-galluse-queue">
    <header>
      <button type="button" onClick={() => navigate("/wms-app/ordini")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button>
      <p className="text-xs font-black uppercase text-teal-700">Prepara ordini</p>
      <h1 className="mt-1 text-3xl font-black">Metodo Galluse</h1>
      <p className="mt-2 text-sm text-slate-500">Un carrello fisso da 10 bag. La coda viene divisa automaticamente in compiti da 10 ordini.</p>
    </header>
    <section className="grid grid-cols-3 gap-2">
      <Metric label="Ordini in coda" value={round?.totale_ordini || 0} />
      <Metric label="Compiti" value={round?.numero_compiti || 0} />
      <Metric label="Bag fisse" value="10" />
    </section>
    {searchParams.get("demo") === "ai" && <Button type="button" variant="outline" className="h-12 w-full" onClick={seedAiDemo} disabled={working}>Ripristina prova casa 22 pezzi</Button>}
    {active.length > 0 && <section>
      <h2 className="mb-3 text-xl font-black">Carrello aperto</h2>
      <button type="button" onClick={() => navigate(`/wms-app/picking-galluse/${active[0].id}`)} className="flex w-full items-center gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-teal-700"><ShoppingBag className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1"><strong className="block">Carrello fisso da {active[0].orders?.length || active[0].numero_bag} ordini</strong><span className="mt-1 block text-xs text-teal-800">{active[0].stato === "da_associare_bag" ? `Scansiona il master ${CART_MASTER_CODE}` : "Picking in corso"}</span></span>
        <Button type="button" variant="outline" size="icon" className="shrink-0 border-red-200 text-red-600" onClick={(event) => { event.stopPropagation(); cancel(); }} disabled={working} aria-label="Annulla carrello"><Trash2 className="h-4 w-4" /></Button>
        <ChevronRight className="h-5 w-5" />
      </button>
    </section>}
    <section>
      <h2 className="mb-3 text-xl font-black">Primo compito disponibile</h2>
      {round ? <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Layers3 className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h3 className="text-lg font-black">Compito 1 di {round.numero_compiti} · {round.numero_ordini} ordini</h3><p className="mt-1 text-xs text-slate-500">{round.cliente} · {round.referenze} referenze · {round.pezzi} pezzi</p></div></div>
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Le bag B-73846 fino a B-73855 sono fisse nelle posizioni 1-10. All'avvio scannerizzi solo il master {CART_MASTER_CODE}, poi parti subito dal primo slot.</p>
        <Button className="mt-4 h-14 w-full text-base font-black" onClick={start} disabled={working || active.length > 0}><Play className="mr-2 h-5 w-5" /> {active.length ? "Riprendi il carrello aperto" : "Avvia compito 1"}</Button>
      </article> : <Empty />}
    </section>
  </div>;
}

function GalluseMission({ batchId }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);
  const load = useCallback(async () => {
    try { setData((await api.get(`/wms/picking-galluse/${batchId}`)).data); }
    catch (error) { toast.error(error.response?.data?.detail || "Carrello non disponibile"); }
  }, [batchId]);
  useEffect(() => { load(); }, [load]);

  const current = data?.current_line || null;
  const awaitingCartScan = data?.batch?.stato === "da_associare_bag";
  const needsSlot = current && !current.location_confirmed_at;
  const remaining = current ? Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0) : 0;
  const completed = data?.batch?.stato === "completata";
  const scannerMode = awaitingCartScan ? "cart" : needsSlot ? "location" : null;
  const openScanner = useCallback(() => { setScannerSession((value) => value + 1); setCameraOpen(true); }, []);
  useEffect(() => {
    const focusScanner = () => { if (scannerMode) openScanner(); };
    window.addEventListener("wms-focus-scanner", focusScanner);
    return () => window.removeEventListener("wms-focus-scanner", focusScanner);
  }, [scannerMode, openScanner]);
  useEffect(() => {
    if (!scannerMode) { setCameraOpen(false); return undefined; }
    const timer = window.setTimeout(openScanner, 100);
    return () => window.clearTimeout(timer);
  }, [scannerMode, current?.id, openScanner]);
  useEffect(() => { setCode(""); setQuantity(0); }, [current?.id, current?.location_confirmed_at]);

  const scanCart = async (rawCode) => {
    const value = String(rawCode || code).trim().toUpperCase();
    if (!value) { toast.error("Scansiona il codice master del carrello."); return; }
    setWorking(true);
    try {
      setData((await api.post(`/wms/picking-galluse/${batchId}/scan`, { codice: value })).data);
      toast.success("Carrello confermato: vai al primo slot");
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Codice master non valido");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally {
      setWorking(false);
      setCode("");
    }
  };
  const scanSlot = async (rawCode) => {
    const value = String(rawCode || code).trim();
    if (!value) return;
    setWorking(true);
    try {
      setData((await api.post(`/wms/picking-galluse/${batchId}/scan`, { codice: value })).data);
      toast.success("Slot confermato: distribuisci i pezzi nelle bag indicate");
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Slot errato");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally {
      setWorking(false);
      setCode("");
    }
  };
  const confirmPick = async () => {
    setWorking(true);
    try {
      setData((await api.post(`/wms/picking-galluse/${batchId}/scan`, { quantita: quantity })).data);
      toast.success(`${quantity} pezzi ripartiti, vai al prossimo slot`);
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Quantita non registrata");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally { setWorking(false); }
  };
  const addQuantity = (amount) => setQuantity((value) => {
    if (value + amount > remaining) { toast.error(`Puoi prelevare al massimo ${remaining} pezzi.`); return value; }
    return value + amount;
  });

  if (!data) return <Loading />;
  const scannerContext = awaitingCartScan
    ? { location: CART_MASTER_CODE, title: "Carrello fisso: bag B-73846 - B-73855", requested: data.summary.orders, completedLines: 0, totalLines: data.summary.orders, picked: 0, expected: data.summary.expected }
    : needsSlot
      ? { location: current.location?.codice, title: current.titolo, requested: remaining, completedLines: (data.lines || []).filter((line) => Number(line.quantita_prelevata) >= Number(line.quantita_attesa)).length, totalLines: data.summary.stops, picked: data.summary.picked, expected: data.summary.expected }
      : null;
  return <div className="space-y-5 pb-24" data-testid="wms-galluse-mission">
    <header><button type="button" onClick={() => navigate("/wms-app/picking-galluse")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna ai carrelli"><ArrowLeft className="h-5 w-5" /></button><div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingBag className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Metodo Galluse</p><h1 className="mt-1 text-3xl font-black">Compito Galluse · {data.summary.orders} ordini</h1><p className="mt-1 text-sm text-slate-500">Ogni bag contiene un ordine. Il giro e aggregato per slot.</p></div></div></header>
    <section className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-end justify-between"><div><span className="text-xs font-black uppercase text-slate-500">Prelevati</span><div className="mt-1 text-3xl font-black">{data.summary.picked}<span className="text-lg text-slate-400">/{data.summary.expected}</span></div></div><strong className="text-teal-700">{data.summary.progress}%</strong></div><Progress value={data.summary.progress} className="mt-3 h-2" /></section>
    {awaitingCartScan && <section className="rounded-md border border-teal-200 bg-teal-50 p-4"><p className="text-xs font-black uppercase text-teal-700">Fase 1 di 2</p><h2 className="mt-1 text-xl font-black text-teal-950">Scansiona il master del carrello</h2><p className="mt-2 text-sm text-teal-900">Il carrello {CART_MASTER_CODE} ha gia le 10 bag fisse nelle posizioni 1-10. La scansione conferma che stai usando il carrello corretto.</p><div className="mt-4 flex items-center justify-between rounded-md bg-white p-3"><span className="font-bold">Bag pronte</span><strong className="font-mono text-xl">{data.summary.orders}/10</strong></div><Button type="button" variant="outline" className="mt-3 h-12 w-full bg-white" onClick={openScanner} disabled={working}><ScanLine className="mr-2 h-5 w-5" /> Scansiona {CART_MASTER_CODE}</Button></section>}
    {!awaitingCartScan && !completed && <section className="rounded-md border border-slate-200 bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Carrello preconfigurato</p><p className="mt-1 text-sm text-slate-600">Le bag sono fisse nelle loro posizioni. Parti direttamente dal primo slot.</p><div className="mt-3 grid grid-cols-5 gap-2">{(data.orders || []).map((link) => <div key={link.id} className="rounded-md bg-slate-100 p-2 text-center"><strong className="block font-mono text-sm">{link.posizione_bag}</strong><span className="mt-1 block truncate font-mono text-[9px] text-slate-600">{link.bag_code}</span></div>)}</div></section>}
    {completed ? <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" /><h2 className="mt-4 text-2xl font-black">Carrello completato</h2><p className="mt-2 text-sm text-emerald-800">Le {data.summary.orders} bag sono in attesa di packing: ogni scansione aprira un solo ordine.</p><Button className="mt-5 h-14 w-full text-base font-black" onClick={() => navigate("/wms-app/bag-storico")}><CheckCircle2 className="mr-2 h-5 w-5" /> Apri storico bag</Button></section> : awaitingCartScan ? <section className="border-2 border-slate-950 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Verifica carrello</p><h2 className="mt-1 text-2xl font-black">Scansiona {CART_MASTER_CODE}</h2><p className="mt-2 text-sm text-slate-500">Conferma il carrello fisico prima di iniziare il primo slot.</p><div className="mt-5 rounded-md bg-slate-50 p-4"><div className="font-mono text-3xl font-black">{CART_MASTER_CODE}</div><div className="mt-1 text-xs font-bold text-slate-500">Codice master carrello</div></div><form onSubmit={(event) => { event.preventDefault(); scanCart(); }} className="mt-4 flex gap-2"><Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder={CART_MASTER_CODE} className="h-14 flex-1 font-mono text-xl" autoComplete="off" /><Button type="submit" className="h-14 px-5" disabled={!code.trim() || working}><Barcode className="h-5 w-5" /></Button></form></section> : current && (needsSlot ? <section className="border-2 border-teal-500 bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-800"><MapPin className="h-6 w-6" /></span><div className="min-w-0 flex-1"><p className="text-xs font-black uppercase text-teal-700">Prossimo slot</p><h2 className="mt-1 text-3xl font-black">{current.location?.codice}</h2></div></div><p className="mt-4 text-sm font-semibold text-slate-600">{current.titolo} - prelievo totale {remaining} pezzi</p><form onSubmit={(event) => { event.preventDefault(); scanSlot(); }} className="mt-5 flex gap-2"><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={current.location?.codice} className="h-14 flex-1 font-mono text-xl" autoComplete="off" /><Button type="submit" className="h-14 px-5" disabled={!code.trim() || working}><ScanLine className="h-5 w-5" /></Button></form></section> : <section className="border-2 border-teal-500 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Preleva da {current.location?.codice}</p><h2 className="mt-1 text-xl font-black">{current.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.fnsku || current.ean || current.sku}</p><div className="mt-5 rounded-md bg-slate-950 p-5 text-center text-white"><div className="text-xs font-black uppercase text-slate-400">Prendi dal totale</div><div className="mt-1 text-5xl font-black">{remaining}</div><div className="mt-2 text-xs text-slate-400">e ripartisci nelle bag qui sotto</div></div><div className="mt-4 space-y-2">{current.allocations.map((allocation) => <div key={allocation.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 font-mono font-black text-white">{allocation.posizione_bag}</span><span className="min-w-0 flex-1"><strong className="block">Bag {allocation.posizione_bag} - {allocation.bag_code}</strong><span className="block truncate text-xs text-slate-500">{allocation.order?.order_name}</span></span><strong className="text-xl">x{allocation.quantita}</strong></div>)}</div><div className="mt-4 grid grid-cols-3 gap-2">{[1, 5, 10].map((amount) => <Button key={amount} variant="outline" className="h-14 text-lg font-black" onClick={() => addQuantity(amount)} disabled={quantity >= remaining}>+{amount}</Button>)}</div><div className="mt-2 flex items-center justify-between text-sm font-bold"><span>Conferma ripartizione</span><span>{quantity}/{remaining}</span></div><Button className="mt-3 h-14 w-full text-base font-black" onClick={confirmPick} disabled={working || quantity !== remaining}><PackageCheck className="mr-2 h-5 w-5" /> Conferma {remaining} pezzi</Button></section>)}
    <section><h2 className="mb-3 text-xl font-black">Percorso per slot</h2><div className="space-y-2">{(data.lines || []).map((line, index) => { const done = Number(line.quantita_prelevata) >= Number(line.quantita_attesa); const activeLine = line.id === current?.id; return <div key={line.id} className={`flex items-center gap-3 rounded-md border p-3 ${activeLine ? "border-teal-500 bg-teal-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full font-black ${done ? "bg-emerald-600 text-white" : activeLine ? "bg-teal-700 text-white" : "bg-slate-100"}`}>{done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}</span><span className="min-w-0 flex-1"><strong className="block truncate">{line.location?.codice} · {line.titolo}</strong><span className="text-xs text-slate-500">{line.quantita_prelevata}/{line.quantita_attesa} pezzi · {line.allocations.length} bag</span></span></div>; })}</div></section>
    {cameraOpen && <CameraScanner key={`galluse-${scannerSession}`} open onOpenChange={setCameraOpen} purpose={awaitingCartScan ? "cart" : "location"} context={scannerContext} onDetected={(value) => { setCameraOpen(false); if (awaitingCartScan) scanCart(value); else scanSlot(value); }} />}
  </div>;
}

function Metric({ label, value }) { return <div className="rounded-md bg-slate-100 p-3"><strong className="block text-2xl font-black">{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-500">{label}</span></div>; }
function Loading() { return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>; }
function Empty() { return <div className="rounded-md border border-dashed border-slate-300 bg-white py-14 text-center"><Layers3 className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">Servono almeno 10 ordini 1x1</h3><p className="mt-1 text-sm text-slate-500">Gli ordini identici restano nel flusso Massivo.</p></div>; }

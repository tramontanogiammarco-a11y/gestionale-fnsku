import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Barcode, CheckCircle2, ChevronRight, Layers3, Loader2, MapPin, PackageCheck, Play, ScanLine, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import CameraScanner from "@/components/wms/CameraScanner";

const BAG_PATTERN = /^B-[0-9]{5}$/;

export default function WmsAppGalluse() {
  const { batchId } = useParams();
  return batchId ? <GalluseMission batchId={batchId} /> : <GalluseQueue />;
}

function GalluseQueue() {
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    try {
      const query = clientId && clientId !== "all" ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
      setData((await api.get(`/wms/picking-galluse${query}`)).data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Metodo Galluse non disponibile");
      setData({ candidates: [], batches: [] });
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const availableByClient = useMemo(() => {
    const groups = new Map();
    for (const order of data?.candidates || []) {
      const current = groups.get(order.cliente_id) || { cliente_id: order.cliente_id, cliente: order.cliente_ragione_sociale || "Cliente", orders: [] };
      current.orders.push(order);
      groups.set(order.cliente_id, current);
    }
    return [...groups.values()].sort((left, right) => right.orders.length - left.orders.length);
  }, [data?.candidates]);
  const active = (data?.batches || []).filter((batch) => ["da_associare_bag", "in_corso"].includes(batch.stato));
  const start = async (group) => {
    setWorking(true);
    try {
      const response = await api.post("/wms/picking-galluse/avvia", { cliente_id: group.cliente_id });
      toast.success(`${response.data.summary.orders} ordini caricati sul carrello`);
      navigate(`/wms-app/picking-galluse/${response.data.batch.id}`);
    } catch (error) { toast.error(error.response?.data?.detail || "Missione Galluse non avviata"); }
    finally { setWorking(false); }
  };

  if (!data) return <Loading />;
  return <div className="space-y-5 pb-24" data-testid="wms-galluse-queue">
    <header><button type="button" onClick={() => navigate("/wms-app/ordini")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button><p className="text-xs font-black uppercase text-teal-700">Prepara ordini</p><h1 className="mt-1 text-3xl font-black">Metodo Galluse</h1><p className="mt-2 text-sm text-slate-500">Un carrello, fino a 10 bag e un solo giro per ogni slot.</p></header>
    <section className="grid grid-cols-3 gap-2"><Metric label="Ordini pronti" value={(data.candidates || []).length} /><Metric label="Carrelli aperti" value={active.length} /><Metric label="Max per giro" value="10" /></section>
    {active.length > 0 && <section><h2 className="mb-3 text-xl font-black">Carrelli aperti</h2><div className="space-y-3">{active.map((batch) => <button type="button" key={batch.id} onClick={() => navigate(`/wms-app/picking-galluse/${batch.id}`)} className="flex w-full items-center gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-left"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-teal-700"><ShoppingBag className="h-6 w-6" /></span><span className="min-w-0 flex-1"><strong className="block">Carrello da {batch.orders?.length || batch.numero_bag} ordini</strong><span className="mt-1 block text-xs text-teal-800">{batch.stato === "da_associare_bag" ? "Associa le bag al carrello" : "Picking in corso"}</span></span><ChevronRight className="h-5 w-5" /></button>)}</div></section>}
    <section><h2 className="mb-3 text-xl font-black">Giri disponibili</h2>{availableByClient.length ? <div className="space-y-3">{availableByClient.map((group) => { const orders = Math.min(10, group.orders.length); const pieces = group.orders.slice(0, 10).reduce((sum, order) => sum + (order.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0); return <article key={group.cliente_id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Layers3 className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h3 className="text-lg font-black">{orders} ordini sul carrello</h3><p className="mt-1 text-xs text-slate-500">{group.cliente} · {pieces} pezzi nel prossimo giro</p></div></div><p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Il sistema aggrega le referenze per slot e indica la bag di destinazione per ogni pezzo.</p><Button className="mt-4 h-14 w-full text-base font-black" onClick={() => start(group)} disabled={working}><Play className="mr-2 h-5 w-5" /> Prepara {orders} ordini</Button></article>; })}</div> : <Empty />}</section>
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
  const load = useCallback(async () => { try { setData((await api.get(`/wms/picking-galluse/${batchId}`)).data); } catch (error) { toast.error(error.response?.data?.detail || "Carrello non disponibile"); } }, [batchId]);
  useEffect(() => { load(); }, [load]);

  const current = data?.current_line || null;
  const binding = data?.batch?.stato === "da_associare_bag";
  const nextBag = (data?.orders || []).find((link) => !link.bag_code) || null;
  const needsSlot = current && !current.location_confirmed_at;
  const remaining = current ? Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0) : 0;
  const completed = data?.batch?.stato === "completata";
  const scannerMode = binding ? "bag" : needsSlot ? "location" : null;
  const openScanner = useCallback(() => { setScannerSession((value) => value + 1); setCameraOpen(true); }, []);
  useEffect(() => {
    if (!scannerMode) { setCameraOpen(false); return undefined; }
    const timer = window.setTimeout(openScanner, 100);
    return () => window.clearTimeout(timer);
  }, [scannerMode, current?.id, nextBag?.id, openScanner]);
  useEffect(() => { setCode(""); setQuantity(0); }, [current?.id, current?.location_confirmed_at]);

  const assignBag = async (rawCode) => {
    const value = String(rawCode || code).trim().toUpperCase();
    if (!nextBag || !BAG_PATTERN.test(value)) { toast.error("Scansiona una bag B-12345."); return; }
    setWorking(true);
    try { setData((await api.post(`/wms/picking-galluse/${batchId}/bag`, { posizione_bag: nextBag.posizione_bag, codice: value })).data); toast.success(`Bag ${value} assegnata alla posizione ${nextBag.posizione_bag}`); if (navigator.vibrate) navigator.vibrate([60, 35, 60]); }
    catch (error) { toast.error(error.response?.data?.detail || "Bag non valida"); if (navigator.vibrate) navigator.vibrate(180); }
    finally { setWorking(false); setCode(""); }
  };
  const scanSlot = async (rawCode) => {
    const value = String(rawCode || code).trim();
    if (!value) return;
    setWorking(true);
    try { setData((await api.post(`/wms/picking-galluse/${batchId}/scan`, { codice: value })).data); toast.success("Slot confermato: distribuisci i pezzi nelle bag indicate"); if (navigator.vibrate) navigator.vibrate([60, 35, 60]); }
    catch (error) { toast.error(error.response?.data?.detail || "Slot errato"); if (navigator.vibrate) navigator.vibrate(180); }
    finally { setWorking(false); setCode(""); }
  };
  const confirmPick = async () => {
    setWorking(true);
    try { setData((await api.post(`/wms/picking-galluse/${batchId}/scan`, { quantita: quantity })).data); toast.success(`${quantity} pezzi ripartiti, vai al prossimo slot`); if (navigator.vibrate) navigator.vibrate([60, 35, 60]); }
    catch (error) { toast.error(error.response?.data?.detail || "Quantita non registrata"); if (navigator.vibrate) navigator.vibrate(180); }
    finally { setWorking(false); }
  };
  const addQuantity = (amount) => setQuantity((value) => { if (value + amount > remaining) { toast.error(`Puoi prelevare al massimo ${remaining} pezzi.`); return value; } return value + amount; });

  if (!data) return <Loading />;
  const scannerContext = binding ? { title: `Bag posizione ${nextBag?.posizione_bag || ""}`, requested: 1, completedLines: data.summary.bags_ready, totalLines: data.summary.orders } : needsSlot ? { location: current.location?.codice, title: current.titolo, requested: remaining, completedLines: (data.lines || []).filter((line) => Number(line.quantita_prelevata) >= Number(line.quantita_attesa)).length, totalLines: data.summary.stops, picked: data.summary.picked, expected: data.summary.expected } : null;
  return <div className="space-y-5 pb-24" data-testid="wms-galluse-mission">
    <header><button type="button" onClick={() => navigate("/wms-app/picking-galluse")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna ai carrelli"><ArrowLeft className="h-5 w-5" /></button><div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingBag className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Metodo Galluse</p><h1 className="mt-1 text-3xl font-black">Carrello {data.summary.orders} ordini</h1><p className="mt-1 text-sm text-slate-500">Ogni bag contiene un ordine. Il giro e aggregato per slot.</p></div></div></header>
    <section className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-end justify-between"><div><span className="text-xs font-black uppercase text-slate-500">Prelevati</span><div className="mt-1 text-3xl font-black">{data.summary.picked}<span className="text-lg text-slate-400">/{data.summary.expected}</span></div></div><strong className="text-teal-700">{data.summary.progress}%</strong></div><Progress value={data.summary.progress} className="mt-3 h-2" /></section>
    {completed ? <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" /><h2 className="mt-4 text-2xl font-black">Carrello completato</h2><p className="mt-2 text-sm text-emerald-800">Le {data.summary.orders} bag sono in attesa di packing: ogni scansione aprira un solo ordine.</p><Button className="mt-5 h-14 w-full text-base font-black" onClick={() => navigate("/wms-app/bag-storico")}><CheckCircle2 className="mr-2 h-5 w-5" /> Apri storico bag</Button></section> : binding ? <section className="border-2 border-slate-950 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Allestimento carrello</p><h2 className="mt-1 text-2xl font-black">Scansiona la bag {nextBag?.posizione_bag}</h2><p className="mt-2 text-sm text-slate-500">Posizione {nextBag?.posizione_bag} di {data.summary.orders}: collega una bag libera all'ordine {nextBag?.order?.order_name}.</p><div className="mt-5 rounded-md bg-slate-50 p-4"><div className="font-mono text-3xl font-black">{nextBag?.posizione_bag}</div><div className="mt-1 text-xs font-bold text-slate-500">Posizione carrello</div></div><form onSubmit={(event) => { event.preventDefault(); assignBag(); }} className="mt-4 flex gap-2"><Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="B-73845" className="h-14 flex-1 font-mono text-xl" autoComplete="off" /><Button type="submit" className="h-14 px-5" disabled={!BAG_PATTERN.test(code) || working}><Barcode className="h-5 w-5" /></Button></form></section> : current && (needsSlot ? <section className="border-2 border-teal-500 bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-800"><MapPin className="h-6 w-6" /></span><div className="min-w-0 flex-1"><p className="text-xs font-black uppercase text-teal-700">Prossimo slot</p><h2 className="mt-1 text-3xl font-black">{current.location?.codice}</h2></div></div><p className="mt-4 text-sm font-semibold text-slate-600">{current.titolo} - prelievo totale {remaining} pezzi</p><form onSubmit={(event) => { event.preventDefault(); scanSlot(); }} className="mt-5 flex gap-2"><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={current.location?.codice} className="h-14 flex-1 font-mono text-xl" autoComplete="off" /><Button type="submit" className="h-14 px-5" disabled={!code.trim() || working}><ScanLine className="h-5 w-5" /></Button></form></section> : <section className="border-2 border-teal-500 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Preleva da {current.location?.codice}</p><h2 className="mt-1 text-xl font-black">{current.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.fnsku || current.ean || current.sku}</p><div className="mt-5 rounded-md bg-slate-950 p-5 text-center text-white"><div className="text-xs font-black uppercase text-slate-400">Prendi dal totale</div><div className="mt-1 text-5xl font-black">{remaining}</div><div className="mt-2 text-xs text-slate-400">e ripartisci nelle bag qui sotto</div></div><div className="mt-4 space-y-2">{current.allocations.map((allocation) => <div key={allocation.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 font-mono font-black text-white">{allocation.posizione_bag}</span><span className="min-w-0 flex-1"><strong className="block">Bag {allocation.posizione_bag} - {allocation.bag_code}</strong><span className="block truncate text-xs text-slate-500">{allocation.order?.order_name}</span></span><strong className="text-xl">x{allocation.quantita}</strong></div>)}</div><div className="mt-4 grid grid-cols-3 gap-2">{[1, 5, 10].map((amount) => <Button key={amount} variant="outline" className="h-14 text-lg font-black" onClick={() => addQuantity(amount)} disabled={quantity >= remaining}>+{amount}</Button>)}</div><div className="mt-2 flex items-center justify-between text-sm font-bold"><span>Conferma ripartizione</span><span>{quantity}/{remaining}</span></div><Button className="mt-3 h-14 w-full text-base font-black" onClick={confirmPick} disabled={working || quantity !== remaining}><PackageCheck className="mr-2 h-5 w-5" /> Conferma {remaining} pezzi</Button></section>)}
    <section><h2 className="mb-3 text-xl font-black">Percorso per slot</h2><div className="space-y-2">{(data.lines || []).map((line, index) => { const done = Number(line.quantita_prelevata) >= Number(line.quantita_attesa); const activeLine = line.id === current?.id; return <div key={line.id} className={`flex items-center gap-3 rounded-md border p-3 ${activeLine ? "border-teal-500 bg-teal-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full font-black ${done ? "bg-emerald-600 text-white" : activeLine ? "bg-teal-700 text-white" : "bg-slate-100"}`}>{done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}</span><span className="min-w-0 flex-1"><strong className="block truncate">{line.location?.codice} · {line.titolo}</strong><span className="text-xs text-slate-500">{line.quantita_prelevata}/{line.quantita_attesa} pezzi · {line.allocations.length} bag</span></span></div>; })}</div></section>
    {cameraOpen && <CameraScanner key={`galluse-${scannerSession}`} open onOpenChange={setCameraOpen} purpose={binding ? "bag" : "location"} context={scannerContext} onDetected={(value) => { setCameraOpen(false); if (binding) assignBag(value); else scanSlot(value); }} />}
  </div>;
}

function Metric({ label, value }) { return <div className="rounded-md bg-slate-100 p-3"><strong className="block text-2xl font-black">{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-500">{label}</span></div>; }
function Loading() { return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>; }
function Empty() { return <div className="rounded-md border border-dashed border-slate-300 bg-white py-14 text-center"><Layers3 className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">Nessun ordine 1x1 disponibile</h3><p className="mt-1 text-sm text-slate-500">Gli ordini identici restano nel flusso Massivo.</p></div>; }

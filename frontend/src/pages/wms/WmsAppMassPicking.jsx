import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Barcode, CheckCircle2, ChevronRight, Layers3, Loader2, MapPin, Play, ScanLine, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import CameraScanner from "@/components/wms/CameraScanner";

const bagPattern = /^B-[A-Z0-9]{5}$/;

export default function WmsAppMassPicking({ mode = "massivo" }) {
  const { batchId } = useParams();
  return batchId ? <MassMission batchId={batchId} mode={mode} /> : <MassQueue mode={mode} />;
}

function MassQueue({ mode }) {
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    try {
      const query = clientId && clientId !== "all" ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
      setData((await api.get(`/wms/picking-${mode}${query}`)).data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Picking non disponibile");
      setData({ groups: [], batches: [], separate_orders: 0 });
    }
  }, [clientId, mode]);
  useEffect(() => { load(); }, [load]);
  const start = async (group, selectedOrders = group.numero_ordini) => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/picking-${mode}/avvia`, {
        signature: group.signature,
        cliente_id: group.cliente_id,
        numero_ordini: selectedOrders,
      });
      toast.success(mode === "mono" ? "Missione mono-prodotto avviata" : "Missione Massivo avviata");
      navigate(`/wms-app/picking-${mode}/${response.data.batch.id}`);
    } catch (error) { toast.error(error.response?.data?.detail || "Missione non avviata"); }
    finally { setWorking(false); }
  };
  if (!data) return <Loading />;
  const active = (data.batches || []).filter((batch) => ["in_corso", "da_confermare_bag"].includes(batch.stato));
  return <div className="wms-page pb-24" data-testid="wms-mass-picking-queue">
    <header><button type="button" onClick={() => navigate("/wms-app/ordini")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button><p className="text-xs font-black uppercase text-teal-700">Prepara ordini</p><h1 className="mt-1 text-3xl font-black">{mode === "mono" ? "Mono-prodotto" : "Massivo"}</h1><p className="mt-2 text-sm text-slate-500">{mode === "mono" ? "Gli ordini da un solo pezzo non aggregabili nel Massivo vengono raccolti nella stessa bag." : "Due o piu ordini con la stessa distinta vengono prelevati insieme, anche quando contengono un solo pezzo."}</p></header>
    <section className="grid grid-cols-3 gap-2"><Metric label="Gruppi" value={(data.groups || []).length} /><Metric label={mode === "mono" ? "Ordini mono" : "Ordini massivi"} value={(data.groups || []).reduce((sum, group) => sum + group.numero_ordini, 0)} /><Metric label={mode === "mono" ? "Da rifornire" : "Altri ordini"} value={mode === "mono" ? data.refill_orders || 0 : data.separate_orders || 0} /></section>
    {mode === "mono" && (data.refill_products || []).length > 0 && <section className="rounded-md border border-amber-300 bg-amber-50 p-4"><h2 className="text-sm font-black text-amber-950">Richiedono refill</h2><div className="mt-2 divide-y divide-amber-200">{data.refill_products.map((product) => <div key={product.referenza_id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-amber-950">{product.titolo}</strong><span className="font-mono text-[11px] text-amber-800">{product.ean || product.sku}</span></span><strong className="text-amber-950">×{product.quantita}</strong></div>)}</div></section>}
    {active.length > 0 && <section><h2 className="mb-3 text-xl font-black">Missioni aperte</h2><div className="space-y-3">{active.map((batch) => <button key={batch.id} type="button" onClick={() => navigate(`/wms-app/picking-${mode}/${batch.id}`)} className="flex w-full items-center gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-left"><BagBadge code={batch.bag_code || "-"} /><span className="min-w-0 flex-1"><strong className="block">{batch.orders?.length || 0} ordini</strong><span className="mt-1 block text-xs text-teal-800">{statusLabel(batch.stato)}</span></span><ChevronRight className="h-5 w-5" /></button>)}</div></section>}
    <section><h2 className="mb-3 text-xl font-black">Gruppi disponibili</h2>{(data.groups || []).length ? <div className="space-y-3">{data.groups.map((group) => <QueueGroupCard key={group.key} group={group} mode={mode} working={working} onStart={start} />)}</div> : <EmptyMass mode={mode} />}</section>
  </div>;
}

function QueueGroupCard({ group, mode, working, onStart }) {
  const available = Number(group.numero_ordini || 0);
  const minimum = mode === "mono" ? 1 : 2;
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    setSelected((current) => Math.min(current, available));
  }, [available]);
  const add = (amount) => setSelected((current) => Math.min(available, current + amount));
  return <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Layers3 className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h3 className="text-lg font-black">{available} {mode === "mono" ? "ordini mono-pezzo" : "ordini identici"}</h3><p className="mt-1 text-xs text-slate-500">{group.cliente} · {group.pezzi_totali} pezzi totali</p></div></div>
    <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">{group.products.map((product) => <div key={product.referenza_id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{product.titolo}</strong><span className="font-mono text-[11px] text-slate-500">{product.ean || product.sku}</span></span><strong>×{selected * Number(product.quantita_per_ordine || 1)}</strong></div>)}</div>
    <div className="mt-4 rounded-md bg-slate-950 p-4 text-white">
      <div className="flex items-end justify-between"><span className="text-xs font-black uppercase text-slate-400">Ordini nel carrello</span><strong className="text-4xl font-black">{selected}<span className="text-lg text-slate-400">/{available}</span></strong></div>
      <div className="mt-3 grid grid-cols-3 gap-2">{[1, 5, 10].map((amount) => <Button key={amount} type="button" variant="secondary" className="h-14 text-lg font-black" onClick={() => add(amount)} disabled={working || selected >= available}>+{amount}</Button>)}</div>
      <button type="button" className="mt-3 h-10 w-full text-sm font-bold text-slate-300 disabled:opacity-50" onClick={() => setSelected(0)} disabled={working || selected === 0}>Azzera</button>
    </div>
    <Button className="mt-4 h-14 w-full text-base font-black" onClick={() => onStart(group, selected)} disabled={working || selected < minimum}><Play className="mr-2 h-5 w-5" /> Avvia con {selected} {selected === 1 ? "ordine" : "ordini"}</Button>
  </article>;
}

function MassMission({ batchId, mode }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [bagCode, setBagCode] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState(0);
  const selectedQuantityRef = useRef(0);
  const quantitySubmitRef = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);
  const load = useCallback(async () => { try { setData((await api.get(`/wms/picking-${mode}/${batchId}`)).data); } catch (error) { toast.error(error.response?.data?.detail || "Missione non disponibile"); } }, [batchId, mode]);
  useEffect(() => { load(); }, [load]);
  const current = data?.current_line;
  const remaining = current ? Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0) : 0;
  const needsSlot = current && !current.location_confirmed_at;
  const bagConfirmation = data?.batch?.stato === "da_confermare_bag";
  useEffect(() => {
    setSelectedQuantity(0);
    selectedQuantityRef.current = 0;
    quantitySubmitRef.current = false;
    setCode("");
  }, [current?.id, current?.location_confirmed_at]);
  const scannerMode = bagConfirmation ? "bag" : needsSlot ? "location" : null;
  const openScanner = useCallback(() => {
    setScannerSession((value) => value + 1);
    setCameraOpen(true);
  }, []);
  useEffect(() => {
    if (!scannerMode) { setCameraOpen(false); return undefined; }
    const timer = window.setTimeout(openScanner, 35);
    return () => window.clearTimeout(timer);
  }, [scannerMode, current?.id, openScanner]);
  const send = async (payload, success, fallback) => {
    setWorking(true);
    try { setData((await api.post(`/wms/picking-${mode}/${batchId}/scan`, payload)).data); toast.success(success); if (navigator.vibrate) navigator.vibrate([60, 35, 60]); }
    catch (error) { toast.error(error.response?.data?.detail || fallback); if (navigator.vibrate) navigator.vibrate(180); }
    finally { setWorking(false); }
  };
  const scanSlot = (rawCode) => { const value = String(rawCode || code).trim(); if (value) { setCode(""); send({ codice: value }, mode === "mono" ? "Prelievo registrato, passa al prossimo prodotto" : "Slot confermato", "Slot o prodotto errato"); } };
  const confirmBag = (rawCode) => { const value = String(rawCode || bagCode).trim().toUpperCase(); if (bagPattern.test(value)) { setBagCode(""); send({ codice: value }, "Bag confermata e registrata nello storico", "Bag non valida"); } };
  const confirmQuantity = async (quantity = selectedQuantityRef.current) => {
    if (quantitySubmitRef.current || working || quantity !== remaining) return;
    quantitySubmitRef.current = true;
    try {
      await send({ quantita: quantity }, `${quantity} pezzi prelevati`, "Quantità non registrata");
    } finally {
      quantitySubmitRef.current = false;
    }
  };
  const addQuantity = (amount) => {
    if (working || quantitySubmitRef.current) return;
    const nextQuantity = selectedQuantityRef.current + amount;
    if (nextQuantity > remaining) {
      toast.error(`Puoi prelevare al massimo ${remaining} pezzi.`);
      return;
    }
    selectedQuantityRef.current = nextQuantity;
    setSelectedQuantity(nextQuantity);
    if (nextQuantity === remaining) window.setTimeout(() => confirmQuantity(nextQuantity), 0);
  };
  const complete = ["completata", "in_packing", "completata_packing"].includes(data?.batch?.stato);
  const routeStops = useMemo(() => data?.lines || [], [data?.lines]);
  if (!data) return <Loading />;
  const scannerContext = needsSlot && current ? buildScannerContext(data.lines || [], current, remaining, data.summary) : null;
  return <div className="wms-page pb-24" data-testid="wms-mass-picking-mission">
    <header><button type="button" onClick={() => navigate(`/wms-app/picking-${mode}`)} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna alle missioni"><ArrowLeft className="h-5 w-5" /></button><div className="flex items-start gap-3"><BagBadge code={data.batch.bag_code || "-"} /><div><p className="text-xs font-black uppercase text-teal-700">Picking {mode === "mono" ? "Mono-prodotto" : "Massivo"}</p><h1 className="mt-1 text-3xl font-black">{data.summary.orders} ordini</h1><p className="mt-1 text-sm text-slate-500">{mode === "mono" ? "Preleva ogni pezzo seguendo la rotta e raccogli tutto in una sola bag." : `Preleva ${data.summary.orders} pezzi per ogni referenza. La bag viene scelta e scansionata solo alla fine.`}</p></div></div></header>
    <section className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-end justify-between"><div><div className="text-xs font-black uppercase text-slate-500">Avanzamento</div><div className="mt-1 text-3xl font-black">{data.summary.picked}<span className="text-lg text-slate-400">/{data.summary.expected}</span></div></div><strong className="text-teal-700">{data.summary.progress}%</strong></div><Progress value={data.summary.progress} className="mt-3 h-2" /></section>
    {complete ? <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" /><h2 className="mt-4 text-2xl font-black">Bag registrata</h2><p className="mt-2 text-sm text-emerald-800">La bag {data.batch.bag_code} e stata consegnata al flusso packing. Da qui puoi solo consultarla nello storico.</p><Button className="mt-5 h-14 w-full text-base font-black" onClick={() => navigate("/wms-app/bag-storico")}><CheckCircle2 className="mr-2 h-5 w-5" /> Apri storico bag</Button></section> : bagConfirmation ? <section className="border-2 border-slate-950 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Prelievo completato</p><h2 className="mt-1 text-2xl font-black">Scansiona una bag libera</h2><p className="mt-2 text-sm text-slate-500">Hai preso {data.summary.expected} pezzi. Mettili in una bag libera e scansionala ora: sarà occupata solo per questo packing.</p><Button type="button" className="mt-5 h-14 w-full text-base font-black" onClick={openScanner} disabled={working}><ScanLine className="mr-2 h-5 w-5" /> Scansiona bag</Button><form onSubmit={(event) => { event.preventDefault(); confirmBag(); }} className="mt-3 flex gap-2"><Input value={bagCode} onChange={(event) => setBagCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 7))} placeholder="B-7K2Q9" className="h-14 flex-1 font-mono text-xl tracking-widest" /><Button type="submit" className="h-14 px-5" disabled={!bagPattern.test(bagCode) || working}><Barcode className="h-5 w-5" /></Button></form></section> : current && (needsSlot ? <section className="border-2 border-teal-500 bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-800"><MapPin className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Prossimo slot</p><h2 className="text-3xl font-black">{current.location?.codice}</h2></div></div>{current.foto_url && <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white p-2"><img src={fileUrl(current.foto_url)} alt={current.titolo} className="h-44 w-full object-contain" /></div>}<Button className="mt-5 h-16 w-full text-base font-black" onClick={openScanner}><ScanLine className="mr-2 h-6 w-6" /> Scansiona barcode slot</Button><form onSubmit={(event) => { event.preventDefault(); scanSlot(); }} className="mt-3 flex gap-2"><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={current.location?.codice} className="h-12 flex-1 font-mono" /><Button type="submit" size="icon" variant="outline" className="h-12 w-12"><Barcode className="h-5 w-5" /></Button></form></section> : <section className="border-2 border-teal-500 bg-white p-5"><p className="text-xs font-black uppercase text-teal-700">Preleva da {current.location?.codice}</p><h2 className="mt-1 text-xl font-black">{current.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.fnsku || current.ean || current.sku}</p>{current.foto_url && <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white p-2"><img src={fileUrl(current.foto_url)} alt={current.titolo} className="h-44 w-full object-contain" /></div>}<div className="mt-5 rounded-md bg-slate-950 p-5 text-center text-white"><div className="text-xs font-black uppercase text-slate-400">Selezionati</div><div className="mt-1 text-5xl font-black">{selectedQuantity}<span className="text-xl text-slate-400">/{remaining}</span></div></div><div className="mt-3 grid grid-cols-3 gap-2">{[1, 5, 10].map((amount) => <Button key={amount} variant="outline" className="h-16 text-xl font-black" onClick={() => addQuantity(amount)} disabled={selectedQuantity >= remaining}>+{amount}</Button>)}</div><Button variant="ghost" className="mt-3 h-14 w-full" onClick={() => { selectedQuantityRef.current = 0; setSelectedQuantity(0); }}>Azzera</Button></section>)}
    <section><h2 className="mb-3 text-xl font-black">Percorso</h2><div className="space-y-2">{routeStops.map((line, index) => { const done = Number(line.quantita_prelevata) >= Number(line.quantita_attesa); return <div key={line.id} className={`flex items-center gap-3 rounded-md border p-3 ${line.id === current?.id ? "border-teal-500 bg-teal-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full font-black ${done ? "bg-emerald-600 text-white" : "bg-slate-100"}`}>{done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}</span><span className="min-w-0 flex-1"><strong className="block">{line.location?.codice} · {line.titolo}</strong><span className="text-xs text-slate-500">{line.quantita_prelevata}/{line.quantita_attesa} pezzi</span></span></div>; })}</div></section>
    {cameraOpen && <CameraScanner key={`mass-${scannerSession}`} open onOpenChange={setCameraOpen} purpose={bagConfirmation ? "bag" : "location"} context={scannerContext} onDetected={(value) => { setCameraOpen(false); if (bagConfirmation) confirmBag(value); else scanSlot(value); }} />}
  </div>;
}

function BagBadge({ code }) { return <span className="flex min-w-20 flex-col items-center justify-center rounded-md bg-slate-950 px-3 py-2 text-white"><ShoppingBag className="h-5 w-5" /><strong className="mt-1 font-mono text-sm">{code}</strong></span>; }
function Metric({ label, value }) { return <div className="rounded-md bg-slate-100 p-3"><strong className="block text-2xl font-black">{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-500">{label}</span></div>; }
function Loading() { return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>; }
function EmptyMass({ mode }) { return <div className="rounded-md border border-dashed border-slate-300 bg-white py-14 text-center"><Layers3 className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">{mode === "mono" ? "Nessun ordine mono-pezzo" : "Nessun gruppo identico"}</h3><p className="mt-1 text-sm text-slate-500">{mode === "mono" ? "Servono ordini verificati da un solo pezzo che non formino un gruppo Massivo." : "Servono almeno due ordini verificati con la stessa distinta."}</p></div>; }
function statusLabel(status) { return status === "in_corso" ? "Picking in corso" : status === "da_confermare_bag" ? "Scansiona bag finale" : status === "completata" ? "Pronta per il packing" : status === "in_packing" ? "Packing in corso" : "Completata"; }
function buildScannerContext(lines, current, remaining, summary) {
  const groups = new Map();
  for (const line of lines) {
    const key = line.referenza_id || line.product_key || line.id;
    const bucket = groups.get(key) || [];
    bucket.push(line);
    groups.set(key, bucket);
  }
  const completedLines = [...groups.values()].filter((group) => group.every((line) => Number(line.quantita_prelevata || 0) >= Number(line.quantita_attesa || 0))).length;
  return {
    location: current.location?.codice,
    title: current.titolo,
    imageUrl: current.foto_url ? fileUrl(current.foto_url) : null,
    requested: remaining,
    completedLines,
    totalLines: groups.size,
    picked: summary.picked,
    expected: summary.expected,
    allowProductBarcode: Boolean(current.picking_scan_product_enabled),
  };
}

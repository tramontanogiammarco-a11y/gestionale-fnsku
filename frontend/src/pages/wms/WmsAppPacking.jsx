import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Barcode, Box, Camera, CheckCircle2, ChevronRight, ImageIcon, Loader2,
  PackageCheck, Play, ScanLine, ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import CameraScanner from "@/components/wms/CameraScanner";

export default function WmsAppPacking() {
  const { orderId, bagCode } = useParams();
  return bagCode ? <BagPacking bagCode={bagCode} /> : orderId ? <PackingStation orderId={orderId} /> : <PackingQueue />;
}

function PackingQueue() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);
  const [bagCode, setBagCode] = useState("");
  const load = useCallback(async () => {
    try { const response = await api.get("/wms/packing"); setSessions(response.data || []); }
    catch (error) { toast.error(error.response?.data?.detail || "Packing non disponibile"); setSessions([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!sessions) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  const active = sessions.filter((session) => session.stato !== "completata");
  const completed = sessions.filter((session) => session.stato === "completata");
  return <div className="space-y-5 pb-24" data-testid="wms-packing-queue"><header><p className="text-xs font-black uppercase text-teal-700">Outbound</p><h1 className="mt-1 text-3xl font-black">Packing station</h1><p className="mt-2 text-sm text-slate-500">{active.length} ordini da verificare e imballare.</p></header><section className="rounded-md border-2 border-slate-950 bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingBag className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-slate-500">Bag ordine o Massivo</p><h2 className="text-xl font-black">Scansiona la bag</h2></div></div><form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (/^[0-9]{6}$/.test(bagCode)) navigate(`/wms-app/packing/bag/${bagCode}`); else toast.error("Il codice bag deve avere 6 cifre"); }}><Input value={bagCode} onChange={(event) => setBagCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" className="h-14 flex-1 font-mono text-2xl tracking-widest" autoFocus /><Button type="submit" className="h-14 px-5" disabled={bagCode.length !== 6}><Barcode className="h-5 w-5" /></Button></form></section><section className="space-y-3">{active.length ? active.filter((session) => !session.mass_batch_id).map((session) => <PackingCard key={session.id} session={session} onClick={() => navigate(`/wms-app/packing/${session.order_id}`)} />) : <div className="rounded-md border border-dashed border-slate-300 bg-white py-14 text-center"><PackageCheck className="mx-auto h-9 w-9 text-emerald-600" /><h2 className="mt-3 font-black">Nessun ordine da imballare</h2></div>}</section>{completed.length > 0 && <section><h2 className="mb-3 text-lg font-black">Completati</h2><div className="space-y-2">{completed.slice(0, 10).map((session) => <PackingCard key={session.id} session={session} onClick={() => navigate(`/wms-app/packing/${session.order_id}`)} />)}</div></section>}</div>;
}

function BagPacking({ bagCode }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { const response = await api.get(`/wms/packing/bag/${bagCode}`); setData(response.data); }
    catch (error) { toast.error(error.response?.data?.detail || "Bag non trovata"); }
  }, [bagCode]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  return <div className="space-y-5 pb-24" data-testid="wms-bag-packing"><header><button type="button" onClick={() => navigate("/wms-app/packing")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white"><ArrowLeft className="h-5 w-5" /></button><div className="flex items-center gap-3"><span className="flex h-16 min-w-24 flex-col items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingBag className="h-5 w-5" /><strong className="mt-1 font-mono">{bagCode}</strong></span><div><p className="text-xs font-black uppercase text-teal-700">{data.batch ? "Packing Massivo" : "Packing ordine"}</p><h1 className="mt-1 text-3xl font-black">{data.summary.orders} {data.summary.orders === 1 ? "ordine" : "ordini"}</h1><p className="mt-1 text-sm text-slate-500">{data.summary.completed} completati</p></div></div></header><Progress value={data.summary.orders ? (data.summary.completed / data.summary.orders) * 100 : 0} className="h-2" /><section className="space-y-3">{data.sessions.map((session) => <article key={session.id} className={`rounded-md border p-4 ${session.stato === "completata" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-full font-black ${session.stato === "completata" ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>{session.stato === "completata" ? <CheckCircle2 className="h-5 w-5" /> : session.packing_sequence || 1}</span><span className="min-w-0 flex-1"><strong className="block text-lg">Ordine {session.order?.order_name}</strong><span className="text-xs text-slate-500">{session.lines.length} prodotti</span></span></div><div className="mt-4 grid grid-cols-3 gap-2">{session.lines.map((line) => <div key={line.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-2 text-center">{line.foto_url ? <img src={fileUrl(line.foto_url)} alt="" className="mx-auto h-16 w-full object-contain" /> : <span className="mx-auto flex h-16 w-full items-center justify-center bg-slate-50 text-slate-300"><ImageIcon className="h-6 w-6" /></span>}<strong className="mt-2 block truncate text-[11px]">{line.titolo}</strong><span className="mt-1 block text-xs font-black">×{line.quantita_attesa}</span></div>)}</div><Button className="mt-4 h-13 w-full font-black" variant={session.stato === "completata" ? "outline" : "default"} onClick={() => navigate(`/wms-app/packing/${session.order_id}`)}>{session.stato === "completata" ? "Rivedi ordine" : "Imballa questo ordine"}<ChevronRight className="ml-2 h-4 w-4" /></Button></article>)}</section></div>;
}

function PackingCard({ session, onClick }) {
  const pieces = (session.order?.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm"><span className={`flex h-11 w-11 items-center justify-center rounded-md ${session.stato === "completata" ? "bg-emerald-50 text-emerald-700" : "bg-teal-50 text-teal-700"}`}><Box className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block text-lg">{session.order?.order_name}</strong><span className="mt-1 block text-xs text-slate-500">{session.order?.cliente_ragione_sociale} · {pieces} pezzi · {session.station_code}</span></span><ChevronRight className="h-5 w-5 text-slate-400" /></button>;
}

function PackingStation({ orderId }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [stationCode, setStationCode] = useState("PACK-01");
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cameraOpen, setCameraOpen] = useState(false);
  const load = useCallback(async () => { try { const response = await api.get(`/wms/packing/${orderId}`); setData(response.data); if (response.data.session?.station_code) setStationCode(response.data.session.station_code); } catch (error) { toast.error(error.response?.data?.detail || "Packing non disponibile"); } finally { setLoading(false); } }, [orderId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const focus = () => window.setTimeout(() => inputRef.current?.focus(), 60); window.addEventListener("wms-focus-scanner", focus); return () => window.removeEventListener("wms-focus-scanner", focus); }, []);
  const start = async () => { setWorking(true); try { const response = await api.post(`/wms/packing/${orderId}/avvia`, { station_code: stationCode }); setData(response.data); toast.success(`${stationCode} avviata`); } catch (error) { toast.error(error.response?.data?.detail || "Station non avviata"); } finally { setWorking(false); } };
  const scan = async (rawCode) => { const value = String(rawCode || code).trim(); if (!value || !data?.session) return; setWorking(true); try { const response = await api.post(`/wms/packing/${data.session.id}/scan`, { codice: value, quantita: Number(quantity) }); setData(response.data); setCode(""); setQuantity(1); if (navigator.vibrate) navigator.vibrate([60,35,60]); toast.success("Prodotto verificato"); } catch (error) { toast.error(error.response?.data?.detail || "Scansione non valida"); if (navigator.vibrate) navigator.vibrate(180); } finally { setWorking(false); } };
  const complete = async () => { setWorking(true); try { const response = await api.post(`/wms/packing/${data.session.id}/completa`, {}); setData(response.data); toast.success("Collo chiuso e pronto alla spedizione"); } catch (error) { toast.error(error.response?.data?.detail || "Packing non completato"); } finally { setWorking(false); } };
  if (loading) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  if (!data) return null;
  const completed = data.session?.stato === "completata";
  return <div className="space-y-5 pb-24" data-testid="wms-packing-station"><header><button type="button" onClick={() => navigate("/wms-app/packing")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna alla coda packing"><ArrowLeft className="h-5 w-5" /></button><p className="text-xs font-black uppercase text-teal-700">Packing station</p><h1 className="mt-1 text-3xl font-black">{data.order.order_name}</h1><p className="mt-1 text-sm text-slate-500">{data.order.cliente_ragione_sociale}</p></header>{!data.session || data.session.stato === "da_imballare" ? <section className="rounded-md border border-slate-200 bg-white p-5"><Box className="h-9 w-9 text-teal-700" /><h2 className="mt-4 text-xl font-black">Inizializza station</h2><label className="mt-4 block"><span className="mb-1 block text-xs font-black uppercase text-slate-500">Codice station</span><Input value={stationCode} onChange={(event) => setStationCode(event.target.value.toUpperCase())} className="h-13 font-mono text-lg" /></label><Button className="mt-4 h-14 w-full text-base font-black" onClick={start} disabled={working}><Play className="mr-2 h-5 w-5" /> Avvia packing</Button></section> : completed ? <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" /><h2 className="mt-4 text-2xl font-black">Collo verificato</h2><p className="mt-2 text-sm text-emerald-800">Pronto per etichetta e spedizione.</p></section> : <><section className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-end justify-between"><div><div className="text-xs font-bold uppercase text-slate-500">{data.session.station_code}</div><div className="mt-1 text-3xl font-black">{data.summary.verified}<span className="text-lg text-slate-400">/{data.summary.expected}</span></div></div><strong className="text-teal-700">{data.summary.progress}%</strong></div><Progress value={data.summary.progress} className="mt-3 h-2" /></section><section className="border-2 border-teal-500 bg-white p-5"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-800"><ScanLine className="h-6 w-6" /></span><div><div className="text-xs font-black uppercase text-teal-700">Verifica contenuto</div><h2 className="mt-1 text-xl font-black">Scansiona il prodotto</h2></div></div><div className="mt-4 grid grid-cols-[1fr_100px] gap-3"><Button className="h-14" onClick={() => setCameraOpen(true)}><Camera className="mr-2 h-5 w-5" /> Fotocamera</Button><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-14 text-lg font-black" /></div><form onSubmit={(event) => { event.preventDefault(); scan(); }} className="mt-3 flex gap-2"><Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} placeholder="EAN, FNSKU o SKU" className="h-12 flex-1 font-mono" autoComplete="off" /><Button type="submit" size="icon" variant="outline" className="h-12 w-12" disabled={!code.trim() || working}><Barcode className="h-5 w-5" /></Button></form></section>{!data.current_line && <Button className="h-14 w-full text-base font-black" onClick={complete} disabled={working}><PackageCheck className="mr-2 h-5 w-5" /> Chiudi collo</Button>}</>}
      <section><h2 className="mb-3 text-xl font-black">Contenuto ordine</h2><div className="space-y-2">{data.lines.map((line) => { const done = Number(line.quantita_verificata) >= Number(line.quantita_attesa); return <div key={line.id} className={`flex items-center gap-3 rounded-md border p-3 ${done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full ${done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? <CheckCircle2 className="h-5 w-5" /> : <Box className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><strong className="block truncate">{line.titolo}</strong><span className="mt-1 block font-mono text-[11px] text-slate-500">{line.fnsku || line.ean || line.sku}</span></div><strong>{line.quantita_verificata}/{line.quantita_attesa}</strong></div>; })}</div></section>
      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="product" onDetected={(value) => { setCameraOpen(false); scan(value); }} />
    </div>;
}

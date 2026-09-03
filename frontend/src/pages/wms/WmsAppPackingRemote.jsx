import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ImageIcon, Loader2, MonitorUp, PackageCheck, Unplug, Wifi } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { fileUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { createPrintJobId, getPairedPrintStationCode, normalizePrintStationCode, pairPrintStation, printStationChannelName } from "@/lib/printStation";

function groupedProducts(station) {
  const groups = new Map();
  for (const session of station?.sessions || []) {
    if (session.stato !== "in_attesa_packing") continue;
    const line = session.lines?.[0];
    if (!line) continue;
    const key = line.referenza_id || line.ean || line.fnsku || line.sku || line.id;
    const current = groups.get(key) || { ...line, count: 0, sessionId: session.id };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()];
}

export default function WmsAppPackingRemote() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const timeoutRef = useRef(null);
  const pendingRequestRef = useRef("");
  const channelRef = useRef(null);
  const [stationCode, setStationCode] = useState(getPairedPrintStationCode);
  const [stationOnline, setStationOnline] = useState(false);
  const [station, setStation] = useState(null);
  const [selecting, setSelecting] = useState("");
  const products = useMemo(() => groupedProducts(station), [station]);

  useEffect(() => {
    const code = normalizePrintStationCode(searchParams.get("station"));
    if (!code) return;
    pairPrintStation(code);
    setStationCode(code);
  }, [searchParams]);

  useEffect(() => {
    if (!supabase || !stationCode) return undefined;
    const channel = supabase.channel(printStationChannelName(stationCode), {
      config: { broadcast: { ack: true }, presence: { key: `mono-mobile-${Date.now()}` } },
    });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const devices = Object.values(channel.presenceState()).flat();
        setStationOnline(devices.some((device) => device.role === "station" && device.capabilities?.includes("mono-packing")));
      })
      .on("broadcast", { event: "packing-state" }, ({ payload }) => setStation(payload?.station || null))
      .on("broadcast", { event: "mono-select-result" }, ({ payload }) => {
        if (!payload?.requestId || payload.requestId !== pendingRequestRef.current) return;
        window.clearTimeout(timeoutRef.current);
        pendingRequestRef.current = "";
        setSelecting("");
        if (payload.ok) toast.success("Prodotto inviato alla Packing Station");
        else toast.error(payload.message || "Prodotto non selezionabile");
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ role: "mobile", capabilities: ["mono-packing"], pairedAt: new Date().toISOString() });
          await channel.send({ type: "broadcast", event: "request-packing-state", payload: {} });
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setStationOnline(false);
      });

    const refresh = window.setInterval(() => channel.send({ type: "broadcast", event: "request-packing-state", payload: {} }), 3000);
    return () => {
      window.clearInterval(refresh);
      window.clearTimeout(timeoutRef.current);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [stationCode]);

  const selectProduct = async (product) => {
    if (!stationOnline || !station?.bag_code || selecting) return;
    const channel = channelRef.current;
    if (!channel) return;
    const requestId = createPrintJobId();
    pendingRequestRef.current = requestId;
    setSelecting(product.sessionId);
    const result = await channel.send({
      type: "broadcast",
      event: "mono-product-select",
      payload: { requestId, bagCode: station.bag_code, sessionId: product.sessionId },
    });
    if (result !== "ok") {
      pendingRequestRef.current = "";
      setSelecting("");
      toast.error("Invio alla Packing Station non riuscito");
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      if (pendingRequestRef.current !== requestId) return;
      pendingRequestRef.current = "";
      setSelecting("");
      toast.error("La Packing Station non ha risposto");
    }, 10000);
  };

  const monoReady = station?.batch?.picking_mode === "mono";
  return <div className="wms-page pb-24" data-testid="wms-packing-remote">
    <header className="wms-page-header items-start">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/wms-app/ordini")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli ordini"><ArrowLeft className="h-5 w-5" /></button>
        <div><p className="wms-eyebrow">Packing collegato</p><h1 className="wms-title">Seleziona prodotto</h1></div>
      </div>
    </header>

    <div className={`flex items-center gap-3 border p-3 ${stationOnline ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      {stationOnline ? <Wifi className="h-5 w-5" /> : <Unplug className="h-5 w-5" />}
      <span><strong className="block text-sm">{stationOnline ? "Packing Station collegata" : "Packing Station non raggiungibile"}</strong><span className="font-mono text-[10px]">{stationCode || "Scansiona il QR della station"}</span></span>
    </div>

    {!station ? <section className="mt-4 flex min-h-72 flex-col items-center justify-center border border-dashed border-slate-300 bg-white p-7 text-center"><MonitorUp className="h-10 w-10 text-slate-300" /><h2 className="mt-3 font-black">In attesa della station</h2><p className="mt-1 text-sm text-slate-500">Scansiona una bag sulla Packing Station.</p></section>
      : !monoReady ? <section className="mt-4 flex min-h-72 flex-col items-center justify-center border border-slate-200 bg-white p-7 text-center"><PackageCheck className="h-10 w-10 text-teal-700" /><h2 className="mt-3 font-black">Bag {station.bag_code || "non attiva"}</h2><p className="mt-1 text-sm text-slate-500">Le foto interattive sono disponibili per le bag mono-prodotto.</p></section>
      : station.phase === "completed" ? <section className="mt-4 flex min-h-72 flex-col items-center justify-center border border-emerald-300 bg-emerald-50 p-7 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-700" /><h2 className="mt-3 text-xl font-black">Bag completata</h2></section>
      : <>
        <section className="mt-4 flex items-center justify-between border-b border-slate-200 pb-3"><div><p className="text-[10px] font-black uppercase text-teal-700">Bag attiva</p><strong className="font-mono text-2xl">{station.bag_code}</strong></div><span className="rounded-md bg-slate-950 px-3 py-2 text-sm font-black text-white">{products.reduce((sum, product) => sum + product.count, 0)} rimasti</span></section>
        {station.phase === "select_product" ? <div className="mt-3 grid grid-cols-2 gap-3">{products.map((product) => <button key={product.sessionId} type="button" onClick={() => selectProduct(product)} disabled={!stationOnline || Boolean(selecting)} className="relative min-h-52 overflow-hidden border-2 border-slate-200 bg-white p-3 text-left transition active:border-teal-600 active:bg-teal-50 disabled:opacity-60">
          <span className="absolute right-2 top-2 z-10 rounded-md bg-slate-950 px-2 py-1 text-sm font-black text-white">×{product.count}</span>
          {product.foto_url ? <img src={fileUrl(product.foto_url)} alt={product.titolo} className="h-28 w-full object-contain" /> : <span className="flex h-28 items-center justify-center text-slate-300"><ImageIcon className="h-9 w-9" /></span>}
          <strong className="mt-2 block text-sm leading-4">{product.titolo}</strong>
          <span className="mt-2 block truncate font-mono text-[10px] text-slate-500">{product.ean || product.fnsku || product.sku}</span>
          {selecting === product.sessionId && <span className="absolute inset-0 flex items-center justify-center bg-white/85"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></span>}
        </button>)}</div> : <section className="mt-4 border border-sky-300 bg-sky-50 p-5 text-center text-sky-950"><PackageCheck className="mx-auto h-8 w-8" /><h2 className="mt-2 font-black">Prodotto selezionato</h2><p className="mt-1 text-sm">Continua sulla Packing Station: scansiona imballaggio ed etichetta.</p></section>}
      </>}
  </div>;
}

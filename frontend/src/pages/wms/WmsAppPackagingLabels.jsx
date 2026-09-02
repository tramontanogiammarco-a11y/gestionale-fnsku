import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Box, Check, Loader2, Minus, Package, Plus, Printer, ShoppingBag, Unplug, Wifi } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { createPrintJobId, getPairedPrintStationCode, normalizePrintStationCode, pairPrintStation, printStationChannelName } from "@/lib/printStation";
import { printZebraPackagingLabels } from "@/lib/zebraPrinter";

const PACKAGING = [
  { code: "SCATOLA-PICCOLA", title: "Scatola piccola", icon: Box },
  { code: "SCATOLA-MEDIA", title: "Scatola media", icon: Box },
  { code: "SCATOLA-GRANDE", title: "Scatola grande", icon: Package },
  { code: "BUSTA-CORRIERE", title: "Busta corriere", icon: ShoppingBag },
];

export default function WmsAppPackagingLabels() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const channelRef = useRef(null);
  const timeoutRef = useRef(null);
  const pendingJobRef = useRef("");
  const [stationCode, setStationCode] = useState(getPairedPrintStationCode);
  const [selected, setSelected] = useState(() => new Set(PACKAGING.map((item) => item.code)));
  const [copies, setCopies] = useState(1);
  const [stationOnline, setStationOnline] = useState(false);
  const [channelReady, setChannelReady] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const stationFromQr = normalizePrintStationCode(searchParams.get("station"));
    if (!stationFromQr) return;
    pairPrintStation(stationFromQr);
    setStationCode(stationFromQr);
  }, [searchParams]);

  useEffect(() => {
    if (!supabase || !stationCode) return undefined;
    const channel = supabase.channel(printStationChannelName(stationCode), {
      config: { broadcast: { ack: true }, presence: { key: `packaging-${Date.now()}` } },
    });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const devices = Object.values(channel.presenceState()).flat();
        setStationOnline(devices.some((device) => device.role === "station"
          && Array.isArray(device.capabilities)
          && device.capabilities.includes("packaging-labels")));
      })
      .on("broadcast", { event: "print-result" }, ({ payload }) => {
        if (!payload?.jobId || payload.jobId !== pendingJobRef.current) return;
        window.clearTimeout(timeoutRef.current);
        pendingJobRef.current = "";
        setPrinting(false);
        if (payload.ok) toast.success(`${payload.count} barcode stampati su ${payload.printer || "Zebra"}`);
        else toast.error(payload.message || "Stampa non completata");
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setChannelReady(true);
          await channel.track({ role: "mobile", pairedAt: new Date().toISOString() });
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          setChannelReady(false);
          setStationOnline(false);
        }
      });
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [stationCode]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const labels = useMemo(() => Array.from({ length: copies }, () => PACKAGING
    .filter((item) => selected.has(item.code))
    .map(({ code, title }) => ({ code, title }))).flat(), [copies, selected]);

  const toggle = (code) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    return next;
  });

  const print = async () => {
    if (!labels.length || printing) return;
    if (stationCode && !stationOnline) {
      toast.error("Packing Station non pronta: aggiorna una volta la pagina sul Mac e attendi lo stato verde.");
      return;
    }
    setPrinting(true);
    try {
      if (stationCode && stationOnline && channelReady && channelRef.current) {
        const jobId = createPrintJobId();
        pendingJobRef.current = jobId;
        const result = await channelRef.current.send({
          type: "broadcast",
          event: "print-packaging-labels",
          payload: { jobId, labels },
        });
        if (result !== "ok") throw new Error("Invio alla Packing Station non riuscito");
        toast.message("Barcode inviati alla Packing Station");
        timeoutRef.current = window.setTimeout(() => {
          if (pendingJobRef.current !== jobId) return;
          pendingJobRef.current = "";
          setPrinting(false);
          toast.error("La Packing Station non ha risposto. Aggiorna la pagina della station sul Mac oppure usa Stampa PDF.");
        }, 12000);
        return;
      }
      const printer = await printZebraPackagingLabels(labels);
      toast.success(`${labels.length} barcode stampati su ${printer.name || "Zebra"}`);
    } catch (error) {
      pendingJobRef.current = "";
      toast.error(error.message || "Zebra non raggiungibile");
    } finally {
      if (!pendingJobRef.current) setPrinting(false);
    }
  };

  const printPdf = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const { data } = await api.get("/wms/packaging/etichette", { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const frame = document.createElement("iframe");
      frame.className = "hidden";
      frame.src = url;
      const cleanup = () => {
        frame.remove();
        URL.revokeObjectURL(url);
      };
      frame.onload = () => {
        frame.contentWindow?.addEventListener("afterprint", cleanup, { once: true });
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        window.setTimeout(cleanup, 300000);
        setPrinting(false);
      };
      document.body.appendChild(frame);
    } catch (error) {
      setPrinting(false);
      toast.error(error.response?.data?.detail || error.message || "PDF non disponibile");
    }
  };

  return <div className="wms-page pb-32">
    <header className="wms-page-header">
      <div className="flex items-start gap-3">
        <Button type="button" size="icon" variant="outline" onClick={() => navigate("/wms-app/strumenti")} aria-label="Torna agli strumenti"><ArrowLeft className="h-5 w-5" /></Button>
        <div><p className="wms-eyebrow">Strumenti</p><h1 className="wms-title">Barcode imballaggi</h1><p className="wms-subtitle">Seleziona i codici e stampali in blocco.</p></div>
      </div>
    </header>

    <div className={`mb-4 flex items-center gap-3 rounded-md border p-3 text-sm font-bold ${stationOnline ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}>
      {stationOnline ? <Wifi className="h-5 w-5" /> : <Unplug className="h-5 w-5" />}
      {stationOnline ? "Packing Station pronta per stampare" : stationCode && channelReady ? "Station associata: aggiorna la pagina sul Mac" : stationCode ? "Collegamento alla Packing Station in corso" : "Zebra locale"}
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PACKAGING.map((item) => {
        const active = selected.has(item.code);
        return <button key={item.code} type="button" onClick={() => toggle(item.code)} className={`relative flex min-h-32 items-center gap-4 rounded-md border-2 p-4 text-left ${active ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white"}`}>
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-md ${active ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}><item.icon className="h-7 w-7" /></span>
          <span className="min-w-0"><strong className="block text-lg">{item.title}</strong><span className="mt-1 block break-all font-mono text-xs text-slate-500">{item.code}</span></span>
          {active && <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white"><Check className="h-4 w-4" /></span>}
        </button>;
      })}
    </div>

    <section className="mt-5 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div><strong className="block">Copie per codice</strong><span className="text-xs text-slate-500">Tre barcode per ogni etichetta fisica 15 x 10 cm</span></div>
        <div className="flex h-12 items-center overflow-hidden rounded-md border border-slate-300">
          <button type="button" className="flex h-full w-12 items-center justify-center" onClick={() => setCopies((value) => Math.max(1, value - 1))} aria-label="Riduci copie"><Minus className="h-4 w-4" /></button>
          <strong className="flex h-full min-w-12 items-center justify-center border-x border-slate-300 font-mono text-lg">{copies}</strong>
          <button type="button" className="flex h-full w-12 items-center justify-center" onClick={() => setCopies((value) => Math.min(20, value + 1))} aria-label="Aumenta copie"><Plus className="h-4 w-4" /></button>
        </div>
      </div>
    </section>

    <div className="fixed inset-x-0 bottom-16 z-20 grid grid-cols-[1fr_auto] gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:static sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0">
      <Button type="button" className="h-14 w-full text-base font-black" onClick={print} disabled={!labels.length || printing}>
        {printing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Printer className="mr-2 h-5 w-5" />}
        {printing ? "Stampa in corso" : `Stampa ${labels.length} barcode`}
      </Button>
      <Button type="button" variant="outline" className="h-14 bg-white px-4 font-black" onClick={printPdf} disabled={printing}><Printer className="mr-2 h-5 w-5" /> PDF</Button>
    </div>
  </div>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Camera, CheckCircle2, CircleAlert, ImageIcon, Loader2, PackageCheck, Printer, QrCode, ShoppingBag, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl, normalizeScannerCode } from "@/lib/api";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";
import QrCodeSvg from "@/components/wms/QrCodeSvg";
import { supabase } from "@/lib/supabase";
import { getOrCreatePrintStationCode, printStationChannelName } from "@/lib/printStation";
import { getDefaultZebraPrinter, printZebraBagLabels, printZebraLocationLabels, printZebraPackagingLabels, printZebraPackingLabels } from "@/lib/zebraPrinter";

function cartIsComplete(snapshot) {
  const bags = snapshot?.cart_bags || [];
  return snapshot?.phase === "cart_ready" && bags.length > 0 && bags.every((bag) => bag.completed);
}

function isCompletePackingScan(value) {
  const code = normalizeScannerCode(value);
  return /^CARRELLO-[0-9]{2}$/.test(code)
    || /^B-[A-Z0-9]{5}$/.test(code)
    || /^PK-[A-F0-9]{12}$/.test(code)
    || /^(SCATOLA-(PICCOLA|MEDIA|GRANDE)|BUSTA-CORRIERE)$/.test(code);
}

function cartStateFromSnapshot(snapshot, previous = null) {
  const bags = snapshot?.cart_bags || previous?.bags || [];
  const highestPosition = bags.reduce((highest, bag) => Math.max(highest, Number(bag.posizione || 0)), 0);
  const righe = Math.max(1, Number(snapshot?.cart_layout?.righe || previous?.righe || 1));
  const colonne = Math.max(1, Number(snapshot?.cart_layout?.colonne || previous?.colonne || highestPosition || 1));
  return {
    cart_code: snapshot?.cart_code || previous?.cart_code,
    bags,
    righe,
    colonne,
    capacity: Math.max(Number(snapshot?.cart_layout?.capacita || previous?.capacity || 0), righe * colonne, highestPosition),
  };
}

function printBlobWithBrowserDialog(blob) {
  const url = URL.createObjectURL(blob);
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
  };
  document.body.appendChild(frame);
}

function ActiveBagContents({ station, phase, working, onLabelScan, onProductSelect, sectionRef }) {
  if (!station?.sessions?.length) return null;
  const labelHistory = phase === "label_history";
  const labelHistoryExpiry = labelHistory && station.inspected_label?.expires_at
    ? new Date(station.inspected_label.expires_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : null;
  const needsDoubleCheck = phase === "double_check";
  const scanningPackaging = phase === "scan_packaging";
  const scanningLabels = phase === "scan_labels";
  const monoMode = station.batch?.picking_mode === "mono";
  const monoProducts = [...station.sessions
    .filter((session) => ["in_attesa_packing", "in_verifica_bag"].includes(session.stato))
    .reduce((groups, session) => {
      const line = session.lines?.[0];
      if (!line) return groups;
      const key = line.referenza_id || line.ean || line.fnsku || line.sku || line.id;
      const current = groups.get(key) || { ...line, count: 0, sessionId: session.id };
      current.count += 1;
      groups.set(key, current);
      return groups;
    }, new Map()).values()];

  return <section ref={sectionRef} className={`scroll-mt-3 rounded-md border-2 p-4 shadow-sm sm:p-5 ${labelHistory ? "border-emerald-500 bg-emerald-50" : needsDoubleCheck ? "border-amber-500 bg-amber-50" : scanningPackaging ? "border-sky-500 bg-sky-50" : scanningLabels ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white"}`}>
    <div className="flex flex-wrap items-center gap-3">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-white ${needsDoubleCheck ? "bg-amber-600" : "bg-teal-700"}`}><ShoppingBag className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-black uppercase ${needsDoubleCheck ? "text-amber-800" : "text-teal-800"}`}>{labelHistory ? "Controllo etichetta" : "Bag attiva"}</p>
        <h2 className="font-mono text-3xl font-black leading-none text-slate-950 sm:text-4xl">{labelHistory ? station.inspected_label?.label_code : station.bag_code}</h2>
      </div>
      <div className={`w-full rounded-md px-3 py-2 text-center text-sm font-black sm:w-auto ${needsDoubleCheck ? "bg-amber-600 text-white" : scanningLabels ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-800"}`}>
        {labelHistory ? `${String(station.inspected_label?.carrier || "").toUpperCase()} · ${station.inspected_label?.order_name}` : needsDoubleCheck ? "RISCANSIONA QUESTA BAG" : phase === "select_product" ? "SCEGLI UN PRODOTTO" : scanningPackaging ? "SCANSIONA IMBALLAGGIO" : scanningLabels ? "SCANSIONA ETICHETTA" : `${station.summary.orders} ${station.summary.orders === 1 ? "ordine" : "ordini"}`}
      </div>
    </div>
    {scanningPackaging && <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{(station.packaging_options || []).map((item) => <div key={item.code} className={`rounded-md border bg-white p-3 ${Number(item.stock_quantity) > 0 ? "border-sky-200" : "border-rose-300"}`}><strong className="block text-xs">{item.name}</strong><code className="mt-1 block text-[10px] font-black text-slate-600">{item.barcode}</code><span className={`mt-2 block text-xs font-bold ${Number(item.stock_quantity) > 0 ? "text-teal-700" : "text-rose-700"}`}>{item.stock_quantity} disponibili</span></div>)}</div>}
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-current/10 pt-3">
      <div><h3 className="text-base font-black">{labelHistory ? "Contenuto previsto del pacco" : "Contenuto della bag"}</h3><p className="text-xs text-slate-600">{labelHistory ? `Disponibile fino al ${labelHistoryExpiry}.` : "Controlla prodotti e quantita prima di chiuderla."}</p></div>
      <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black shadow-sm">{labelHistory ? "Storico 48 ore" : monoMode ? "Mono-prodotto" : station.batch ? "Massivo" : "1x1"}</span>
    </div>
    {monoMode && phase === "select_product" && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {monoProducts.map((product) => <button key={product.sessionId} type="button" onClick={() => onProductSelect(product.sessionId)} disabled={working} className="relative min-h-44 overflow-hidden rounded-md border-2 border-slate-200 bg-white p-3 text-left transition hover:border-teal-500 disabled:opacity-60">
        <span className="absolute right-2 top-2 rounded-md bg-slate-950 px-2 py-1 text-sm font-black text-white">×{product.count}</span>
        {product.foto_url ? <img src={fileUrl(product.foto_url)} alt={product.titolo} className="h-24 w-full object-contain" /> : <span className="flex h-24 items-center justify-center text-slate-300"><ImageIcon className="h-8 w-8" /></span>}
        <strong className="mt-2 block text-sm leading-4">{product.titolo}</strong>
        <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{product.ean || product.fnsku || product.sku}</span>
      </button>)}
    </div>}
    {phase !== "select_product" && <div className="mt-3 grid gap-3 md:grid-cols-2">
      {station.sessions.map((session, index) => <article key={session.id} className={`rounded-md border bg-white p-3 ${session.stato === "completata" ? "border-emerald-300" : needsDoubleCheck ? "border-amber-300" : "border-teal-200"}`}>
        <div className="flex items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${session.stato === "completata" ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>{session.stato === "completata" ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">Ordine {session.order?.order_name}</strong><span className="text-xs text-slate-500">{session.lines.length} referenze</span></div></div>
        <div className="mt-3 grid grid-cols-3 gap-2">{session.lines.map((line) => <div key={line.id} className="min-w-0 rounded-md bg-slate-50 p-2 text-center">{line.foto_url ? <img src={fileUrl(line.foto_url)} alt="" className="mx-auto h-14 w-full object-contain" /> : <span className="mx-auto flex h-14 items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></span>}<strong className="mt-1 block truncate text-[10px]">{line.titolo}</strong><span className="block text-sm font-black">x{line.quantita_attesa}</span></div>)}</div>
        {scanningLabels && (session.carrier_label_scanned_at
          ? <div className="mt-3 rounded-md bg-emerald-100 px-3 py-2 font-mono text-xs font-black text-emerald-800">ETICHETTA ACQUISITA</div>
          : <button type="button" onClick={() => onLabelScan(session.carrier_label_code)} disabled={working} className="mt-3 w-full rounded-md bg-amber-100 px-3 py-3 text-left font-mono text-xs font-black text-amber-900 hover:bg-amber-200 disabled:opacity-60">{session.carrier_label_code}</button>)}
      </article>)}
    </div>}
  </section>;
}

export default function WmsAppPacking() {
  const scannerRef = useRef(null);
  const activeBagRef = useRef(null);
  const scanInFlightRef = useRef(false);
  const printRetryInFlightRef = useRef(false);
  const wakeLockRef = useRef(null);
  const stationChannelRef = useRef(null);
  const stationSnapshotRef = useRef(null);
  const [station, setStation] = useState(null);
  const [cart, setCart] = useState(null);
  const [code, setCode] = useState("");
  const [scannerResetKey, setScannerResetKey] = useState(0);
  const [working, setWorking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [zebra, setZebra] = useState({ status: "checking", name: "" });
  const [printStationCode] = useState(getOrCreatePrintStationCode);
  const [pairedDevices, setPairedDevices] = useState(0);
  const [remotePrintStatus, setRemotePrintStatus] = useState("ready");
  const [pendingCarrierPrint, setPendingCarrierPrint] = useState(null);
  const stationQrUrl = useMemo(() => `${window.location.origin}/wms-app/packing-remoto?station=${encodeURIComponent(printStationCode)}`, [printStationCode]);

  useEffect(() => { stationSnapshotRef.current = station; }, [station]);
  useEffect(() => {
    setCode("");
  }, [station?.bag_code, station?.phase, station?.summary?.completed]);

  const openCamera = useCallback(() => {
    setCameraSession((value) => value + 1);
    setCameraOpen(true);
  }, []);

  const focusScanner = useCallback(() => {
    window.setTimeout(() => scannerRef.current?.focus(), 20);
  }, []);

  const resetStation = useCallback(() => {
    stationSnapshotRef.current = null;
    setStation(null);
    setCode("");
    focusScanner();
  }, [focusScanner]);

  const refreshCart = useCallback(async () => {
    const cartCode = cart?.cart_code || station?.cart_code;
    if (!cartCode) return null;
    const response = await api.post("/wms/packing/station/scan", {
      codice: cartCode,
      bag_code: null,
      cart_code: cartCode,
    });
    const next = response.data;
    if (cartIsComplete(next)) {
      setCart(null);
      stationSnapshotRef.current = null;
      setStation(null);
      setCode("");
      return next;
    }
    setCart((current) => cartStateFromSnapshot(next, current));
    stationSnapshotRef.current = next;
    setStation(next);
    setCode("");
    return next;
  }, [cart?.cart_code, station?.cart_code]);

  useEffect(() => {
    focusScanner();
    const keepFocus = () => focusScanner();
    const keepFocusOnPage = () => {
      if (!cameraOpen) focusScanner();
    };
    window.addEventListener("focus", keepFocus);
    window.addEventListener("pageshow", keepFocus);
    document.addEventListener("pointerdown", keepFocusOnPage);
    const interval = window.setInterval(keepFocusOnPage, 1500);
    return () => {
      window.removeEventListener("focus", keepFocus);
      window.removeEventListener("pageshow", keepFocus);
      document.removeEventListener("pointerdown", keepFocusOnPage);
      window.clearInterval(interval);
    };
  }, [cameraOpen, focusScanner]);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return undefined;
    const requestWakeLock = async () => {
      if (document.visibilityState !== "visible" || wakeLockRef.current) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => { wakeLockRef.current = null; }, { once: true });
      } catch {
        wakeLockRef.current = null;
      }
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") requestWakeLock(); };
    requestWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  const checkZebra = useCallback(async ({ notify = false, background = false } = {}) => {
    if (!background) setZebra((current) => ({ ...current, status: "checking" }));
    try {
      const printer = await getDefaultZebraPrinter();
      setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
      if (notify) toast.success(`Zebra collegata: ${printer.name || "stampante predefinita"}`);
      return printer;
    } catch (error) {
      setZebra({ status: "unavailable", name: "" });
      if (notify) toast.error("Avvia Zebra Browser Print e imposta la Zebra come stampante predefinita");
      return null;
    }
  }, []);

  useEffect(() => { checkZebra(); }, [checkZebra]);

  useEffect(() => {
    if (zebra.status === "ready" && !pendingCarrierPrint) return undefined;
    const retry = () => checkZebra({ background: true });
    const interval = window.setInterval(retry, 4000);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
    };
  }, [checkZebra, pendingCarrierPrint, zebra.status]);

  useEffect(() => {
    if (!supabase || !printStationCode) return undefined;
    const channel = supabase.channel(printStationChannelName(printStationCode), {
      config: { broadcast: { ack: true }, presence: { key: `packing-${printStationCode}` } },
    });
    stationChannelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const devices = Object.values(channel.presenceState()).flat();
        setPairedDevices(devices.filter((device) => device.role === "mobile").length);
      })
      .on("broadcast", { event: "print-location-labels" }, async ({ payload }) => {
        const jobId = String(payload?.jobId || "");
        const locations = Array.isArray(payload?.locations)
          ? payload.locations.slice(0, 1000).filter((location) => {
            const code = String(location?.code || "");
            return /^[SP][0-9]{1,5}\+[A-Z][0-9]{1,2}$/.test(code)
              || (String(location?.type || "").toLowerCase() === "bag" && /^B-[A-Z0-9]{5}$/.test(code));
          })
          : [];
        if (!locations.length) {
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Nessuna ubicazione valida da stampare" } });
          return;
        }
        setRemotePrintStatus("printing");
        try {
          const printer = await printZebraLocationLabels(locations);
          setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: true, count: locations.length, printer: printer.name || "Zebra" } });
          toast.success(`${locations.length} etichette ubicazione stampate dalla station`);
        } catch (error) {
          setZebra({ status: "unavailable", name: "" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Zebra non raggiungibile sulla Packing Station" } });
          toast.error("Stampa slot/pallet non riuscita: controlla Zebra Browser Print");
        } finally {
          setRemotePrintStatus("ready");
        }
      })
      .on("broadcast", { event: "print-packaging-labels" }, async ({ payload }) => {
        const jobId = String(payload?.jobId || "");
        const allowedCodes = new Set(["SCATOLA-PICCOLA", "SCATOLA-MEDIA", "SCATOLA-GRANDE", "BUSTA-CORRIERE"]);
        const labels = Array.isArray(payload?.labels)
          ? payload.labels.slice(0, 120).filter((label) => allowedCodes.has(String(label?.code || "")))
          : [];
        if (!labels.length) {
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Nessun barcode imballaggio valido" } });
          return;
        }
        setRemotePrintStatus("printing");
        try {
          const printer = await printZebraPackagingLabels(labels);
          setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: true, count: labels.length, printer: printer.name || "Zebra" } });
          toast.success(`${labels.length} barcode imballaggio stampati dalla station`);
        } catch (error) {
          setZebra({ status: "unavailable", name: "" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Zebra non raggiungibile sulla Packing Station" } });
          toast.error("Stampa imballaggi non riuscita: controlla Zebra Browser Print");
        } finally {
          setRemotePrintStatus("ready");
        }
      })
      .on("broadcast", { event: "print-bag-labels" }, async ({ payload }) => {
        const jobId = String(payload?.jobId || "");
        const bags = Array.isArray(payload?.bags)
          ? payload.bags.slice(0, 500).filter((bag) => /^B-[A-Z0-9]{5}$/.test(String(bag?.code || bag?.codice || "")))
          : [];
        if (!bags.length) {
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Nessuna bag valida da stampare" } });
          return;
        }
        setRemotePrintStatus("printing");
        try {
          const printer = await printZebraBagLabels(bags);
          setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: true, count: bags.length, printer: printer.name || "Zebra" } });
          toast.success(`${bags.length} etichette bag stampate dalla station`);
        } catch (error) {
          setZebra({ status: "unavailable", name: "" });
          await channel.send({ type: "broadcast", event: "print-result", payload: { jobId, ok: false, message: "Zebra non raggiungibile sulla Packing Station" } });
          toast.error("Stampa bag non riuscita: controlla Zebra Browser Print");
        } finally {
          setRemotePrintStatus("ready");
        }
      })
      .on("broadcast", { event: "request-packing-state" }, async () => {
        await channel.send({ type: "broadcast", event: "packing-state", payload: { station: stationSnapshotRef.current } });
      })
      .on("broadcast", { event: "mono-product-select" }, async ({ payload }) => {
        const current = stationSnapshotRef.current;
        if (!current?.bag_code || current.batch?.picking_mode !== "mono" || payload?.bagCode !== current.bag_code) return;
        try {
          const response = await api.post("/wms/packing/mono/select", { bag_code: current.bag_code, session_id: payload?.sessionId });
          stationSnapshotRef.current = response.data;
          setCode("");
          setStation(response.data);
          await channel.send({ type: "broadcast", event: "mono-select-result", payload: { ok: true, requestId: payload?.requestId } });
          await channel.send({ type: "broadcast", event: "packing-state", payload: { station: response.data } });
          toast.success("Prodotto selezionato dal telefono: scansiona l'imballaggio");
        } catch (error) {
          await channel.send({ type: "broadcast", event: "mono-select-result", payload: { ok: false, requestId: payload?.requestId, message: error.response?.data?.detail || "Prodotto non disponibile" } });
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            role: "station",
            stationCode: printStationCode,
            capabilities: ["location-labels", "packaging-labels", "bag-labels", "mono-packing"],
            onlineAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      stationChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [printStationCode]);

  useEffect(() => {
    if (!stationChannelRef.current) return;
    stationChannelRef.current.send({ type: "broadcast", event: "packing-state", payload: { station } });
  }, [station]);

  useEffect(() => {
    if (!station?.bag_code || !["select_product", "double_check", "scan_packaging", "scan_labels"].includes(station.phase)) return;
    window.setTimeout(() => activeBagRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [station?.bag_code, station?.phase]);

  useEffect(() => {
    if (!station || station.phase !== "completed") return undefined;
    const timeout = window.setTimeout(() => {
      if (cart?.cart_code) {
        refreshCart().catch(() => {
          setStation({
            phase: "cart_ready",
            cart_code: cart.cart_code,
            cart_bags: cart.bags,
            cart_layout: { righe: cart.righe, colonne: cart.colonne, capacita: cart.capacity },
            sessions: [],
            labels: [],
            summary: { orders: 0 },
          });
          setCode("");
        }).finally(focusScanner);
        return;
      }
      resetStation();
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [cart, focusScanner, refreshCart, resetStation, station]);

  const printCarrierLabels = async (bagCode, labels) => {
    try {
      const printer = await printZebraPackingLabels(labels);
      setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
      setPendingCarrierPrint(null);
      try {
        await api.post("/wms/packing/labels/printed", {
          session_ids: labels.map((label) => label.session_id),
        });
      } catch {
        toast.error("Etichetta stampata, ma la conferma di stampa non e stata registrata.");
      }
      toast.success(`${labels.length} etichette stampate su ${printer.name || "Zebra"}`);
      return true;
    } catch (zebraError) {
      setZebra({ status: "unavailable", name: "" });
      setPendingCarrierPrint({ bagCode, labels });
      toast.error("Zebra non raggiungibile. La station riprovera automaticamente senza perdere l'etichetta.");
      return false;
    }
  };

  useEffect(() => {
    if (!pendingCarrierPrint || zebra.status !== "ready" || printRetryInFlightRef.current) return;
    let cancelled = false;
    printRetryInFlightRef.current = true;
    printZebraPackingLabels(pendingCarrierPrint.labels)
      .then(async (printer) => {
        if (cancelled) return;
        setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
        setPendingCarrierPrint(null);
        try {
          await api.post("/wms/packing/labels/printed", {
            session_ids: pendingCarrierPrint.labels.map((label) => label.session_id),
          });
        } catch {
          toast.error("Etichetta stampata, ma la conferma di stampa non e stata registrata.");
        }
        toast.success("Zebra ripristinata: etichetta stampata automaticamente");
      })
      .catch(() => {
        if (!cancelled) setZebra({ status: "unavailable", name: "" });
      })
      .finally(() => {
        printRetryInFlightRef.current = false;
        if (!cancelled) focusScanner();
      });
    return () => { cancelled = true; };
  }, [focusScanner, pendingCarrierPrint, zebra.status]);

  const printTestLabel = async (carrier = "gls") => {
    const carrierName = carrier.toUpperCase();
    const testLabel = {
      code: `PK-${carrierName}-TEST-001`,
      order_name: `${carrierName}-TEST-001`,
      carrier,
      recipient_name: "Mario Rossi",
      address1: "Via delle Prove 25",
      zip: "20100",
      city: "Milano",
      province: "MI",
      country: "Italia",
      weight: 1,
    };
    try {
      const printer = await printZebraPackingLabels([testLabel]);
      setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
      toast.success(`Etichetta ${carrierName} stampata su ${printer.name || "Zebra"}`);
      return;
    } catch {
      setZebra({ status: "unavailable", name: "" });
      toast.error("Zebra non raggiungibile: uso la stampa browser di emergenza");
    }
    try {
      const response = await api.get(`/wms/packing/etichetta-test?carrier=${carrier}`, { responseType: "blob" });
      printBlobWithBrowserDialog(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Impossibile creare l'etichetta di prova");
    }
  };

  const submitScan = async (overrideCode = null) => {
    const value = normalizeScannerCode(overrideCode ?? code);
    if (!value || working || scanInFlightRef.current) return;
    const currentStation = stationSnapshotRef.current || station;
    const isPackagingCode = /^(SCATOLA-(PICCOLA|MEDIA|GRANDE)|BUSTA-CORRIERE)$/.test(value);
    if (isPackagingCode && currentStation?.bag_code && currentStation.phase !== "scan_packaging") {
      setCode("");
      setScannerResetKey((value) => value + 1);
      focusScanner();
      return;
    }
    scanInFlightRef.current = true;
    setCode("");
    setWorking(true);
    try {
      const response = await api.post("/wms/packing/station/scan", {
        codice: value,
        bag_code: ["label_history", "empty_bag"].includes(currentStation?.phase) ? null : currentStation?.bag_code || null,
        cart_code: ["label_history", "empty_bag"].includes(currentStation?.phase) ? null : cart?.cart_code || currentStation?.cart_code || null,
      });
      const next = response.data;
      if (cartIsComplete(next)) {
        setCart(null);
        stationSnapshotRef.current = null;
        setStation(null);
        setCode("");
        if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
        toast.success("Carrello completato. Scansiona un nuovo carrello o una bag.");
        return;
      }
      if (next.phase === "cart_ready") setCart((current) => cartStateFromSnapshot(next, current));
      stationSnapshotRef.current = next;
      setStation(next);
      setCode("");
      if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
      const labelsToPrint = next.labels_to_print || [];
      if (labelsToPrint.length) await printCarrierLabels(next.bag_code, labelsToPrint);
      if (next.phase === "cart_ready") toast.success("Carrello riconosciuto: ora scansiona una bag");
      if (next.phase === "empty_bag") toast.success(`Bag ${next.bag_code} libera e vuota.`);
      if (next.phase === "select_product" && currentStation?.phase === "scan_packaging") toast.success("Ordine imballato: scegli il prossimo prodotto");
      else if (next.phase === "select_product" && currentStation?.phase !== "select_product") toast.success("Bag mono-prodotto riconosciuta: scansiona il prodotto o seleziona la foto");
      if (next.phase === "double_check") toast.success("Bag riconosciuta: riscansionala per il doppio controllo");
      if (next.phase === "scan_packaging") toast.success("Bag confermata: scansiona scatola o busta corriere");
      if (next.phase === "scan_labels" && currentStation?.phase === "scan_packaging") {
        await printCarrierLabels(next.bag_code, next.labels.filter((label) => !label.scanned));
        toast.success("Imballaggio associato e scalato: scansiona l'etichetta corriere");
      }
      if (next.phase === "completed") toast.success("Packing completato. Bag libera e vuota.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Scansione non valida");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally {
      scanInFlightRef.current = false;
      setCode("");
      setScannerResetKey((value) => value + 1);
      setWorking(false);
      focusScanner();
    }
  };

  const selectMonoProduct = async (sessionId) => {
    if (!station?.bag_code || working) return;
    setWorking(true);
    try {
      const response = await api.post("/wms/packing/mono/select", { bag_code: station.bag_code, session_id: sessionId });
      stationSnapshotRef.current = response.data;
      setCode("");
      setStation(response.data);
      toast.success("Prodotto riconosciuto: scansiona l'imballaggio");
      if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Prodotto non disponibile");
    } finally {
      setWorking(false);
      focusScanner();
    }
  };

  const phase = station?.phase || "scan_bag";
  const completedLabels = station?.labels?.filter((label) => label.scanned).length || 0;
  const pendingLabels = station?.labels?.filter((label) => !label.scanned).length || 0;
  const visibleCart = cart?.cart_code ? cart : (station?.phase === "cart_ready" ? cartStateFromSnapshot(station) : null);
  const visibleCartBags = visibleCart?.bags || [];
  const bagsByPosition = new Map(visibleCartBags.map((bag) => [Number(bag.posizione), bag]));
  const prompt = pendingCarrierPrint
    ? "Attendo Zebra: ristampa automatica in corso"
    : phase === "double_check"
    ? "Riscansiona la stessa bag"
    : phase === "scan_packaging"
      ? "Scansiona scatola o busta corriere"
    : phase === "scan_labels"
      ? `Scansiona ${pendingLabels === 1 ? "l'etichetta corriere" : "tutte le etichette corriere"}`
      : phase === "select_product"
        ? "Scansiona un prodotto o seleziona la foto"
      : phase === "completed"
        ? "Bag liberata"
        : phase === "empty_bag"
          ? "Bag libera e vuota"
        : phase === "label_history"
          ? "Contenuto previsto del pacco"
        : phase === "cart_ready"
          ? "Scansiona una bag del carrello"
          : "Scansiona un carrello o una bag";

  return <div className="wms-page mx-auto max-w-5xl pb-24" data-testid="wms-packing-station">
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_244px]">
      <div className="min-w-0 space-y-5">
        <header>
          <p className="wms-eyebrow">Outbound</p><h1 className="wms-title">Packing station</h1><p className="wms-subtitle">Scanner sempre pronto. La fotocamera si apre solo quando serve.</p>
        </header>
        {zebra.status === "unavailable" && <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong className="block">Stampa automatica Zebra non attiva</strong><span className="mt-1 block text-xs leading-5">Controlla che Zebra Browser Print sia aperto e la stampante collegata. La station verifica il collegamento e riprende la stampa automaticamente.</span></div></div>}

        <section className={`rounded-md border-2 bg-white p-5 shadow-sm ${pendingCarrierPrint ? "border-amber-500" : ["completed", "empty_bag"].includes(phase) ? "border-emerald-500" : phase === "scan_packaging" ? "border-sky-500" : phase === "scan_labels" ? "border-teal-500" : "border-slate-950"}`}>
          <div className="flex items-center gap-4">
            <span className={`flex h-14 w-14 items-center justify-center rounded-md ${["completed", "empty_bag"].includes(phase) ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>
              {["completed", "empty_bag"].includes(phase) ? <CheckCircle2 className="h-7 w-7" /> : phase === "scan_labels" ? <Barcode className="h-7 w-7" /> : phase === "scan_packaging" ? <PackageCheck className="h-7 w-7" /> : <ShoppingBag className="h-7 w-7" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase text-teal-700">Scanner pronto</p>
              <h2 className="mt-1 text-2xl font-black">{prompt}</h2>
              {phase === "cart_ready" && <p className="mt-1 font-mono text-sm text-slate-500">Carrello {station.cart_code}</p>}
              {station?.bag_code && <p className="mt-1 font-mono text-sm text-slate-500">Bag {station.bag_code}</p>}
            </div>
            {phase === "scan_labels" && <div className="text-right"><strong className="block text-3xl font-black">{completedLabels}/{station.labels.length}</strong><span className="text-xs font-bold uppercase text-slate-500">etichette</span></div>}
          </div>
          {phase !== "completed" && <form onSubmit={(event) => { event.preventDefault(); submitScan(); }} className="mt-5 flex items-stretch gap-3">
            <Input
              key={`${station?.bag_code || "none"}:${phase}:${station?.summary?.completed || 0}:${scannerResetKey}`}
              ref={scannerRef}
              value={code}
              onChange={(event) => {
                const nextCode = normalizeScannerCode(event.target.value);
                setCode(nextCode);
                if (isCompletePackingScan(nextCode)) window.setTimeout(() => submitScan(nextCode), 0);
              }}
              placeholder={phase === "label_history" ? "Scansiona un'altra etichetta o bag" : phase === "scan_labels" ? "Scansiona etichetta corriere" : phase === "scan_packaging" ? "SCATOLA-PICCOLA, MEDIA, GRANDE o BUSTA-CORRIERE" : phase === "select_product" ? "Scansiona barcode prodotto" : phase === "cart_ready" ? "Scansiona una bag" : "CARRELLO-01 oppure bag o etichetta"}
              className="h-16 min-w-0 flex-1 border-slate-950 bg-slate-50 text-center font-mono text-xl font-black tracking-wider sm:text-2xl"
              autoComplete="off"
              inputMode="none"
              disabled={working || Boolean(pendingCarrierPrint)}
              aria-label="Scanner packing"
            />
            <button
              type="button"
              onClick={openCamera}
              disabled={working}
              title="Apri fotocamera"
              aria-label="Apri fotocamera per scansionare"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <Camera className="h-7 w-7" />
            </button>
          </form>}
        </section>
      </div>
      <aside className="flex w-full shrink-0 flex-col items-center gap-3 lg:items-end">
        <section className="w-full rounded-md border border-teal-300 bg-white p-3 shadow-sm">
          <div className="mx-auto w-fit rounded-md border border-slate-200 bg-white p-2">
            <QrCodeSvg value={stationQrUrl} size={196} className="h-[196px] w-[196px]" />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-teal-800"><QrCode className="h-4 w-4" /><p className="text-[10px] font-black uppercase">Collega telefono</p></div>
          <div className="mt-2 flex flex-col items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-black ${pairedDevices > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}><Smartphone className="h-4 w-4" /> {pairedDevices > 0 ? `${pairedDevices} dispositivo collegato` : "In attesa del telefono"}</span>
            <span className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] font-black text-white">{printStationCode}</span>
            {remotePrintStatus === "printing" && <span className="inline-flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs font-black text-amber-800"><Loader2 className="h-4 w-4 animate-spin" /> Stampa in corso</span>}
          </div>
        </section>
        <button type="button" onClick={() => checkZebra({ notify: true })} className={`flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-black ${zebra.status === "ready" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : zebra.status === "checking" ? "border-slate-300 bg-white text-slate-600" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
          {zebra.status === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : zebra.status === "ready" ? <Printer className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          <span>{zebra.status === "ready" ? zebra.name : zebra.status === "checking" ? "Cerco Zebra" : "Zebra non collegata"}</span>
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => printTestLabel("brt")} className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 hover:border-red-600 hover:text-red-700">
            <Printer className="h-4 w-4" /> Test BRT
          </button>
          <button type="button" onClick={() => printTestLabel("gls")} className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 hover:border-amber-500 hover:text-amber-700">
            <Printer className="h-4 w-4" /> Test GLS
          </button>
        </div>
      </aside>
    </div>

    <ActiveBagContents station={station} phase={phase} working={working} onLabelScan={submitScan} onProductSelect={selectMonoProduct} sectionRef={activeBagRef} />

    {visibleCart && visibleCartBags.length > 0 && <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">{visibleCart.cart_code}</h2>
          <p className="mt-1 text-sm text-slate-500">Schema fisico del carrello: la bag attiva resta evidenziata durante il packing.</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block rounded-full bg-teal-50 px-3 py-1 text-sm font-black text-teal-800">
            {visibleCartBags.filter((bag) => bag.completed).length}/{visibleCartBags.length} completate
          </span>
          <span className="mt-1 block text-xs font-bold text-slate-500">{visibleCart.righe} righe x {visibleCart.colonne} colonne</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto pb-2">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${visibleCart.colonne}, minmax(104px, 1fr))`,
            minWidth: `${Math.max(visibleCart.colonne * 112, 280)}px`,
          }}
        >
          {Array.from({ length: visibleCart.capacity }, (_, index) => index + 1).map((position) => {
            const bag = bagsByPosition.get(position);
            const active = Boolean(bag && station?.bag_code === bag.bag_code);
            return <button
              key={position}
              type="button"
              disabled={!bag || phase !== "cart_ready"}
              onClick={() => { setCode(bag.bag_code); focusScanner(); }}
              className={`min-h-24 rounded-md border p-3 text-left transition-colors ${active
                ? "border-amber-500 bg-amber-50 ring-2 ring-amber-400"
                : bag?.completed
                  ? "border-emerald-200 bg-emerald-50"
                  : bag?.ready
                    ? "border-teal-200 bg-teal-50"
                    : "border-dashed border-slate-200 bg-slate-50"}`}
            >
              <span className="block text-xs font-black uppercase text-slate-500">Posizione {position}</span>
              <strong className={`mt-1 block font-mono text-base ${bag ? "text-slate-950" : "text-slate-300"}`}>{bag?.bag_code || "Vuota"}</strong>
              <span className={`mt-1 block text-xs font-bold ${active ? "text-amber-800" : "text-slate-500"}`}>
                {active ? "Bag attiva" : bag?.ready ? `${bag.orders} ordine pronto` : bag?.completed ? "Completata" : bag ? "Libera" : "Nessuna bag"}
              </span>
            </button>;
          })}
        </div>
      </div>
    </section>}

    {phase === "completed" && <section className="flex items-center justify-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><PackageCheck className="h-6 w-6" /><strong>Compito chiuso. Pronto per la prossima bag.</strong></section>}
    <CameraScanner
      key={`packing-${cameraSession}`}
      open={cameraOpen}
      onOpenChange={(nextOpen) => {
        setCameraOpen(nextOpen);
      }}
      purpose={phase === "scan_labels" ? "carrier_label" : phase === "select_product" ? "product" : phase === "cart_ready" || phase === "double_check" ? "bag" : "packing"}
      onDetected={(value) => {
        setCameraOpen(false);
        submitScan(value);
      }}
    />
    {working && <div className="fixed inset-x-0 bottom-6 flex justify-center"><span className="flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white"><Loader2 className="h-4 w-4 animate-spin" /> Elaborazione scanner</span></div>}
  </div>;
}

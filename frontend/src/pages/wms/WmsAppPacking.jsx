import { useCallback, useEffect, useRef, useState } from "react";
import { Barcode, Camera, CheckCircle2, ImageIcon, Loader2, PackageCheck, Printer, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";

function cartIsComplete(snapshot) {
  const bags = snapshot?.cart_bags || [];
  return snapshot?.phase === "cart_ready" && bags.length > 0 && bags.every((bag) => bag.completed);
}

export default function WmsAppPacking() {
  const scannerRef = useRef(null);
  const [station, setStation] = useState(null);
  const [cart, setCart] = useState(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [autoCamera, setAutoCamera] = useState(true);

  const openCamera = useCallback(() => {
    setAutoCamera(true);
    setCameraSession((value) => value + 1);
    setCameraOpen(true);
  }, []);

  const focusScanner = useCallback(() => {
    window.setTimeout(() => scannerRef.current?.focus(), 20);
  }, []);

  const resetStation = useCallback(() => {
    setStation(null);
    setCode("");
    focusScanner();
  }, [focusScanner]);

  const refreshCart = useCallback(async () => {
    const response = await api.post("/wms/packing/station/scan", {
      codice: "CARRELLO-01",
      bag_code: null,
      cart_code: "CARRELLO-01",
    });
    const next = response.data;
    if (cartIsComplete(next)) {
      setCart(null);
      setStation(null);
      setCode("");
      return next;
    }
    setCart({ cart_code: next.cart_code, bags: next.cart_bags || [] });
    setStation(next);
    setCode("");
    return next;
  }, []);

  useEffect(() => {
    focusScanner();
    const keepFocus = () => focusScanner();
    window.addEventListener("focus", keepFocus);
    return () => window.removeEventListener("focus", keepFocus);
  }, [focusScanner]);

  useEffect(() => {
    if (!station || station.phase !== "completed") return undefined;
    const timeout = window.setTimeout(() => {
      if (cart?.cart_code) {
        refreshCart().catch(() => {
          setStation({ phase: "cart_ready", cart_code: cart.cart_code, cart_bags: cart.bags, sessions: [], labels: [], summary: { orders: 0 } });
          setCode("");
        }).finally(focusScanner);
        return;
      }
      resetStation();
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [cart, focusScanner, refreshCart, resetStation, station]);

  const printCarrierLabels = async (bagCode) => {
    try {
      const response = await api.get(`/wms/packing/bag/${bagCode}/etichette`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const frame = document.createElement("iframe");
      frame.className = "hidden";
      frame.src = url;
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        window.setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 3000);
      };
      document.body.appendChild(frame);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Etichette corriere non disponibili");
    }
  };

  const printTestLabel = async () => {
    try {
      const response = await api.get("/wms/packing/etichetta-test", { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const frame = document.createElement("iframe");
      frame.className = "hidden";
      frame.src = url;
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        window.setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 3000);
      };
      document.body.appendChild(frame);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Impossibile creare l'etichetta di prova");
    }
  };

  const submitScan = async (overrideCode = null) => {
    const value = String(overrideCode ?? code).trim().toUpperCase().replace(/\s+/g, "");
    if (!value || working) return;
    setWorking(true);
    try {
      const response = await api.post("/wms/packing/station/scan", {
        codice: value,
        bag_code: station?.bag_code || null,
        cart_code: cart?.cart_code || station?.cart_code || null,
      });
      const next = response.data;
      if (cartIsComplete(next)) {
        setCart(null);
        setStation(null);
        setCode("");
        if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
        toast.success("Carrello completato. Scansiona un nuovo carrello o una bag.");
        return;
      }
      if (next.phase === "cart_ready") setCart({ cart_code: next.cart_code, bags: next.cart_bags || [] });
      setStation(next);
      setCode("");
      if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
      if (next.phase === "cart_ready") toast.success("Carrello riconosciuto: ora scansiona una bag");
      if (next.phase === "double_check") toast.success("Bag riconosciuta: riscansionala per il doppio controllo");
      if (next.phase === "scan_labels" && station?.phase === "double_check") {
        toast.success(`${next.labels.length} etichette inviate alla stampante`);
        printCarrierLabels(next.bag_code);
      }
      if (next.phase === "completed") toast.success("Packing completato. Bag liberata.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Scansione non valida");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally {
      setWorking(false);
      focusScanner();
    }
  };

  const phase = station?.phase || "scan_bag";
  const completedLabels = station?.labels?.filter((label) => label.scanned).length || 0;
  const pendingLabels = station?.labels?.filter((label) => !label.scanned).length || 0;
  useEffect(() => {
    if (!autoCamera || working || phase === "completed" || cameraOpen) return undefined;
    const timeout = window.setTimeout(openCamera, 40);
    return () => window.clearTimeout(timeout);
  }, [autoCamera, cameraOpen, openCamera, phase, station?.bag_code, completedLabels, working]);
  const prompt = phase === "double_check"
    ? "Riscansiona la stessa bag"
    : phase === "scan_labels"
      ? `Scansiona ${pendingLabels === 1 ? "l'etichetta corriere" : "tutte le etichette corriere"}`
      : phase === "completed"
        ? "Bag liberata"
        : phase === "cart_ready"
          ? "Scansiona una bag del carrello"
          : "Scansiona un carrello o una bag";

  return <div className="wms-page mx-auto max-w-5xl pb-24" data-testid="wms-packing-station">
    <header className="wms-page-header items-start gap-4">
      <div><p className="wms-eyebrow">Outbound</p><h1 className="wms-title">Packing station</h1><p className="wms-subtitle">La fotocamera resta attiva e guida ogni passaggio.</p></div>
      <button type="button" onClick={printTestLabel} className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:border-teal-600 hover:text-teal-800">
        <Printer className="h-4 w-4" />
        <span className="hidden sm:inline">Etichetta test</span>
      </button>
    </header>

    <section className={`rounded-md border-2 bg-white p-5 shadow-sm ${phase === "completed" ? "border-emerald-500" : phase === "scan_labels" ? "border-teal-500" : "border-slate-950"}`}>
      <div className="flex items-center gap-4">
        <span className={`flex h-14 w-14 items-center justify-center rounded-md ${phase === "completed" ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>
          {phase === "completed" ? <CheckCircle2 className="h-7 w-7" /> : phase === "scan_labels" ? <Barcode className="h-7 w-7" /> : <ShoppingBag className="h-7 w-7" />}
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
          ref={scannerRef}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={phase === "scan_labels" ? "Scansiona etichetta corriere" : phase === "cart_ready" ? "B-73846" : "CARRELLO-01 oppure bag"}
          className="h-16 min-w-0 flex-1 border-slate-950 bg-slate-50 text-center font-mono text-xl font-black tracking-wider sm:text-2xl"
          autoComplete="off"
          inputMode="none"
          disabled={working}
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

    {phase === "cart_ready" && station?.cart_bags?.length > 0 && <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">Carrello 01</h2>
          <p className="mt-1 text-sm text-slate-500">Inserisci una bag fissa per vedere i prodotti prima di chiuderla.</p>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-black text-teal-800">
          {station.cart_bags.filter((bag) => bag.completed).length}/10 completate
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {station.cart_bags.map((bag) => <button key={bag.bag_code} type="button" onClick={() => { setCode(bag.bag_code); focusScanner(); }} className={`rounded-md border p-3 text-left ${bag.ready ? "border-teal-200 bg-teal-50" : bag.completed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
          <span className="block text-xs font-black uppercase text-slate-500">Posizione {bag.posizione}</span>
          <strong className="mt-1 block font-mono text-lg">{bag.bag_code}</strong>
          <span className="mt-1 block text-xs font-bold text-slate-500">{bag.ready ? `${bag.orders} ordine pronto` : bag.completed ? "Completata" : "Vuota"}</span>
        </button>)}
      </div>
    </section>}

    {station?.sessions?.length > 0 && <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-black">Contenuto bag</h2><p className="mt-1 text-sm text-slate-500">{station.summary.orders} {station.summary.orders === 1 ? "ordine" : "ordini"} da chiudere.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">{station.batch ? "Massivo" : "1x1"}</span></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {station.sessions.map((session, index) => <article key={session.id} className={`rounded-md border p-4 ${session.stato === "completata" ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
          <div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full font-black ${session.stato === "completata" ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>{session.stato === "completata" ? <CheckCircle2 className="h-5 w-5" /> : index + 1}</span><div className="min-w-0 flex-1"><strong className="block truncate">Ordine {session.order?.order_name}</strong><span className="text-xs text-slate-500">{session.lines.length} referenze</span></div></div>
          <div className="mt-3 grid grid-cols-3 gap-2">{session.lines.map((line) => <div key={line.id} className="min-w-0 rounded-md bg-slate-50 p-2 text-center">{line.foto_url ? <img src={fileUrl(line.foto_url)} alt="" className="mx-auto h-12 w-full object-contain" /> : <span className="mx-auto flex h-12 items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></span>}<strong className="mt-1 block truncate text-[10px]">{line.titolo}</strong><span className="block text-xs font-black">x{line.quantita_attesa}</span></div>)}</div>
          {phase === "scan_labels" && (session.carrier_label_scanned_at
            ? <div className="mt-3 rounded-md bg-emerald-100 px-3 py-2 font-mono text-xs font-black text-emerald-800">ETICHETTA ACQUISITA</div>
            : <button type="button" onClick={() => submitScan(session.carrier_label_code)} disabled={working} className="mt-3 w-full rounded-md bg-amber-100 px-3 py-3 text-left font-mono text-xs font-black text-amber-900 hover:bg-amber-200 disabled:opacity-60">{session.carrier_label_code}</button>)}
        </article>)}
      </div>
    </section>}

    {phase === "completed" && <section className="flex items-center justify-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><PackageCheck className="h-6 w-6" /><strong>Compito chiuso. Pronto per la prossima bag.</strong></section>}
    <CameraScanner
      key={`packing-${cameraSession}`}
      open={cameraOpen}
      onOpenChange={(nextOpen) => {
        setCameraOpen(nextOpen);
        if (!nextOpen) setAutoCamera(false);
      }}
      purpose={phase === "scan_labels" ? "carrier_label" : phase === "cart_ready" || phase === "double_check" ? "bag" : "packing"}
      onDetected={(value) => {
        setCameraOpen(false);
        submitScan(value);
      }}
    />
    {working && <div className="fixed inset-x-0 bottom-6 flex justify-center"><span className="flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white"><Loader2 className="h-4 w-4 animate-spin" /> Elaborazione scanner</span></div>}
  </div>;
}

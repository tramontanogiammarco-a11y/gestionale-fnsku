import { useCallback, useEffect, useRef, useState } from "react";
import { Barcode, Camera, CheckCircle2, CircleAlert, ImageIcon, Loader2, PackageCheck, Printer, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl, normalizeScannerCode } from "@/lib/api";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";
import { getDefaultZebraPrinter, printZebraPackingLabels } from "@/lib/zebraPrinter";

function cartIsComplete(snapshot) {
  const bags = snapshot?.cart_bags || [];
  return snapshot?.phase === "cart_ready" && bags.length > 0 && bags.every((bag) => bag.completed);
}

function isCompletePackingScan(value) {
  const code = normalizeScannerCode(value);
  return /^CARRELLO-[0-9]{2}$/.test(code) || /^B-[0-9]{5}$/.test(code) || /^PK-[A-F0-9]{12}$/.test(code);
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

export default function WmsAppPacking() {
  const scannerRef = useRef(null);
  const scanInFlightRef = useRef(false);
  const [station, setStation] = useState(null);
  const [cart, setCart] = useState(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [zebra, setZebra] = useState({ status: "checking", name: "" });

  const openCamera = useCallback(() => {
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
      setStation(null);
      setCode("");
      return next;
    }
    setCart((current) => cartStateFromSnapshot(next, current));
    setStation(next);
    setCode("");
    return next;
  }, [cart?.cart_code, station?.cart_code]);

  useEffect(() => {
    focusScanner();
    const keepFocus = () => focusScanner();
    window.addEventListener("focus", keepFocus);
    return () => window.removeEventListener("focus", keepFocus);
  }, [focusScanner]);

  const checkZebra = useCallback(async ({ notify = false } = {}) => {
    setZebra((current) => ({ ...current, status: "checking" }));
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
      toast.success(`${labels.length} etichette stampate su ${printer.name || "Zebra"}`);
      return true;
    } catch (zebraError) {
      setZebra({ status: "unavailable", name: "" });
      toast.error("Stampa automatica non riuscita: avvia Zebra Browser Print. Apro la stampa browser di emergenza.");
    }
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
      return false;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Etichette corriere non disponibili");
      return false;
    }
  };

  const printTestLabel = async () => {
    try {
      const printer = await printZebraPackingLabels([{ code: "PK-000000000001", order_name: "TEST STAMPANTE" }]);
      setZebra({ status: "ready", name: printer.name || "Zebra predefinita" });
      toast.success(`Etichetta test stampata su ${printer.name || "Zebra"}`);
      return;
    } catch {
      setZebra({ status: "unavailable", name: "" });
      toast.error("Zebra non raggiungibile: uso la stampa browser di emergenza");
    }
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
    const value = normalizeScannerCode(overrideCode ?? code);
    if (!value || working || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
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
      if (next.phase === "cart_ready") setCart((current) => cartStateFromSnapshot(next, current));
      setStation(next);
      setCode("");
      if (navigator.vibrate) navigator.vibrate([55, 35, 55]);
      if (next.phase === "cart_ready") toast.success("Carrello riconosciuto: ora scansiona una bag");
      if (next.phase === "double_check") toast.success("Bag riconosciuta: riscansionala per il doppio controllo");
      if (next.phase === "scan_labels" && station?.phase === "double_check") {
        await printCarrierLabels(next.bag_code, next.labels);
      }
      if (next.phase === "completed") toast.success("Packing completato. Bag liberata.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Scansione non valida");
      if (navigator.vibrate) navigator.vibrate(180);
    } finally {
      scanInFlightRef.current = false;
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
      <div><p className="wms-eyebrow">Outbound</p><h1 className="wms-title">Packing station</h1><p className="wms-subtitle">Scanner sempre pronto. La fotocamera si apre solo quando serve.</p></div>
      <div className="flex flex-col items-end gap-2">
        <button type="button" onClick={() => checkZebra({ notify: true })} className={`flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-black ${zebra.status === "ready" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : zebra.status === "checking" ? "border-slate-300 bg-white text-slate-600" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
          {zebra.status === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : zebra.status === "ready" ? <Printer className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          <span>{zebra.status === "ready" ? zebra.name : zebra.status === "checking" ? "Cerco Zebra" : "Zebra non collegata"}</span>
        </button>
        <button type="button" onClick={printTestLabel} className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 hover:border-teal-600 hover:text-teal-800">
          <Printer className="h-4 w-4" /> Etichetta test
        </button>
      </div>
    </header>
    {zebra.status === "unavailable" && <div className="mb-4 flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong className="block">Stampa automatica Zebra non attiva</strong><span className="mt-1 block text-xs leading-5">Avvia Zebra Browser Print sul PC, collega la stampante e impostala come predefinita, poi premi “Zebra non collegata” per riprovare.</span></div></div>}

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
          onChange={(event) => {
            const nextCode = normalizeScannerCode(event.target.value);
            setCode(nextCode);
            if (isCompletePackingScan(nextCode)) window.setTimeout(() => submitScan(nextCode), 0);
          }}
          placeholder={phase === "scan_labels" ? "Scansiona etichetta corriere" : phase === "cart_ready" ? "Scansiona una bag" : "CARRELLO-01 oppure bag"}
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

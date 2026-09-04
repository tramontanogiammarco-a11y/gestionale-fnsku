import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  Camera,
  ChevronRight,
  Edit3,
  History,
  Loader2,
  MapPin,
  Minus,
  MoveRight,
  PackagePlus,
  PackageSearch,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CameraScanner from "@/components/wms/CameraScanner";
import { toast } from "sonner";

export default function UniversalScanner({ open, onOpenChange, clientId, onViewLocation }) {
  const inputRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  const [action, setAction] = useState(null);
  const [draft, setDraft] = useState({ quantity: "1", targetCode: "", sourceCode: "" });
  const [selectedBag, setSelectedBag] = useState(null);
  const [bagDetail, setBagDetail] = useState(null);
  const [bagDetailLoading, setBagDetailLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setCameraOpen(false);
      return;
    }
    setResult(null);
    setAction(null);
    setDraft({ quantity: "1", targetCode: "", sourceCode: "" });
    setSelectedBag(null);
    setBagDetail(null);
    setCode("");
    setCameraOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 35);
  }, [open]);

  const scan = async (rawCode) => {
    const value = String(rawCode || "").trim();
    if (!value) return;
    setCode(value);
    setAction(null);
    setLoading(true);
    try {
      const query = new URLSearchParams({ code: value });
      if (clientId && clientId !== "all") query.set("cliente_id", clientId);
      const response = await api.get(`/wms/scan?${query.toString()}`);
      setResult(response.data);
      if (response.data.kind === "unknown") toast.error(`Codice ${value} non riconosciuto`);
      else if (navigator.vibrate) navigator.vibrate(70);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Scansione non riuscita");
    } finally {
      setCode("");
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 35);
    }
  };

  const openBag = async (bag) => {
    if (!bag?.codice || bag.stato === "disponibile") return;
    setSelectedBag(bag);
    setBagDetail(null);
    setBagDetailLoading(true);
    try {
      const response = await api.get(`/wms/bags/${encodeURIComponent(bag.codice)}/contenuto`);
      setBagDetail(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Contenuto bag non disponibile");
    } finally {
      setBagDetailLoading(false);
    }
  };

  const assignActionCode = (value) => {
    const clean = String(value || "").trim();
    if (!clean || !action) return false;
    if (action.type === "swap") {
      runSwap(clean);
      return true;
    }
    if (action.type === "swap" || action.type === "move") {
      setDraft((current) => ({ ...current, targetCode: clean }));
      setCode(clean);
      toast.info("Codice destinazione inserito. Ora conferma l'operazione.");
      return true;
    }
    if (action.type === "pallet") {
      setDraft((current) => ({ ...current, sourceCode: clean }));
      setCode(clean);
      toast.info("Pallet inserito. Ora scegli la quantita e conferma.");
      return true;
    }
    return false;
  };

  const submit = (event) => {
    event.preventDefault();
    if (assignActionCode(code)) return;
    scan(code);
  };

  const handleDetected = (value) => {
    setCameraOpen(false);
    if (assignActionCode(value)) return;
    scan(value);
  };

  const startAction = (type, location) => {
    if (type !== "swap" && location.contenuto.length > 1) {
      toast.error("Questa posizione contiene piu referenze: apri il dettaglio posizione.");
      return;
    }
    if ((type === "edit" || type === "move") && !location.contenuto.length) {
      toast.error("Questa posizione e vuota.");
      return;
    }
    if (type === "pallet" && location.tipo !== "slot") {
      toast.error("Prima scansiona lo slot dove vuoi portare la merce.");
      return;
    }
    const item = location.contenuto[0] || null;
    setAction({ type, location, item });
    setDraft({
      quantity: type === "edit" ? String(item?.quantita || location.quantita || 0) : "1",
      targetCode: "",
      sourceCode: "",
    });
    const messages = {
      edit: "Modifica la quantita e conferma.",
      swap: "Scansiona lo slot Y: lo scambio parte in automatico.",
      move: "Scansiona lo slot destinazione, scegli la quantita e conferma.",
      pallet: "Scansiona il pallet origine, scegli la quantita e conferma.",
    };
    toast.info(messages[type]);
    if (type === "swap" || type === "move" || type === "pallet") {
      window.setTimeout(() => setCameraOpen(true), 50);
    }
  };

  const runSwap = async (targetCode) => {
    if (!action || action.type !== "swap") return;
    setWorking(true);
    try {
      await api.post("/wms/stock/scambia", {
        source_location_id: action.location.id,
        target_location_code: targetCode,
      });
      toast.success("Slot scambiati");
      await scan(action.location.codice);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Scambio non riuscito");
    } finally {
      setWorking(false);
    }
  };

  const runAction = async () => {
    if (!action) return;
    const quantity = Number(draft.quantity || 0);
    const productPayload = action.item
      ? {
        cliente_id: action.item.cliente_id,
        product_key: productKey(action.item),
      }
      : {};

    setWorking(true);
    try {
      if (action.type === "edit") {
        await api.post("/wms/stock/quantita", {
          location_id: action.location.id,
          quantita: quantity,
          ...productPayload,
        });
        toast.success("Quantita aggiornata");
      }
      if (action.type === "move") {
        await api.post("/wms/stock/sposta", {
          source_location_id: action.location.id,
          target_location_code: draft.targetCode,
          quantita: quantity,
          ...productPayload,
        });
        toast.success("Quantita spostata");
      }
      if (action.type === "pallet") {
        await api.post("/wms/stock/pallet-slot", {
          source_location_code: draft.sourceCode,
          target_location_id: action.location.id,
          quantita: quantity,
          ...productPayload,
        });
        toast.success("Slot rifornito dal pallet");
      }
      if (action.type !== "swap") await scan(action.location.codice);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Operazione non riuscita");
    } finally {
      setWorking(false);
    }
  };

  const canConfirm = action
    && (action.type === "edit"
      || ((action.type === "swap" || action.type === "move") && draft.targetCode.trim())
      || (action.type === "pallet" && draft.sourceCode.trim()))
    && (action.type === "swap" || Number(draft.quantity || 0) >= 0);
  const waitingForScannedTarget = action && ["swap", "move", "pallet"].includes(action.type);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl font-black"><Barcode className="h-5 w-5 text-teal-700" /> Scanner universale</SheetTitle>
            <SheetDescription>Leggi bag, etichette, slot, pallet, prodotti o carrelli.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
            <Button type="button" className="h-14 w-full text-base font-black" onClick={() => setCameraOpen(true)}>
              <Camera className="mr-2 h-5 w-5" /> {waitingForScannedTarget ? actionCameraLabel(action.type) : "Apri fotocamera"}
            </Button>
            {waitingForScannedTarget ? (
              <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
                <div className="font-black">{actionScanTitle(action.type)}</div>
                <div className="mt-1 text-xs font-semibold text-teal-800">
                  {action.type === "move" ? "Non scrivere il codice: usa la fotocamera o il lettore per scansionare lo slot destinazione." : "Non scrivere il codice: usa la scansione per continuare."}
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="flex gap-2">
                <Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} className="h-12 min-w-0 flex-1 font-mono" placeholder="P1+A1, EAN o FNSKU" autoComplete="off" />
                <Button type="submit" size="icon" variant="outline" className="h-12 w-12 shrink-0" disabled={loading || !code.trim()} aria-label="Cerca codice">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                </Button>
              </form>
            )}

            {!result && !loading && (
              <div className="grid grid-cols-2 gap-3 pt-2 text-center text-sm">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4"><Warehouse className="mx-auto h-6 w-6 text-teal-700" /><strong className="mt-2 block">Posizione</strong><span className="mt-1 block text-xs text-slate-500">Mostra e modifica</span></div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4"><PackageSearch className="mx-auto h-6 w-6 text-teal-700" /><strong className="mt-2 block">Prodotto</strong><span className="mt-1 block text-xs text-slate-500">Mostra dove si trova</span></div>
              </div>
            )}

            {loading && <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>}
            {!loading && result?.kind === "location" && (
              <LocationResult
                location={result.location}
                action={action}
                draft={draft}
                working={working}
                canConfirm={canConfirm}
                onDraftChange={setDraft}
                onStartAction={startAction}
                onScanTarget={() => setCameraOpen(true)}
                onCancelAction={() => setAction(null)}
                onConfirmAction={runAction}
                onView={() => onViewLocation(result.location.codice)}
              />
            )}
            {!loading && result?.kind === "bag" && <BagHistoryResult result={result} />}
            {!loading && result?.kind === "label" && <LabelResult label={result.label} />}
            {!loading && result?.kind === "product" && <ProductResult products={result.products} onViewLocation={onViewLocation} />}
            {!loading && result?.kind === "cart" && <CartResult result={result} onOpenBag={openBag} />}
            {!loading && result?.kind === "unknown" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-center">
                <Barcode className="mx-auto h-8 w-8 text-amber-700" />
                <h3 className="mt-3 font-black">Codice non riconosciuto</h3>
                <p className="mt-1 break-all font-mono text-sm text-amber-800">{result.code}</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <BagContentsDialog bag={selectedBag} detail={bagDetail} loading={bagDetailLoading} onOpenChange={(nextOpen) => { if (!nextOpen) { setSelectedBag(null); setBagDetail(null); } }} />
      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="universal" onDetected={handleDetected} />
    </>
  );
}

function CartResult({ result, onOpenBag }) {
  const { cart, positions = [], capacity = 0, summary = {} } = result;
  const positionMap = Object.fromEntries(positions.map((position) => [Number(position.posizione), position]));
  const columns = Math.max(1, Number(cart.colonne || 1));
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white" data-testid="universal-scanner-cart">
      <div className="flex items-start gap-3 bg-slate-950 p-4 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10"><ShoppingCart className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-teal-300">Carrello</div><h3 className="mt-1 font-mono text-2xl font-black">{cart.codice}</h3><p className="mt-1 text-xs text-slate-300">Griglia {cart.righe} × {cart.colonne}</p></div>
        <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${summary.occupied ? "bg-rose-100 text-rose-900" : "bg-emerald-100 text-emerald-900"}`}>{summary.occupied || 0} piene</span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        <CartMetric label="Bag configurate" value={`${summary.configured || 0}/${capacity}`} />
        <CartMetric label="Libere" value={summary.available || 0} tone="text-emerald-700" />
        <CartMetric label="Piene" value={summary.occupied || 0} tone="text-rose-700" />
      </div>

      <div className="p-3">
        <div className="mb-3 flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-teal-700" /><h4 className="font-black">Composizione bag</h4></div>
        <div className="overflow-x-auto pb-1">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))`, minWidth: `${columns * 78}px` }}>
            {Array.from({ length: capacity }, (_, index) => index + 1).map((position) => {
              const item = positionMap[position];
              const occupied = item?.bag && item.bag.stato !== "disponibile";
              return (
                <div key={position} className={`relative min-h-24 rounded-md border ${occupied ? "border-rose-300 bg-rose-50" : item?.bag ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50"}`}>
                  {occupied && <button type="button" className="absolute inset-0 z-10 rounded-md" onClick={() => onOpenBag(item.bag)} aria-label={`Apri contenuto ${item.bag.codice || item.bag_code}`} />}
                  <div className="p-2">
                  <span className="block text-[9px] font-black uppercase text-slate-500">Pos. {position}</span>
                  {item?.bag ? <><strong className="mt-2 block break-all font-mono text-xs text-slate-950">{item.bag.codice || item.bag_code}</strong><span className={`mt-2 block rounded-md px-1 py-1 text-center text-[9px] font-black uppercase ${occupied ? "bg-rose-700 text-white" : "bg-emerald-700 text-white"}`}>{occupied ? "Apri · piena" : "Libera"}</span></> : <span className="mt-3 block text-[10px] font-bold text-slate-400">Nessuna bag</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {summary.occupied > 0 && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-900">Le bag rosse sono già occupate e devono essere liberate completando il packing.</p>}
      </div>
    </div>
  );
}

function BagHistoryResult({ result }) {
  const current = result.current || {};
  const currentPieces = Number(current.summary?.pieces || 0);
  return <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
    <div className="flex items-start gap-3 bg-slate-950 p-4 text-white">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10"><ShoppingBag className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-teal-300">Bag</div><h3 className="mt-1 font-mono text-2xl font-black">{result.bag.codice}</h3></div>
      <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${result.bag.stato === "disponibile" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>{result.bag.stato === "disponibile" ? "Libera" : "In uso"}</span>
    </div>
    {currentPieces > 0 && <section className="border-b border-slate-200 bg-amber-50 p-4"><p className="text-[10px] font-black uppercase text-amber-800">Contenuto attuale</p><strong className="mt-1 block text-xl text-amber-950">{currentPieces} pezzi · {current.summary?.orders || 0} ordini</strong><div className="mt-3 divide-y divide-amber-200 border-t border-amber-200">{(current.orders || []).flatMap((order) => order.items || []).map((item, index) => <ProductLine key={item.id || index} item={item} />)}</div></section>}
    <div className="p-4"><div className="mb-3 flex items-center gap-2"><History className="h-5 w-5 text-teal-700" /><h4 className="font-black">Ultime 48 ore</h4></div>
      {result.history?.length ? <div className="space-y-3">{result.history.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}</div> : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">Nessun utilizzo registrato nelle ultime 48 ore.</p>}
    </div>
  </div>;
}

function HistoryEntry({ entry }) {
  return <section className="rounded-md border border-slate-200 p-3">
    <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-black uppercase text-teal-700">{entry.type === "packing" ? "Packing" : "Refill"}</span><strong className="mt-1 block">{entry.order_name || `${entry.source_code || "Pallet"} → ${entry.target_code || "Slot"}`}</strong>{entry.label_code && <span className="mt-1 block break-all font-mono text-[10px] text-slate-500">{entry.label_code}</span>}</div><time className="shrink-0 text-[10px] font-bold text-slate-500">{formatScannerDate(entry.occurred_at)}</time></div>
    <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">{(entry.items || []).map((item, index) => <ProductLine key={item.id || index} item={{ ...item, quantita: item.quantita_attesa }} />)}</div>
  </section>;
}

function LabelResult({ label }) {
  const items = Array.isArray(label.items) ? label.items : [];
  const pieces = items.reduce((sum, item) => sum + Number(item.quantita_attesa || 0), 0);
  return <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
    <div className="flex items-start gap-3 bg-slate-950 p-4 text-white"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10"><Tag className="h-6 w-6" /></span><div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-teal-300">Etichetta {String(label.carrier || "corriere").toUpperCase()}</div><h3 className="mt-1 break-all font-mono text-lg font-black">{label.label_code}</h3><p className="mt-1 text-xs text-slate-300">{label.order_name} · {label.recipient_name}</p></div><strong className="shrink-0 text-xl">{pieces} pz</strong></div>
    <div className="divide-y divide-slate-100">{items.map((item, index) => <ProductLine key={item.id || index} item={{ ...item, quantita: item.quantita_attesa }} />)}</div>
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">Bag {label.bag_code || "non associata"} · Imballaggio {label.packaging_code || "non registrato"}</div>
  </div>;
}

function formatScannerDate(value) {
  return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

function BagContentsDialog({ bag, detail, loading, onOpenChange }) {
  const summary = detail?.summary || {};
  return (
    <Dialog open={Boolean(bag)} onOpenChange={onOpenChange}>
      <DialogContent className="wms-shell max-h-[calc(100dvh-16px)] w-[calc(100%-16px)] max-w-lg overflow-y-auto rounded-md bg-white p-0">
        <DialogHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><ShoppingBag className="h-5 w-5 text-rose-700" /> {bag?.codice}</DialogTitle>
          <DialogDescription>{detail?.phase === "picking_galluse" ? "Contenuto assegnato durante il picking" : "Contenuto presente nella bag per il packing"}</DialogDescription>
        </DialogHeader>
        {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div> : detail ? <div className="pb-5">
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
            <CartMetric label="Ordini" value={summary.orders || 0} />
            <CartMetric label="Referenze" value={summary.references || 0} />
            <CartMetric label="Pezzi" value={summary.pieces || 0} />
          </div>
          {(detail.orders || []).length ? <div className="divide-y divide-slate-200">
            {detail.orders.map((order) => <section key={order.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-black uppercase text-teal-700">Ordine</span><h3 className="mt-1 text-lg font-black">{order.order_name}</h3><p className="mt-1 text-xs text-slate-500">{order.cliente}</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600">{bagOrderStatus(order.wms_status)}</span></div>
              <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                {order.items.map((item) => <div key={item.id} className="flex items-start gap-3 p-3"><div className="min-w-0 flex-1"><strong className="block text-sm">{item.titolo}</strong><span className="mt-1 block break-all font-mono text-[10px] text-slate-500">{item.fnsku || item.ean || item.sku || "Codice non disponibile"}</span></div><strong className="shrink-0 text-lg">×{item.quantita}</strong></div>)}
              </div>
            </section>)}
          </div> : <div className="p-6 text-center text-sm text-slate-500">La bag risulta occupata, ma non contiene ordini operativi associati.</div>}
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}

function bagOrderStatus(status) {
  if (status === "in_preparazione") return "Picking";
  if (status === "in_attesa_packing") return "Attesa packing";
  if (status === "in_packing") return "In packing";
  return String(status || "Occupata").replace(/_/g, " ");
}

function CartMetric({ label, value, tone = "text-slate-950" }) {
  return <div className="min-w-0 p-3"><strong className={`block text-xl font-black ${tone}`}>{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-500">{label}</span></div>;
}

function LocationResult({ location, action, draft, working, canConfirm, onDraftChange, onStartAction, onScanTarget, onCancelAction, onConfirmAction, onView }) {
  const activeAction = action?.location?.id === location.id ? action : null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-start gap-3 bg-slate-950 p-4 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10"><MapPin className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-teal-300">{location.tipo}</div><h3 className="mt-1 font-mono text-2xl font-black">{location.codice}</h3></div>
        <span className={`rounded-md px-2 py-1 text-sm font-black ${location.occupata ? "bg-teal-100 text-teal-900" : "bg-white/10 text-white"}`}>{Number(location.quantita || 0)} pz</span>
      </div>
      {location.contenuto.length ? (
        <div className="divide-y divide-slate-100">
          {location.contenuto.map((item) => <ProductLine key={`${item.cliente_id}:${item.fnsku || item.ean}`} item={item} />)}
        </div>
      ) : <div className="p-6 text-center text-sm text-slate-500">La posizione e libera.</div>}

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
        <ScannerAction icon={Edit3} label="Modifica qta" onClick={() => onStartAction("edit", location)} />
        <ScannerAction icon={ArrowLeftRight} label="Scambia slot" onClick={() => onStartAction("swap", location)} />
        <ScannerAction icon={PackagePlus} label="Da pallet" onClick={() => onStartAction("pallet", location)} />
        <ScannerAction icon={MoveRight} label="Sposta qta" onClick={() => onStartAction("move", location)} />
      </div>

      {activeAction && (
        <div className="border-t border-slate-100 bg-slate-50 p-4">
          <div className="text-sm font-black">{actionTitle(activeAction.type)}</div>
          <p className="mt-1 text-xs text-slate-500">{actionHelp(activeAction.type)}</p>
          {activeAction.type === "swap" && (
            <ScanTarget
              icon={ArrowLeftRight}
              value={draft.targetCode}
              emptyLabel="Scansiona slot Y"
              filledLabel="Slot Y scansionato"
              onScan={onScanTarget}
            />
          )}
          {activeAction.type === "move" && (
            <ScanTarget
              icon={MoveRight}
              value={draft.targetCode}
              emptyLabel="Scansiona slot destinazione"
              filledLabel="Slot destinazione"
              onScan={onScanTarget}
            />
          )}
          {activeAction.type === "pallet" && (
            <ScanTarget
              icon={PackagePlus}
              value={draft.sourceCode}
              emptyLabel="Scansiona pallet origine"
              filledLabel="Pallet origine"
              onScan={onScanTarget}
            />
          )}
          {activeAction.type !== "swap" && (
            <QuantityStepper
              value={draft.quantity}
              max={activeAction.type === "move" ? activeAction.item?.quantita : undefined}
              onChange={(quantity) => onDraftChange((current) => ({ ...current, quantity }))}
            />
          )}
          {activeAction.type === "swap" ? (
            <Button type="button" variant="outline" className="mt-3 h-12 w-full bg-white font-bold" onClick={onCancelAction} disabled={working}>Annulla scambio</Button>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-12 bg-white font-bold" onClick={onCancelAction} disabled={working}>Annulla</Button>
              <Button type="button" className="h-12 font-black" onClick={onConfirmAction} disabled={!canConfirm || working}>
                {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Conferma
              </Button>
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={onView} className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-3 text-sm font-bold text-teal-700">Apri dettaglio posizione <ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

function ScannerAction({ icon: Icon, label, onClick }) {
  return (
    <Button type="button" variant="outline" className="h-12 justify-center px-2 text-xs font-black" onClick={onClick}>
      <Icon className="mr-1.5 h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function QuantityStepper({ value, max, onChange }) {
  const numeric = Math.max(0, Number(value || 0));
  const next = (amount) => {
    const candidate = numeric + amount;
    onChange(String(Math.max(0, max ? Math.min(max, candidate) : candidate)));
  };
  return (
    <div className="mt-3 flex items-center gap-2">
      <Button type="button" size="icon" variant="outline" className="h-12 w-12 bg-white" onClick={() => next(-1)}><Minus className="h-4 w-4" /></Button>
      <Input value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-12 min-w-0 flex-1 bg-white text-center text-lg font-black" placeholder="0" />
      <Button type="button" size="icon" variant="outline" className="h-12 w-12 bg-white" onClick={() => next(1)}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}

function ScanTarget({ icon: Icon, value, emptyLabel, filledLabel, onScan }) {
  return (
    <button type="button" onClick={onScan} className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-md border border-dashed border-teal-300 bg-white px-4 py-3 text-left">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-slate-950">{value ? filledLabel : emptyLabel}</span>
        <span className="mt-0.5 block break-all font-mono text-xs text-slate-500">{value || "Tocca qui o usa il lettore per scansionare"}</span>
      </span>
      <Camera className="h-5 w-5 shrink-0 text-teal-700" />
    </button>
  );
}

function ProductResult({ products, onViewLocation }) {
  return <div className="space-y-3">{products.map((product) => (
    <div key={`${product.cliente_id}:${product.fnsku || product.ean}`} className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Boxes className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="font-black">{product.titolo}</div><div className="mt-1 text-xs text-slate-500">{product.cliente}</div><div className="mt-2 break-all font-mono text-xs text-slate-500">{product.ean || "EAN assente"} · {product.fnsku || "FNSKU assente"}</div></div><strong className="text-2xl">{product.disponibile}</strong></div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
        {product.ubicazioni.map((location) => <button key={location.id} type="button" onClick={() => onViewLocation(location.codice)} className="flex w-full items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-left"><MapPin className="h-4 w-4 text-teal-700" /><span className="flex-1 font-mono text-sm font-bold">{location.codice}</span><strong>{location.quantita} pz</strong></button>)}
        {product.non_ubicato > 0 && <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><span>Da ubicare</span><strong>{product.non_ubicato} pz</strong></div>}
        {!product.ubicazioni.length && product.non_ubicato === 0 && <div className="text-sm text-slate-500">Nessuna giacenza disponibile.</div>}
      </div>
    </div>
  ))}</div>;
}

function ProductLine({ item }) {
  return <div className="flex items-start gap-3 p-4"><div className="min-w-0 flex-1"><div className="font-bold">{item.titolo}</div>{item.cliente && <div className="mt-1 text-xs text-slate-500">{item.cliente}</div>}<div className="mt-1 break-all font-mono text-xs text-slate-500">{item.ean || "EAN assente"} · {item.fnsku || "FNSKU assente"}</div></div><strong className="shrink-0 text-lg">{item.quantita} pz</strong></div>;
}

function actionCameraLabel(type) {
  if (type === "swap") return "Scansiona slot Y";
  if (type === "move") return "Scansiona slot destinazione";
  if (type === "pallet") return "Scansiona pallet origine";
  return "Apri fotocamera";
}

function actionScanTitle(type) {
  if (type === "swap") return "Inquadra lo slot Y";
  if (type === "move") return "Inquadra lo slot destinazione";
  if (type === "pallet") return "Inquadra il pallet origine";
  return "Scansione richiesta";
}

function actionTitle(type) {
  if (type === "edit") return "Modifica quantita";
  if (type === "swap") return "Scambia slot";
  if (type === "pallet") return "Porta quantita da pallet";
  return "Sposta quantita";
}

function actionHelp(type) {
  if (type === "edit") return "La nuova quantita viene salvata come rettifica inventario.";
  if (type === "swap") return "Scansiona lo slot Y: i prodotti dentro X e Y vengono scambiati.";
  if (type === "pallet") return "Scansiona il pallet origine e conferma quanti pezzi portare allo slot.";
  return "Scansiona lo slot destinazione e conferma solo i pezzi da spostare.";
}

function productKey(item = {}) {
  const fnsku = String(item.fnsku || "").trim().toLowerCase();
  const ean = String(item.ean || "").trim().toLowerCase();
  return fnsku ? `fnsku:${fnsku}` : ean ? `ean:${ean}` : null;
}

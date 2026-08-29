import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  Camera,
  ChevronRight,
  Edit3,
  Loader2,
  MapPin,
  Minus,
  MoveRight,
  PackagePlus,
  PackageSearch,
  Plus,
  Search,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setAction(null);
    setDraft({ quantity: "1", targetCode: "", sourceCode: "" });
    setCode("");
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
      setLoading(false);
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
            <SheetDescription>Leggi una posizione, un EAN, un FNSKU o un pallet.</SheetDescription>
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
            {!loading && result?.kind === "product" && <ProductResult products={result.products} onViewLocation={onViewLocation} />}
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
      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="universal" onDetected={handleDetected} />
    </>
  );
}

function LocationResult({ location, action, draft, working, canConfirm, onDraftChange, onStartAction, onScanTarget, onCancelAction, onConfirmAction, onView }) {
  const activeAction = action?.location?.id === location.id ? action : null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-start gap-3 bg-slate-950 p-4 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10"><MapPin className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-teal-300">{location.tipo}</div><h3 className="mt-1 font-mono text-2xl font-black">{location.codice}</h3></div>
        <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${location.occupata ? "bg-teal-100 text-teal-900" : "bg-white/10 text-white"}`}>{location.occupata ? "Occupata" : "Libera"}</span>
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
  return <div className="flex items-start gap-3 p-4"><div className="min-w-0 flex-1"><div className="font-bold">{item.titolo}</div><div className="mt-1 text-xs text-slate-500">{item.cliente}</div><div className="mt-1 break-all font-mono text-xs text-slate-500">{item.ean || "EAN assente"} · {item.fnsku || "FNSKU assente"}</div></div><strong className="shrink-0 text-lg">{item.quantita} pz</strong></div>;
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

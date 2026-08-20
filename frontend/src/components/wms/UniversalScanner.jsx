import { useEffect, useRef, useState } from "react";
import { Barcode, Boxes, Camera, ChevronRight, Loader2, MapPin, PackageSearch, Search, Warehouse } from "lucide-react";
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
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCode("");
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const scan = async (rawCode) => {
    const value = String(rawCode || "").trim();
    if (!value) return;
    setCode(value);
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

  const submit = (event) => {
    event.preventDefault();
    scan(code);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl font-black"><Barcode className="h-5 w-5 text-teal-700" /> Scanner universale</SheetTitle>
            <SheetDescription>Leggi una posizione, un EAN o un FNSKU.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
            <Button type="button" className="h-14 w-full text-base font-black" onClick={() => setCameraOpen(true)}>
              <Camera className="mr-2 h-5 w-5" /> Apri fotocamera
            </Button>
            <form onSubmit={submit} className="flex gap-2">
              <Input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value)} className="h-12 min-w-0 flex-1 font-mono" placeholder="P1+A1, EAN o FNSKU" autoComplete="off" />
              <Button type="submit" size="icon" variant="outline" className="h-12 w-12 shrink-0" disabled={loading || !code.trim()} aria-label="Cerca codice">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              </Button>
            </form>

            {!result && !loading && (
              <div className="grid grid-cols-2 gap-3 pt-2 text-center text-sm">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4"><Warehouse className="mx-auto h-6 w-6 text-teal-700" /><strong className="mt-2 block">Posizione</strong><span className="mt-1 block text-xs text-slate-500">Mostra cosa contiene</span></div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4"><PackageSearch className="mx-auto h-6 w-6 text-teal-700" /><strong className="mt-2 block">Prodotto</strong><span className="mt-1 block text-xs text-slate-500">Mostra dove si trova</span></div>
              </div>
            )}

            {loading && <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>}
            {!loading && result?.kind === "location" && <LocationResult location={result.location} onView={() => onViewLocation(result.location.codice)} />}
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
      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="universal" onDetected={(value) => { setCameraOpen(false); scan(value); }} />
    </>
  );
}

function LocationResult({ location, onView }) {
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
      ) : <div className="p-6 text-center text-sm text-slate-500">La posizione è libera.</div>}
      <button type="button" onClick={onView} className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-3 text-sm font-bold text-teal-700">Apri dettaglio posizione <ChevronRight className="h-4 w-4" /></button>
    </div>
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

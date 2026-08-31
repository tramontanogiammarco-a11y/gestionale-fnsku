import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function CameraScanner({ open, onOpenChange, purpose = "universal", onDetected, context = null }) {
  const controlsRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [videoElement, setVideoElement] = useState(null);
  const [starting, setStarting] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    if (!open || !videoElement) return undefined;
    let cancelled = false;
    let handled = false;
    const reader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 40,
      delayBetweenScanSuccess: 180,
    });
    setStarting(true);
    setPreviewReady(false);
    setError("");
    reader.decodeFromConstraints({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 960 },
        height: { ideal: 540 },
      },
    }, videoElement, (result, _, controls) => {
      if (controls) controlsRef.current = controls;
      if (!result || handled || cancelled) return;
      handled = true;
      controlsRef.current?.stop();
      onDetectedRef.current(result.getText());
    }).then((controls) => {
      if (cancelled) controls.stop();
      else controlsRef.current = controls;
      setStarting(false);
      videoElement.play().catch(() => {});
    }).catch(() => {
      if (cancelled) return;
      setStarting(false);
      setError("Fotocamera non disponibile. Consenti l'accesso nelle impostazioni del browser oppure usa l'inserimento manuale.");
    });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, videoElement]);

  const title = purpose === "location" ? "Scansiona posizione" : purpose === "product" ? "Scansiona prodotto" : purpose === "bag" ? "Scansiona bag" : purpose === "cart" ? "Scansiona carrello" : purpose === "carrier_label" ? "Scansiona etichetta corriere" : purpose === "packing" ? "Scansiona carrello o bag" : "Scanner universale";
  const description = purpose === "location"
    ? "Inquadra il barcode applicato alla posizione pallet o slot."
    : purpose === "product"
      ? "Inquadra l'EAN o il barcode del prodotto."
      : purpose === "bag"
        ? "Inquadra il barcode della bag libera."
        : purpose === "cart"
          ? "Inquadra il barcode master applicato al carrello."
        : purpose === "carrier_label"
          ? "Inquadra il barcode stampato sull'etichetta del corriere."
        : purpose === "packing"
          ? "Inquadra il barcode del carrello oppure quello applicato alla bag."
      : "Inquadra una posizione, un EAN o un FNSKU.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wms-shell block max-h-[calc(100dvh-16px)] max-w-[calc(100%-16px)] space-y-3 overflow-y-auto rounded-md border-slate-300 bg-[#f8faf9] p-3 sm:max-w-md sm:p-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {context && <section className="rounded-md border border-slate-200 bg-white">
          <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200">
            <div className="p-3"><span className="block text-xs font-bold uppercase text-slate-500">Referenze</span><strong className="mt-1 block text-2xl font-black">{context.completedLines}<span className="text-base text-slate-400">/{context.totalLines}</span></strong></div>
            <div className="p-3"><span className="block text-xs font-bold uppercase text-slate-500">Pezzi</span><strong className="mt-1 block text-2xl font-black">{context.picked}<span className="text-base text-slate-400">/{context.expected}</span></strong></div>
          </div>
          <div className="p-3 sm:p-4">
            <span className="text-xs font-black uppercase text-teal-700">{purpose === "cart" ? "Scansiona il master" : "Scansiona lo slot"}</span>
            <div className="mt-2 flex items-end justify-between gap-3"><strong className="font-mono text-4xl font-black tracking-wide text-slate-950">{context.location}</strong><span className="rounded-md bg-teal-700 px-2 py-1 text-xs font-black text-white">{context.requested} pz</span></div>
            <p className="mt-2 truncate text-sm font-semibold text-slate-600">{context.title}</p>
            {context.bagAllocations?.length > 0 && <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-xs font-black uppercase text-amber-800">Dopo il prelievo inserisci subito nelle bag</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {context.bagAllocations.map((allocation) => <div key={`${allocation.posizione_bag}-${allocation.bag_code}`} className="min-h-[76px] rounded-md border border-amber-300 bg-amber-50 p-2.5">
                  <span className="block text-[10px] font-black uppercase text-amber-800">Bag {allocation.posizione_bag}</span>
                  <strong className="block font-mono text-sm text-slate-950">{allocation.bag_code}</strong>
                  <span className="mt-1 block text-xl font-black leading-none text-amber-950">x{allocation.quantita}</span>
                </div>)}
              </div>
            </div>}
          </div>
        </section>}
        <div className="relative aspect-[4/5] max-h-[64dvh] overflow-hidden rounded-md bg-slate-950 shadow-inner">
          <video ref={setVideoElement} className="h-full w-full object-cover" autoPlay muted playsInline onPlaying={() => { setPreviewReady(true); setStarting(false); }} />
          {context?.imageUrl && <figure className="pointer-events-none absolute left-1/2 top-[4%] z-20 w-[88%] -translate-x-1/2 overflow-hidden rounded-md border-2 border-white bg-white p-2 shadow-lg">
            <img src={context.imageUrl} alt={context.title || "Prodotto da prelevare"} className="h-52 w-full object-contain" decoding="async" fetchPriority="high" />
            <figcaption className="mt-1 truncate text-center text-xs font-bold text-slate-700">{context.title}</figcaption>
          </figure>}
          {!context?.locationConfirmed && <div className="pointer-events-none absolute inset-x-[12%] bottom-[10%] z-10 h-24 rounded-md border-2 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />}
          {context?.locationConfirmed && context?.quantityControls && <div className="absolute inset-x-3 bottom-3 z-30 rounded-md border border-slate-200 bg-white p-3 shadow-xl">
            <div className="grid grid-cols-3 gap-2">
              {[1, 5, 10].map((amount) => <Button key={amount} type="button" variant="outline" className="h-12 text-lg font-black" onClick={() => context.quantityControls.onAdd(amount)} disabled={context.quantityControls.working || context.quantityControls.value >= context.quantityControls.remaining}>+{amount}</Button>)}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm font-black"><span>Pezzi selezionati</span><span>{context.quantityControls.value}/{context.quantityControls.remaining}</span></div>
            <Button type="button" className="mt-2 h-12 w-full font-black" onClick={context.quantityControls.onConfirm} disabled={context.quantityControls.working || context.quantityControls.value !== context.quantityControls.remaining}>Conferma {context.quantityControls.remaining} pezzi</Button>
          </div>}
          {starting && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-white"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Avvio fotocamera</div>}
          {!starting && !previewReady && !error && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6"><Button type="button" variant="secondary" onClick={() => videoElement?.play().catch(() => setError("Il browser ha bloccato l'anteprima. Chiudi e riapri la fotocamera."))}>Avvia anteprima</Button></div>}
        </div>
        {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <Button type="button" variant="outline" className="h-11 w-full bg-white" onClick={() => onOpenChange(false)}>Inserimento manuale</Button>
      </DialogContent>
    </Dialog>
  );
}

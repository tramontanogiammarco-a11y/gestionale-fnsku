import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

// Card box lato cliente: mostra composizione + upload PDF unico etichette.
export function ClientBoxUpload({ box, onDone }) {
  const labelsRef = useRef();
  const [uploading, setUploading] = useState(null);

  const upload = async (file) => {
    setUploading("etichette");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/box/${box.id}/etichette`, fd);
      toast.success("PDF etichette caricato");
      onDone();
    } catch (e) {
      toast.error("Errore nel caricamento");
    } finally { setUploading(null); }
  };

  const puoCaricare = box.stato !== "spedito";

  return (
    <div className="rounded-md border border-border p-4" data-testid={`cbu-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {box.peso_kg ? `${box.peso_kg} kg · ` : ""}
        {box.lunghezza_cm && box.larghezza_cm && box.altezza_cm
          ? `${box.lunghezza_cm}×${box.larghezza_cm}×${box.altezza_cm} cm` : "dimensioni n/d"}
      </div>
      {box.contenuto?.length > 0 && (
        <div className="mt-3 rounded bg-slate-50 p-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Contenuto</div>
          {box.contenuto.map((c, i) => (
            <div key={i} className="flex justify-between text-xs py-0.5">
              <span className="font-mono">{c.ean}{c.fnsku ? ` · ${c.fnsku}` : ""}</span>
              <span>×{c.quantita}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4">
        <input ref={labelsRef} type="file" accept="application/pdf" className="hidden"
               data-testid={`cbu-labels-input-${box.id}`}
               onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        {box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url ? (
          <a href={fileUrl(box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbu-labels-done-${box.id}`}>
            <CheckCircle2 className="h-4 w-4" /> PDF etichette caricato
          </a>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "etichette"}
                  onClick={() => labelsRef.current.click()} data-testid={`cbu-labels-btn-${box.id}`}>
            {uploading === "etichette" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF etichette Amazon + UPS
          </Button>
        )}
      </div>
    </div>
  );
}

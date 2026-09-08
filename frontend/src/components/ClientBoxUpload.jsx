import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientBoxDetails } from "@/components/ClientBoxDetails";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, Trash2 } from "lucide-react";

// Card box lato cliente: mostra composizione + upload PDF unico etichette.
export function ClientBoxUpload({ box, onDone }) {
  const labelsRef = useRef();
  const [uploading, setUploading] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const removeLabels = async () => {
    if (!window.confirm(`Eliminare le etichette Amazon e UPS di ${box.numero_box}?`)) return;
    setDeleting(true);
    try {
      const { data } = await api.delete(`/box/${box.id}/etichette`);
      const count = Number(data?.affected_count || 1);
      toast.success(count > 1 ? `PDF rimosso da ${count} box` : "PDF etichette eliminato");
      if (data?.cleanup_warning) toast.warning("Etichette scollegate; pulizia del file da verificare");
      await onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Impossibile eliminare le etichette");
    } finally {
      setDeleting(false);
    }
  };

  const puoCaricare = box.stato !== "spedito";

  return (
    <div className="rounded-md border border-border p-4" data-testid={`cbu-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <ClientBoxDetails box={box} testIdPrefix="cbu-dati-etichette" />
      <div className="mt-4">
        <input ref={labelsRef} type="file" accept="application/pdf" className="hidden"
               data-testid={`cbu-labels-input-${box.id}`}
               onChange={(e) => {
                 const file = e.target.files?.[0];
                 e.target.value = "";
                 if (file) upload(file);
               }} />
        {box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url ? (
          <div className="flex items-center justify-between gap-2">
            <a href={fileUrl(box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbu-labels-done-${box.id}`}>
              <CheckCircle2 className="h-4 w-4" /> PDF etichette caricato
            </a>
            {puoCaricare && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={deleting}
                onClick={removeLabels}
                data-testid={`cbu-labels-delete-${box.id}`}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span className="ml-1">Elimina</span>
              </Button>
            )}
          </div>
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

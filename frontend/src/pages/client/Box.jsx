import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, CheckCircle2 } from "lucide-react";

export default function ClientBox() {
  const [boxes, setBoxes] = useState(null);

  const load = () => api.get("/box").then((r) => setBoxes(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="client-box">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">I miei box</h1>
        <p className="text-muted-foreground text-sm mt-1">Carica le etichette Amazon e UPS per i box pronti.</p>
      </div>

      {!boxes ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : boxes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nessun box ancora preparato.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {boxes.map((b) => <BoxItem key={b.id} box={b} onDone={load} />)}
        </div>
      )}
    </div>
  );
}

function BoxItem({ box, onDone }) {
  const amazonRef = useRef();
  const upsRef = useRef();
  const [uploading, setUploading] = useState(null);

  const upload = async (tipo, file) => {
    setUploading(tipo);
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/box/${box.id}/etichetta-${tipo}`, fd);
      toast.success(`Etichetta ${tipo === "amazon" ? "Amazon" : "UPS"} caricata`);
      onDone();
    } catch (e) {
      toast.error("Errore nel caricamento");
    } finally { setUploading(null); }
  };

  const puoCaricare = box.stato === "pronto" || box.stato === "in_preparazione";

  return (
    <Card className="p-4" data-testid={`cbox-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">{box.contenuto?.length || 0} referenze</div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        {/* Amazon */}
        <div>
          <input ref={amazonRef} type="file" accept="application/pdf" className="hidden"
                 data-testid={`cbox-amazon-input-${box.id}`}
                 onChange={(e) => e.target.files[0] && upload("amazon", e.target.files[0])} />
          {box.etichetta_amazon_pdf_url ? (
            <a href={fileUrl(box.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbox-amazon-done-${box.id}`}>
              <CheckCircle2 className="h-4 w-4" /> Amazon caricata
            </a>
          ) : (
            <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "amazon"}
                    onClick={() => amazonRef.current.click()} data-testid={`cbox-amazon-btn-${box.id}`}>
              {uploading === "amazon" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF Amazon
            </Button>
          )}
        </div>
        {/* UPS */}
        <div>
          <input ref={upsRef} type="file" accept="application/pdf" className="hidden"
                 data-testid={`cbox-ups-input-${box.id}`}
                 onChange={(e) => e.target.files[0] && upload("ups", e.target.files[0])} />
          {box.etichetta_ups_pdf_url ? (
            <a href={fileUrl(box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbox-ups-done-${box.id}`}>
              <CheckCircle2 className="h-4 w-4" /> UPS caricata
            </a>
          ) : (
            <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "ups"}
                    onClick={() => upsRef.current.click()} data-testid={`cbox-ups-btn-${box.id}`}>
              {uploading === "ups" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF UPS
            </Button>
          )}
        </div>
      </div>
      {!puoCaricare && box.stato === "spedito" && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1"><FileText className="h-3 w-3" /> Box spedito.</p>
      )}
    </Card>
  );
}

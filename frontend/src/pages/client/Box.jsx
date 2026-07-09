import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, CheckCircle2 } from "lucide-react";

export default function ClientBox() {
  const [boxes, setBoxes] = useState(null);
  const [titoli, setTitoli] = useState({});

  const load = () => api.get("/box").then((r) => setBoxes(r.data));
  useEffect(() => {
    load();
    api.get("/referenze").then((r) => {
      const m = {}; r.data.forEach((x) => (m[x.ean] = x.titolo)); setTitoli(m);
    });
  }, []);

  return (
    <div className="space-y-6" data-testid="client-box">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">I miei box</h1>
        <p className="text-muted-foreground text-sm mt-1">Carica un unico PDF con entrambe le etichette del box.</p>
      </div>

      {!boxes ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : boxes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nessun box ancora preparato.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {boxes.map((b) => <BoxItem key={b.id} box={b} titoli={titoli} onDone={load} />)}
        </div>
      )}
    </div>
  );
}

function BoxItem({ box, titoli, onDone }) {
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

  const puoCaricare = box.stato === "pronto" || box.stato === "in_preparazione";

  return (
    <Card className="p-4" data-testid={`cbox-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {box.contenuto?.length || 0} referenze · {box.contenuto?.reduce((a, c) => a + (c.quantita || 0), 0) || 0} pezzi
      </div>

      {box.contenuto?.length > 0 && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid={`cbox-contenuto-${box.id}`}>
          <div className="font-medium text-foreground mb-1">Contenuto del box</div>
          <div className="space-y-1">
            {box.contenuto.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-2" data-testid={`cbox-item-${box.id}-${i}`}>
                <div className="min-w-0">
                  {titoli?.[c.ean] && <div className="truncate text-foreground">{titoli[c.ean]}</div>}
                  <div className="font-mono text-[11px] text-muted-foreground">
                    EAN {c.ean}
                    {c.sku ? ` · SKU ${c.sku}` : ""}
                    {c.fnsku ? ` · FNSKU ${c.fnsku}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-semibold">×{c.quantita}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <input ref={labelsRef} type="file" accept="application/pdf" className="hidden"
               data-testid={`cbox-labels-input-${box.id}`}
               onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        {box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url ? (
          <a href={fileUrl(box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbox-labels-done-${box.id}`}>
            <CheckCircle2 className="h-4 w-4" /> PDF etichette caricato
          </a>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "etichette"}
                  onClick={() => labelsRef.current.click()} data-testid={`cbox-labels-btn-${box.id}`}>
            {uploading === "etichette" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF etichette Amazon + UPS
          </Button>
        )}
      </div>
      {!puoCaricare && box.stato === "spedito" && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1"><FileText className="h-3 w-3" /> Box spedito.</p>
      )}
    </Card>
  );
}

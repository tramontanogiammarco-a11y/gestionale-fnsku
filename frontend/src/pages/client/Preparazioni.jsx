import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { FLUSSO_PREP, STATI_PREP } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, ClipboardList, ChevronRight } from "lucide-react";

export default function ClientPreparazioni() {
  const [preps, setPreps] = useState(null);
  const navigate = useNavigate();

  const load = () => api.get("/preparazioni").then((r) => setPreps(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="client-preparazioni">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Preparazioni</h1>
          <p className="text-muted-foreground text-sm mt-1">Chiedi al prep center di preparare pezzi dal tuo magazzino.</p>
        </div>
        <NuovaPreparazioneDialog onDone={load} />
      </div>

      {!preps ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : preps.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nessuna preparazione. Creane una scegliendo EAN, SKU e quantità dal magazzino.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {preps.map((p) => (
            <Card key={p.id} data-testid={`cprep-${p.id}`} className="p-4 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate(`/app/preparazioni/${p.id}`)}>
              <div className="flex items-center justify-between">
                <div className="font-heading font-semibold">Preparazione</div>
                <StatusBadge stato={p.stato} tipo="prep" />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {new Date(p.created_at).toLocaleDateString("it-IT")} · {p.righe?.length || 0} righe · {p.righe?.reduce((a, r) => a + r.quantita, 0) || 0} pezzi
              </div>
              <div className="flex items-center gap-1 mt-3">
                {FLUSSO_PREP.map((s, i) => {
                  const done = FLUSSO_PREP.indexOf(p.stato) >= i;
                  return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_PREP[s].label} />;
                })}
              </div>
              <div className="flex items-center justify-end gap-1 mt-3 text-xs font-medium text-blue-600">
                {p.stato === "pronto" ? "Carica etichette" : "Apri dettaglio"}<ChevronRight className="h-4 w-4" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NuovaPreparazioneDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [magazzino, setMagazzino] = useState([]);
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState([{ ean: "", sku: "", quantita: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) api.get("/magazzino").then((r) => setMagazzino(r.data)); }, [open]);

  const skusPerEan = (ean) => magazzino.find((m) => m.ean === ean)?.skus || [];
  const dispPerEan = (ean) => magazzino.find((m) => m.ean === ean)?.disponibile;

  const update = (i, k, v) => {
    const next = [...righe]; next[i][k] = v;
    if (k === "ean") { const skus = skusPerEan(v); next[i].sku = skus.length === 1 ? skus[0] : ""; }
    setRighe(next);
  };
  const addRow = () => setRighe([...righe, { ean: "", sku: "", quantita: "" }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));

  const salva = async () => {
    const valide = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => ({ ean: r.ean, sku: r.sku || null, quantita: Number(r.quantita) }));
    if (valide.length === 0) { toast.error("Aggiungi almeno una riga con EAN e quantità"); return; }
    setSaving(true);
    try {
      await api.post("/preparazioni", { note, righe: valide });
      toast.success("Preparazione inviata al prep center");
      setOpen(false); setNote(""); setRighe([{ ean: "", sku: "", quantita: "" }]);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="nuova-prep-btn"><ClipboardList className="h-4 w-4 mr-2" /> Nuova preparazione</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Richiedi preparazione</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <datalist id="mag-ean-list">
            {magazzino.map((m) => <option key={m.ean} value={m.ean}>{m.titolo || m.ean} (disp. {m.disponibile})</option>)}
          </datalist>
          <div>
            <Label className="text-xs">Righe (EAN · SKU · quantità)</Label>
            <div className="mt-1 space-y-2">
              {righe.map((r, i) => {
                const skus = skusPerEan(r.ean);
                const disp = dispPerEan(r.ean);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`prep-riga-${i}`}>
                    <Input list="mag-ean-list" className="col-span-4 font-mono text-xs" data-testid={`prep-ean-${i}`} value={r.ean} onChange={(e) => update(i, "ean", e.target.value)} placeholder="EAN" />
                    {skus.length > 0 ? (
                      <select className="col-span-4 h-9 rounded-md border border-input bg-background px-2 text-xs font-mono" data-testid={`prep-sku-${i}`} value={r.sku} onChange={(e) => update(i, "sku", e.target.value)}>
                        <option value="">— scegli SKU —</option>
                        {skus.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <Input className="col-span-4 font-mono text-xs" data-testid={`prep-sku-${i}`} value={r.sku} onChange={(e) => update(i, "sku", e.target.value)} placeholder="SKU" />
                    )}
                    <Input type="number" min={1} className="col-span-3" data-testid={`prep-qta-${i}`} value={r.quantita} onChange={(e) => update(i, "quantita", e.target.value)} placeholder={disp != null ? `max ${disp}` : "Q.tà"} />
                    <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} disabled={righe.length === 1} data-testid={`prep-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addRow} data-testid="prep-add-row"><Plus className="h-4 w-4 mr-1" /> Aggiungi riga</Button>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea data-testid="prep-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="prep-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Invia richiesta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

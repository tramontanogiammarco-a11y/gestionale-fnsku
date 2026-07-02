import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { STATI_PREP, STATI_BOX } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, FileText, ClipboardList, Box as BoxIcon } from "lucide-react";

export default function AdminPreparazioneDetail() {
  const { id } = useParams();
  const [prep, setPrep] = useState(null);
  const [boxes, setBoxes] = useState([]);

  const load = () => {
    api.get(`/preparazioni/${id}`).then((r) => setPrep(r.data));
    api.get(`/box?preparazione_id=${id}`).then((r) => setBoxes(r.data));
  };
  useEffect(() => { load(); }, [id]);

  const cambiaStato = async (nuovo) => {
    try {
      await api.put(`/preparazioni/${id}/stato`, { stato: nuovo });
      toast.success("Stato aggiornato");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Operazione non riuscita");
    }
  };

  if (!prep)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="admin-prep-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{prep.cliente_ragione_sociale}</h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge stato={prep.stato} tipo="prep" />
            <span className="text-xs text-muted-foreground">Richiesta il {new Date(prep.created_at).toLocaleDateString("it-IT")}</span>
          </div>
          {prep.note && <p className="text-sm text-muted-foreground mt-2">{prep.note}</p>}
        </div>
        <Select value={prep.stato} onValueChange={cambiaStato}>
          <SelectTrigger className="w-44" data-testid="prep-stato-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(STATI_PREP).map((s) => <SelectItem key={s} value={s}>{STATI_PREP[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2 mb-3"><ClipboardList className="h-5 w-5 text-blue-600" /> Prodotti richiesti</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>EAN</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {prep.righe.map((r) => (
              <TableRow key={r.id} data-testid={`aprep-riga-${r.id}`}>
                <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                <TableCell className="font-mono text-xs">{r.sku || "—"}</TableCell>
                <TableCell className="text-right">{r.quantita}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2"><BoxIcon className="h-5 w-5 text-blue-600" /> Scatole ({boxes.length})</h2>
          <NuovoBoxPrepDialog prep={prep} onCreated={load} />
        </div>
        {boxes.length === 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="prep-no-box-hint">
            Nessuna scatola. Clicca <b>"Nuova scatola"</b> per comporre il collo (dimensioni, peso, contenuto). Il cliente potrà poi caricare le etichette.
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {boxes.map((b) => <BoxCard key={b.id} box={b} onChange={load} />)}
        </div>
      </div>
    </div>
  );
}

function BoxCard({ box, onChange }) {
  const cambiaStato = async (nuovo) => {
    try {
      await api.put(`/box/${box.id}/stato`, { stato: nuovo });
      toast.success("Stato box aggiornato");
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Operazione non riuscita");
    }
  };
  return (
    <Card className="p-4" data-testid={`aprep-box-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {box.peso_kg ? `${box.peso_kg} kg · ` : ""}
        {box.lunghezza_cm && box.larghezza_cm && box.altezza_cm ? `${box.lunghezza_cm}×${box.larghezza_cm}×${box.altezza_cm} cm` : "dimensioni n/d"}
      </div>
      {box.contenuto?.length > 0 && (
        <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
          {box.contenuto.map((c, i) => (
            <div key={i} className="flex justify-between py-0.5"><span className="font-mono">{c.ean}</span><span>×{c.quantita}</span></div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2 text-xs">
        {box.etichetta_amazon_pdf_url && <a href={fileUrl(box.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600"><FileText className="h-3 w-3" /> Amazon</a>}
        {box.etichetta_ups_pdf_url && <a href={fileUrl(box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-600"><FileText className="h-3 w-3" /> UPS</a>}
      </div>
      <div className="mt-3">
        <Select value={box.stato} onValueChange={cambiaStato}>
          <SelectTrigger className="w-full h-8" data-testid={`aprep-box-stato-${box.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(STATI_BOX).map((s) => <SelectItem key={s} value={s}>{STATI_BOX[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function NuovoBoxPrepDialog({ prep, onCreated }) {
  const [open, setOpen] = useState(false);
  const [numero, setNumero] = useState("");
  const [peso, setPeso] = useState("");
  const [dim, setDim] = useState({ l: "", w: "", h: "" });
  const [contenuto, setContenuto] = useState({});
  const [saving, setSaving] = useState(false);

  const salva = async () => {
    if (!numero) { toast.error("Inserisci il numero box"); return; }
    const cont = prep.righe
      .filter((r) => Number(contenuto[r.id]) > 0)
      .map((r) => ({ ean: r.ean, fnsku: "", quantita: Number(contenuto[r.id]) }));
    setSaving(true);
    try {
      await api.post("/box", {
        preparazione_id: prep.id,
        numero_box: numero,
        peso_kg: peso ? Number(peso) : null,
        lunghezza_cm: dim.l ? Number(dim.l) : null,
        larghezza_cm: dim.w ? Number(dim.w) : null,
        altezza_cm: dim.h ? Number(dim.h) : null,
        contenuto: cont,
      });
      toast.success("Scatola creata");
      setOpen(false); setNumero(""); setPeso(""); setDim({ l: "", w: "", h: "" }); setContenuto({});
      onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore creazione scatola");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="nuovo-box-prep-btn"><Plus className="h-4 w-4 mr-1" /> Nuova scatola</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nuova scatola</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Numero box</Label><Input data-testid="pbox-numero-input" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="BOX-001" className="mt-1" /></div>
          <div className="grid grid-cols-4 gap-2">
            <div><Label className="text-xs">Peso kg</Label><Input data-testid="pbox-peso-input" value={peso} onChange={(e) => setPeso(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">L cm</Label><Input value={dim.l} onChange={(e) => setDim({ ...dim, l: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">W cm</Label><Input value={dim.w} onChange={(e) => setDim({ ...dim, w: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">H cm</Label><Input value={dim.h} onChange={(e) => setDim({ ...dim, h: e.target.value })} className="mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs">Contenuto (quantità per EAN richiesto)</Label>
            <div className="mt-1 space-y-2 max-h-48 overflow-auto">
              {prep.righe.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs flex-1">{r.ean}{r.sku ? ` · ${r.sku}` : ""} <span className="text-muted-foreground">(rich. {r.quantita})</span></span>
                  <Input type="number" min={0} placeholder="0" data-testid={`pbox-content-${r.id}`} value={contenuto[r.id] ?? ""} onChange={(e) => setContenuto({ ...contenuto, [r.id]: e.target.value })} className="h-8 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="pbox-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crea scatola
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

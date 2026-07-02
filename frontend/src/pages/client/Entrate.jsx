import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { FLUSSO_ENTRATA, STATI_ENTRATA } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, PackagePlus, Barcode, FileText, Truck } from "lucide-react";

export default function ClientEntrate() {
  const [entrate, setEntrate] = useState(null);

  const load = () => api.get("/entrate").then((r) => setEntrate(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="client-entrate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Le mie entrate</h1>
          <p className="text-muted-foreground text-sm mt-1">Annuncia gli arrivi merce e segui lo stato.</p>
        </div>
        <NuovaEntrataDialog onDone={load} />
      </div>

      {!entrate ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : entrate.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nessuna entrata. Crea il tuo primo annuncio di arrivo merce.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {entrate.map((e) => (
            <Card key={e.id} className="p-4" data-testid={`centrata-${e.id}`}>
              <div className="flex items-center justify-between">
                <div className="font-heading font-semibold capitalize">{e.tipo}</div>
                <StatusBadge stato={e.stato} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {new Date(e.data_annuncio).toLocaleDateString("it-IT")} · {e.righe?.length || 0} referenze · {e.righe?.reduce((a, r) => a + r.quantita, 0) || 0} pezzi
              </div>
              {(e.ddt || e.tracking) && (
                <div className="flex flex-wrap gap-3 mt-2 text-xs">
                  {e.ddt && <span className="inline-flex items-center gap-1 text-slate-600"><FileText className="h-3 w-3" /> DDT: <span className="font-mono">{e.ddt}</span></span>}
                  {e.tracking && <span className="inline-flex items-center gap-1 text-slate-600"><Truck className="h-3 w-3" /> Tracking: <span className="font-mono">{e.tracking}</span></span>}
                </div>
              )}
              {/* Avanzamento flusso */}
              <div className="flex items-center gap-1 mt-3">
                {FLUSSO_ENTRATA.map((s, i) => {
                  const done = FLUSSO_ENTRATA.indexOf(e.stato) >= i;
                  return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_ENTRATA[s].label} />;
                })}
              </div>
              {e.note && <p className="text-xs text-muted-foreground mt-2">{e.note}</p>}
              {e.righe?.length > 0 && (
                <div className="mt-3">
                  <GestisciFnskuDialog entrata={e} onDone={load} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NuovaEntrataDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState("pallet");
  const [ddt, setDdt] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState([{ ean: "", quantita: "", fnsku: "" }]);
  const [referenze, setReferenze] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) api.get("/referenze").then((r) => setReferenze(r.data)); }, [open]);

  const update = (i, k, v) => {
    const next = [...righe]; next[i][k] = v;
    // autocompleta FNSKU se l'EAN corrisponde a una referenza
    if (k === "ean") {
      const ref = referenze.find((x) => x.ean === v);
      if (ref?.fnsku) next[i].fnsku = ref.fnsku;
    }
    setRighe(next);
  };
  const addRow = () => setRighe([...righe, { ean: "", quantita: "", fnsku: "" }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));

  const salva = async () => {
    const valide = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => ({ ean: r.ean, quantita: Number(r.quantita), fnsku: r.fnsku || null }));
    if (valide.length === 0) { toast.error("Aggiungi almeno una riga con EAN e quantità"); return; }
    setSaving(true);
    try {
      await api.post("/entrate", { tipo, ddt: ddt || null, tracking: tracking || null, note, righe: valide });
      toast.success("Entrata annunciata");
      setOpen(false); setTipo("pallet"); setDdt(""); setTracking(""); setNote(""); setRighe([{ ean: "", quantita: "", fnsku: "" }]);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="nuova-entrata-btn"><PackagePlus className="h-4 w-4 mr-2" /> Nuova entrata</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Annuncia arrivo merce</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="mt-1" data-testid="entrata-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pallet">Pallet</SelectItem>
                  <SelectItem value="scatola">Scatola</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>N. DDT</Label>
              <Input data-testid="entrata-ddt" value={ddt} onChange={(e) => setDdt(e.target.value)} className="mt-1 font-mono" placeholder="es. 123/2026" />
            </div>
            <div>
              <Label>Tracking</Label>
              <Input data-testid="entrata-tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} className="mt-1 font-mono" placeholder="codice corriere" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">Indica il DDT o il tracking per farmi riconoscere la spedizione in arrivo.</p>

          <div>
            <Label className="text-xs">Contenuto (EAN · quantità · FNSKU)</Label>
            <datalist id="ean-list">
              {referenze.map((r) => <option key={r.id} value={r.ean}>{r.titolo}</option>)}
            </datalist>
            <div className="mt-1 space-y-2">
              {righe.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`entrata-riga-${i}`}>
                  <Input list="ean-list" className="col-span-5 font-mono text-xs" data-testid={`entrata-ean-${i}`} value={r.ean} onChange={(e) => update(i, "ean", e.target.value)} placeholder="EAN" />
                  <Input type="number" min={1} className="col-span-2" data-testid={`entrata-qta-${i}`} value={r.quantita} onChange={(e) => update(i, "quantita", e.target.value)} placeholder="Q.tà" />
                  <Input className="col-span-4 font-mono text-xs" data-testid={`entrata-fnsku-${i}`} value={r.fnsku} onChange={(e) => update(i, "fnsku", e.target.value)} placeholder="FNSKU (opz.)" />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} disabled={righe.length === 1} data-testid={`entrata-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addRow} data-testid="entrata-add-row"><Plus className="h-4 w-4 mr-1" /> Aggiungi EAN</Button>
          </div>

          <div>
            <Label>Note</Label>
            <Textarea data-testid="entrata-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="entrata-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Annuncia entrata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// Dialog per aggiungere/modificare gli FNSKU delle righe DOPO aver creato l'entrata
function GestisciFnskuDialog({ entrata, onDone }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const v = {};
      entrata.righe.forEach((r) => (v[r.id] = r.fnsku || ""));
      setValues(v);
    }
  }, [open, entrata]);

  const mancanti = entrata.righe.filter((r) => !r.fnsku).length;

  const salva = async () => {
    setSaving(true);
    try {
      await Promise.all(
        entrata.righe
          .filter((r) => (values[r.id] || "") !== (r.fnsku || ""))
          .map((r) => api.put(`/entrate-righe/${r.id}`, { fnsku: values[r.id] || null }))
      );
      toast.success("FNSKU aggiornati");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" data-testid={`gestisci-fnsku-btn-${entrata.id}`}>
          <Barcode className="h-4 w-4 mr-2" />
          Gestisci FNSKU{mancanti > 0 ? ` (${mancanti} mancanti)` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>FNSKU dell'entrata</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Inserisci il codice FNSKU per ogni EAN. Il prep center genererà le etichette a barre da questi codici.
        </p>
        <div className="space-y-2 max-h-72 overflow-auto mt-2">
          {entrata.righe.map((r) => (
            <div key={r.id} className="flex items-center gap-2" data-testid={`gf-row-${r.id}`}>
              <div className="flex-1">
                <div className="font-mono text-xs">{r.ean}</div>
                <div className="text-[11px] text-muted-foreground">Q.tà {r.quantita}</div>
              </div>
              <Input
                data-testid={`gf-fnsku-${r.id}`}
                value={values[r.id] ?? ""}
                onChange={(e) => setValues({ ...values, [r.id]: e.target.value })}
                placeholder="es. X001ABCDE1"
                className="h-8 w-44 font-mono text-xs"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid={`gf-salva-${entrata.id}`}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salva FNSKU
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import ProcessTimeline from "@/components/ProcessTimeline";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, Save, FileText, Truck, Barcode, Plus, Trash2 } from "lucide-react";

export default function ClientEntrataDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entrata, setEntrata] = useState(null);
  const [form, setForm] = useState({ tipo: "pallet", colli: "1", ddt: "", tracking: "", note: "" });
  const [righe, setRighe] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get(`/entrate/${id}`).then((r) => {
      setEntrata(r.data);
      setForm({
        tipo: r.data.tipo || "pallet",
        colli: String(r.data.colli || 1),
        ddt: r.data.ddt || "",
        tracking: r.data.tracking || "",
        note: r.data.note || "",
      });
      setRighe((r.data.righe || []).map((row) => ({
        id: row.id,
        ean: row.ean || "",
        quantita: String(row.quantita || ""),
        fnsku: row.fnsku || "",
      })));
    }).catch((e) => {
      const s = e?.response?.status;
      if (s === 403) toast.error("Questa entrata non appartiene al tuo account.");
      else if (s === 404) toast.error("Entrata non trovata.");
      else if (s !== 401) toast.error("Impossibile caricare l'entrata.");
      navigate("/app/entrate");
    });
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const updateRiga = (index, key, value) => {
    const next = [...righe];
    next[index] = { ...next[index], [key]: value };
    setRighe(next);
  };

  const addRiga = () => setRighe([...righe, { ean: "", quantita: "", fnsku: "" }]);

  const eliminaRiga = async (index) => {
    const row = righe[index];
    if (!row.id) {
      setRighe(righe.filter((_, idx) => idx !== index));
      return;
    }
    if (!window.confirm("Eliminare questa riga dall'entrata?")) return;
    try {
      await api.delete(`/entrate-righe/${row.id}`);
      toast.success("Riga eliminata");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const eliminaEntrata = async () => {
    if (!window.confirm("Cancellare questa entrata e tutte le sue righe?")) return;
    try {
      await api.delete(`/entrate/${id}`);
      toast.success("Entrata cancellata");
      navigate("/app/entrate");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const salva = async () => {
    if (!entrata) return;
    const incomplete = righe.some((row) => (row.ean || row.quantita || row.fnsku) && (!row.ean || Number(row.quantita) <= 0));
    if (incomplete) {
      toast.error("Completa EAN e quantità, oppure elimina la riga.");
      return;
    }
    const valide = righe.filter((row) => row.ean && Number(row.quantita) > 0);
    if (!valide.length) {
      toast.error("Aggiungi almeno una riga con EAN e quantità");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/entrate/${entrata.id}`, {
        tipo: form.tipo,
        colli: Number(form.colli) || 1,
        ddt: optionalText(form.ddt),
        tracking: optionalText(form.tracking),
        note: form.note || "",
      });
      await Promise.all(valide.map((row) => (
        row.id
          ? api.put(`/entrate-righe/${row.id}`, { ean: row.ean, quantita: Number(row.quantita), fnsku: optionalText(row.fnsku) })
          : api.post("/entrate-righe", { entrata_id: entrata.id, ean: row.ean, quantita: Number(row.quantita), fnsku: optionalText(row.fnsku) })
      )));
      toast.success("Entrata salvata");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  if (!entrata) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const timeline = [
    { label: "Annunciata", date: entrata.data_annuncio, done: true, actor: "Cliente" },
    { label: "Ricevuta", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", current: entrata.stato === "in_attesa", actor: "Prep center" },
    { label: "A magazzino", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Dopo ricezione" },
    { label: "Archiviata", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Quando ricevuta" },
  ];

  return (
    <div className="space-y-6" data-testid="client-entrata-detail">
      <button onClick={() => navigate("/app/entrate")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4" /> Torna alle entrate
      </button>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-bold tracking-tight capitalize">{entrata.tipo}</h1>
            <StatusBadge stato={entrata.stato} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={salva} disabled={saving} data-testid="save-entrata-btn">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Salva entrata
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={eliminaEntrata} data-testid="delete-entrata-btn">
              <Trash2 className="h-4 w-4 mr-2" /> Cancella entrata
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-600">
          <span>Annunciata il {new Date(entrata.data_annuncio).toLocaleDateString("it-IT")}</span>
          {entrata.ddt && <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> DDT: <span className="font-mono">{entrata.ddt}</span></span>}
          {entrata.tracking && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Tracking: <span className="font-mono">{entrata.tracking}</span></span>}
        </div>
        <div className="flex items-center gap-1 mt-3 max-w-md">
          {FLUSSO_ENTRATA.map((s, i) => {
            const done = FLUSSO_ENTRATA.indexOf(entrata.stato) >= i;
            return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_ENTRATA[s].label} />;
          })}
        </div>
      </div>

      <ProcessTimeline title="Timeline entrata" description="Tracciamento della merce dal tuo annuncio al magazzino." steps={timeline} />

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold mb-3">Dati entrata</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
              <SelectTrigger className="mt-1" data-testid="edit-entrata-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pallet">Pallet</SelectItem>
                <SelectItem value="scatola">Scatola</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">N. colli</Label>
            <Input type="number" min={1} className="mt-1" data-testid="edit-entrata-colli" value={form.colli} onChange={(e) => setForm({ ...form, colli: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">DDT</Label>
            <Input className="mt-1 font-mono text-xs" data-testid="edit-entrata-ddt" value={form.ddt} onChange={(e) => setForm({ ...form, ddt: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Tracking</Label>
            <Input className="mt-1 font-mono text-xs" data-testid="edit-entrata-tracking" value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} />
          </div>
          <div className="md:col-span-5">
            <Label className="text-xs">Note</Label>
            <Textarea className="mt-1" data-testid="edit-entrata-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2"><Barcode className="h-5 w-5 text-blue-600" /> Righe prodotto</h2>
          <Button variant="outline" size="sm" onClick={addRiga} data-testid="cd-add-riga">
            <Plus className="h-4 w-4 mr-1" /> Aggiungi riga
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EAN</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {righe.map((row, index) => (
              <TableRow key={row.id || `new-${index}`} data-testid={`cd-riga-${row.id || index}`}>
                <TableCell>
                  <Input className="h-8 w-44 font-mono text-xs" value={row.ean} onChange={(e) => updateRiga(index, "ean", e.target.value)} data-testid={`cd-ean-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <Input type="number" min={1} className="h-8 w-24" value={row.quantita} onChange={(e) => updateRiga(index, "quantita", e.target.value)} data-testid={`cd-qta-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <Input className="h-8 w-44 font-mono text-xs" value={row.fnsku} onChange={(e) => updateRiga(index, "fnsku", e.target.value)} data-testid={`cd-fnsku-${row.id || index}`} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => eliminaRiga(index)} data-testid={`cd-del-riga-${row.id || index}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        Una volta che il prep center segna la merce come <b>arrivata</b>, la trovi nel tuo <b>Magazzino</b>. Da lì crea una <b>Preparazione</b> per farti spedire i prodotti.
      </div>
    </div>
  );
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

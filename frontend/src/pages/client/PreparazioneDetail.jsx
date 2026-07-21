import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import ProcessTimeline from "@/components/ProcessTimeline";
import { FLUSSO_PREP, STATI_PREP, SERVIZI } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, ClipboardList, Save, Trash2, Plus } from "lucide-react";

function isPreparazioneAttiva(prep) {
  return prep.stato === "richiesta" || prep.stato === "in_lavorazione";
}

function statoCliente(prep) {
  return isPreparazioneAttiva(prep) ? prep.stato : "spedito";
}

export default function ClientPreparazioneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prep, setPrep] = useState(null);
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get(`/preparazioni/${id}`).then((r) => {
      setPrep(r.data);
      setNote(r.data.note || "");
      setRighe((r.data.righe || []).map((rg) => ({
        id: rg.id,
        referenza_id: rg.referenza_id,
        titolo: rg.titolo || "",
        ean: rg.ean || "",
        sku: rg.sku || "",
        fnsku: rg.fnsku || "",
        quantita: String(rg.quantita || ""),
        servizi: rg.servizi || [],
      })));
    }).catch((e) => {
      const s = e?.response?.status;
      if (s === 403) toast.error("Questa preparazione non appartiene al tuo account.");
      else if (s === 404) toast.error("Preparazione non trovata.");
      else if (s !== 401) toast.error("Impossibile caricare la preparazione.");
      navigate("/app/preparazioni");
    });
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const updateRiga = (index, key, value) => {
    const next = [...righe];
    next[index] = { ...next[index], [key]: value };
    setRighe(next);
  };

  const toggleServ = (index, key) => {
    const next = [...righe];
    const set = new Set(next[index].servizi || []);
    set.has(key) ? set.delete(key) : set.add(key);
    next[index] = { ...next[index], servizi: [...set] };
    setRighe(next);
  };

  const addRiga = () => setRighe([...righe, { ean: "", sku: "", fnsku: "", quantita: "", servizi: [] }]);

  const eliminaRiga = async (index) => {
    const row = righe[index];
    if (!row.id) {
      setRighe(righe.filter((_, idx) => idx !== index));
      return;
    }
    if (!window.confirm("Eliminare questa riga dalla preparazione?")) return;
    try {
      await api.delete(`/preparazioni-righe/${row.id}`);
      toast.success("Riga eliminata");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const elimina = async () => {
    if (!window.confirm("Cancellare questa preparazione e tutte le sue righe?")) return;
    try {
      await api.delete(`/preparazioni/${id}`);
      toast.success("Preparazione cancellata");
      navigate("/app/preparazioni");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const salva = async () => {
    if (!prep) return;
    const incomplete = righe.some((row) => (row.ean || row.sku || row.fnsku || row.quantita) && (!row.ean || Number(row.quantita) <= 0));
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
      await api.put(`/preparazioni/${prep.id}`, { note });
      await Promise.all(valide.map((row) => (
        row.id
          ? api.put(`/preparazioni-righe/${row.id}`, {
            ean: row.ean,
            sku: optionalText(row.sku),
            fnsku: optionalText(row.fnsku),
            quantita: Number(row.quantita),
            servizi: row.servizi || [],
          })
          : api.post("/preparazioni-righe", {
            preparazione_id: prep.id,
            ean: row.ean,
            sku: optionalText(row.sku),
            fnsku: optionalText(row.fnsku),
            quantita: Number(row.quantita),
            servizi: row.servizi || [],
          })
      )));
      await Promise.all(valide
        .filter((row) => row.referenza_id && row.fnsku)
        .map((row) => api.put(`/referenze/${row.referenza_id}`, { fnsku: optionalText(row.fnsku) })));
      toast.success("Preparazione salvata");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  if (!prep) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const displayStato = statoCliente(prep);
  const order = ["richiesta", "in_lavorazione", "pronto", "spedito"];
  const currentIndex = order.indexOf(displayStato);
  const timeline = [
    { label: "Richiesta", date: prep.created_at, done: currentIndex >= 0 },
    { label: "In lavorazione", done: currentIndex >= 1, current: displayStato === "richiesta", empty: "Da avviare" },
    { label: "Pronta", date: prep.data_pronto, done: currentIndex >= 2, current: displayStato === "in_lavorazione", empty: "Da completare" },
    { label: "Completata", date: prep.data_spedito || prep.data_pronto, done: currentIndex >= 3, current: displayStato === "pronto", empty: "Da completare" },
  ];

  return (
    <div className="space-y-6" data-testid="client-prep-detail">
      <button onClick={() => navigate("/app/preparazioni")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4" /> Torna alle preparazioni
      </button>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-bold tracking-tight">Preparazione</h1>
            <StatusBadge stato={displayStato} tipo="prep" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={salva} disabled={saving} data-testid="save-prep-detail">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Salva preparazione
            </Button>
            <Button variant="outline" onClick={elimina} data-testid="delete-prep-detail" className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" /> Cancella preparazione
            </Button>
          </div>
        </div>
        <div className="text-sm text-slate-600 mt-1">Creata il {new Date(prep.created_at).toLocaleDateString("it-IT")}</div>
        <div className="flex items-center gap-1 mt-3 max-w-md">
          {FLUSSO_PREP.map((s, i) => {
            const done = FLUSSO_PREP.indexOf(displayStato) >= i;
            return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_PREP[s].label} />;
          })}
        </div>
      </div>

      <ProcessTimeline
        title="Timeline preparazione"
        description="Segui lo stato della tua richiesta senza chiedere aggiornamenti."
        steps={timeline}
      />

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold mb-3">Note preparazione</h2>
        <Label className="text-xs">Note</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} data-testid="edit-prep-note" className="mt-1" />
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-600" /> Prodotti e lavorazioni</h2>
          <Button variant="outline" size="sm" onClick={addRiga} data-testid="cprep-add-riga">
            <Plus className="h-4 w-4 mr-1" /> Aggiungi riga
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prodotto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>Lavorazioni</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {righe.map((row, index) => (
              <TableRow key={row.id || `new-${index}`} data-testid={`cprep-riga-${row.id || index}`}>
                <TableCell>
                  {row.titolo && <div className="mb-1 max-w-44 truncate text-xs font-semibold text-slate-900">{row.titolo}</div>}
                  <Input className="h-8 w-36 font-mono text-xs" value={row.ean} onChange={(e) => updateRiga(index, "ean", e.target.value)} data-testid={`cprep-ean-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <Input className="h-8 w-32 font-mono text-xs" value={row.sku} onChange={(e) => updateRiga(index, "sku", e.target.value)} data-testid={`cprep-sku-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <Input className="h-8 w-36 font-mono text-xs" value={row.fnsku} onChange={(e) => updateRiga(index, "fnsku", e.target.value)} data-testid={`cprep-fnsku-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <Input type="number" min={1} className="h-8 w-20" value={row.quantita} onChange={(e) => updateRiga(index, "quantita", e.target.value)} data-testid={`cprep-qta-${row.id || index}`} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-3">
                    {Object.keys(SERVIZI).map((key) => (
                      <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Checkbox checked={(row.servizi || []).includes(key)} onCheckedChange={() => toggleServ(index, key)} data-testid={`cprep-serv-${row.id || index}-${key}`} />
                        {SERVIZI[key].label}
                      </label>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => eliminaRiga(index)} data-testid={`cprep-del-riga-${row.id || index}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Le etichette Amazon e UPS si caricano sui <b>colli</b> nella sezione <b>Spedizioni</b>, quando il prep center li ha preparati.
        </p>
      </Card>
    </div>
  );
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

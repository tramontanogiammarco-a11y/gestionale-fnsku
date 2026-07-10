import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { FLUSSO_PREP, STATI_PREP, SERVIZI } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, ClipboardList, ChevronRight } from "lucide-react";

export default function ClientPreparazioni() {
  const [preps, setPreps] = useState(null);
  const [view, setView] = useState("attive");
  const navigate = useNavigate();

  const load = () => api.get("/preparazioni").then((r) => setPreps(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="client-preparazioni">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Preparazioni</h1>
          <p className="text-muted-foreground text-sm mt-1">Chiedi al prep center di preparare pezzi dal tuo magazzino, scegliendo le lavorazioni.</p>
        </div>
        <NuovaPreparazioneDialog onDone={load} />
      </div>

      {preps && (
        <div className="flex flex-wrap gap-2">
          {[
            ["attive", "Attive", preps.filter((p) => p.stato !== "spedito").length],
            ["archivio", "Archivio", preps.filter((p) => p.stato === "spedito").length],
          ].map(([key, label, count]) => (
            <Button key={key} size="sm" variant={view === key ? "default" : "outline"} onClick={() => setView(key)} data-testid={`prep-view-${key}`}>
              {label} <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{count}</span>
            </Button>
          ))}
        </div>
      )}

      {!preps ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : preps.filter((p) => view === "archivio" ? p.stato === "spedito" : p.stato !== "spedito").length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {view === "archivio" ? "Nessuna preparazione archiviata." : "Nessuna preparazione attiva. Creane una scegliendo EAN, FNSKU, quantità e lavorazioni."}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {preps.filter((p) => view === "archivio" ? p.stato === "spedito" : p.stato !== "spedito").map((p) => (
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
              <div className="flex items-center justify-between gap-2 mt-3">
                {p.stato === "richiesta" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-prep-${p.id}`}
                    className="text-destructive hover:text-destructive"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm("Cancellare questa preparazione? Potrai crearne una nuova subito dopo.")) return;
                      try {
                        await api.delete(`/preparazioni/${p.id}`);
                        toast.success("Preparazione cancellata");
                        load();
                      } catch (err) {
                        toast.error(formatApiError(err.response?.data?.detail));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Cancella
                  </Button>
                ) : <span />}
                <div className="flex items-center gap-1 text-xs font-medium text-blue-600">
                  Apri dettaglio<ChevronRight className="h-4 w-4" />
                </div>
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
  const [righe, setRighe] = useState([{ ean: "", fnsku: "", quantita: "", servizi: [] }]);
  const [tipoPrep, setTipoPrep] = useState("standard");
  const [gruppiAmazon, setGruppiAmazon] = useState([{ nome: "Gruppo 1", righe: [{ ean: "", quantita: "" }] }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) api.get("/magazzino").then((r) => setMagazzino(r.data)); }, [open]);

  const fnskuPerEan = (ean) => magazzino.find((m) => m.ean === ean)?.fnsku || "";
  const dispPerEan = (ean) => magazzino.find((m) => m.ean === ean)?.disponibile;

  const update = (i, k, v) => {
    const next = [...righe]; next[i][k] = v;
    if (k === "ean") next[i].fnsku = fnskuPerEan(v);
    setRighe(next);
  };
  const toggleServ = (i, key) => {
    const next = [...righe];
    const set = new Set(next[i].servizi);
    set.has(key) ? set.delete(key) : set.add(key);
    next[i].servizi = [...set];
    setRighe(next);
  };
  const addRow = () => setRighe([...righe, { ean: "", fnsku: "", quantita: "", servizi: [] }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));
  const updateGruppo = (i, k, v) => {
    const next = [...gruppiAmazon]; next[i][k] = v; setGruppiAmazon(next);
  };
  const updateGruppoRiga = (groupIndex, rowIndex, key, value) => {
    const next = [...gruppiAmazon];
    const rows = [...(next[groupIndex].righe || [])];
    rows[rowIndex] = { ...rows[rowIndex], [key]: value };
    next[groupIndex] = { ...next[groupIndex], righe: rows };
    setGruppiAmazon(next);
  };
  const addGruppo = () => setGruppiAmazon([...gruppiAmazon, { nome: `Gruppo ${gruppiAmazon.length + 1}`, righe: [{ ean: "", quantita: "" }] }]);
  const delGruppo = (i) => setGruppiAmazon(gruppiAmazon.filter((_, idx) => idx !== i));
  const addGruppoRiga = (groupIndex) => {
    const next = [...gruppiAmazon];
    next[groupIndex] = { ...next[groupIndex], righe: [...(next[groupIndex].righe || []), { ean: "", quantita: "" }] };
    setGruppiAmazon(next);
  };
  const delGruppoRiga = (groupIndex, rowIndex) => {
    const next = [...gruppiAmazon];
    const rows = (next[groupIndex].righe || []).filter((_, idx) => idx !== rowIndex);
    next[groupIndex] = { ...next[groupIndex], righe: rows.length ? rows : [{ ean: "", quantita: "" }] };
    setGruppiAmazon(next);
  };

  const totalePezzi = righe.reduce((sum, r) => sum + (Number(r.quantita) || 0), 0);
  const righeRichieste = righe
    .filter((r) => r.ean && Number(r.quantita) > 0)
    .map((r) => ({ ...r, quantita: Number(r.quantita), titolo: magazzino.find((m) => m.ean === r.ean)?.titolo || "" }));
  const richiestoPerEan = righeRichieste.reduce((acc, r) => {
    acc[r.ean] = (acc[r.ean] || 0) + r.quantita;
    return acc;
  }, {});
  const infoRichieste = Object.fromEntries(righeRichieste.map((r) => [r.ean, r]));
  const gruppiValidi = gruppiAmazon
    .map((g, index) => ({
      nome: (g.nome || `Gruppo ${index + 1}`).trim(),
      righe: (g.righe || [])
        .map((r) => {
          const info = infoRichieste[r.ean] || {};
          return {
            ean: r.ean,
            titolo: info.titolo || "",
            fnsku: info.fnsku || "",
            quantita: Number(r.quantita) || 0,
          };
        })
        .filter((r) => r.ean && r.quantita > 0),
    }))
    .filter((g) => g.righe.length > 0);
  const assegnatoPerEan = gruppiValidi.reduce((acc, g) => {
    g.righe.forEach((r) => { acc[r.ean] = (acc[r.ean] || 0) + r.quantita; });
    return acc;
  }, {});
  const totaleGruppi = Object.values(assegnatoPerEan).reduce((sum, value) => sum + value, 0);
  const erroriGruppi = [
    ...Object.entries(richiestoPerEan)
      .filter(([ean, qty]) => (assegnatoPerEan[ean] || 0) !== qty)
      .map(([ean, qty]) => `${ean}: richiesti ${qty}, nei gruppi ${assegnatoPerEan[ean] || 0}`),
    ...Object.keys(assegnatoPerEan)
      .filter((ean) => !richiestoPerEan[ean])
      .map((ean) => `${ean}: non presente nella preparazione`),
  ];

  const buildNote = () => {
    if (tipoPrep !== "gruppi_amazon") return note;
    const bloccoGruppi = `[GRUPPI AMAZON]\n${JSON.stringify({
      version: 2,
      totale: totalePezzi,
      gruppi: gruppiValidi,
    })}\n[/GRUPPI AMAZON]`;
    return note?.trim() ? `${bloccoGruppi}\n\nNote cliente:\n${note.trim()}` : bloccoGruppi;
  };

  const salva = async () => {
    const valide = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => ({ ean: r.ean, fnsku: r.fnsku || null, quantita: Number(r.quantita), servizi: r.servizi }));
    if (valide.length === 0) { toast.error("Aggiungi almeno una riga con EAN e quantità"); return; }
    if (tipoPrep === "gruppi_amazon") {
      if (gruppiValidi.length === 0) { toast.error("Aggiungi almeno un gruppo Amazon con referenza e quantità"); return; }
      if (erroriGruppi.length > 0) {
        toast.error(`Controlla i gruppi Amazon: ${erroriGruppi[0]}`);
        return;
      }
    }
    setSaving(true);
    try {
      await api.post("/preparazioni", { note: buildNote(), righe: valide });
      toast.success("Preparazione inviata al prep center");
      setOpen(false);
      setNote("");
      setRighe([{ ean: "", fnsku: "", quantita: "", servizi: [] }]);
      setTipoPrep("standard");
      setGruppiAmazon([{ nome: "Gruppo 1", righe: [{ ean: "", quantita: "" }] }]);
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
        <div className="space-y-4 max-h-[70vh] overflow-auto pr-1">
          <datalist id="mag-ean-list">
            {magazzino.map((m) => <option key={m.ean} value={m.ean}>{`${m.titolo || m.ean} (disp. ${m.disponibile})`}</option>)}
          </datalist>
          <datalist id="prep-ean-richiesti-list">
            {righeRichieste.map((r) => <option key={r.ean} value={r.ean}>{`${r.titolo || r.ean} · richiesti ${richiestoPerEan[r.ean]}`}</option>)}
          </datalist>
          <div>
            <Label className="text-xs">Righe (EAN · FNSKU · quantità · lavorazioni)</Label>
            <div className="mt-1 space-y-3">
              {righe.map((r, i) => {
                const disp = dispPerEan(r.ean);
                return (
                  <div key={i} className="rounded-md border border-border p-3" data-testid={`prep-riga-${i}`}>
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <Input list="mag-ean-list" className="col-span-5 font-mono text-xs" data-testid={`prep-ean-${i}`} value={r.ean} onChange={(e) => update(i, "ean", e.target.value)} placeholder="EAN" />
                      <Input className="col-span-4 font-mono text-xs" data-testid={`prep-fnsku-${i}`} value={r.fnsku} onChange={(e) => update(i, "fnsku", e.target.value)} placeholder="FNSKU" />
                      <Input type="number" min={1} className="col-span-2" data-testid={`prep-qta-${i}`} value={r.quantita} onChange={(e) => update(i, "quantita", e.target.value)} placeholder={disp != null ? `max ${disp}` : "Q.tà"} />
                      <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} disabled={righe.length === 1} data-testid={`prep-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 pl-1">
                      {Object.keys(SERVIZI).map((key) => (
                        <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <Checkbox checked={r.servizi.includes(key)} onCheckedChange={() => toggleServ(i, key)} data-testid={`prep-serv-${i}-${key}`} />
                          {SERVIZI[key].label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addRow} data-testid="prep-add-row"><Plus className="h-4 w-4 mr-1" /> Aggiungi riga</Button>
          </div>
          <div className="rounded-md border border-border p-3">
            <Label className="text-xs">Tipo preparazione</Label>
            <RadioGroup value={tipoPrep} onValueChange={setTipoPrep} className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex items-start gap-2 rounded-md border border-border bg-white p-3 cursor-pointer">
                <RadioGroupItem value="standard" className="mt-0.5" data-testid="prep-tipo-standard" />
                <span>
                  <span className="block text-sm font-semibold">Standard</span>
                  <span className="block text-xs text-muted-foreground">Preparazione unica, senza gruppi separati.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-border bg-white p-3 cursor-pointer">
                <RadioGroupItem value="gruppi_amazon" className="mt-0.5" data-testid="prep-tipo-gruppi-amazon" />
                <span>
                  <span className="block text-sm font-semibold">Gruppi Amazon</span>
                  <span className="block text-xs text-muted-foreground">Dividi i pezzi nei gruppi comunicati da Amazon.</span>
                </span>
              </label>
            </RadioGroup>
            {tipoPrep === "gruppi_amazon" && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-muted-foreground">Totale preparazione: {totalePezzi} pezzi</span>
                  <span className={erroriGruppi.length === 0 && totalePezzi > 0 ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                    Totale assegnato nei gruppi: {totaleGruppi}
                  </span>
                </div>
                {righeRichieste.length > 0 && (
                  <div className="rounded-md bg-slate-50 p-2 text-xs">
                    <div className="font-semibold text-slate-700 mb-1">Controllo referenze</div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {Object.entries(richiestoPerEan).map(([ean, qty]) => {
                        const assegnato = assegnatoPerEan[ean] || 0;
                        return (
                          <div key={ean} className={assegnato === qty ? "text-emerald-700" : "text-amber-700"}>
                            <span className="font-mono">{ean}</span>: {assegnato}/{qty} pz
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {gruppiAmazon.map((g, i) => (
                  <div key={i} className="rounded-md border border-border bg-white p-3 space-y-2" data-testid={`prep-gruppo-amazon-${i}`}>
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-11"
                        value={g.nome}
                        onChange={(e) => updateGruppo(i, "nome", e.target.value)}
                        placeholder={`Gruppo ${i + 1}`}
                        data-testid={`prep-gruppo-nome-${i}`}
                      />
                      <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delGruppo(i)} disabled={gruppiAmazon.length === 1} data-testid={`prep-gruppo-del-${i}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {(g.righe || []).map((gr, rowIndex) => (
                      <div key={rowIndex} className="grid grid-cols-12 gap-2 items-center" data-testid={`prep-gruppo-riga-${i}-${rowIndex}`}>
                        <Input
                          list="prep-ean-richiesti-list"
                          className="col-span-7 font-mono text-xs"
                          value={gr.ean}
                          onChange={(e) => updateGruppoRiga(i, rowIndex, "ean", e.target.value)}
                          placeholder="EAN referenza"
                          data-testid={`prep-gruppo-ean-${i}-${rowIndex}`}
                        />
                        <Input
                          type="number"
                          min={1}
                          className="col-span-4"
                          value={gr.quantita}
                          onChange={(e) => updateGruppoRiga(i, rowIndex, "quantita", e.target.value)}
                          placeholder="Pezzi"
                          data-testid={`prep-gruppo-qta-${i}-${rowIndex}`}
                        />
                        <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delGruppoRiga(i, rowIndex)} disabled={(g.righe || []).length === 1} data-testid={`prep-gruppo-riga-del-${i}-${rowIndex}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => addGruppoRiga(i)} data-testid={`prep-gruppo-riga-add-${i}`}>
                      <Plus className="h-4 w-4 mr-1" /> Aggiungi referenza al gruppo
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addGruppo} data-testid="prep-gruppo-add">
                  <Plus className="h-4 w-4 mr-1" /> Aggiungi gruppo
                </Button>
              </div>
            )}
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

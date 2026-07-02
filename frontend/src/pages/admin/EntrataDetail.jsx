import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { STATI_ENTRATA, STATI_BOX } from "@/lib/statuses";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, PackageCheck, Barcode, Plus, FileText, Save, Trash2,
} from "lucide-react";

// Messaggio d'errore chiaro per le azioni admin (gestisce il caso 403 sessione cliente)
function azioneErrore(e) {
  const status = e?.response?.status;
  if (status === 403) {
    return "Azione riservata all'amministratore. Sembra che tu sia collegato come cliente: esci e rientra con l'account admin.";
  }
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return "Operazione non riuscita. Riprova.";
}

export default function AdminEntrataDetail() {
  const { id } = useParams();
  const [entrata, setEntrata] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [fnskuEdit, setFnskuEdit] = useState({});
  const [selezione, setSelezione] = useState({});
  const [copie, setCopie] = useState({});
  const [formato, setFormato] = useState("50x30");
  const [formati, setFormati] = useState(["50x30"]);
  const [generando, setGenerando] = useState(false);

  const load = () => {
    api.get(`/entrate/${id}`).then((r) => {
      setEntrata(r.data);
      const fe = {}, cp = {};
      r.data.righe.forEach((rg) => { fe[rg.id] = rg.fnsku || ""; cp[rg.id] = 1; });
      setFnskuEdit(fe); setCopie(cp);
    });
    api.get(`/box?entrata_id=${id}`).then((r) => setBoxes(r.data));
  };
  useEffect(() => {
    load();
    api.get("/etichette/formati").then((r) => setFormati(r.data.formati));
  }, [id]);

  const ricevi = async () => {
    try {
      await api.post(`/entrate/${id}/ricevi`);
      toast.success("Entrata segnata come ricevuta");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  const cambiaStato = async (nuovo) => {
    // Non si può marcare "pronto" senza aver creato almeno un box (dove il cliente carica le etichette)
    if (nuovo === "pronto" && boxes.length === 0) {
      toast.error("Crea prima almeno un box (con dimensioni e peso): il cliente caricherà le etichette sui box.");
      return;
    }
    try {
      await api.put(`/entrate/${id}/stato`, { stato: nuovo });
      toast.success("Stato aggiornato");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  const salvaFnsku = async (rigaId) => {
    try {
      await api.put(`/entrate-righe/${rigaId}`, { fnsku: fnskuEdit[rigaId] || null });
      toast.success("FNSKU salvato");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  const generaEtichette = async () => {
    const selezionate = entrata.righe.filter((rg) => selezione[rg.id]);
    if (selezionate.length === 0) {
      toast.error("Seleziona almeno una riga");
      return;
    }
    // Il barcode si genera SOLO dall'FNSKU: segnala le righe che ne sono prive
    const senzaFnsku = selezionate.filter((rg) => !((fnskuEdit[rg.id] || rg.fnsku || "").trim()));
    if (senzaFnsku.length > 0) {
      toast.error(`Manca l'FNSKU per: ${senzaFnsku.map((r) => r.ean).join(", ")}. Inseriscilo (e salva) prima di generare.`);
      return;
    }
    const items = selezionate.map((rg) => ({
      fnsku: (fnskuEdit[rg.id] || rg.fnsku).trim(),
      titolo: rg.ean,
      copie: Number(copie[rg.id]) || 1,
    }));
    setGenerando(true);
    try {
      const res = await api.post("/etichette/genera", { items, formato, mostra_titolo: true }, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
      toast.success("PDF etichette generato");
    } catch (e) {
      // Mostra il motivo reale restituito dal backend (blob -> testo)
      let msg = "Errore nella generazione etichette";
      try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) {}
      toast.error(msg);
    } finally {
      setGenerando(false);
    }
  };

  if (!entrata)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="entrata-detail">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {entrata.cliente_ragione_sociale} · <span className="capitalize">{entrata.tipo}</span>
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge stato={entrata.stato} />
            <span className="text-xs text-muted-foreground">
              Annunciata il {new Date(entrata.data_annuncio).toLocaleDateString("it-IT")}
            </span>
          </div>
          {(entrata.ddt || entrata.tracking) && (
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              {entrata.ddt && <span className="text-slate-600">DDT: <span className="font-mono">{entrata.ddt}</span></span>}
              {entrata.tracking && <span className="text-slate-600">Tracking: <span className="font-mono">{entrata.tracking}</span></span>}
            </div>
          )}
          {entrata.note && <p className="text-sm text-muted-foreground mt-2">{entrata.note}</p>}
        </div>
        <div className="flex items-center gap-2">
          {entrata.stato === "in_attesa" && (
            <Button data-testid="ricevi-btn" onClick={ricevi}>
              <PackageCheck className="h-4 w-4 mr-2" /> Segna Ricevuto
            </Button>
          )}
          <Select value={entrata.stato} onValueChange={cambiaStato}>
            <SelectTrigger className="w-44" data-testid="entrata-stato-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(STATI_ENTRATA).map((s) => (
                <SelectItem key={s} value={s}>{STATI_ENTRATA[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Righe + generazione etichette */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-heading text-lg font-semibold">Righe (EAN · quantità · FNSKU)</h2>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Formato</Label>
            <Select value={formato} onValueChange={setFormato}>
              <SelectTrigger className="w-28" data-testid="formato-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {formati.map((f) => <SelectItem key={f} value={f}>{f} mm</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={generaEtichette} disabled={generando} data-testid="genera-etichette-btn">
              {generando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Barcode className="h-4 w-4 mr-2" />}
              Genera etichette
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead>Copie</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entrata.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`riga-${rg.id}`}>
                <TableCell>
                  <Checkbox
                    data-testid={`select-riga-${rg.id}`}
                    checked={!!selezione[rg.id]}
                    onCheckedChange={(v) => setSelezione({ ...selezione, [rg.id]: v })}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{rg.ean}</TableCell>
                <TableCell>{rg.quantita}</TableCell>
                <TableCell>
                  <Input
                    data-testid={`fnsku-input-${rg.id}`}
                    value={fnskuEdit[rg.id] ?? ""}
                    onChange={(e) => setFnskuEdit({ ...fnskuEdit, [rg.id]: e.target.value })}
                    placeholder="es. X001ABCDE1"
                    className="h-8 w-40 font-mono text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    data-testid={`copie-input-${rg.id}`}
                    value={copie[rg.id] ?? 1}
                    onChange={(e) => setCopie({ ...copie, [rg.id]: e.target.value })}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" data-testid={`save-fnsku-${rg.id}`} onClick={() => salvaFnsku(rg.id)}>
                    <Save className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          Seleziona le righe con FNSKU e clicca "Genera etichette" per il PDF Code128 stampabile.
        </p>
      </Card>

      {/* Box */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold">Box in uscita ({boxes.length})</h2>
          <NuovoBoxDialog entrata={entrata} onCreated={load} />
        </div>
        {boxes.length === 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="no-box-hint">
            Nessun box creato. Clicca <b>"Nuovo box"</b> per preparare una scatola indicando <b>dimensioni (L×W×H)</b>, <b>peso</b> e <b>contenuto</b>.
            Solo quando esiste almeno un box il cliente potrà caricare le etichette Amazon e UPS.
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {boxes.map((b) => (
            <BoxCard key={b.id} box={b} onChange={load} />
          ))}
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
      toast.error(azioneErrore(e));
    }
  };
  return (
    <Card className="p-4" data-testid={`box-card-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {box.peso_kg ? `${box.peso_kg} kg · ` : ""}
        {box.lunghezza_cm && box.larghezza_cm && box.altezza_cm
          ? `${box.lunghezza_cm}×${box.larghezza_cm}×${box.altezza_cm} cm`
          : "dimensioni n/d"}
      </div>
      <div className="text-xs mt-2">{box.contenuto?.length || 0} referenze nel box</div>
      <div className="flex flex-wrap gap-2 mt-3 text-xs">
        {box.etichetta_amazon_pdf_url && (
          <a href={fileUrl(box.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-blue-600" data-testid={`amazon-label-${box.id}`}>
            <FileText className="h-3 w-3" /> Etichetta Amazon
          </a>
        )}
        {box.etichetta_ups_pdf_url && (
          <a href={fileUrl(box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-blue-600" data-testid={`ups-label-${box.id}`}>
            <FileText className="h-3 w-3" /> Etichetta UPS
          </a>
        )}
      </div>
      <div className="mt-3">
        <Select value={box.stato} onValueChange={cambiaStato}>
          <SelectTrigger className="w-full h-8" data-testid={`box-stato-select-${box.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(STATI_BOX).map((s) => (
              <SelectItem key={s} value={s}>{STATI_BOX[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function NuovoBoxDialog({ entrata, onCreated }) {
  const [open, setOpen] = useState(false);
  const [numero, setNumero] = useState("");
  const [peso, setPeso] = useState("");
  const [dim, setDim] = useState({ l: "", w: "", h: "" });
  const [refs, setRefs] = useState([]);
  // Contenuto libero e multi-referenza: righe {ean, fnsku, quantita}
  const [righe, setRighe] = useState([{ ean: "", fnsku: "", quantita: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // referenze del cliente per popolare il menù EAN (box multi-referenza)
    api.get(`/referenze?cliente_id=${entrata.cliente_id}`).then((r) => setRefs(r.data));
    // precompila con gli EAN dell'entrata come comodità
    setRighe(entrata.righe.length
      ? entrata.righe.map((rg) => ({ ean: rg.ean, fnsku: rg.fnsku || "", quantita: "" }))
      : [{ ean: "", fnsku: "", quantita: "" }]);
  }, [open, entrata]);

  const fnskuPerEan = (ean) => {
    const r = refs.find((x) => x.ean === ean && x.fnsku);
    return r?.fnsku || "";
  };
  const update = (i, k, v) => {
    const next = [...righe]; next[i][k] = v;
    if (k === "ean" && !next[i].fnsku) next[i].fnsku = fnskuPerEan(v);
    setRighe(next);
  };
  const addRow = () => setRighe([...righe, { ean: "", fnsku: "", quantita: "" }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));

  const salva = async () => {
    if (!numero) { toast.error("Inserisci il numero box"); return; }
    const cont = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => ({ ean: r.ean, fnsku: r.fnsku || "", quantita: Number(r.quantita) }));
    if (cont.length === 0) { toast.error("Aggiungi almeno una referenza con quantità"); return; }
    setSaving(true);
    try {
      await api.post("/box", {
        entrata_id: entrata.id,
        numero_box: numero,
        peso_kg: peso ? Number(peso) : null,
        lunghezza_cm: dim.l ? Number(dim.l) : null,
        larghezza_cm: dim.w ? Number(dim.w) : null,
        altezza_cm: dim.h ? Number(dim.h) : null,
        contenuto: cont,
      });
      toast.success("Box creato");
      setOpen(false); setNumero(""); setPeso(""); setDim({ l: "", w: "", h: "" });
      onCreated();
    } catch (e) {
      toast.error(azioneErrore(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="nuovo-box-btn"><Plus className="h-4 w-4 mr-1" /> Nuovo box</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Nuovo box (multi-referenza)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Numero box</Label>
            <Input data-testid="box-numero-input" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="BOX-001" className="mt-1" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div><Label className="text-xs">Peso kg</Label><Input data-testid="box-peso-input" value={peso} onChange={(e) => setPeso(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">L cm</Label><Input value={dim.l} onChange={(e) => setDim({ ...dim, l: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">W cm</Label><Input value={dim.w} onChange={(e) => setDim({ ...dim, w: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">H cm</Label><Input value={dim.h} onChange={(e) => setDim({ ...dim, h: e.target.value })} className="mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs">Contenuto — aggiungi una o più referenze (EAN · FNSKU · quantità)</Label>
            <datalist id="box-ean-list">
              {refs.map((r) => <option key={r.id} value={r.ean}>{`${r.titolo || r.ean}`}</option>)}
            </datalist>
            <div className="mt-1 space-y-2 max-h-56 overflow-auto">
              {righe.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`box-cont-row-${i}`}>
                  <Input list="box-ean-list" className="col-span-5 font-mono text-xs" data-testid={`box-cont-ean-${i}`} value={r.ean} onChange={(e) => update(i, "ean", e.target.value)} placeholder="EAN" />
                  <Input className="col-span-4 font-mono text-xs" data-testid={`box-cont-fnsku-${i}`} value={r.fnsku} onChange={(e) => update(i, "fnsku", e.target.value)} placeholder="FNSKU" />
                  <Input type="number" min={0} className="col-span-2" data-testid={`box-cont-qta-${i}`} value={r.quantita} onChange={(e) => update(i, "quantita", e.target.value)} placeholder="Q.tà" />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} disabled={righe.length === 1} data-testid={`box-cont-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addRow} data-testid="box-cont-add"><Plus className="h-4 w-4 mr-1" /> Aggiungi referenza</Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="box-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crea box
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

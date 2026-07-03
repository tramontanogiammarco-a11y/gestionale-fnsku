import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { toast } from "sonner";
import { STATI_BOX } from "@/lib/statuses";
import { StatusBadge } from "@/components/StatusBadge";
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
import { Loader2, Plus, FileText, Trash2, Boxes as BoxesIcon, ClipboardList } from "lucide-react";

function azioneErrore(e) {
  if (e?.response?.status === 403)
    return "Azione riservata all'amministratore: esci e rientra come admin.";
  return e?.response?.data?.detail || "Operazione non riuscita.";
}

// Componi box a livello di CLIENTE pescando SOLO dalla merce in preparazione
// (richiesta nelle Preparazioni). Un box può mescolare SKU di richieste diverse.
export default function AdminComposizioneBox() {
  const [clienti, setClienti] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [preparato, setPreparato] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/clienti").then((r) => setClienti(r.data)); }, []);

  const load = (cid) => {
    if (!cid) return;
    setLoading(true);
    Promise.all([
      api.get(`/preparato?cliente_id=${cid}`),
      api.get(`/box?cliente_id=${cid}`),
    ])
      .then(([p, b]) => { setPreparato(p.data); setBoxes(b.data); })
      .catch((e) => toast.error(azioneErrore(e)))
      .finally(() => setLoading(false));
  };

  const onSelectCliente = (cid) => { setClienteId(cid); load(cid); };

  const cambiaStatoBox = async (id, stato) => {
    try {
      await api.put(`/box/${id}/stato`, { stato });
      toast.success("Stato box aggiornato");
      load(clienteId);
    } catch (e) { toast.error(azioneErrore(e)); }
  };

  const imballabili = preparato.filter((m) => m.disponibile > 0);

  return (
    <div className="space-y-6" data-testid="admin-composizione-box">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight flex items-center gap-2">
            <BoxesIcon className="h-7 w-7 text-blue-600" /> Composizione Box
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Componi i colli usando <b>solo la merce in preparazione</b> del cliente. Un box può contenere SKU di richieste diverse.
          </p>
        </div>
        <div className="w-72">
          <Label className="text-xs">Cliente</Label>
          <Select value={clienteId} onValueChange={onSelectCliente}>
            <SelectTrigger className="mt-1" data-testid="comp-cliente-select"><SelectValue placeholder="Seleziona un cliente" /></SelectTrigger>
            <SelectContent>
              {clienti.map((c) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!clienteId ? (
        <Card className="p-10 text-center text-muted-foreground" data-testid="comp-empty-hint">
          Seleziona un cliente per vedere la merce in preparazione e comporre i box.
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* Merce in preparazione (imballabile) */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-blue-600" /> Merce in preparazione
              </h2>
              <NuovoBoxClienteDialog clienteId={clienteId} imballabili={imballabili} onCreated={() => load(clienteId)} />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EAN</TableHead>
                  <TableHead>Prodotto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Richiesto</TableHead>
                  <TableHead className="text-right">In box</TableHead>
                  <TableHead className="text-right">Da imballare</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preparato.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nessuna merce in preparazione. Il cliente deve prima creare una richiesta di preparazione.
                  </TableCell></TableRow>
                )}
                {preparato.map((m) => (
                  <TableRow key={m.ean} data-testid={`comp-prep-${m.ean}`}>
                    <TableCell className="font-mono text-xs">{m.ean}</TableCell>
                    <TableCell className="max-w-xs truncate">{m.titolo || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{m.skus.join(", ") || "—"}</TableCell>
                    <TableCell className="text-right">{m.richiesto}</TableCell>
                    <TableCell className="text-right text-orange-600">{m.in_box}</TableCell>
                    <TableCell className="text-right font-bold text-emerald-700">{m.disponibile}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Box del cliente */}
          <div>
            <h2 className="font-heading text-lg font-semibold mb-3">Box del cliente ({boxes.length})</h2>
            {boxes.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="comp-no-box">
                Nessun box. Clicca <b>"Nuovo box"</b> per comporre un collo dalla merce in preparazione.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {boxes.map((b) => (
                  <Card className="p-4" key={b.id} data-testid={`comp-box-${b.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-heading font-semibold font-mono">{b.numero_box}</div>
                      <StatusBadge stato={b.stato} tipo="box" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {b.peso_kg ? `${b.peso_kg} kg · ` : ""}
                      {b.lunghezza_cm && b.larghezza_cm && b.altezza_cm
                        ? `${b.lunghezza_cm}×${b.larghezza_cm}×${b.altezza_cm} cm` : "dimensioni n/d"}
                    </div>
                    {b.contenuto?.length > 0 && (
                      <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
                        {b.contenuto.map((c, i) => (
                          <div key={i} className="flex justify-between py-0.5">
                            <span className="font-mono">{c.ean}{c.sku ? ` · ${c.sku}` : ""}</span>
                            <span>×{c.quantita}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      {b.etichetta_amazon_pdf_url && <a href={fileUrl(b.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600"><FileText className="h-3 w-3" /> Amazon</a>}
                      {b.etichetta_ups_pdf_url && <a href={fileUrl(b.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-600"><FileText className="h-3 w-3" /> UPS</a>}
                    </div>
                    <div className="mt-3">
                      <Select value={b.stato} onValueChange={(v) => cambiaStatoBox(b.id, v)}>
                        <SelectTrigger className="w-full h-8" data-testid={`comp-box-stato-${b.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(STATI_BOX).map((s) => <SelectItem key={s} value={s}>{STATI_BOX[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NuovoBoxClienteDialog({ clienteId, imballabili, onCreated }) {
  const [open, setOpen] = useState(false);
  const [numero, setNumero] = useState("");
  const [peso, setPeso] = useState("");
  const [dim, setDim] = useState({ l: "", w: "", h: "" });
  const [righe, setRighe] = useState([{ ean: "", quantita: "" }]);
  const [saving, setSaving] = useState(false);

  const infoEan = (ean) => imballabili.find((x) => x.ean === ean);
  const libero = (ean) => { const m = infoEan(ean); return m ? m.disponibile : 0; };

  const update = (i, k, v) => { const n = [...righe]; n[i][k] = v; setRighe(n); };
  const addRow = () => setRighe([...righe, { ean: "", quantita: "" }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));

  const salva = async () => {
    if (!numero) { toast.error("Inserisci il numero box"); return; }
    const cont = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => {
        const info = infoEan(r.ean);
        return { ean: r.ean, sku: info?.skus?.[0] || null, fnsku: "", quantita: Number(r.quantita) };
      });
    if (cont.length === 0) { toast.error("Aggiungi almeno una referenza con quantità"); return; }
    const eccesso = cont.find((c) => c.quantita > libero(c.ean));
    if (eccesso) { toast.error(`Quantità oltre la merce in preparazione per EAN ${eccesso.ean} (max ${libero(eccesso.ean)}).`); return; }
    setSaving(true);
    try {
      await api.post("/box", {
        cliente_id: clienteId,
        numero_box: numero,
        peso_kg: peso ? Number(peso) : null,
        lunghezza_cm: dim.l ? Number(dim.l) : null,
        larghezza_cm: dim.w ? Number(dim.w) : null,
        altezza_cm: dim.h ? Number(dim.h) : null,
        contenuto: cont,
      });
      toast.success("Box creato");
      setOpen(false); setNumero(""); setPeso(""); setDim({ l: "", w: "", h: "" }); setRighe([{ ean: "", quantita: "" }]);
      onCreated();
    } catch (e) {
      toast.error(azioneErrore(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={imballabili.length === 0} data-testid="comp-nuovo-box-btn">
          <Plus className="h-4 w-4 mr-1" /> Nuovo box
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Nuovo box (multi-referenza)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Numero box</Label>
            <Input data-testid="comp-box-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="BOX-001" className="mt-1" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div><Label className="text-xs">Peso kg</Label><Input data-testid="comp-box-peso" value={peso} onChange={(e) => setPeso(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">L cm</Label><Input value={dim.l} onChange={(e) => setDim({ ...dim, l: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">W cm</Label><Input value={dim.w} onChange={(e) => setDim({ ...dim, w: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">H cm</Label><Input value={dim.h} onChange={(e) => setDim({ ...dim, h: e.target.value })} className="mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs">Contenuto — aggiungi referenze dalla merce in preparazione</Label>
            <div className="mt-1 space-y-2 max-h-64 overflow-auto">
              {righe.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`comp-cont-row-${i}`}>
                  <div className="col-span-8">
                    <Select value={r.ean} onValueChange={(v) => update(i, "ean", v)}>
                      <SelectTrigger className="h-9" data-testid={`comp-cont-ean-${i}`}><SelectValue placeholder="Scegli EAN / SKU" /></SelectTrigger>
                      <SelectContent>
                        {imballabili.map((m) => (
                          <SelectItem key={m.ean} value={m.ean}>
                            {m.ean}{m.skus?.length ? ` · ${m.skus.join("/")}` : ""} — {m.titolo || ""} (da imballare {m.disponibile})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input type="number" min={0} className="col-span-3" data-testid={`comp-cont-qta-${i}`} value={r.quantita} onChange={(e) => update(i, "quantita", e.target.value)} placeholder="Q.tà" />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} disabled={righe.length === 1} data-testid={`comp-cont-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addRow} data-testid="comp-cont-add"><Plus className="h-4 w-4 mr-1" /> Aggiungi referenza</Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="comp-box-salva">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crea box
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

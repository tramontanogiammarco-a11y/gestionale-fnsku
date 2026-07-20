import { useEffect, useMemo, useState } from "react";
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
import { Loader2, Plus, FileText, Trash2, Boxes as BoxesIcon, ClipboardList, Copy, Pencil } from "lucide-react";

function azioneErrore(e) {
  if (e?.response?.status === 403)
    return "Azione riservata all'amministratore: esci e rientra come admin.";
  return e?.response?.data?.detail || "Operazione non riuscita.";
}

function skusFor(item) {
  if (Array.isArray(item?.skus)) return item.skus.filter(Boolean);
  return item?.sku ? [item.sku] : [];
}

function numeroOrNull(value) {
  const clean = String(value || "").replace(",", ".").trim();
  return clean ? Number(clean) : null;
}

function quantitaBox(box, ean) {
  return (box?.contenuto || [])
    .filter((c) => c.ean === ean)
    .reduce((sum, c) => sum + Number(c.quantita || 0), 0);
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
                  <TableHead>Prodotto / EAN</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Richiesto</TableHead>
                  <TableHead className="text-right">In box</TableHead>
                  <TableHead className="text-right">Da imballare</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imballabili.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Nessuna merce da imballare. Il cliente deve prima mettere una preparazione in pronto oppure la merce risulta gia boxata.
                  </TableCell></TableRow>
                )}
                {imballabili.map((m) => (
                  <TableRow key={m.ean} data-testid={`comp-prep-${m.ean}`}>
                    <TableCell>
                      <div className="max-w-xs truncate text-sm font-medium">{m.titolo || "Titolo non disponibile"}</div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">EAN {m.ean || "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{skusFor(m).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right">{m.richiesto}</TableCell>
                    <TableCell className="text-right text-orange-600">{m.in_box}</TableCell>
                    <TableCell className={`text-right font-bold ${m.disponibile > 0 ? "text-emerald-700" : "text-slate-500"}`}>{m.disponibile}</TableCell>
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
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-heading font-semibold font-mono">{b.numero_box}</div>
                        <div className="mt-1"><StatusBadge stato={b.stato} tipo="box" /></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <BoxFormDialog
                          mode="edit"
                          clienteId={clienteId}
                          imballabili={imballabili}
                          box={b}
                          onDone={() => load(clienteId)}
                          trigger={(
                            <Button size="sm" variant="outline" data-testid={`comp-box-edit-${b.id}`}>
                              <Pencil className="h-4 w-4 mr-1" /> Modifica
                            </Button>
                          )}
                        />
                        <BoxFormDialog
                          mode="duplicate"
                          clienteId={clienteId}
                          imballabili={imballabili}
                          box={b}
                          onDone={() => load(clienteId)}
                          trigger={(
                            <Button size="sm" variant="outline" data-testid={`comp-box-duplicate-${b.id}`}>
                              <Copy className="h-4 w-4 mr-1" /> Duplica
                            </Button>
                          )}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {b.peso_kg ? `${b.peso_kg} kg · ` : ""}
                      {b.lunghezza_cm && b.larghezza_cm && b.altezza_cm
                        ? `${b.lunghezza_cm}×${b.larghezza_cm}×${b.altezza_cm} cm` : "dimensioni n/d"}
                      {b.scatola_tipo && b.scatola_tipo !== "cliente" ? ` · Scatola nostra ${b.scatola_tipo}` : " · Scatola cliente"}
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
                      {b.etichetta_amazon_pdf_url && b.etichetta_amazon_pdf_url === b.etichetta_ups_pdf_url ? (
                        <a href={fileUrl(b.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-600"><FileText className="h-3 w-3" /> Etichette</a>
                      ) : (
                        <>
                          {b.etichetta_amazon_pdf_url && <a href={fileUrl(b.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600"><FileText className="h-3 w-3" /> Amazon</a>}
                          {b.etichetta_ups_pdf_url && <a href={fileUrl(b.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-600"><FileText className="h-3 w-3" /> UPS</a>}
                        </>
                      )}
                    </div>
                    <div className="mt-2">
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
  return (
    <BoxFormDialog
      mode="create"
      clienteId={clienteId}
      imballabili={imballabili}
      onDone={onCreated}
      trigger={(
        <Button size="sm" disabled={imballabili.length === 0} data-testid="comp-nuovo-box-btn">
          <Plus className="h-4 w-4 mr-1" /> Nuovo box
        </Button>
      )}
    />
  );
}

function BoxFormDialog({ mode, clienteId, imballabili, box, onDone, trigger }) {
  const [open, setOpen] = useState(false);
  const [numero, setNumero] = useState("");
  const [peso, setPeso] = useState("");
  const [dim, setDim] = useState({ l: "", w: "", h: "" });
  const [scatolaTipo, setScatolaTipo] = useState("cliente");
  const [righe, setRighe] = useState([{ ean: "", quantita: "" }]);
  const [saving, setSaving] = useState(false);
  const isEdit = mode === "edit";
  const isDuplicate = mode === "duplicate";
  const sourceContent = useMemo(() => box?.contenuto || [], [box]);
  const optionMap = new Map();

  imballabili.forEach((m) => optionMap.set(m.ean, m));
  sourceContent.forEach((c) => {
    if (!optionMap.has(c.ean)) {
      optionMap.set(c.ean, {
        ean: c.ean,
        sku: c.sku,
        skus: c.sku ? [c.sku] : [],
        fnsku: c.fnsku,
        titolo: "gia in questo box",
        disponibile: 0,
      });
    }
  });
  const opzioni = Array.from(optionMap.values());

  useEffect(() => {
    if (!open) return;
    if (box) {
      setNumero(isDuplicate ? "" : box.numero_box || "");
      setPeso(box.peso_kg ? String(box.peso_kg) : "");
      setDim({
        l: box.lunghezza_cm ? String(box.lunghezza_cm) : "",
        w: box.larghezza_cm ? String(box.larghezza_cm) : "",
        h: box.altezza_cm ? String(box.altezza_cm) : "",
      });
      setScatolaTipo(box.scatola_tipo || "cliente");
      setRighe(sourceContent.length
        ? sourceContent.map((c) => ({
          ean: c.ean || "",
          sku: c.sku || "",
          fnsku: c.fnsku || "",
          quantita: c.quantita ? String(c.quantita) : "",
        }))
        : [{ ean: "", quantita: "" }]);
    } else {
      setNumero("");
      setPeso("");
      setDim({ l: "", w: "", h: "" });
      setScatolaTipo("cliente");
      setRighe([{ ean: "", quantita: "" }]);
    }
  }, [open, box, isDuplicate, sourceContent]);

  const onScatola = (v) => {
    setScatolaTipo(v);
    if (v === "60x40x40") setDim({ l: "60", w: "40", h: "40" });
    else if (v === "40x30x30") setDim({ l: "40", w: "30", h: "30" });
  };

  const infoEan = (ean) => optionMap.get(ean);
  const libero = (ean) => {
    const m = imballabili.find((x) => x.ean === ean);
    return Number(m?.disponibile || 0) + ((isEdit || isDuplicate) ? quantitaBox(box, ean) : 0);
  };

  const update = (i, k, v) => {
    const n = [...righe];
    n[i][k] = v;
    if (k === "ean") {
      const info = infoEan(v);
      n[i].sku = skusFor(info)[0] || "";
      n[i].fnsku = info?.fnsku || "";
    }
    setRighe(n);
  };
  const addRow = () => setRighe([...righe, { ean: "", quantita: "" }]);
  const delRow = (i) => setRighe(righe.filter((_, idx) => idx !== i));

  const salva = async () => {
    if (!numero) { toast.error("Inserisci il numero box"); return; }
    const cont = righe
      .filter((r) => r.ean && Number(r.quantita) > 0)
      .map((r) => {
        const info = infoEan(r.ean);
        return { ean: r.ean, sku: skusFor(info)[0] || r.sku || null, fnsku: info?.fnsku || r.fnsku || "", quantita: Number(r.quantita) };
      });
    if (cont.length === 0) { toast.error("Aggiungi almeno una referenza con quantità"); return; }
    const totali = cont.reduce((acc, c) => ({ ...acc, [c.ean]: (acc[c.ean] || 0) + c.quantita }), {});
    const eccesso = Object.entries(totali).find(([ean, qta]) => qta > libero(ean));
    if (eccesso) { toast.error(`Quantità oltre la merce in preparazione per EAN ${eccesso[0]} (max ${libero(eccesso[0])}).`); return; }
    setSaving(true);
    try {
      const payload = {
        cliente_id: clienteId,
        numero_box: numero,
        peso_kg: numeroOrNull(peso),
        lunghezza_cm: numeroOrNull(dim.l),
        larghezza_cm: numeroOrNull(dim.w),
        altezza_cm: numeroOrNull(dim.h),
        scatola_tipo: scatolaTipo,
        contenuto: cont,
      };
      if (isEdit) await api.put(`/box/${box.id}`, payload);
      else await api.post("/box", payload);
      toast.success(isEdit ? "Box aggiornato" : "Box creato");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(azioneErrore(e));
    } finally { setSaving(false); }
  };

  const titolo = isEdit ? "Modifica box" : isDuplicate ? "Duplica box" : "Nuovo box (multi-referenza)";
  const salvaLabel = isEdit ? "Salva modifiche" : isDuplicate ? "Duplica box" : "Crea box";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{titolo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Numero box</Label>
            <Input data-testid="comp-box-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="BOX-001" className="mt-1" />
            {isDuplicate && <div className="mt-1 text-xs text-muted-foreground">Stesso contenuto di {box?.numero_box}: cambia solo il numero e salva.</div>}
          </div>
          <div>
            <Label className="text-xs">Scatola</Label>
            <Select value={scatolaTipo} onValueChange={onScatola}>
              <SelectTrigger className="mt-1" data-testid="comp-scatola-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cliente">Scatola del cliente (nessun costo)</SelectItem>
                <SelectItem value="60x40x40">Scatola nostra — 60×40×40 cm</SelectItem>
                <SelectItem value="40x30x30">Scatola nostra — 40×30×30 cm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div><Label className="text-xs">Peso kg</Label><Input data-testid="comp-box-peso" value={peso} onChange={(e) => setPeso(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">L cm</Label><Input disabled={scatolaTipo !== "cliente"} value={dim.l} onChange={(e) => setDim({ ...dim, l: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">W cm</Label><Input disabled={scatolaTipo !== "cliente"} value={dim.w} onChange={(e) => setDim({ ...dim, w: e.target.value })} className="mt-1" /></div>
            <div><Label className="text-xs">H cm</Label><Input disabled={scatolaTipo !== "cliente"} value={dim.h} onChange={(e) => setDim({ ...dim, h: e.target.value })} className="mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs">Contenuto — aggiungi referenze dalla merce in preparazione</Label>
            <div className="mt-1 space-y-2 max-h-64 overflow-auto">
              {righe.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`comp-cont-row-${i}`}>
                  <div className="col-span-8">
                    <Select value={r.ean} onValueChange={(v) => update(i, "ean", v)}>
                      <SelectTrigger className="h-9" data-testid={`comp-cont-ean-${i}`}><SelectValue placeholder="Scegli prodotto / EAN / SKU" /></SelectTrigger>
                      <SelectContent>
                        {opzioni.map((m) => (
                          <SelectItem key={m.ean} value={m.ean}>
                            {m.titolo || "Titolo non disponibile"} — EAN {m.ean}{skusFor(m).length ? ` · SKU ${skusFor(m).join("/")}` : ""} (max {libero(m.ean)})
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
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {salvaLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

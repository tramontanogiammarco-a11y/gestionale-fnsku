import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Upload, ImageOff, Save, Image, Trash2, Package, Layers } from "lucide-react";

export default function ClientReferenze() {
  const [referenze, setReferenze] = useState(null);
  const [fnskuEdit, setFnskuEdit] = useState({});

  const load = () =>
    api.get("/referenze").then((r) => {
      setReferenze(r.data);
      const fe = {}; r.data.forEach((x) => (fe[x.id] = x.fnsku || "")); setFnskuEdit(fe);
    });
  useEffect(() => { load(); }, []);

  const salvaFnsku = async (id) => {
    await api.put(`/referenze/${id}`, { fnsku: fnskuEdit[id] || null });
    toast.success("FNSKU salvato");
    load();
  };

  const uploadFoto = async (id, file) => {
    const fd = new FormData(); fd.append("file", file);
    await api.post(`/referenze/${id}/foto`, fd);
    toast.success("Foto caricata");
    load();
  };

  return (
    <div className="space-y-6" data-testid="client-referenze">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Le mie referenze</h1>
          <p className="text-muted-foreground text-sm mt-1">Prodotti da inviare al prep center.</p>
        </div>
        <div className="flex gap-2">
          <ImportDialog onDone={load} />
          <AddDialog onDone={load} referenze={referenze || []} />
        </div>
      </div>

      <Card>
        {!referenze ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead>Titolo</TableHead>
                <TableHead>EAN</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>FNSKU</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referenze.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Nessuna referenza. Aggiungine una o importa un file.</TableCell></TableRow>
              )}
              {referenze.map((r) => (
                <TableRow key={r.id} data-testid={`cref-row-${r.id}`}>
                  <TableCell>
                    <FotoCell ref_id={r.id} url={r.foto_url} onUpload={uploadFoto} />
                  </TableCell>
                  <TableCell className="font-medium max-w-xs truncate">
                    <div className="flex items-center gap-2">
                      {r.is_bundle && (
                        <Badge variant="secondary" className="gap-1 shrink-0" data-testid={`cref-bundle-badge-${r.id}`}>
                          <Layers className="h-3 w-3" /> Bundle
                        </Badge>
                      )}
                      <span className="truncate">{r.titolo}</span>
                    </div>
                    {r.is_bundle && r.componenti?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground font-normal mt-0.5">
                        {r.componenti.map((c) => `${c.quantita}× ${c.ean}`).join(" + ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku || "—"}</TableCell>
                  <TableCell>
                    <Input
                      data-testid={`cref-fnsku-${r.id}`}
                      value={fnskuEdit[r.id] ?? ""}
                      onChange={(e) => setFnskuEdit({ ...fnskuEdit, [r.id]: e.target.value })}
                      placeholder="es. X001ABCDE1"
                      className="h-8 w-40 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" data-testid={`cref-save-${r.id}`} onClick={() => salvaFnsku(r.id)}><Save className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function FotoCell({ ref_id, url, onUpload }) {
  const inputRef = useRef();
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
             data-testid={`cref-foto-input-${ref_id}`}
             onChange={(e) => e.target.files[0] && onUpload(ref_id, e.target.files[0])} />
      {url ? (
        <img src={fileUrl(url)} alt="" className="h-10 w-10 rounded object-cover border cursor-pointer" onClick={() => inputRef.current.click()} />
      ) : (
        <button onClick={() => inputRef.current.click()} data-testid={`cref-foto-btn-${ref_id}`}
                className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center hover:bg-slate-200">
          <Image className="h-4 w-4 text-slate-400" />
        </button>
      )}
    </>
  );
}

function AddDialog({ onDone, referenze }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ean: "", titolo: "", sku: "", asin: "", fnsku: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isBundle, setIsBundle] = useState(false);
  const [componenti, setComponenti] = useState([{ ean: "", quantita: "1" }]);

  // Prodotti selezionabili come componenti (esclusi altri bundle)
  const prodotti = (referenze || []).filter((r) => !r.is_bundle);

  const reset = () => {
    setForm({ ean: "", titolo: "", sku: "", asin: "", fnsku: "" });
    setFile(null); setIsBundle(false); setComponenti([{ ean: "", quantita: "1" }]);
  };

  const updComp = (i, k, v) => { const n = [...componenti]; n[i][k] = v; setComponenti(n); };
  const addComp = () => setComponenti([...componenti, { ean: "", quantita: "1" }]);
  const delComp = (i) => setComponenti(componenti.filter((_, idx) => idx !== i));

  const salva = async () => {
    if (!form.ean || !form.titolo) { toast.error("EAN e titolo sono obbligatori"); return; }
    let comps = [];
    if (isBundle) {
      comps = componenti
        .filter((c) => c.ean && Number(c.quantita) > 0)
        .map((c) => ({ ean: c.ean, quantita: Number(c.quantita) }));
      if (comps.length === 0) { toast.error("Aggiungi almeno un componente al bundle"); return; }
    }
    setSaving(true);
    try {
      const { data } = await api.post("/referenze", {
        ...form, is_bundle: isBundle, componenti: comps,
      });
      if (file) {
        const fd = new FormData(); fd.append("file", file);
        await api.post(`/referenze/${data.id}/foto`, fd);
      }
      toast.success(isBundle ? "Bundle creato" : "Referenza aggiunta");
      setOpen(false); reset();
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button data-testid="add-ref-btn"><Plus className="h-4 w-4 mr-2" /> Aggiungi</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isBundle ? "Nuovo bundle" : "Nuova referenza"}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
          <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 cursor-pointer">
            <Checkbox checked={isBundle} onCheckedChange={(v) => setIsBundle(!!v)} data-testid="add-is-bundle" />
            <div>
              <div className="text-sm font-medium flex items-center gap-1.5"><Package className="h-4 w-4" /> Questo è un bundle</div>
              <div className="text-xs text-muted-foreground">Unisce più prodotti esistenti (es. X + Y) in un'unica referenza Amazon con EAN e FNSKU propri.</div>
            </div>
          </label>

          <div><Label>EAN (del bundle) *</Label><Input data-testid="add-ean" value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} className="mt-1 font-mono" /></div>
          <div><Label>Titolo *</Label><Input data-testid="add-titolo" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>SKU</Label><Input data-testid="add-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="mt-1 font-mono" /></div>
            <div><Label>ASIN</Label><Input data-testid="add-asin" value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} className="mt-1 font-mono" /></div>
          </div>
          <div><Label>FNSKU</Label><Input data-testid="add-fnsku" value={form.fnsku} onChange={(e) => setForm({ ...form, fnsku: e.target.value })} className="mt-1 font-mono" placeholder="opzionale, aggiungibile dopo" /></div>

          {isBundle && (
            <div className="rounded-md border border-border p-3 space-y-2" data-testid="bundle-componenti">
              <Label className="text-xs">Componenti del bundle (prodotto · quantità per bundle)</Label>
              {prodotti.length === 0 && (
                <div className="text-xs text-amber-600">Nessun prodotto disponibile. Crea prima i prodotti singoli, poi il bundle.</div>
              )}
              {componenti.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`bundle-comp-row-${i}`}>
                  <select
                    className="col-span-8 h-9 rounded-md border border-input bg-background px-2 text-xs"
                    data-testid={`bundle-comp-ean-${i}`}
                    value={c.ean}
                    onChange={(e) => updComp(i, "ean", e.target.value)}
                  >
                    <option value="">— scegli prodotto —</option>
                    {prodotti.map((p) => (
                      <option key={p.id} value={p.ean}>{`${p.titolo} (${p.ean})`}</option>
                    ))}
                  </select>
                  <Input type="number" min={1} className="col-span-3" data-testid={`bundle-comp-qta-${i}`} value={c.quantita} onChange={(e) => updComp(i, "quantita", e.target.value)} placeholder="Q.tà" />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delComp(i)} disabled={componenti.length === 1} data-testid={`bundle-comp-del-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addComp} data-testid="bundle-comp-add"><Plus className="h-4 w-4 mr-1" /> Aggiungi componente</Button>
            </div>
          )}

          <div><Label>Foto prodotto</Label><Input data-testid="add-foto" type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} className="mt-1" /></div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="add-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const importa = async () => {
    if (!file) { toast.error("Seleziona un file CSV o Excel"); return; }
    setLoading(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/referenze/import", fd);
      setResult(data);
      toast.success(`${data.inseriti} referenze importate`);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setFile(null); setResult(null); } }}>
      <DialogTrigger asChild><Button variant="outline" data-testid="import-btn"><Upload className="h-4 w-4 mr-2" /> Importa file</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Importa referenze (CSV / Excel)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Colonne riconosciute automaticamente: <b>EAN</b>, SKU, ASIN, Titolo. Le righe senza EAN vengono scartate.
          </p>
          <Input data-testid="import-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
          {result && (
            <div className="text-sm space-y-2" data-testid="import-result">
              <div className="text-emerald-600 font-medium">{result.inseriti} righe importate su {result.totale_righe}.</div>
              {result.errori?.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 max-h-40 overflow-auto">
                  <div className="font-medium text-amber-700 mb-1">{result.errori.length} righe scartate:</div>
                  <ul className="list-disc pl-4 text-amber-700 text-xs space-y-0.5">
                    {result.errori.slice(0, 20).map((er, i) => <li key={i}>Riga {er.riga}: {er.errore}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={importa} disabled={loading} data-testid="import-conferma-btn">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Importa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const [titoloEdit, setTitoloEdit] = useState({});
  const [eanEdit, setEanEdit] = useState({});
  const [skuEdit, setSkuEdit] = useState({});
  const [asinEdit, setAsinEdit] = useState({});
  const [fnskuEdit, setFnskuEdit] = useState({});
  const [savingAll, setSavingAll] = useState(false);

  const load = () =>
    api.get("/referenze").then((r) => {
      setReferenze(r.data);
      const te = {};
      const ee = {};
      const se = {};
      const ae = {};
      const fe = {};
      r.data.forEach((x) => {
        te[x.id] = x.titolo || "";
        ee[x.id] = x.ean || "";
        se[x.id] = x.sku || "";
        ae[x.id] = x.asin || "";
        fe[x.id] = x.fnsku || "";
      });
      setTitoloEdit(te);
      setEanEdit(ee);
      setSkuEdit(se);
      setAsinEdit(ae);
      setFnskuEdit(fe);
    });
  useEffect(() => { load(); }, []);

  const salvaTutte = async () => {
    if (!referenze?.length) return;
    const senzaTitolo = referenze.find((r) => !optionalText(titoloEdit[r.id]));
    if (senzaTitolo) {
      toast.error("Ogni referenza deve avere un titolo");
      return;
    }

    const modificate = referenze.filter((r) => (
      optionalText(titoloEdit[r.id]) !== optionalText(r.titolo)
      || optionalText(eanEdit[r.id]) !== optionalText(r.ean)
      || optionalText(skuEdit[r.id]) !== optionalText(r.sku)
      || optionalText(asinEdit[r.id]) !== optionalText(r.asin)
      || optionalText(fnskuEdit[r.id]) !== optionalText(r.fnsku)
    ));

    if (!modificate.length) {
      toast.info("Nessuna modifica da salvare");
      return;
    }

    setSavingAll(true);
    try {
      await Promise.all(modificate.map((r) => api.put(`/referenze/${r.id}`, {
        titolo: optionalText(titoloEdit[r.id]),
        ean: optionalText(eanEdit[r.id]),
        sku: optionalText(skuEdit[r.id]),
        asin: optionalText(asinEdit[r.id]),
        fnsku: optionalText(fnskuEdit[r.id]),
      })));
      toast.success(`${modificate.length} referenze salvate`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSavingAll(false);
    }
  };

  const uploadFoto = async (id, file) => {
    const fd = new FormData(); fd.append("file", file);
    await api.post(`/referenze/${id}/foto`, fd);
    toast.success("Foto caricata");
    load();
  };

  const eliminaReferenza = async (r) => {
    const label = r.titolo || r.ean || "questa referenza";
    if (!window.confirm(`Eliminare ${label}?`)) return;
    try {
      await api.delete(`/referenze/${r.id}`);
      toast.success("Referenza eliminata");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="space-y-6" data-testid="client-referenze">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Le mie referenze</h1>
          <p className="text-muted-foreground text-sm mt-1">Prodotti da inviare al prep center.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={salvaTutte} disabled={!referenze?.length || savingAll} data-testid="cref-save-all">
            {savingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Salva modifiche
          </Button>
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
                <TableHead>ASIN</TableHead>
                <TableHead>FNSKU</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referenze.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Nessuna referenza. Aggiungine una o importa un file.</TableCell></TableRow>
              )}
              {referenze.map((r) => (
                <TableRow key={r.id} data-testid={`cref-row-${r.id}`}>
                  <TableCell>
                    <FotoCell ref_id={r.id} url={r.foto_url} onUpload={uploadFoto} />
                  </TableCell>
                  <TableCell className="font-medium min-w-56">
                    <div className="flex items-center gap-2">
                      {r.is_bundle && (
                        <Badge variant="secondary" className="gap-1 shrink-0" data-testid={`cref-bundle-badge-${r.id}`}>
                          <Layers className="h-3 w-3" /> Bundle
                        </Badge>
                      )}
                      <Input
                        data-testid={`cref-titolo-${r.id}`}
                        value={titoloEdit[r.id] ?? ""}
                        onChange={(e) => setTitoloEdit({ ...titoloEdit, [r.id]: e.target.value })}
                        placeholder="Titolo prodotto"
                        className="h-8 min-w-52"
                      />
                    </div>
                    {r.is_bundle && r.componenti?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground font-normal mt-0.5">
                        {r.componenti.map((c) => `${c.quantita}× ${c.ean}`).join(" + ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      data-testid={`cref-ean-${r.id}`}
                      value={eanEdit[r.id] ?? ""}
                      onChange={(e) => setEanEdit({ ...eanEdit, [r.id]: e.target.value })}
                      placeholder="da aggiungere"
                      className="h-8 w-40 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      data-testid={`cref-sku-${r.id}`}
                      value={skuEdit[r.id] ?? ""}
                      onChange={(e) => setSkuEdit({ ...skuEdit, [r.id]: e.target.value })}
                      placeholder="SKU"
                      className="h-8 w-36 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      data-testid={`cref-asin-${r.id}`}
                      value={asinEdit[r.id] ?? ""}
                      onChange={(e) => setAsinEdit({ ...asinEdit, [r.id]: e.target.value })}
                      placeholder="da aggiungere"
                      className="h-8 w-36 font-mono text-xs"
                    />
                  </TableCell>
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
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" title="Elimina" className="text-destructive hover:text-destructive" data-testid={`cref-delete-${r.id}`} onClick={() => eliminaReferenza(r)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
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

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
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
  const [form, setForm] = useState({ ean: "", titolo: "", fnsku: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isBundle, setIsBundle] = useState(false);
  const [componenti, setComponenti] = useState([{ ean: "", quantita: "1" }]);

  // Prodotti selezionabili come componenti (esclusi altri bundle)
  const prodotti = (referenze || []).filter((r) => !r.is_bundle && r.ean);

  const reset = () => {
    setForm({ ean: "", titolo: "", fnsku: "" });
    setFile(null); setIsBundle(false); setComponenti([{ ean: "", quantita: "1" }]);
  };

  const updComp = (i, k, v) => { const n = [...componenti]; n[i][k] = v; setComponenti(n); };
  const addComp = () => setComponenti([...componenti, { ean: "", quantita: "1" }]);
  const delComp = (i) => setComponenti(componenti.filter((_, idx) => idx !== i));

  const salva = async () => {
    if (!form.titolo.trim()) { toast.error("Il titolo è obbligatorio"); return; }
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
        titolo: form.titolo,
        ean: optionalText(form.ean),
        fnsku: optionalText(form.fnsku),
        is_bundle: isBundle,
        componenti: comps,
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
              <div className="text-xs text-muted-foreground">Unisce più prodotti esistenti (es. X + Y) in un'unica referenza Amazon con EAN e FNSKU propri, anche aggiungibili dopo.</div>
            </div>
          </label>

          <div><Label>EAN opzionale</Label><Input data-testid="add-ean" value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} className="mt-1 font-mono" placeholder="puoi aggiungerlo dopo" /></div>
          <div><Label>Titolo *</Label><Input data-testid="add-titolo" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} className="mt-1" /></div>
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

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
import { Loader2, Plus, Upload, ImageOff, Save, Image } from "lucide-react";

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
          <AddDialog onDone={load} />
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
                  <TableCell className="font-medium max-w-xs truncate">{r.titolo}</TableCell>
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

function AddDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ean: "", titolo: "", sku: "", asin: "", fnsku: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const salva = async () => {
    if (!form.ean || !form.titolo) { toast.error("EAN e titolo sono obbligatori"); return; }
    setSaving(true);
    try {
      const { data } = await api.post("/referenze", form);
      if (file) {
        const fd = new FormData(); fd.append("file", file);
        await api.post(`/referenze/${data.id}/foto`, fd);
      }
      toast.success("Referenza aggiunta");
      setOpen(false); setForm({ ean: "", titolo: "", sku: "", asin: "", fnsku: "" }); setFile(null);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="add-ref-btn"><Plus className="h-4 w-4 mr-2" /> Aggiungi</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuova referenza</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>EAN *</Label><Input data-testid="add-ean" value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} className="mt-1 font-mono" /></div>
          <div><Label>Titolo *</Label><Input data-testid="add-titolo" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>SKU</Label><Input data-testid="add-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="mt-1 font-mono" /></div>
            <div><Label>ASIN</Label><Input data-testid="add-asin" value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} className="mt-1 font-mono" /></div>
          </div>
          <div><Label>FNSKU</Label><Input data-testid="add-fnsku" value={form.fnsku} onChange={(e) => setForm({ ...form, fnsku: e.target.value })} className="mt-1 font-mono" placeholder="opzionale, aggiungibile dopo" /></div>
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

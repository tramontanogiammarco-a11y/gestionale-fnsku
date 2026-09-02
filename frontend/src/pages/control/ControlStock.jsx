import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowRight, ArrowRightLeft, Boxes, ChevronRight, ClipboardCheck, Loader2, MapPin, PackageCheck, Save, Search, Scale, Truck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

const EMPTY_FORM = { ean: "", sku: "", peso_kg: "", lunghezza_cm: "", larghezza_cm: "", altezza_cm: "" };

function errorMessage(error) {
  return error?.response?.data?.detail || error?.message || "Operazione non riuscita";
}

function numberText(value) {
  return Number(value || 0).toLocaleString("it-IT");
}

function movementMeta(type) {
  if (type === "ricezione") return { label: "Ricezione", icon: Warehouse, tone: "emerald" };
  if (type === "trasferimento") return { label: "Spostamento", icon: ArrowRightLeft, tone: "sky" };
  if (type === "inventario") return { label: "Inventario", icon: ClipboardCheck, tone: "amber" };
  return { label: "Prelievo", icon: Truck, tone: "violet" };
}

function ProductDetail({ product, onOpenChange, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    setForm({
      ean: product.ean || "",
      sku: product.skus?.[0] || "",
      peso_kg: product.peso_kg || "",
      lunghezza_cm: product.lunghezza_cm || "",
      larghezza_cm: product.larghezza_cm || "",
      altezza_cm: product.altezza_cm || "",
    });
  }, [product]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const realWeight = Number(String(form.peso_kg).replace(",", ".")) || 0;
  const volumetricWeight = [form.lunghezza_cm, form.larghezza_cm, form.altezza_cm]
    .map((value) => Number(String(value).replace(",", ".")) || 0)
    .reduce((total, value) => total * value, 1) / 5000;
  const shippingWeight = Math.max(realWeight, volumetricWeight);

  const save = async () => {
    if (!product?.referenza_id) return toast.error("Scheda referenza non collegata: aggiorna la pagina e riprova");
    const payload = { ean: form.ean, sku: form.sku };
    for (const field of ["peso_kg", "lunghezza_cm", "larghezza_cm", "altezza_cm"]) {
      if (String(form[field]).trim()) payload[field] = form[field];
    }
    payload.misure_confermate = ["peso_kg", "lunghezza_cm", "larghezza_cm", "altezza_cm"].every((field) => Number(String(form[field]).replace(",", ".")) > 0);
    setBusy(true);
    try {
      await api.put(`/referenze/${product.referenza_id}`, payload);
      toast.success("Scheda prodotto aggiornata");
      await onSaved(product.referenza_id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{product?.titolo || "Dettaglio prodotto"}</DialogTitle>
        <DialogDescription>Giacenza fisica, dati logistici e cronologia completa della referenza.</DialogDescription>
      </DialogHeader>

      {product && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-extrabold uppercase text-slate-500">Disponibile</p><p className="mt-2 text-2xl font-extrabold text-teal-800">{numberText(product.disponibile)}</p></div>
          <div className="border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-extrabold uppercase text-slate-500">Impegnato</p><p className="mt-2 text-2xl font-extrabold text-amber-700">{numberText(product.in_preparazione)}</p></div>
          <div className="border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-extrabold uppercase text-slate-500">Ricevuto</p><p className="mt-2 text-2xl font-extrabold">{numberText(product.ricevuto)}</p></div>
          <div className="border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-extrabold uppercase text-slate-500">Ubicazioni</p><p className="mt-2 text-2xl font-extrabold">{product.ubicazioni?.length || 0}</p></div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-extrabold">Dove si trova</h3><p className="mt-1 text-xs text-slate-500">Quantità attuale divisa tra slot e pallet.</p></div>
            <div className="divide-y divide-slate-100">
              {(product.ubicazioni || []).map((location) => <div key={location.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-50 text-teal-800"><MapPin className="h-4 w-4" /></span><div><p className="font-mono text-sm font-extrabold">{location.codice}</p><p className="text-xs capitalize text-slate-500">{location.tipo || "ubicazione"}</p></div></div>
                <span className="text-lg font-extrabold">{numberText(location.quantita)} pz</span>
              </div>)}
              {Number(product.non_ubicato || 0) > 0 && <div className="flex items-center justify-between bg-amber-50 px-4 py-3"><div><p className="font-extrabold text-amber-900">Non ubicato</p><p className="text-xs text-amber-700">Stock presente senza posizione fisica.</p></div><span className="text-lg font-extrabold text-amber-900">{numberText(product.non_ubicato)} pz</span></div>}
              {!product.ubicazioni?.length && !Number(product.non_ubicato || 0) && <p className="px-4 py-8 text-center text-sm text-slate-500">Nessuna quantità fisica presente.</p>}
            </div>
          </section>

          <section className="border border-slate-200 p-4">
            <div className="mb-4 flex items-center gap-2"><Scale className="h-5 w-5 text-teal-700" /><div><h3 className="font-extrabold">Codici e dati di spedizione</h3><p className="text-xs text-slate-500">Questi valori alimentano preventivo e scelta corriere.</p></div></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="stock-ean">EAN</Label><Input id="stock-ean" className="mt-1 font-mono" value={form.ean} onChange={(event) => setField("ean", event.target.value)} /></div>
              <div><Label htmlFor="stock-sku">SKU</Label><Input id="stock-sku" className="mt-1 font-mono" value={form.sku} onChange={(event) => setField("sku", event.target.value)} /></div>
              <div><Label htmlFor="stock-weight">Peso reale (kg)</Label><Input id="stock-weight" className="mt-1" type="number" min="0.01" step="0.01" value={form.peso_kg} onChange={(event) => setField("peso_kg", event.target.value)} /></div>
              <div className="border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-extrabold uppercase text-slate-500">Peso tariffato stimato</p><p className="mt-1 text-xl font-extrabold">{shippingWeight ? `${shippingWeight.toFixed(2)} kg` : "Da completare"}</p><p className="mt-1 text-[11px] text-slate-500">Maggiore tra reale e volumetrico / 5.000.</p></div>
              <div><Label htmlFor="stock-length">Lunghezza (cm)</Label><Input id="stock-length" className="mt-1" type="number" min="0.01" step="0.01" value={form.lunghezza_cm} onChange={(event) => setField("lunghezza_cm", event.target.value)} /></div>
              <div><Label htmlFor="stock-width">Larghezza (cm)</Label><Input id="stock-width" className="mt-1" type="number" min="0.01" step="0.01" value={form.larghezza_cm} onChange={(event) => setField("larghezza_cm", event.target.value)} /></div>
              <div><Label htmlFor="stock-height">Altezza (cm)</Label><Input id="stock-height" className="mt-1" type="number" min="0.01" step="0.01" value={form.altezza_cm} onChange={(event) => setField("altezza_cm", event.target.value)} /></div>
              <div className="flex items-end"><StatusPill tone={product.misure_confermate ? "emerald" : "amber"}>{product.misure_confermate ? "Misure confermate" : "Misure da completare"}</StatusPill></div>
            </div>
          </section>
        </div>

        <section className="border border-slate-200">
          <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-extrabold">Storico movimentazioni</h3><p className="mt-1 text-xs text-slate-500">Ricezioni, trasferimenti, conteggi inventariali e prelievi in ordine cronologico.</p></div>
          {(product.movimenti || []).length ? <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">{product.movimenti.map((movement, index) => {
            const meta = movementMeta(movement.tipo); const Icon = meta.icon; const positive = Number(movement.quantita || 0) > 0;
            return <div key={`${movement.id}-${index}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[160px_1fr_auto] sm:items-center">
              <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100"><Icon className="h-4 w-4" /></span><div><p className="text-sm font-extrabold">{meta.label}</p><p className="text-[11px] text-slate-500">{movement.created_at ? new Date(movement.created_at).toLocaleString("it-IT") : "Data non disponibile"}</p></div></div>
              <div><p className="text-sm font-semibold">{movement.descrizione}</p><div className="mt-1 flex items-center gap-2 font-mono text-xs text-slate-500"><span>{movement.da || "Ingresso"}</span><ArrowRight className="h-3 w-3" /><span>{movement.a || "Stock"}</span></div></div>
              <p className={`text-right text-base font-extrabold ${positive ? "text-emerald-700" : "text-rose-700"}`}>{positive ? "+" : ""}{numberText(movement.quantita)} pz</p>
            </div>;
          })}</div> : <p className="px-4 py-8 text-center text-sm text-slate-500">Nessuna movimentazione registrata.</p>}
        </section>
      </div>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Chiudi</Button>
        <Button type="button" onClick={save} disabled={busy || !product?.referenza_id} className="bg-teal-700 text-white hover:bg-teal-800">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salva prodotto</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function ControlStock() {
  const context = useOutletContext();
  const { clientId } = context;
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (keepReferenceId = null) => {
    const query = clientId ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
    try {
      const response = await api.get(`/wms/stock${query}`);
      const next = response.data || { products: [], summary: {} };
      setData(next);
      if (keepReferenceId) setSelected(next.products?.find((product) => product.referenza_id === keepReferenceId) || null);
      return next;
    } catch (error) {
      toast.error(errorMessage(error));
      setData({ products: [], summary: {} });
      return null;
    }
  }, [clientId]);

  useEffect(() => { setData(null); setSelected(null); load(); }, [load]);
  const rows = useMemo(() => (data?.products || []).filter((row) => [row.titolo, row.ean, row.fnsku, ...(row.skus || []), row.cliente].join(" ").toLowerCase().includes(search.toLowerCase())), [data, search]);
  if (!data) return <PageLoader />;
  const totals = (data.products || []).reduce((acc, row) => ({ received: acc.received + Number(row.ricevuto || 0), available: acc.available + Number(row.disponibile || 0), prep: acc.prep + Number(row.in_preparazione || 0) }), { received: 0, available: 0, prep: 0 });

  return <div>
    <PageIntro eyebrow="Inventario" title="Stock" description="Apri una referenza per controllare ubicazioni, movimenti, codici, peso e dimensioni." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Disponibili" value={numberText(totals.available)} icon={PackageCheck} /><Metric label="In preparazione" value={numberText(totals.prep)} icon={Boxes} tone="amber" /><Metric label="Unità ricevute" value={numberText(totals.received)} icon={Warehouse} tone="sky" /></div>
    <Panel className="mt-4" title="Catalogo disponibile" description={`${rows.length} referenze`} action={<div className="relative w-64 max-w-full"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca prodotto, EAN o SKU" className="h-9 pl-9" /></div>}>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-5 py-3">Prodotto</th>{context.isStaff && !context.clientId && <th className="px-5 py-3">Cliente</th>}<th className="px-5 py-3">EAN / SKU</th><th className="px-5 py-3">Ubicazioni</th><th className="px-5 py-3 text-right">Ricevuto</th><th className="px-5 py-3 text-right">Impegnato</th><th className="px-5 py-3 text-right">Disponibile</th><th className="w-10" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={`${row.cliente_id || "client"}-${row.referenza_id || row.ean}`} onClick={() => setSelected(row)} className="cursor-pointer hover:bg-teal-50/50"><td className="px-5 py-4"><p className="font-extrabold">{row.titolo || "Senza titolo"}</p>{row.misure_confermate ? <p className="mt-1 text-[11px] font-bold text-emerald-700">Dati spedizione completi</p> : <p className="mt-1 text-[11px] font-bold text-amber-700">Peso o misure da completare</p>}</td>{context.isStaff && !context.clientId && <td className="px-5 py-4 text-slate-600">{row.cliente || "—"}</td>}<td className="px-5 py-4 font-mono text-xs text-slate-500"><p><span className="mr-2 font-sans text-[10px] font-bold uppercase text-slate-400">EAN</span>{row.ean || "—"}</p><p className="mt-1"><span className="mr-2 font-sans text-[10px] font-bold uppercase text-slate-400">SKU</span>{row.skus?.[0] || "—"}</p></td><td className="px-5 py-4"><span className="font-extrabold">{row.ubicazioni?.length || 0}</span>{Number(row.non_ubicato || 0) > 0 && <p className="mt-1 text-[11px] font-bold text-amber-700">{row.non_ubicato} non ubicati</p>}</td><td className="px-5 py-4 text-right font-bold">{numberText(row.ricevuto)}</td><td className="px-5 py-4 text-right font-bold text-amber-700">{numberText(row.in_preparazione)}</td><td className="px-5 py-4 text-right text-base font-extrabold text-teal-800">{numberText(row.disponibile)}</td><td className="pr-4 text-slate-400"><ChevronRight className="h-5 w-5" /></td></tr>)}</tbody></table></div> : <EmptyState title="Nessuna referenza trovata" description="Modifica la ricerca oppure seleziona un altro cliente." />}
    </Panel>
    <ProductDetail product={selected} onOpenChange={(open) => !open && setSelected(null)} onSaved={load} />
  </div>;
}

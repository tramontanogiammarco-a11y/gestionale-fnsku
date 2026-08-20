import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Barcode, Boxes, Loader2, MapPin, PackageSearch, Search, Warehouse } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

export default function WmsAppProductSearch() {
  const { clientId: workspaceClientId } = useOutletContext();
  const inputRef = useRef(null);
  const [stock, setStock] = useState(null);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState(workspaceClientId || "all");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/wms/stock")
      .then((response) => setStock(response.data))
      .catch((error) => toast.error(error.response?.data?.detail || error.message || "Prodotti non disponibili"));
  }, []);

  useEffect(() => {
    setClientId(workspaceClientId || "all");
  }, [workspaceClientId]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const hasCriteria = Boolean(query.trim()) || clientId !== "all";
  const results = useMemo(() => {
    if (!stock || !hasCriteria) return [];
    const needle = normalize(query);
    return (stock.products || []).filter((product) => {
      if (clientId !== "all" && product.cliente_id !== clientId) return false;
      if (!needle) return true;
      return [product.titolo, product.ean, product.fnsku, product.cliente, ...(product.skus || [])]
        .some((value) => normalize(value).includes(needle));
    });
  }, [clientId, hasCriteria, query, stock]);

  if (!stock) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  return (
    <div className="space-y-5" data-testid="wms-product-search">
      <header>
        <p className="text-xs font-extrabold uppercase text-teal-700">Ricerca magazzino</p>
        <h1 className="mt-1 text-3xl font-black">Cerca prodotto</h1>
        <p className="mt-2 text-sm text-slate-500">Trova quantità e ubicazioni tramite SKU, EAN, FNSKU o cliente.</p>
      </header>

      <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} className="h-14 pl-11 text-base" placeholder="SKU, EAN, FNSKU o titolo" autoComplete="off" />
        </div>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-12" aria-label="Filtra per cliente"><SelectValue placeholder="Tutti i clienti" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i clienti</SelectItem>
            {(stock.clienti || []).map((client) => <SelectItem key={client.id} value={client.id}>{client.ragione_sociale}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>

      {!hasCriteria ? (
        <EmptySearch />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">Risultati</h2><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{results.length}</span></div>
          {results.length ? (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
              {results.map((product) => <ProductRow key={`${product.cliente_id}:${product.fnsku || product.ean}`} product={product} onClick={() => setSelected(product)} />)}
            </div>
          ) : <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center"><PackageSearch className="mx-auto h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">Nessun prodotto trovato</h3><p className="mt-1 text-sm text-slate-500">Controlla il codice o cambia cliente.</p></div>}
        </section>
      )}

      <ProductSheet product={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}

function ProductRow({ product, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Boxes className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><strong className="block leading-tight">{product.titolo}</strong><span className="mt-1 block text-xs text-slate-500">{product.cliente}</span><span className="mt-2 block break-all font-mono text-[11px] text-slate-500">{product.skus?.length ? `SKU ${product.skus.join(", ")}` : "SKU assente"}</span></span>
      <span className="shrink-0 text-right"><strong className="block text-xl">{product.disponibile}</strong><span className="text-[10px] font-bold uppercase text-slate-400">pezzi</span></span>
    </button>
  );
}

function ProductSheet({ product, open, onOpenChange }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0">
        <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
          <SheetTitle className="text-xl font-black">{product?.titolo}</SheetTitle>
          <SheetDescription>{product?.cliente}</SheetDescription>
        </SheetHeader>
        {product && <div className="space-y-5 p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Disponibile" value={product.disponibile} tone="teal" />
            <Metric label="Da ubicare" value={product.non_ubicato} tone={product.non_ubicato ? "amber" : "slate"} />
          </div>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            <CodeRow label="EAN" value={product.ean} />
            <CodeRow label="FNSKU" value={product.fnsku} />
            <CodeRow label="SKU" value={product.skus?.join(", ")} />
          </div>
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-black"><MapPin className="h-5 w-5 text-teal-700" /> Ubicazioni</h3>
            {product.ubicazioni?.length ? <div className="space-y-2">{product.ubicazioni.map((location) => <div key={location.id} className="flex items-center gap-3 rounded-md border border-slate-200 p-4"><Warehouse className="h-5 w-5 text-teal-700" /><span className="flex-1 font-mono font-black">{location.codice}</span><strong>{location.quantita} pz</strong></div>)}</div> : <div className="rounded-md bg-amber-50 p-4 text-sm font-semibold text-amber-900">Nessuna posizione assegnata.</div>}
          </section>
        </div>}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, tone }) {
  const colors = tone === "teal" ? "bg-teal-50 text-teal-950" : tone === "amber" ? "bg-amber-50 text-amber-950" : "bg-slate-100 text-slate-900";
  return <div className={`rounded-md p-4 ${colors}`}><strong className="text-3xl">{value || 0}</strong><span className="mt-1 block text-xs font-bold">{label}</span></div>;
}

function CodeRow({ label, value }) {
  return <div className="flex items-start gap-3 p-3"><span className="w-14 shrink-0 text-xs font-black text-slate-400">{label}</span><span className="min-w-0 break-all font-mono text-sm font-bold">{value || "Non presente"}</span></div>;
}

function EmptySearch() {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Barcode className="h-7 w-7" /></span><h2 className="mt-4 text-xl font-black">Cerca una referenza</h2><p className="mt-2 max-w-xs text-sm text-slate-500">Digita o scansiona uno SKU, un EAN o un FNSKU. Puoi anche scegliere un cliente per vedere tutti i suoi prodotti.</p></div>;
}

function normalize(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, ""); }

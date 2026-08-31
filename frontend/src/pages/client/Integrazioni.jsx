import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowRight, CheckCircle2, CircleAlert, DownloadCloud, Eye, Loader2, PackageSearch, PlugZap, RefreshCw, Store,
} from "lucide-react";

export default function ClientIntegrazioni() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [ordersResult, setOrdersResult] = useState(null);

  const loadConnection = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/shopify/connections");
      const ownConnection = (data || []).find((item) => item.cliente_id === user?.cliente_id) || null;
      setConnection(ownConnection);
      if (ownConnection?.shop_domain) setShopDomain(ownConnection.shop_domain);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  }, [user?.cliente_id]);

  useEffect(() => { loadConnection(); }, [loadConnection]);

  useEffect(() => {
    if (searchParams.get("shopify") !== "connected") return;
    toast.success(`Shopify collegato: ${searchParams.get("shop") || "negozio"}`);
    loadConnection();
    setSearchParams({}, { replace: true });
  }, [loadConnection, searchParams, setSearchParams]);

  const connectShopify = async () => {
    if (!shopDomain.trim()) return toast.error("Inserisci il dominio myshopify.com");
    setConnecting(true);
    try {
      const { data } = await api.post("/shopify/oauth/start", {
        cliente_id: user?.cliente_id,
        shop_domain: shopDomain,
      });
      window.location.href = data.authorize_url;
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
      setConnecting(false);
    }
  };

  const importReferences = async (dryRun) => {
    if (!shopDomain.trim()) return toast.error("Collega prima il negozio Shopify");
    setImporting(true);
    setResult(null);
    try {
      const { data } = await api.post("/shopify/import", {
        cliente_id: user?.cliente_id,
        shop_domain: shopDomain,
        dry_run: dryRun,
      });
      setResult(data);
      toast.success(dryRun ? "Anteprima catalogo pronta" : "Referenze Shopify importate");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setImporting(false);
    }
  };

  const importOrders = async (dryRun) => {
    if (!shopDomain.trim()) return toast.error("Collega prima il negozio Shopify");
    setOrdersLoading(true);
    setOrdersResult(null);
    try {
      const { data } = await api.post("/shopify/orders/import", {
        cliente_id: user?.cliente_id,
        shop_domain: shopDomain,
        dry_run: dryRun,
      });
      setOrdersResult(data);
      toast.success(dryRun ? "Anteprima ordini pronta" : "Ordini Shopify importati");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setOrdersLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="client-integrazioni">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase text-teal-700">
            <PlugZap className="h-4 w-4" /> Integrazioni
          </div>
          <h1 className="font-heading text-3xl font-black tracking-tight">Collega il tuo ecommerce</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Sincronizza prodotti, varianti, SKU, EAN e immagini direttamente dal tuo catalogo Shopify.
          </p>
        </div>
        <Link to="/app/referenze" className="inline-flex items-center gap-2 text-sm font-bold text-teal-700 hover:text-teal-900">
          Apri prodotti <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-100 text-emerald-800"><Store className="h-6 w-6" /></div>
              <div>
                <h2 className="font-heading text-xl font-bold">Shopify</h2>
                <p className="text-sm text-muted-foreground">Catalogo prodotti e varianti</p>
              </div>
            </div>
            {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${connection ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {connection ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {connection ? "Collegato" : "Da collegare"}
              </span>
            )}
          </div>

          <div className="mt-6">
            <Label htmlFor="client-shopify-domain">Dominio del negozio</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input id="client-shopify-domain" value={shopDomain} onChange={(event) => setShopDomain(event.target.value)} placeholder="negozio.myshopify.com" className="h-11" />
              <Button onClick={connectShopify} disabled={connecting || loading || !shopDomain.trim()} className="h-11 shrink-0">
                {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                {connection ? "Ricollega" : "Collega Shopify"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Usa il dominio che termina con <span className="font-mono">.myshopify.com</span>.</p>
          </div>

          {connection && (
            <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-bold text-emerald-950">{connection.shop_domain}</p>
                  <p className="mt-1 text-sm text-emerald-800">Autorizzazione attiva. Puoi controllare il catalogo e importare le referenze.</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => importReferences(true)} disabled={importing} className="bg-white">
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />} Anteprima
                </Button>
                <Button onClick={() => importReferences(false)} disabled={importing}>
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />} Importa referenze
                </Button>
                <Button variant="ghost" onClick={loadConnection} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" /> Aggiorna stato</Button>
              </div>
              <div className="mt-4 border-t border-emerald-200 pt-4">
                <p className="mb-3 text-xs font-bold uppercase text-emerald-900">Sincronizzazione ordini</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => importOrders(true)} disabled={ordersLoading} className="bg-white">
                    {ordersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />} Anteprima ordini
                  </Button>
                  <Button onClick={() => importOrders(false)} disabled={ordersLoading}>
                    {ordersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />} Importa ordini Shopify
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <PackageSearch className="h-6 w-6 text-teal-700" />
            <h2 className="mt-4 font-heading text-lg font-bold">Catalogo e stock</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              L’import crea le referenze con titolo, SKU, EAN e fotografia. La giacenza Aimago resta a zero finché la merce non viene ricevuta fisicamente.
            </p>
          </Card>
          <Card className="border-slate-900 bg-slate-950 p-5 text-white">
            <p className="text-xs font-bold uppercase text-teal-200">Flusso corretto</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">Shopify importa il catalogo. Entrate registra ciò che arriverà. La ricezione aggiorna lo stock disponibile.</p>
          </Card>
        </div>
      </div>

      {result && (
        <Card className="p-5 sm:p-6" data-testid="client-shopify-result">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-xl font-bold">{result.dry_run ? "Anteprima catalogo" : "Importazione completata"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{result.shop_domain}</p>
            </div>
            <div className="flex gap-2">
              <Metric label="Trovate" value={result.trovate ?? ((result.create || 0) + (result.update || 0))} />
              <Metric label="Nuove" value={result.create ?? "-"} />
              <Metric label="Aggiornate" value={result.update ?? "-"} />
            </div>
          </div>
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Varianti senza barcode/EAN non importate: <b>{result.senza_barcode || 0}</b>
          </div>
          {result.anteprima?.length > 0 && (
            <Table className="mt-4">
              <TableHeader><TableRow><TableHead>Prodotto</TableHead><TableHead>SKU</TableHead><TableHead>EAN</TableHead></TableRow></TableHeader>
              <TableBody>{result.anteprima.map((row, index) => (
                <TableRow key={`${row.ean}-${index}`}><TableCell className="font-semibold">{row.titolo}</TableCell><TableCell className="font-mono text-xs">{row.sku || "-"}</TableCell><TableCell className="font-mono text-xs">{row.ean}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
          {!result.dry_run && <Button asChild className="mt-5"><Link to="/app/referenze">Vedi referenze importate <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
        </Card>
      )}
      {ordersResult && (
        <Card className="p-5 sm:p-6" data-testid="client-shopify-orders-result">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="font-heading text-xl font-bold">{ordersResult.dry_run ? "Anteprima ordini Shopify" : "Ordini Shopify importati"}</h2><p className="mt-1 text-sm text-muted-foreground">{ordersResult.shop_domain}</p></div>
            <div className="flex gap-2"><Metric label="Ordini" value={ordersResult.ordini ?? ((ordersResult.create || 0) + (ordersResult.update || 0))}/><Metric label="Righe" value={ordersResult.righe ?? "-"}/><Metric label="Collegate" value={ordersResult.righe_collegate ?? "-"}/></div>
          </div>
          {ordersResult.anteprima?.length > 0 && <Table className="mt-5"><TableHeader><TableRow><TableHead>Ordine</TableHead><TableHead>Stato</TableHead><TableHead>Righe</TableHead><TableHead>Totale</TableHead></TableRow></TableHeader><TableBody>{ordersResult.anteprima.map((row)=><TableRow key={row.shopify_order_id}><TableCell className="font-bold">{row.order_name}</TableCell><TableCell>{row.fulfillment_status||row.financial_status||"-"}</TableCell><TableCell>{row.righe}</TableCell><TableCell>{row.total_price?`${row.total_price} ${row.currency||""}`:"-"}</TableCell></TableRow>)}</TableBody></Table>}
          {!ordersResult.dry_run && <Button asChild className="mt-5"><Link to="/wms/orders">Apri ordini <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>}
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="min-w-20 rounded-md bg-slate-100 px-3 py-2 text-center"><div className="text-lg font-black text-slate-950">{value}</div><div className="text-[10px] font-bold uppercase text-slate-500">{label}</div></div>;
}

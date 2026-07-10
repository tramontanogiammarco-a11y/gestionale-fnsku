import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, DownloadCloud, ExternalLink, Link2, Loader2, PlugZap, ShieldCheck, ShoppingCart, Store } from "lucide-react";

const SHOPIFY_CALLBACK_URL = "https://ryprjuqfervusppnedsz.supabase.co/functions/v1/shopify-oauth-callback";

export default function AdminIntegrazioni() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clienti, setClienti] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [shopDomain, setShopDomain] = useState("zcgygr-91.myshopify.com");
  const [accessToken, setAccessToken] = useState("");
  const [result, setResult] = useState(null);
  const [ordersResult, setOrdersResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api.get("/clienti").then((r) => setClienti(r.data || []));
  }, []);

  useEffect(() => {
    if (searchParams.get("shopify") === "connected") {
      toast.success(`Shopify collegato: ${searchParams.get("shop") || "negozio"}`);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const connectShopify = async () => {
    if (!clienteId || !shopDomain) {
      toast.error("Seleziona cliente e dominio myshopify.com");
      return;
    }
    setConnecting(true);
    try {
      const { data } = await api.post("/shopify/oauth/start", {
        cliente_id: clienteId,
        shop_domain: shopDomain,
      });
      window.location.href = data.authorize_url;
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setConnecting(false);
    }
  };

  const run = async (dryRun) => {
    if (!clienteId || !shopDomain) {
      toast.error("Seleziona cliente e dominio Shopify");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post("/shopify/import", {
        cliente_id: clienteId,
        shop_domain: shopDomain,
        access_token: accessToken || undefined,
        dry_run: dryRun,
      });
      setResult(data);
      toast.success(dryRun ? "Connessione Shopify riuscita" : "Import Shopify completato");
      if (!dryRun) setAccessToken("");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const importOrders = async (dryRun) => {
    if (!clienteId || !shopDomain) {
      toast.error("Seleziona cliente e dominio Shopify");
      return;
    }
    setOrdersLoading(true);
    setOrdersResult(null);
    try {
      const { data } = await api.post("/shopify/orders/import", {
        cliente_id: clienteId,
        shop_domain: shopDomain,
        dry_run: dryRun,
      });
      setOrdersResult(data);
      toast.success(dryRun ? "Anteprima ordini pronta" : "Import ordini Shopify completato");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setOrdersLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-integrazioni">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1fr_360px]">
          <div className="p-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
              <PlugZap className="h-3.5 w-3.5" /> Integrazioni
            </div>
            <h1 className="font-heading text-4xl font-black tracking-tight">Shopify sync</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Importa automaticamente le referenze cliente da prodotti e varianti Shopify, usando SKU e barcode/EAN.
            </p>
          </div>
          <div className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-teal-200">Sicurezza</div>
            <div className="mt-4 flex gap-3 rounded-md bg-white/8 p-3 text-sm text-slate-200">
              <ShieldCheck className="h-5 w-5 shrink-0 text-teal-200" />
              <span>Il token Shopify viene salvato solo lato Supabase tramite OAuth. Nel browser resta solo il pulsante di collegamento.</span>
            </div>
          </div>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-5 grid gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-2 font-heading text-lg font-bold">
              <Store className="h-5 w-5 text-teal-700" /> Collegamento Shopify moderno
            </div>
            <p className="mt-1 text-teal-800">
              In Shopify Dev Dashboard imposta questo URL nei redirect dell'app, poi torna qui e premi Collega Shopify.
            </p>
            <div className="mt-3 rounded-md bg-white/80 px-3 py-2 font-mono text-xs text-slate-800">
              {SHOPIFY_CALLBACK_URL}
            </div>
          </div>
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(SHOPIFY_CALLBACK_URL).then(() => toast.success("URL copiato"))}>
            Copia redirect
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label className="text-xs">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger className="mt-1" data-testid="shopify-cliente"><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
              <SelectContent>
                {clienti.map((c) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Shop domain</Label>
            <Input
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="nome-store.myshopify.com"
              className="mt-1"
              data-testid="shopify-domain"
            />
          </div>
          <div className="lg:col-span-2">
            <Label className="text-xs">Admin API access token manuale (opzionale)</Label>
            <Textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="shpat_..."
              className="mt-1 min-h-24 font-mono text-xs"
              data-testid="shopify-token"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Lascialo vuoto se hai usato il pulsante Collega Shopify. Serve solo come fallback se Shopify ti mostra ancora un token Admin API.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={connectShopify} disabled={connecting || !clienteId || !shopDomain} data-testid="shopify-connect-btn">
            {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
            Collega Shopify
          </Button>
          <Button variant="outline" onClick={() => run(true)} disabled={loading} data-testid="shopify-test-btn">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Test + anteprima
          </Button>
          <Button onClick={() => run(false)} disabled={loading} data-testid="shopify-import-btn">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />}
            Importa referenze
          </Button>
          <Button variant="outline" onClick={() => importOrders(true)} disabled={ordersLoading} data-testid="shopify-orders-test-btn">
            {ordersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
            Anteprima ordini
          </Button>
          <Button onClick={() => importOrders(false)} disabled={ordersLoading} data-testid="shopify-orders-import-btn">
            {ordersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
            Importa ordini
          </Button>
          <a
            href="https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:text-slate-950"
          >
            Guida OAuth <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </Card>

      {result && (
        <Card className="p-5" data-testid="shopify-result">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-bold">{result.dry_run ? "Anteprima import" : "Import completato"}</h2>
              <p className="text-sm text-muted-foreground">{result.shop_domain} · {result.cliente}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Trovate" value={result.trovate ?? ((result.create || 0) + (result.update || 0))} />
              <Metric label="Create" value={result.create ?? "-"} />
              <Metric label="Aggiornate" value={result.update ?? "-"} />
            </div>
          </div>
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Varianti senza barcode/EAN: <b>{result.senza_barcode || 0}</b>. Queste non vengono importate perché il gestionale usa EAN come chiave operativa.
          </div>
          {result.anteprima?.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EAN</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Titolo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.anteprima.map((row, index) => (
                  <TableRow key={`${row.ean}-${index}`}>
                    <TableCell className="font-mono text-xs">{row.ean}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku || "—"}</TableCell>
                    <TableCell>{row.titolo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {result.errori?.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {result.errori.join(" · ")}
            </div>
          )}
        </Card>
      )}

      {ordersResult && (
        <Card className="p-5" data-testid="shopify-orders-result">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-bold">{ordersResult.dry_run ? "Anteprima ordini" : "Ordini importati"}</h2>
              <p className="text-sm text-muted-foreground">{ordersResult.shop_domain} · {ordersResult.cliente}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Ordini" value={ordersResult.ordini ?? ((ordersResult.create || 0) + (ordersResult.update || 0))} />
              <Metric label="Righe" value={ordersResult.righe ?? "-"} />
              <Metric label="Collegate" value={ordersResult.righe_collegate ?? "-"} />
            </div>
          </div>
          {ordersResult.anteprima?.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ordine</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Righe</TableHead>
                  <TableHead>Totale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersResult.anteprima.map((row) => (
                  <TableRow key={row.shopify_order_id}>
                    <TableCell className="font-semibold">{row.order_name}</TableCell>
                    <TableCell>{row.fulfillment_status || row.financial_status || "-"}</TableCell>
                    <TableCell>{row.righe}</TableCell>
                    <TableCell>{row.total_price ? `${row.total_price} ${row.currency || ""}` : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {ordersResult.errori?.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {ordersResult.errori.join(" · ")}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="font-heading text-xl font-black">{value}</div>
    </div>
  );
}

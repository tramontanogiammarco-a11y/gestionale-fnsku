import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowDownRight, ArrowUpRight, Eye, Loader2, Layers, Search, Users, Warehouse } from "lucide-react";
import { toast } from "sonner";

function num(value) {
  return Number(value || 0);
}

function text(value) {
  return String(value || "").toLowerCase();
}

function clienteTotals(rows = []) {
  return rows.reduce((acc, row) => {
    acc.ricevuto += num(row.ricevuto);
    acc.in_preparazione += num(row.in_preparazione);
    acc.spedito += num(row.spedito);
    acc.disponibile += num(row.disponibile);
    return acc;
  }, { ricevuto: 0, in_preparazione: 0, spedito: 0, disponibile: 0 });
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("it-IT");
}

export default function AdminMagazzino() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [clienti, setClienti] = useState([]);
  const [stockByCliente, setStockByCliente] = useState({});
  const [query, setQuery] = useState("");
  const [movimentiOpen, setMovimentiOpen] = useState(false);
  const [movimentiLoading, setMovimentiLoading] = useState(false);
  const [movimenti, setMovimenti] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const clientiRes = await api.get("/clienti");
        const listaClienti = clientiRes.data || [];
        const stockEntries = await Promise.all(
          listaClienti.map(async (cliente) => {
            const res = await api.get(`/magazzino?cliente_id=${cliente.id}`);
            return [cliente.id, res.data || []];
          })
        );
        if (!mounted) return;
        setClienti(listaClienti);
        setStockByCliente(Object.fromEntries(stockEntries));
      } catch (error) {
        toast.error(formatApiError(error.response?.data?.detail || error.message));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const filteredClienti = useMemo(() => {
    const q = text(query).trim();
    return clienti.map((cliente) => {
      const rows = [...(stockByCliente[cliente.id] || [])]
        .sort((a, b) => String(a.titolo || a.ean || "").localeCompare(String(b.titolo || b.ean || ""), "it", { numeric: true }));
      const filteredRows = !q ? rows : rows.filter((row) => (
        text(cliente.ragione_sociale).includes(q)
        || text(row.titolo).includes(q)
        || text(row.ean).includes(q)
        || text(row.fnsku).includes(q)
      ));
      return {
        cliente,
        rows: filteredRows,
        totals: clienteTotals(filteredRows),
        totalReferenze: filteredRows.length,
      };
    }).filter((group) => group.rows.length || text(group.cliente.ragione_sociale).includes(q));
  }, [clienti, stockByCliente, query]);

  const globalTotals = useMemo(() => {
    return filteredClienti.reduce((acc, group) => {
      acc.clienti += 1;
      acc.referenze += group.totalReferenze;
      acc.ricevuto += group.totals.ricevuto;
      acc.disponibile += group.totals.disponibile;
      return acc;
    }, { clienti: 0, referenze: 0, ricevuto: 0, disponibile: 0 });
  }, [filteredClienti]);

  const apriMovimenti = async (cliente, row) => {
    setMovimentiOpen(true);
    setMovimentiLoading(true);
    setMovimenti({
      cliente,
      ean: row.ean,
      titolo: row.titolo,
      fnsku: row.fnsku,
      movimenti: [],
      totali: { entrate: 0, uscite: 0 },
    });
    try {
      const params = new URLSearchParams({ cliente_id: cliente.id, ean: row.ean || "" });
      const res = await api.get(`/magazzino/movimenti?${params.toString()}`);
      setMovimenti({ cliente, ...res.data });
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setMovimentiLoading(false);
    }
  };

  const apriDocumentoMovimento = (mov) => {
    if (!mov?.ref_id) return;
    const path = mov.tipo === "entrata"
      ? `/admin/entrate/${mov.ref_id}`
      : `/admin/preparazioni/${mov.ref_id}`;
    setMovimentiOpen(false);
    navigate(path);
  };

  return (
    <div className="space-y-6" data-testid="admin-magazzino">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Warehouse className="h-7 w-7 text-teal-700" /> Magazzino
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Referenze e quantità divise per cliente, con EAN e FNSKU sempre visibili.</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca cliente, prodotto, EAN, FNSKU..."
            className="pl-9"
            data-testid="admin-magazzino-search"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Users className="h-4 w-4" /> Clienti</div>
          <div className="mt-2 text-2xl font-bold">{globalTotals.clienti}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-muted-foreground">Referenze</div>
          <div className="mt-2 text-2xl font-bold">{globalTotals.referenze}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-muted-foreground">Ricevuto</div>
          <div className="mt-2 text-2xl font-bold">{globalTotals.ricevuto}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-muted-foreground">Disponibile</div>
          <div className="mt-2 text-2xl font-bold text-emerald-700">{globalTotals.disponibile}</div>
        </Card>
      </div>

      {loading ? (
        <Card className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></Card>
      ) : filteredClienti.length === 0 ? (
        <Card className="py-16 text-center text-muted-foreground">Nessuna referenza trovata.</Card>
      ) : (
        <div className="space-y-4">
          {filteredClienti.map(({ cliente, rows, totals, totalReferenze }) => (
            <Card key={cliente.id} className="overflow-hidden" data-testid={`magazzino-cliente-${cliente.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold">{cliente.ragione_sociale}</h2>
                  <p className="text-sm text-muted-foreground">{totalReferenze} referenze · {totals.disponibile} disponibili</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">Ricevuto {totals.ricevuto}</Badge>
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700">In preparazione {totals.in_preparazione}</Badge>
                  <Badge variant="secondary" className="bg-slate-100 text-slate-600">Spedito {totals.spedito}</Badge>
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">Disponibile {totals.disponibile}</Badge>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prodotto</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead>FNSKU</TableHead>
                    <TableHead className="text-right">Ricevuto</TableHead>
                    <TableHead className="text-right">In preparazione</TableHead>
                    <TableHead className="text-right">Spedito</TableHead>
                    <TableHead className="text-right">Disponibile</TableHead>
                    <TableHead className="text-right">Dettaglio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nessuna referenza per questo cliente.</TableCell></TableRow>
                  ) : rows.map((row) => (
                    <TableRow key={`${cliente.id}-${row.ean}`} className={row.is_bundle ? "bg-primary/5" : ""}>
                      <TableCell className="max-w-sm">
                        <div className="flex items-center gap-2">
                          {row.is_bundle && <Badge variant="secondary" className="gap-1"><Layers className="h-3 w-3" /> Bundle</Badge>}
                          <span className="font-medium">{row.titolo || "—"}</span>
                        </div>
                        {row.is_bundle && row.componenti?.length > 0 && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {row.componenti.map((component) => `${component.quantita}× ${component.titolo || component.ean} (disp. ${component.disponibile})`).join(" + ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.ean || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.fnsku || "—"}</TableCell>
                      <TableCell className="text-right">{row.ricevuto}</TableCell>
                      <TableCell className="text-right text-orange-600">{row.in_preparazione}</TableCell>
                      <TableCell className="text-right text-slate-500">{row.spedito}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-700">{row.disponibile}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => apriMovimenti(cliente, row)} data-testid={`magazzino-movimenti-${cliente.id}-${row.ean}`}>
                          <Eye className="mr-1 h-4 w-4" /> Movimenti
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={movimentiOpen} onOpenChange={setMovimentiOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Movimenti stock</DialogTitle>
          </DialogHeader>
          {!movimenti ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-bold">{movimenti.titolo || "—"}</div>
                <div className="mt-1 flex flex-wrap gap-3 font-mono text-xs text-muted-foreground">
                  <span>EAN {movimenti.ean || "—"}</span>
                  <span>FNSKU {movimenti.fnsku || "—"}</span>
                  <span>{movimenti.cliente?.ragione_sociale}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">Entrate +{movimenti.totali?.entrate || 0}</Badge>
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700">Preparazioni -{movimenti.totali?.uscite || 0}</Badge>
                </div>
              </div>

              <Card className="overflow-hidden">
                {movimentiLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Movimento</TableHead>
                        <TableHead>Numero</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead className="text-right">Quantità</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(movimenti.movimenti || []).length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nessun movimento per questa referenza.</TableCell></TableRow>
                      ) : movimenti.movimenti.map((mov) => (
                        <TableRow key={`${mov.tipo}-${mov.id}`}>
                          <TableCell>
                            <span className={`inline-flex items-center gap-2 font-semibold ${mov.segno === "in" ? "text-emerald-700" : "text-orange-700"}`}>
                              {mov.segno === "in" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                              {mov.segno === "in" ? "Entrata" : "Uscita preparazione"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-left font-medium text-slate-950 underline-offset-4 hover:underline"
                              onClick={() => apriDocumentoMovimento(mov)}
                              disabled={!mov.ref_id}
                              data-testid={`magazzino-movimento-link-${mov.tipo}-${mov.ref_id || mov.id}`}
                            >
                              {mov.documento}
                            </Button>
                            <div className="font-mono text-[11px] text-muted-foreground">{mov.codice}</div>
                          </TableCell>
                          <TableCell>{formatDate(mov.data)}</TableCell>
                          <TableCell><Badge variant="secondary">{mov.stato}</Badge></TableCell>
                          <TableCell className={`text-right font-bold ${mov.segno === "in" ? "text-emerald-700" : "text-orange-700"}`}>
                            {mov.segno === "in" ? "+" : "-"}{mov.quantita}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

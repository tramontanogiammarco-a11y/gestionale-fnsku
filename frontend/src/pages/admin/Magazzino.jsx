import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Layers, Search, Users, Warehouse } from "lucide-react";
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

export default function AdminMagazzino() {
  const [loading, setLoading] = useState(true);
  const [clienti, setClienti] = useState([]);
  const [stockByCliente, setStockByCliente] = useState({});
  const [query, setQuery] = useState("");

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nessuna referenza per questo cliente.</TableCell></TableRow>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Warehouse, Layers } from "lucide-react";

// Magazzino virtuale del cliente: giacenze per EAN
export default function ClientMagazzino() {
  const [items, setItems] = useState(null);

  useEffect(() => { api.get("/magazzino").then((r) => setItems(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="client-magazzino">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight flex items-center gap-2">
          <Warehouse className="h-6 w-6 text-blue-600" /> Magazzino virtuale
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Giacenze disponibili per EAN presso il prep center.</p>
      </div>
      <Card>
        {!items ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>EAN</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>FNSKU</TableHead>
                <TableHead className="text-right">Ricevuto</TableHead>
                <TableHead className="text-right">In preparazione</TableHead>
                <TableHead className="text-right">Spedito</TableHead>
                <TableHead className="text-right">Disponibile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Magazzino vuoto. La merce comparirà qui quando il prep center la segna come "ricevuta".</TableCell></TableRow>
              )}
              {items.map((it) => (
                <TableRow key={it.ean} data-testid={`mag-row-${it.ean}`} className={it.is_bundle ? "bg-primary/5" : ""}>
                  <TableCell className="font-mono text-xs">{it.ean}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="flex items-center gap-2">
                      {it.is_bundle && (
                        <Badge variant="secondary" className="gap-1 shrink-0"><Layers className="h-3 w-3" /> Bundle</Badge>
                      )}
                      <span className="truncate">{it.titolo || "—"}</span>
                    </div>
                    {it.is_bundle && it.componenti?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {it.componenti.map((c) => `${c.quantita}× ${c.titolo || c.ean} (disp. ${c.disponibile})`).join(" + ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{it.fnsku || "—"}</TableCell>
                  <TableCell className="text-right">{it.is_bundle ? "—" : it.ricevuto}</TableCell>
                  <TableCell className="text-right text-orange-600">{it.in_preparazione}</TableCell>
                  <TableCell className="text-right text-slate-500">{it.spedito}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-700">
                    {it.disponibile}{it.is_bundle && <span className="text-[10px] font-normal text-muted-foreground ml-1">realizzabili</span>}
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

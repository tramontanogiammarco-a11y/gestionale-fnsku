import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { STATI_ENTRATA } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

export default function ClientSpedizioni() {
  const [entrate, setEntrate] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/entrate").then((r) => setEntrate(r.data));
    api.get("/dashboard/stats").then((r) => setStats(r.data));
  }, []);

  return (
    <div className="space-y-6" data-testid="client-spedizioni">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Stato spedizioni</h1>
        <p className="text-muted-foreground text-sm mt-1">Riepilogo di tutto ciò che hai in corso.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.keys(STATI_ENTRATA).map((s) => (
            <Card key={s} className="p-4" data-testid={`cstat-${s}`}>
              <div className="font-heading text-2xl font-bold">{stats.entrate_per_stato[s] ?? 0}</div>
              <div className="mt-2"><StatusBadge stato={s} /></div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        {!entrate ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Referenze</TableHead>
                <TableHead>Pezzi</TableHead>
                <TableHead>Annuncio</TableHead>
                <TableHead>Ricezione</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entrate.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Nessuna spedizione in corso.</TableCell></TableRow>
              )}
              {entrate.map((e) => (
                <TableRow key={e.id} data-testid={`csped-row-${e.id}`}>
                  <TableCell className="capitalize font-medium">{e.tipo}</TableCell>
                  <TableCell>{e.righe?.length || 0}</TableCell>
                  <TableCell>{e.righe?.reduce((a, r) => a + r.quantita, 0) || 0}</TableCell>
                  <TableCell>{new Date(e.data_annuncio).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell>{e.data_ricezione ? new Date(e.data_ricezione).toLocaleDateString("it-IT") : "—"}</TableCell>
                  <TableCell><StatusBadge stato={e.stato} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

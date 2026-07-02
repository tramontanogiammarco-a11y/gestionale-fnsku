import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ChevronRight } from "lucide-react";

export default function AdminPreparazioni() {
  const [preps, setPreps] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { api.get("/preparazioni").then((r) => setPreps(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="admin-preparazioni">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Preparazioni</h1>
        <p className="text-muted-foreground text-sm mt-1">Richieste di preparazione dei clienti dal magazzino.</p>
      </div>
      <Card>
        {!preps ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Righe</TableHead>
                <TableHead>Pezzi</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preps.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Nessuna preparazione richiesta.</TableCell></TableRow>
              )}
              {preps.map((p) => (
                <TableRow key={p.id} data-testid={`prep-row-${p.id}`} className="cursor-pointer" onClick={() => navigate(`/admin/preparazioni/${p.id}`)}>
                  <TableCell className="font-medium">{p.cliente_ragione_sociale}</TableCell>
                  <TableCell>{p.righe?.length || 0}</TableCell>
                  <TableCell>{p.righe?.reduce((a, r) => a + r.quantita, 0) || 0}</TableCell>
                  <TableCell>{new Date(p.created_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell><StatusBadge stato={p.stato} tipo="prep" /></TableCell>
                  <TableCell className="text-right"><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

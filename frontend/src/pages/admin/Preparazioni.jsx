import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ChevronRight, Trash2 } from "lucide-react";

export default function AdminPreparazioni() {
  const [preps, setPreps] = useState(null);
  const [view, setView] = useState("attive");
  const navigate = useNavigate();

  const load = useCallback(() => api.get("/preparazioni").then((r) => setPreps(r.data)), []);
  useEffect(() => { load(); }, [load]);
  const visiblePreps = (preps || []).filter((p) => view === "archivio" ? p.stato === "spedito" : p.stato !== "spedito");

  const eliminaPreparazione = async (event, prep) => {
    event.stopPropagation();
    const nome = prep.cliente_ragione_sociale || "questo cliente";
    if (!window.confirm(`Cancellare questa preparazione di ${nome}? Verranno eliminate anche le righe collegate.`)) return;
    try {
      await api.delete(`/preparazioni/${prep.id}`);
      toast.success("Preparazione cancellata");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Impossibile cancellare la preparazione");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-preparazioni">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Preparazioni</h1>
        <p className="text-muted-foreground text-sm mt-1">Richieste di preparazione dei clienti dal magazzino.</p>
      </div>
      {preps && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={view === "attive" ? "default" : "outline"} onClick={() => setView("attive")} data-testid="admin-prep-view-attive">
            Attive <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{preps.filter((p) => p.stato !== "spedito").length}</span>
          </Button>
          <Button size="sm" variant={view === "archivio" ? "default" : "outline"} onClick={() => setView("archivio")} data-testid="admin-prep-view-archivio">
            Archivio <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{preps.filter((p) => p.stato === "spedito").length}</span>
          </Button>
        </div>
      )}
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
              {visiblePreps.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">{view === "archivio" ? "Nessuna preparazione archiviata." : "Nessuna preparazione attiva."}</TableCell></TableRow>
              )}
              {visiblePreps.map((p) => (
                <TableRow key={p.id} data-testid={`prep-row-${p.id}`} className="cursor-pointer" onClick={() => navigate(`/admin/preparazioni/${p.id}`)}>
                  <TableCell className="font-medium">{p.cliente_ragione_sociale}</TableCell>
                  <TableCell>{p.righe?.length || 0}</TableCell>
                  <TableCell>{p.righe?.reduce((a, r) => a + r.quantita, 0) || 0}</TableCell>
                  <TableCell>{new Date(p.created_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell><StatusBadge stato={p.stato} tipo="prep" /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        data-testid={`delete-prep-admin-${p.id}`}
                        onClick={(event) => eliminaPreparazione(event, p)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
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

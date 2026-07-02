import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { STATI_ENTRATA } from "@/lib/statuses";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight } from "lucide-react";

export default function AdminEntrate() {
  const [entrate, setEntrate] = useState(null);
  const [params, setParams] = useSearchParams();
  const stato = params.get("stato") || "";
  const navigate = useNavigate();

  const load = () => {
    const q = stato ? `?stato=${stato}` : "";
    api.get(`/entrate${q}`).then((r) => setEntrate(r.data));
  };
  useEffect(load, [stato]);

  return (
    <div className="space-y-6" data-testid="admin-entrate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Entrate merce</h1>
          <p className="text-muted-foreground text-sm mt-1">Arrivi annunciati dai clienti.</p>
        </div>
      </div>

      {/* Filtri per stato */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={stato === "" ? "default" : "outline"}
          onClick={() => setParams({})}
          data-testid="filter-tutti"
        >
          Tutti
        </Button>
        {Object.keys(STATI_ENTRATA).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={stato === s ? "default" : "outline"}
            onClick={() => setParams({ stato: s })}
            data-testid={`filter-${s}`}
          >
            {STATI_ENTRATA[s].label}
          </Button>
        ))}
      </div>

      <Card>
        {!entrate ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Referenze</TableHead>
                <TableHead>Data annuncio</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entrate.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nessuna entrata trovata.
                  </TableCell>
                </TableRow>
              )}
              {entrate.map((e) => (
                <TableRow
                  key={e.id}
                  data-testid={`entrata-row-${e.id}`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/entrate/${e.id}`)}
                >
                  <TableCell className="font-medium">{e.cliente_ragione_sociale}</TableCell>
                  <TableCell className="capitalize">{e.tipo}</TableCell>
                  <TableCell>{e.righe?.length || 0}</TableCell>
                  <TableCell>{new Date(e.data_annuncio).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell><StatusBadge stato={e.stato} /></TableCell>
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

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { STATI_ENTRATA } from "@/lib/statuses";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Archive, ChevronRight, Loader2, ScanBarcode, Trash2 } from "lucide-react";

const STATI_RICEZIONE_APERTA = new Set(["in_attesa", "in_lavorazione"]);

export default function AdminEntrate() {
  const [entrate, setEntrate] = useState(null);
  const [view, setView] = useState("attive");
  const [params, setParams] = useSearchParams();
  const stato = params.get("stato") || "";
  const navigate = useNavigate();

  const load = useCallback(() => {
    const q = stato ? `?stato=${stato}` : "";
    api.get(`/entrate${q}`).then((r) => setEntrate(r.data));
  }, [stato]);
  useEffect(() => { load(); }, [load]);
  const entrateAperte = (entrate || []).filter((e) => STATI_RICEZIONE_APERTA.has(e.stato));
  const entrateArchiviate = (entrate || []).filter((e) => !STATI_RICEZIONE_APERTA.has(e.stato));
  const visibleEntrate = view === "archivio" ? entrateArchiviate : entrateAperte;
  const percorsoEntrata = (entrata) => (
    STATI_RICEZIONE_APERTA.has(entrata.stato)
      ? `/admin/wms/inbound/${entrata.id}`
      : `/admin/entrate/${entrata.id}`
  );

  const eliminaEntrata = async (event, entrata) => {
    event.stopPropagation();
    const nome = entrata.cliente_ragione_sociale || "questo cliente";
    if (!window.confirm(`Cancellare questa entrata di ${nome}? Verranno eliminate anche le righe collegate.`)) return;
    try {
      await api.delete(`/entrate/${entrata.id}`);
      toast.success("Entrata cancellata");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Impossibile cancellare l'entrata");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-entrate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Ricezione merce</h1>
          <p className="mt-1 text-sm text-muted-foreground">EAN/FNSKU, quantità, ubicazioni e anomalie.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-teal-200 bg-teal-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-teal-700 shadow-sm">
            <ScanBarcode className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-heading text-base font-semibold text-slate-950">Scanner ricezione</h2>
            <p className="text-sm text-slate-600">{entrateAperte.length} arrivi da ricevere o completare</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={view === "attive" ? "default" : "outline"} onClick={() => setView("attive")} data-testid="entrate-admin-view-attive">
          <ScanBarcode className="mr-2 h-4 w-4" />
          Da ricevere <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{entrateAperte.length}</span>
        </Button>
        <Button size="sm" variant={view === "archivio" ? "default" : "outline"} onClick={() => setView("archivio")} data-testid="entrate-admin-view-archivio">
          <Archive className="mr-2 h-4 w-4" />
          Storico <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{entrateArchiviate.length}</span>
        </Button>
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

      <div className="grid gap-3 md:hidden">
        {!entrate ? (
          <Card className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </Card>
        ) : visibleEntrate.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {view === "archivio" ? "Nessuna entrata nello storico." : "Nessun arrivo da ricevere."}
          </Card>
        ) : visibleEntrate.map((e) => (
          <Card key={e.id} className="p-4" data-testid={`entrata-mobile-${e.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-950">{e.cliente_ragione_sociale}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="capitalize">{e.tipo}</span> · {e.righe?.length || 0} referenze · {new Date(e.data_annuncio).toLocaleDateString("it-IT")}
                </p>
              </div>
              <StatusBadge stato={e.stato} />
            </div>
            {(e.corriere || e.ddt || e.tracking) && (
              <p className="mt-3 truncate font-mono text-xs text-slate-600">
                {[e.corriere, e.ddt ? `DDT ${e.ddt}` : null, e.tracking].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <Button
                className="min-w-0 flex-1"
                variant={STATI_RICEZIONE_APERTA.has(e.stato) ? "default" : "outline"}
                data-testid={`open-entrata-mobile-${e.id}`}
                onClick={() => navigate(percorsoEntrata(e))}
              >
                {STATI_RICEZIONE_APERTA.has(e.stato) ? <ScanBarcode className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                {e.stato === "in_lavorazione" ? "Continua ricezione" : e.stato === "in_attesa" ? "Ricevi con scanner" : "Apri storico"}
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="shrink-0 text-destructive hover:text-destructive"
                data-testid={`delete-entrata-mobile-${e.id}`}
                onClick={(event) => eliminaEntrata(event, e)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
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
                <TableHead>Corriere / DDT / Tracking</TableHead>
                <TableHead>Referenze</TableHead>
                <TableHead>Data annuncio</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEntrate.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    {view === "archivio" ? "Nessuna entrata nello storico." : "Nessun arrivo da ricevere."}
                  </TableCell>
                </TableRow>
              )}
              {visibleEntrate.map((e) => (
                <TableRow
                  key={e.id}
                  data-testid={`entrata-row-${e.id}`}
                  className="cursor-pointer"
                  onClick={() => navigate(percorsoEntrata(e))}
                >
                  <TableCell className="font-medium">{e.cliente_ragione_sociale}</TableCell>
                  <TableCell className="capitalize">{e.tipo}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {[e.corriere, e.ddt ? `DDT ${e.ddt}` : null, e.tracking].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell>{e.righe?.length || 0}</TableCell>
                  <TableCell>{new Date(e.data_annuncio).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell><StatusBadge stato={e.stato} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant={STATI_RICEZIONE_APERTA.has(e.stato) ? "default" : "outline"}
                        data-testid={`open-entrata-${e.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(percorsoEntrata(e));
                        }}
                      >
                        {STATI_RICEZIONE_APERTA.has(e.stato) ? (
                          <ScanBarcode className="mr-2 h-4 w-4" />
                        ) : (
                          <Archive className="mr-2 h-4 w-4" />
                        )}
                        {e.stato === "in_lavorazione"
                          ? "Continua ricezione"
                          : e.stato === "in_attesa"
                            ? "Ricevi con scanner"
                            : "Apri storico"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        data-testid={`delete-entrata-${e.id}`}
                        onClick={(event) => eliminaEntrata(event, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
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

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { FLUSSO_PREP, STATI_PREP, SERVIZI } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, ClipboardList, Trash2 } from "lucide-react";

export default function ClientPreparazioneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prep, setPrep] = useState(null);

  useEffect(() => {
    api.get(`/preparazioni/${id}`).then((r) => setPrep(r.data)).catch((e) => {
      const s = e?.response?.status;
      if (s === 403) toast.error("Questa preparazione non appartiene al tuo account.");
      else if (s === 404) toast.error("Preparazione non trovata.");
      else if (s !== 401) toast.error("Impossibile caricare la preparazione.");
      navigate("/app/preparazioni");
    });
  }, [id, navigate]);

  if (!prep)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const elimina = async () => {
    if (!window.confirm("Cancellare questa preparazione? Potrai crearne una nuova subito dopo.")) return;
    try {
      await api.delete(`/preparazioni/${id}`);
      toast.success("Preparazione cancellata");
      navigate("/app/preparazioni");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Impossibile cancellare la preparazione");
    }
  };

  return (
    <div className="space-y-6" data-testid="client-prep-detail">
      <button onClick={() => navigate("/app/preparazioni")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4" /> Torna alle preparazioni
      </button>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-bold tracking-tight">Preparazione</h1>
            <StatusBadge stato={prep.stato} tipo="prep" />
          </div>
          {prep.stato === "richiesta" && (
            <Button variant="outline" onClick={elimina} data-testid="delete-prep-detail" className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" /> Cancella richiesta
            </Button>
          )}
        </div>
        <div className="text-sm text-slate-600 mt-1">Creata il {new Date(prep.created_at).toLocaleDateString("it-IT")}</div>
        <div className="flex items-center gap-1 mt-3 max-w-md">
          {FLUSSO_PREP.map((s, i) => {
            const done = FLUSSO_PREP.indexOf(prep.stato) >= i;
            return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_PREP[s].label} />;
          })}
        </div>
      </div>

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2 mb-3"><ClipboardList className="h-5 w-5 text-blue-600" /> Prodotti e lavorazioni richieste</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>EAN</TableHead><TableHead>FNSKU</TableHead><TableHead>Lavorazioni</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {prep.righe.map((r) => (
              <TableRow key={r.id} data-testid={`cprep-riga-${r.id}`}>
                <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                <TableCell className="font-mono text-xs">{r.fnsku || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(r.servizi || []).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    {(r.servizi || []).map((s) => (
                      <span key={s} className="inline-flex rounded-full bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 text-[10px] font-medium">
                        {SERVIZI[s]?.label || s}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">{r.quantita}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Le etichette Amazon e UPS si caricano sui <b>colli</b> nella sezione <b>Spedizioni</b>, quando il prep center li ha preparati.
        </p>
      </Card>
    </div>
  );
}

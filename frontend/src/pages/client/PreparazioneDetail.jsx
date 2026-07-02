import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { FLUSSO_PREP, STATI_PREP } from "@/lib/statuses";
import { ClientBoxUpload } from "@/components/ClientBoxUpload";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, Box as BoxIcon, ClipboardList } from "lucide-react";

export default function ClientPreparazioneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prep, setPrep] = useState(null);
  const [boxes, setBoxes] = useState([]);

  const load = () => {
    api.get(`/preparazioni/${id}`).then((r) => setPrep(r.data)).catch((e) => {
      const s = e?.response?.status;
      if (s === 403) toast.error("Questa preparazione non appartiene al tuo account.");
      else if (s === 404) toast.error("Preparazione non trovata.");
      else if (s !== 401) toast.error("Impossibile caricare la preparazione.");
      navigate("/app/preparazioni");
    });
    api.get(`/box?preparazione_id=${id}`).then((r) => setBoxes(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);

  if (!prep)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="client-prep-detail">
      <button onClick={() => navigate("/app/preparazioni")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4" /> Torna alle preparazioni
      </button>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Preparazione</h1>
          <StatusBadge stato={prep.stato} tipo="prep" />
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
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2 mb-3"><ClipboardList className="h-5 w-5 text-blue-600" /> Prodotti richiesti</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>EAN</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {prep.righe.map((r) => (
              <TableRow key={r.id} data-testid={`cprep-riga-${r.id}`}>
                <TableCell className="font-mono text-xs">{r.ean}</TableCell>
                <TableCell className="font-mono text-xs">{r.sku || "—"}</TableCell>
                <TableCell className="text-right">{r.quantita}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2 mb-3"><BoxIcon className="h-5 w-5 text-blue-600" /> Scatole preparate</h2>
        {boxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Il prep center non ha ancora preparato le scatole. Quando saranno pronte, qui potrai caricare le etichette Amazon e UPS.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {boxes.map((b) => <ClientBoxUpload key={b.id} box={b} onDone={load} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

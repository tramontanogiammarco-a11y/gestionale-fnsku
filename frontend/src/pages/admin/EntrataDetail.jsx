import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, PackageCheck } from "lucide-react";

function azioneErrore(e) {
  if (e?.response?.status === 403)
    return "Azione riservata all'amministratore: esci e rientra come admin.";
  return e?.response?.data?.detail || "Operazione non riuscita. Riprova.";
}

export default function AdminEntrataDetail() {
  const { id } = useParams();
  const [entrata, setEntrata] = useState(null);

  const load = () => api.get(`/entrate/${id}`).then((r) => setEntrata(r.data));
  useEffect(() => { load(); }, [id]);

  const ricevi = async () => {
    try {
      await api.post(`/entrate/${id}/ricevi`);
      toast.success("Entrata segnata come ricevuta");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  if (!entrata)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="entrata-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {entrata.cliente_ragione_sociale} · <span className="capitalize">{entrata.tipo}</span>
            {entrata.colli > 1 ? <span className="text-muted-foreground text-lg"> ×{entrata.colli}</span> : null}
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge stato={entrata.stato} />
            <span className="text-xs text-muted-foreground">
              Annunciata il {new Date(entrata.data_annuncio).toLocaleDateString("it-IT")}
            </span>
          </div>
          {(entrata.ddt || entrata.tracking) && (
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              {entrata.ddt && <span className="text-slate-600">DDT: <span className="font-mono">{entrata.ddt}</span></span>}
              {entrata.tracking && <span className="text-slate-600">Tracking: <span className="font-mono">{entrata.tracking}</span></span>}
            </div>
          )}
          {entrata.note && <p className="text-sm text-muted-foreground mt-2">{entrata.note}</p>}
        </div>
        <div className="flex items-center gap-2">
          {entrata.stato === "in_attesa" ? (
            <Button data-testid="ricevi-btn" onClick={ricevi}>
              <PackageCheck className="h-4 w-4 mr-2" /> Segna Arrivato
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600 font-medium" data-testid="entrata-arrivato">
              <PackageCheck className="h-4 w-4" /> Merce arrivata — a magazzino
            </span>
          )}
        </div>
      </div>

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold mb-4">Contenuto arrivo (EAN · quantità)</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EAN</TableHead>
              <TableHead className="text-right">Quantità</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entrata.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`riga-${rg.id}`}>
                <TableCell className="font-mono text-xs">{rg.ean}</TableCell>
                <TableCell className="text-right">{rg.quantita}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          La generazione degli FNSKU e le lavorazioni avvengono nella sezione <b>Preparazioni</b>.
        </p>
      </Card>
    </div>
  );
}

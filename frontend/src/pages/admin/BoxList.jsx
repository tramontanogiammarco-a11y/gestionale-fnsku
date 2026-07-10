import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { STATI_BOX } from "@/lib/statuses";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, FileText } from "lucide-react";

export default function AdminBox() {
  const [boxes, setBoxes] = useState(null);

  const load = () => api.get("/box").then((r) => setBoxes(r.data));
  useEffect(() => { load(); }, []);

  const cambiaStato = async (id, stato) => {
    try {
      await api.put(`/box/${id}/stato`, { stato });
      toast.success("Stato aggiornato");
      load();
    } catch (e) {
      const msg = e?.response?.status === 403
        ? "Azione riservata all'amministratore: esci e rientra come admin."
        : (e?.response?.data?.detail || "Operazione non riuscita.");
      toast.error(msg);
    }
  };

  const nextBoxAction = (stato) => ({
    in_preparazione: { label: "Pronto", next: "pronto" },
    pronto: { label: "Spedito", next: "spedito" },
  }[stato]);

  return (
    <div className="space-y-6" data-testid="admin-box">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Box</h1>
        <p className="text-muted-foreground text-sm mt-1">Tutti i box in uscita verso Amazon.</p>
      </div>
      <Card>
        {!boxes ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Box</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Dimensioni</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Ref.</TableHead>
                <TableHead>Etichette</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boxes.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Nessun box.</TableCell></TableRow>
              )}
              {boxes.map((b) => (
                <TableRow key={b.id} data-testid={`box-row-${b.id}`}>
                  <TableCell className="font-mono font-medium">{b.numero_box}</TableCell>
                  <TableCell>{b.cliente_ragione_sociale}</TableCell>
                  <TableCell className="text-xs">
                    {b.lunghezza_cm && b.larghezza_cm && b.altezza_cm
                      ? `${b.lunghezza_cm}×${b.larghezza_cm}×${b.altezza_cm} cm` : "—"}
                  </TableCell>
                  <TableCell>{b.peso_kg ? `${b.peso_kg} kg` : "—"}</TableCell>
                  <TableCell>{b.contenuto?.length || 0}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {b.etichetta_amazon_pdf_url && b.etichetta_amazon_pdf_url === b.etichetta_ups_pdf_url ? (
                        <a href={fileUrl(b.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" title="Etichette Amazon + UPS" className="inline-flex items-center gap-1 text-emerald-600">
                          <FileText className="h-4 w-4" /><span className="text-xs">Etichette</span>
                        </a>
                      ) : (
                        <>
                          {b.etichetta_amazon_pdf_url && (
                            <a href={fileUrl(b.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer" title="Amazon" className="text-blue-600"><FileText className="h-4 w-4" /></a>
                          )}
                          {b.etichetta_ups_pdf_url && (
                            <a href={fileUrl(b.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer" title="UPS" className="text-emerald-600"><FileText className="h-4 w-4" /></a>
                          )}
                        </>
                      )}
                      {!b.etichetta_amazon_pdf_url && !b.etichetta_ups_pdf_url && <span className="text-xs text-muted-foreground">In attesa</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {nextBoxAction(b.stato) && (
                        <Button size="sm" onClick={() => cambiaStato(b.id, nextBoxAction(b.stato).next)} data-testid={`box-next-${b.id}`}>
                          {nextBoxAction(b.stato).label}
                        </Button>
                      )}
                      <Select value={b.stato} onValueChange={(v) => cambiaStato(b.id, v)}>
                        <SelectTrigger className="h-8 w-40" data-testid={`box-stato-${b.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(STATI_BOX).map((s) => <SelectItem key={s} value={s}>{STATI_BOX[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
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

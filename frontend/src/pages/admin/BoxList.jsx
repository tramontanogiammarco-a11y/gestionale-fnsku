import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileText } from "lucide-react";

export default function AdminBox() {
  const [boxes, setBoxes] = useState(null);

  const load = () => api.get("/box").then((r) => setBoxes(r.data));
  useEffect(() => { load(); }, []);

  const visibleBoxes = (boxes || []).filter((b) => b.stato === "spedito");
  const sharedPdfCounts = countSharedLabelUrls(boxes || []);

  return (
    <div className="space-y-6" data-testid="admin-box">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Box spediti</h1>
        <p className="text-muted-foreground text-sm mt-1">Archivio dei colli gia usciti verso Amazon.</p>
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
              {visibleBoxes.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Nessun box spedito.</TableCell></TableRow>
              )}
              {visibleBoxes.map((b) => (
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
                          <FileText className="h-4 w-4" /><span className="text-xs">{sharedPdfCounts[b.etichetta_amazon_pdf_url] > 1 ? `Gruppo ${sharedPdfCounts[b.etichetta_amazon_pdf_url]} box` : "Etichette"}</span>
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
                  <TableCell><StatusBadge stato={b.stato} tipo="box" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function countSharedLabelUrls(boxes) {
  return boxes.reduce((acc, box) => {
    const url = box.etichetta_amazon_pdf_url && box.etichetta_amazon_pdf_url === box.etichetta_ups_pdf_url
      ? box.etichetta_amazon_pdf_url
      : null;
    if (url) acc[url] = (acc[url] || 0) + 1;
    return acc;
  }, {});
}

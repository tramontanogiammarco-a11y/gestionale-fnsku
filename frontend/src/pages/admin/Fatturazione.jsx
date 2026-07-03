import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Receipt, Download } from "lucide-react";

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export default function AdminFatturazione() {
  const now = new Date();
  const [clienti, setClienti] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [anno, setAnno] = useState(now.getFullYear());
  const [mese, setMese] = useState(now.getMonth() + 1);
  const [pallet, setPallet] = useState(0);
  const [fattura, setFattura] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/clienti").then((r) => setClienti(r.data)); }, []);

  const calcola = async () => {
    if (!clienteId) { toast.error("Seleziona un cliente"); return; }
    setLoading(true);
    try {
      const r = await api.get(`/fatturazione?cliente_id=${clienteId}&anno=${anno}&mese=${mese}&pallet=${Number(pallet) || 0}`);
      setFattura(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore nel calcolo");
    } finally { setLoading(false); }
  };

  const scaricaPdf = async () => {
    if (!clienteId) { toast.error("Seleziona un cliente"); return; }
    try {
      const res = await api.get(`/fatturazione/pdf?cliente_id=${clienteId}&anno=${anno}&mese=${mese}&pallet=${Number(pallet) || 0}`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch (e) {
      toast.error("Errore nella generazione PDF");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-fatturazione">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-7 w-7 text-blue-600" /> Fatturazione
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Calcolo automatico dei costi mensili per cliente in base al listino.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <Label className="text-xs">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger className="mt-1" data-testid="fatt-cliente"><SelectValue placeholder="Seleziona un cliente" /></SelectTrigger>
              <SelectContent>
                {clienti.map((c) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mese</Label>
            <Select value={String(mese)} onValueChange={(v) => setMese(Number(v))}>
              <SelectTrigger className="mt-1" data-testid="fatt-mese"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESI.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Anno</Label>
            <Input type="number" data-testid="fatt-anno" value={anno} onChange={(e) => setAnno(Number(e.target.value))} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">N. pallet stoccati</Label>
            <Input type="number" min={0} data-testid="fatt-pallet" value={pallet} onChange={(e) => setPallet(e.target.value)} className="mt-1" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={calcola} disabled={loading} data-testid="fatt-calcola-btn">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Calcola
          </Button>
          <Button variant="outline" onClick={scaricaPdf} disabled={!fattura} data-testid="fatt-pdf-btn">
            <Download className="h-4 w-4 mr-2" /> Scarica PDF
          </Button>
        </div>
      </Card>

      {fattura && (
        <Card className="p-5" data-testid="fatt-risultato">
          <h2 className="font-heading text-lg font-semibold mb-3">
            {fattura.ragione_sociale} — periodo {fattura.periodo}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrizione</TableHead>
                <TableHead className="text-right">Q.tà</TableHead>
                <TableHead className="text-right">Prezzo</TableHead>
                <TableHead className="text-right">Importo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fattura.righe.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nessun costo nel periodo selezionato.</TableCell></TableRow>
              )}
              {fattura.righe.map((r, i) => (
                <TableRow key={i} data-testid={`fatt-riga-${i}`}>
                  <TableCell>{r.descrizione}</TableCell>
                  <TableCell className="text-right">{r.quantita}</TableCell>
                  <TableCell className="text-right">€ {Number(r.prezzo).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">€ {Number(r.importo).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Imponibile</span><span data-testid="fatt-subtotale">€ {Number(fattura.subtotale).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IVA {fattura.iva_perc}%</span><span>€ {Number(fattura.iva_importo).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-base border-t pt-1"><span>TOTALE</span><span data-testid="fatt-totale">€ {Number(fattura.totale).toFixed(2)}</span></div>
          </div>
        </Card>
      )}
    </div>
  );
}

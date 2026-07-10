import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Receipt, Download, Calculator, Boxes, ClipboardList, PackageOpen } from "lucide-react";

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export default function AdminFatturazione() {
  const now = new Date();
  const [searchParams] = useSearchParams();
  const [clienti, setClienti] = useState([]);
  const [clienteId, setClienteId] = useState(searchParams.get("cliente_id") || "");
  const [anno, setAnno] = useState(now.getFullYear());
  const [mese, setMese] = useState(now.getMonth() + 1);
  const [pallet, setPallet] = useState(0);
  const [fattura, setFattura] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/clienti").then((r) => setClienti(r.data)); }, []);
  useEffect(() => {
    const fromUrl = searchParams.get("cliente_id");
    if (fromUrl) setClienteId(fromUrl);
  }, [searchParams]);

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
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
          <Receipt className="h-3.5 w-3.5" /> Report economico
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight">Fatturazione</h1>
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
        <div className="space-y-4" data-testid="fatt-risultato">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: "Totale", value: `€ ${Number(fattura.totale).toFixed(2)}`, icon: Calculator, tone: "bg-teal-50 text-teal-700" },
              { label: "Entrate", value: (fattura.metriche.entrata_pallet || 0) + (fattura.metriche.entrata_scatola || 0), icon: PackageOpen, tone: "bg-sky-50 text-sky-700" },
              { label: "Preparazioni", value: fattura.metriche.preparazioni || 0, icon: ClipboardList, tone: "bg-indigo-50 text-indigo-700" },
              { label: "Box", value: fattura.metriche.box || 0, icon: Boxes, tone: "bg-amber-50 text-amber-700" },
            ].map((kpi) => (
              <Card key={kpi.label} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{kpi.label}</div>
                    <div className="mt-3 font-heading text-3xl font-black">{kpi.value}</div>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpi.tone}`}><kpi.icon className="h-5 w-5" /></div>
                </div>
              </Card>
            ))}
          </div>
          <Card className="p-5">
            <h2 className="font-heading text-lg font-semibold mb-3">Costo per voce</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fattura.righe.map((r) => ({ name: r.codice, importo: Number(r.importo || 0) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="importo" fill="#0f766e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
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
        </div>
      )}
    </div>
  );
}

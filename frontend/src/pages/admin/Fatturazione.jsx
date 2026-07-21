import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Receipt, Download, Calculator, Boxes, ClipboardList, PackageOpen, Warehouse } from "lucide-react";
import { STATI_PREP } from "@/lib/statuses";

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export default function AdminFatturazione({ clientMode = false }) {
  const now = new Date();
  const [searchParams] = useSearchParams();
  const [clienti, setClienti] = useState([]);
  const [clienteId, setClienteId] = useState(clientMode ? "" : searchParams.get("cliente_id") || "");
  const [anno, setAnno] = useState(now.getFullYear());
  const [mese, setMese] = useState(now.getMonth() + 1);
  const [pallet, setPallet] = useState(0);
  const [fattura, setFattura] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientMode) api.get("/clienti").then((r) => setClienti(r.data));
  }, [clientMode]);
  useEffect(() => {
    const fromUrl = searchParams.get("cliente_id");
    if (!clientMode && fromUrl) setClienteId(fromUrl);
  }, [clientMode, searchParams]);

  const calcola = async (silent = false) => {
    if (!clientMode && !clienteId) {
      if (!silent) toast.error("Seleziona un cliente");
      return;
    }
    setLoading(true);
    try {
      const query = new URLSearchParams({
        anno: String(anno),
        mese: String(mese),
        pallet: String(clientMode ? 0 : Number(pallet) || 0),
      });
      if (!clientMode) query.set("cliente_id", clienteId);
      const r = await api.get(`/fatturazione?${query.toString()}`);
      setFattura(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Errore nel calcolo");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (clientMode || clienteId) calcola(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientMode, clienteId, anno, mese]);

  const scaricaPdf = async () => {
    if (!clientMode && !clienteId) { toast.error("Seleziona un cliente"); return; }
    try {
      const query = new URLSearchParams({
        anno: String(anno),
        mese: String(mese),
        pallet: String(clientMode ? 0 : Number(pallet) || 0),
      });
      if (!clientMode) query.set("cliente_id", clienteId);
      const res = await api.get(`/fatturazione/pdf?${query.toString()}`, { responseType: "blob" });
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
        <p className="text-muted-foreground text-sm mt-1">
          {clientMode ? "Costi live delle richieste completate, divisi per entrate, preparazioni, stoccaggio e box." : "Calcolo automatico dei costi mensili per cliente in base al listino."}
        </p>
      </div>

      <Card className="p-5">
        <div className={`grid grid-cols-1 gap-3 items-end ${clientMode ? "md:grid-cols-3" : "md:grid-cols-5"}`}>
          {!clientMode && (
            <div className="md:col-span-2">
              <Label className="text-xs">Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger className="mt-1" data-testid="fatt-cliente"><SelectValue placeholder="Seleziona un cliente" /></SelectTrigger>
                <SelectContent>
                  {clienti.map((c) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
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
          {!clientMode && (
            <div>
              <Label className="text-xs">N. pallet stoccati</Label>
              <Input type="number" min={0} data-testid="fatt-pallet" value={pallet} onChange={(e) => setPallet(e.target.value)} className="mt-1" />
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={() => calcola()} disabled={loading} data-testid="fatt-calcola-btn">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Aggiorna
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
              { label: "Stoccaggio", value: `${fattura.dettaglio?.stoccaggio?.pallet || 0} pallet`, icon: Warehouse, tone: "bg-emerald-50 text-emerald-700" },
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

          <EntrateFatturazione entrate={fattura.dettaglio?.entrate || []} />
          <PreparazioniFatturazione preparazioni={fattura.dettaglio?.preparazioni || []} />
          <StoccaggioFatturazione stoccaggio={fattura.dettaglio?.stoccaggio} clientMode={clientMode} />

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

function EntrateFatturazione({ entrate }) {
  return (
    <Card className="p-5" data-testid="fatt-entrate-dettaglio">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Entrate</h2>
          <p className="text-xs text-muted-foreground">Merce ricevuta nel periodo, conteggiata per pallet o scatole.</p>
        </div>
        <Badge variant="secondary">{entrate.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Colli</TableHead>
            <TableHead className="text-right">Pezzi</TableHead>
            <TableHead className="text-right">Prezzo</TableHead>
            <TableHead className="text-right">Importo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entrate.length === 0 && (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nessuna entrata fatturabile nel periodo.</TableCell></TableRow>
          )}
          {entrate.map((entrata) => (
            <TableRow key={entrata.id}>
              <TableCell>{formatDate(entrata.data_ricezione)}</TableCell>
              <TableCell className="capitalize">{entrata.tipo}</TableCell>
              <TableCell className="text-right">{entrata.costo?.quantita || 0}</TableCell>
              <TableCell className="text-right">{entrata.pezzi || 0}</TableCell>
              <TableCell className="text-right">{eur(entrata.costo?.prezzo)}</TableCell>
              <TableCell className="text-right font-medium">{eur(entrata.costo?.importo)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PreparazioniFatturazione({ preparazioni }) {
  return (
    <Card className="p-5" data-testid="fatt-preparazioni-dettaglio">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Preparazione per preparazione</h2>
          <p className="text-xs text-muted-foreground">Conteggiate solo quando passano a Pronto nel periodo selezionato.</p>
        </div>
        <Badge variant="secondary">{preparazioni.length}</Badge>
      </div>
      <div className="space-y-3">
        {preparazioni.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">
            Nessuna preparazione pronta nel periodo.
          </div>
        )}
        {preparazioni.map((prep, index) => (
          <div key={prep.id} className="rounded-md border border-slate-200 bg-white p-4" data-testid={`fatt-prep-${prep.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-heading text-base font-bold">Preparazione {index + 1}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Pronta il {formatDate(prep.data_pronto)} · {prep.pezzi || 0} pezzi · {prep.boxes?.length || 0} box
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={STATI_PREP[prep.stato]?.cls || ""}>{STATI_PREP[prep.stato]?.label || prep.stato}</Badge>
                <div className="text-right font-heading text-lg font-black">{eur(prep.totale)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prodotto</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead>FNSKU</TableHead>
                      <TableHead className="text-right">Q.tà</TableHead>
                      <TableHead>Lavorazioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(prep.righe || []).map((riga) => (
                      <TableRow key={riga.id}>
                        <TableCell className="font-medium">{riga.titolo || riga.ean}</TableCell>
                        <TableCell className="font-mono text-xs">{riga.ean}</TableCell>
                        <TableCell className="font-mono text-xs">{riga.fnsku || "-"}</TableCell>
                        <TableCell className="text-right">{riga.quantita}</TableCell>
                        <TableCell>{(riga.servizi || []).map(serviceLabel).join(", ") || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Costi preparazione</div>
                {(prep.costi || []).length === 0 && <div className="text-sm text-muted-foreground">Nessun costo collegato.</div>}
                <div className="space-y-2">
                  {(prep.costi || []).map((costo) => (
                    <div key={costo.codice} className="flex items-center justify-between gap-3 text-sm">
                      <div>
                        <div className="font-medium">{costo.descrizione}</div>
                        <div className="text-xs text-muted-foreground">{costo.quantita} × {eur(costo.prezzo)}</div>
                      </div>
                      <div className="font-semibold">{eur(costo.importo)}</div>
                    </div>
                  ))}
                </div>
                {(prep.boxes || []).length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-muted-foreground">
                    Box: {prep.boxes.map((box) => box.numero_box).join(", ")}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StoccaggioFatturazione({ stoccaggio, clientMode }) {
  const pallet = Number(stoccaggio?.pallet || 0);
  return (
    <Card className="p-5" data-testid="fatt-stoccaggio-dettaglio">
      <h2 className="font-heading text-lg font-semibold">Stoccaggio</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {clientMode ? "Il costo compare quando viene inserito nel conteggio mensile." : "Calcolato sui pallet stoccati inseriti nel filtro sopra."}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Pallet" value={pallet} />
        <MiniStat label="Prezzo pallet/mese" value={eur(stoccaggio?.prezzo)} />
        <MiniStat label="Importo" value={eur(stoccaggio?.importo)} strong />
      </div>
    </Card>
  );
}

function MiniStat({ label, value, strong = false }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-2 font-heading ${strong ? "text-xl font-black" : "text-lg font-bold"}`}>{value}</div>
    </div>
  );
}

function serviceLabel(code) {
  return {
    fnsku: "FNSKU",
    busta: "Busta",
    nastratura: "Nastratura",
    pluriball: "Pluriball",
  }[code] || code;
}

function eur(value) {
  return `€ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

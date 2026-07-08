import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { STATI_PREP, SERVIZI } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Barcode, Save, ClipboardList } from "lucide-react";

function azioneErrore(e) {
  if (e?.response?.status === 403)
    return "Azione riservata all'amministratore: esci e rientra come admin.";
  return e?.response?.data?.detail || "Operazione non riuscita.";
}

function parseGruppiAmazon(note = "") {
  const match = note.match(/\[GRUPPI AMAZON\]([\s\S]*?)\[\/GRUPPI AMAZON\]/);
  if (!match) return { hasGruppi: false, noteCliente: note };
  const block = match[1] || "";
  const totalMatch = block.match(/Totale pezzi:\s*(\d+)/i);
  const gruppi = [...block.matchAll(/-\s*(.+?):\s*(\d+)\s*pz/gi)].map((m) => ({
    nome: m[1].trim(),
    quantita: Number(m[2]),
  }));
  const noteCliente = note
    .replace(match[0], "")
    .trim()
    .replace(/^Note cliente:\s*/i, "")
    .trim();
  return {
    hasGruppi: true,
    totale: totalMatch ? Number(totalMatch[1]) : gruppi.reduce((sum, g) => sum + g.quantita, 0),
    gruppi,
    noteCliente,
  };
}

export default function AdminPreparazioneDetail() {
  const { id } = useParams();
  const [prep, setPrep] = useState(null);
  const [fnskuEdit, setFnskuEdit] = useState({});
  const [selezione, setSelezione] = useState({});
  const [copie, setCopie] = useState({});
  const [formato, setFormato] = useState("50x30");
  const [formati, setFormati] = useState(["50x30"]);
  const [generando, setGenerando] = useState(false);

  const load = () => {
    api.get(`/preparazioni/${id}`).then((r) => {
      setPrep(r.data);
      const fe = {}, cp = {};
      r.data.righe.forEach((rg) => { fe[rg.id] = rg.fnsku || ""; cp[rg.id] = 1; });
      setFnskuEdit(fe); setCopie(cp);
    });
  };
  useEffect(() => {
    load();
    api.get("/etichette/formati").then((r) => setFormati(r.data.formati));
  }, [id]);

  const cambiaStato = async (nuovo) => {
    try {
      await api.put(`/preparazioni/${id}/stato`, { stato: nuovo });
      toast.success("Stato aggiornato");
      load();
    } catch (e) { toast.error(azioneErrore(e)); }
  };

  const salvaFnsku = async (riga) => {
    if (!riga.referenza_id) {
      toast.error(`Nessuna referenza collegata a ${riga.ean}. Crea la referenza nella sezione Referenze.`);
      return;
    }
    try {
      await api.put(`/referenze/${riga.referenza_id}`, { fnsku: fnskuEdit[riga.id] || null });
      toast.success("FNSKU salvato sulla referenza");
      load();
    } catch (e) { toast.error(azioneErrore(e)); }
  };

  const generaEtichette = async () => {
    const selezionate = prep.righe.filter((rg) => selezione[rg.id]);
    if (selezionate.length === 0) { toast.error("Seleziona almeno una riga"); return; }
    const senzaFnsku = selezionate.filter((rg) => !((fnskuEdit[rg.id] || rg.fnsku || "").trim()));
    if (senzaFnsku.length > 0) {
      toast.error(`Manca l'FNSKU per: ${senzaFnsku.map((r) => r.ean).join(", ")}. Inseriscilo e salva prima di generare.`);
      return;
    }
    const items = selezionate.map((rg) => ({
      fnsku: (fnskuEdit[rg.id] || rg.fnsku).trim(),
      titolo: rg.titolo || rg.ean,
      copie: Number(copie[rg.id]) || 1,
    }));
    setGenerando(true);
    try {
      const res = await api.post("/etichette/genera", { items, formato, mostra_titolo: true }, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
      toast.success("PDF FNSKU generato");
    } catch (e) {
      let msg = "Errore nella generazione FNSKU";
      try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) {}
      toast.error(msg);
    } finally { setGenerando(false); }
  };

  if (!prep)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const gruppiAmazon = parseGruppiAmazon(prep.note || "");

  return (
    <div className="space-y-6" data-testid="admin-prep-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{prep.cliente_ragione_sociale}</h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge stato={prep.stato} tipo="prep" />
            <span className="text-xs text-muted-foreground">Richiesta il {new Date(prep.created_at).toLocaleDateString("it-IT")}</span>
          </div>
          {gruppiAmazon.noteCliente && <p className="text-sm text-muted-foreground mt-2">{gruppiAmazon.noteCliente}</p>}
        </div>
        <div>
          <Label className="text-xs">Stato lavorazione</Label>
          <Select value={prep.stato} onValueChange={cambiaStato}>
            <SelectTrigger className="w-48 mt-1" data-testid="prep-stato-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(STATI_PREP).map((s) => <SelectItem key={s} value={s}>{STATI_PREP[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {gruppiAmazon.hasGruppi && (
        <Card className="p-5 border-teal-200 bg-teal-50/70" data-testid="prep-gruppi-amazon">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-lg font-semibold text-teal-950">Gruppi Amazon</h2>
              <p className="text-sm text-teal-800">Composizione da rispettare nella preparazione.</p>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-teal-800 border border-teal-200">
              Totale {gruppiAmazon.totale} pezzi
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {gruppiAmazon.gruppi.map((g, index) => (
              <div key={`${g.nome}-${index}`} className="rounded-md border border-teal-200 bg-white p-3" data-testid={`prep-gruppo-amazon-${index}`}>
                <div className="text-sm font-semibold text-slate-900">{g.nome}</div>
                <div className="text-2xl font-bold text-teal-700 mt-1">{g.quantita}</div>
                <div className="text-xs text-muted-foreground">pezzi</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-blue-600" /> Prodotti · servizi · FNSKU
          </h2>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Formato</Label>
            <Select value={formato} onValueChange={setFormato}>
              <SelectTrigger className="w-28" data-testid="formato-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {formati.map((f) => <SelectItem key={f} value={f}>{f} mm</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={generaEtichette} disabled={generando} data-testid="genera-fnsku-btn">
              {generando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Barcode className="h-4 w-4 mr-2" />}
              Scarica FNSKU
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Servizi</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>Copie</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prep.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`aprep-riga-${rg.id}`}>
                <TableCell>
                  <Checkbox
                    data-testid={`select-riga-${rg.id}`}
                    checked={!!selezione[rg.id]}
                    onCheckedChange={(v) => setSelezione({ ...selezione, [rg.id]: v })}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{rg.ean}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(rg.servizi || []).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    {(rg.servizi || []).map((s) => (
                      <span key={s} className="inline-flex rounded-full bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 text-[10px] font-medium" data-testid={`serv-${rg.id}-${s}`}>
                        {SERVIZI[s]?.label || s}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    data-testid={`fnsku-input-${rg.id}`}
                    value={fnskuEdit[rg.id] ?? ""}
                    onChange={(e) => setFnskuEdit({ ...fnskuEdit, [rg.id]: e.target.value })}
                    placeholder="es. X001ABCDE1"
                    className="h-8 w-36 font-mono text-xs"
                  />
                </TableCell>
                <TableCell>{rg.quantita}</TableCell>
                <TableCell>
                  <Input type="number" min={1} data-testid={`copie-input-${rg.id}`}
                    value={copie[rg.id] ?? 1}
                    onChange={(e) => setCopie({ ...copie, [rg.id]: e.target.value })}
                    className="h-8 w-16" />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" data-testid={`save-fnsku-${rg.id}`} onClick={() => salvaFnsku(rg)}>
                    <Save className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          Seleziona le righe con FNSKU e clicca "Scarica FNSKU" per il PDF Code128. La composizione dei box avviene in <b>Composizione Box</b> quando la preparazione è <b>Pronto</b>.
        </p>
      </Card>
    </div>
  );
}

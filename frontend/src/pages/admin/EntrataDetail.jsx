import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
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
import { Loader2, PackageCheck, Barcode, Save } from "lucide-react";

// Messaggio d'errore chiaro per le azioni admin (gestisce il caso 403 sessione cliente)
function azioneErrore(e) {
  const status = e?.response?.status;
  if (status === 403) {
    return "Azione riservata all'amministratore. Sembra che tu sia collegato come cliente: esci e rientra con l'account admin.";
  }
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return "Operazione non riuscita. Riprova.";
}

export default function AdminEntrataDetail() {
  const { id } = useParams();
  const [entrata, setEntrata] = useState(null);
  const [fnskuEdit, setFnskuEdit] = useState({});
  const [selezione, setSelezione] = useState({});
  const [copie, setCopie] = useState({});
  const [formato, setFormato] = useState("50x30");
  const [formati, setFormati] = useState(["50x30"]);
  const [generando, setGenerando] = useState(false);

  const load = () => {
    api.get(`/entrate/${id}`).then((r) => {
      setEntrata(r.data);
      const fe = {}, cp = {};
      r.data.righe.forEach((rg) => { fe[rg.id] = rg.fnsku || ""; cp[rg.id] = 1; });
      setFnskuEdit(fe); setCopie(cp);
    });
  };
  useEffect(() => {
    load();
    api.get("/etichette/formati").then((r) => setFormati(r.data.formati));
  }, [id]);

  const ricevi = async () => {
    try {
      await api.post(`/entrate/${id}/ricevi`);
      toast.success("Entrata segnata come ricevuta");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  const salvaFnsku = async (rigaId) => {
    try {
      await api.put(`/entrate-righe/${rigaId}`, { fnsku: fnskuEdit[rigaId] || null });
      toast.success("FNSKU salvato");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    }
  };

  const generaEtichette = async () => {
    const selezionate = entrata.righe.filter((rg) => selezione[rg.id]);
    if (selezionate.length === 0) {
      toast.error("Seleziona almeno una riga");
      return;
    }
    // Il barcode si genera SOLO dall'FNSKU: segnala le righe che ne sono prive
    const senzaFnsku = selezionate.filter((rg) => !((fnskuEdit[rg.id] || rg.fnsku || "").trim()));
    if (senzaFnsku.length > 0) {
      toast.error(`Manca l'FNSKU per: ${senzaFnsku.map((r) => r.ean).join(", ")}. Inseriscilo (e salva) prima di generare.`);
      return;
    }
    const items = selezionate.map((rg) => ({
      fnsku: (fnskuEdit[rg.id] || rg.fnsku).trim(),
      titolo: rg.ean,
      copie: Number(copie[rg.id]) || 1,
    }));
    setGenerando(true);
    try {
      const res = await api.post("/etichette/genera", { items, formato, mostra_titolo: true }, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
      toast.success("PDF etichette generato");
    } catch (e) {
      // Mostra il motivo reale restituito dal backend (blob -> testo)
      let msg = "Errore nella generazione etichette";
      try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) {}
      toast.error(msg);
    } finally {
      setGenerando(false);
    }
  };

  if (!entrata)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="entrata-detail">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {entrata.cliente_ragione_sociale} · <span className="capitalize">{entrata.tipo}</span>
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

      {/* Righe + generazione etichette */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-heading text-lg font-semibold">Righe (EAN · quantità · FNSKU)</h2>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Formato</Label>
            <Select value={formato} onValueChange={setFormato}>
              <SelectTrigger className="w-28" data-testid="formato-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {formati.map((f) => <SelectItem key={f} value={f}>{f} mm</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={generaEtichette} disabled={generando} data-testid="genera-etichette-btn">
              {generando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Barcode className="h-4 w-4 mr-2" />}
              Genera etichette
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead>Copie</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entrata.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`riga-${rg.id}`}>
                <TableCell>
                  <Checkbox
                    data-testid={`select-riga-${rg.id}`}
                    checked={!!selezione[rg.id]}
                    onCheckedChange={(v) => setSelezione({ ...selezione, [rg.id]: v })}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{rg.ean}</TableCell>
                <TableCell>{rg.quantita}</TableCell>
                <TableCell>
                  <Input
                    data-testid={`fnsku-input-${rg.id}`}
                    value={fnskuEdit[rg.id] ?? ""}
                    onChange={(e) => setFnskuEdit({ ...fnskuEdit, [rg.id]: e.target.value })}
                    placeholder="es. X001ABCDE1"
                    className="h-8 w-40 font-mono text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    data-testid={`copie-input-${rg.id}`}
                    value={copie[rg.id] ?? 1}
                    onChange={(e) => setCopie({ ...copie, [rg.id]: e.target.value })}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" data-testid={`save-fnsku-${rg.id}`} onClick={() => salvaFnsku(rg.id)}>
                    <Save className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          Seleziona le righe con FNSKU e clicca "Genera etichette" per il PDF Code128 stampabile.
          La composizione dei box avviene in <b>"Composizione Box"</b>, pescando dal magazzino del cliente.
        </p>
      </Card>
    </div>
  );
}

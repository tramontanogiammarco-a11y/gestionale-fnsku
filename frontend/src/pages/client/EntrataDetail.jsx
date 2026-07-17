import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientBoxDetails } from "@/components/ClientBoxDetails";
import ProcessTimeline from "@/components/ProcessTimeline";
import { FLUSSO_ENTRATA, STATI_ENTRATA } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, ArrowLeft, Save, FileText, Truck, Upload, CheckCircle2, Barcode, Box as BoxIcon,
} from "lucide-react";

export default function ClientEntrataDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entrata, setEntrata] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [fnsku, setFnsku] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(`/entrate/${id}`).then((r) => {
      setEntrata(r.data);
      const v = {}; r.data.righe.forEach((rg) => (v[rg.id] = rg.fnsku || "")); setFnsku(v);
    }).catch((e) => {
      const s = e?.response?.status;
      if (s === 403) toast.error("Questa entrata non appartiene al tuo account.");
      else if (s === 404) toast.error("Entrata non trovata.");
      else if (s !== 401) toast.error("Impossibile caricare l'entrata.");
      navigate("/app/entrate");
    });
    api.get(`/box?entrata_id=${id}`).then((r) => setBoxes(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);

  const salvaFnsku = async () => {
    if (!entrata) return;
    setSaving(true);
    try {
      await Promise.all(
        entrata.righe
          .filter((rg) => (fnsku[rg.id] || "") !== (rg.fnsku || ""))
          .map((rg) => api.put(`/entrate-righe/${rg.id}`, { fnsku: fnsku[rg.id] || null }))
      );
      toast.success("FNSKU salvati e inviati al prep center");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  if (!entrata)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const modificabile = entrata.stato !== "spedito";
  const timeline = [
    { label: "Annunciata", date: entrata.data_annuncio, done: true, actor: "Cliente" },
    { label: "Ricevuta", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", current: entrata.stato === "in_attesa", actor: "Prep center" },
    { label: "A magazzino", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Dopo ricezione" },
    { label: "Archiviata", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Quando ricevuta" },
  ];

  return (
    <div className="space-y-6" data-testid="client-entrata-detail">
      <button onClick={() => navigate("/app/entrate")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4" /> Torna alle entrate
      </button>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight capitalize">{entrata.tipo}</h1>
          <StatusBadge stato={entrata.stato} />
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-600">
          <span>Annunciata il {new Date(entrata.data_annuncio).toLocaleDateString("it-IT")}</span>
          {entrata.ddt && <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> DDT: <span className="font-mono">{entrata.ddt}</span></span>}
          {entrata.tracking && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Tracking: <span className="font-mono">{entrata.tracking}</span></span>}
        </div>
        <div className="flex items-center gap-1 mt-3 max-w-md">
          {FLUSSO_ENTRATA.map((s, i) => {
            const done = FLUSSO_ENTRATA.indexOf(entrata.stato) >= i;
            return <div key={s} className={`h-1.5 flex-1 rounded-full ${done ? "bg-blue-500" : "bg-slate-200"}`} title={STATI_ENTRATA[s].label} />;
          })}
        </div>
      </div>

      <ProcessTimeline
        title="Timeline entrata"
        description="Tracciamento della merce dal tuo annuncio al magazzino."
        steps={timeline}
      />

      {/* FNSKU / referenze */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2"><Barcode className="h-5 w-5 text-blue-600" /> Codici FNSKU</h2>
          {modificabile && (
            <Button onClick={salvaFnsku} disabled={saving} data-testid="save-fnsku-btn">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Salva FNSKU
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Inserisci l'FNSKU per ogni EAN: il prep center userà questi codici per generare le etichette a barre.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EAN</TableHead>
              <TableHead>Q.tà</TableHead>
              <TableHead>FNSKU</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entrata.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`cd-riga-${rg.id}`}>
                <TableCell className="font-mono text-xs">{rg.ean}</TableCell>
                <TableCell>{rg.quantita}</TableCell>
                <TableCell>
                  {modificabile ? (
                    <Input
                      data-testid={`cd-fnsku-${rg.id}`}
                      value={fnsku[rg.id] ?? ""}
                      onChange={(e) => setFnsku({ ...fnsku, [rg.id]: e.target.value })}
                      placeholder="es. X001ABCDE1"
                      className="h-8 w-44 font-mono text-xs"
                    />
                  ) : (
                    <span className="font-mono text-xs">{rg.fnsku || "—"}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Nel nuovo flusso le scatole si gestiscono nelle Preparazioni */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        Una volta che il prep center segna la merce come <b>arrivata</b>, la trovi nel tuo <b>Magazzino</b>. Da lì crea una <b>Preparazione</b> per farti spedire i prodotti: le scatole e il caricamento delle etichette Amazon/UPS avvengono nella sezione <b>Preparazioni</b>.
      </div>
    </div>
  );
}

// Card box con composizione + upload PDF unico etichette.
function BoxUpload({ box, onDone }) {
  const labelsRef = useRef();
  const [uploading, setUploading] = useState(null);

  const upload = async (file) => {
    setUploading("etichette");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/box/${box.id}/etichette`, fd);
      toast.success("PDF etichette caricato");
      onDone();
    } catch (e) {
      toast.error("Errore nel caricamento");
    } finally { setUploading(null); }
  };

  const puoCaricare = box.stato !== "spedito";

  return (
    <div className="rounded-md border border-border p-4" data-testid={`cd-box-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <ClientBoxDetails box={box} testIdPrefix="cd-dati-etichette" />

      {/* Upload etichette */}
      <div className="mt-4">
        <input ref={labelsRef} type="file" accept="application/pdf" className="hidden"
               data-testid={`cd-labels-input-${box.id}`}
               onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        {box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url ? (
          <a href={fileUrl(box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cd-labels-done-${box.id}`}>
            <CheckCircle2 className="h-4 w-4" /> PDF etichette caricato
          </a>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "etichette"}
                  onClick={() => labelsRef.current.click()} data-testid={`cd-labels-btn-${box.id}`}>
            {uploading === "etichette" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF etichette Amazon + UPS
          </Button>
        )}
      </div>
    </div>
  );
}

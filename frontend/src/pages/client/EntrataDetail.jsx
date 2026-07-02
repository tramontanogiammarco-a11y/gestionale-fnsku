import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
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

      {/* Box + upload etichette (visibili quando il prep center li ha preparati) */}
      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2 mb-3"><BoxIcon className="h-5 w-5 text-blue-600" /> Scatole preparate</h2>
        {boxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Il prep center non ha ancora preparato le scatole. Quando l'entrata sarà <b>pronta</b>, qui vedrai la composizione delle scatole e potrai caricare le etichette Amazon e UPS.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {boxes.map((b) => <BoxUpload key={b.id} box={b} onDone={load} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

// Card box con composizione + upload etichette Amazon/UPS
function BoxUpload({ box, onDone }) {
  const amazonRef = useRef();
  const upsRef = useRef();
  const [uploading, setUploading] = useState(null);

  const upload = async (tipo, file) => {
    setUploading(tipo);
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/box/${box.id}/etichetta-${tipo}`, fd);
      toast.success(`Etichetta ${tipo === "amazon" ? "Amazon" : "UPS"} caricata`);
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
      <div className="text-xs text-muted-foreground mt-1">
        {box.peso_kg ? `${box.peso_kg} kg · ` : ""}
        {box.lunghezza_cm && box.larghezza_cm && box.altezza_cm
          ? `${box.lunghezza_cm}×${box.larghezza_cm}×${box.altezza_cm} cm` : "dimensioni n/d"}
      </div>

      {/* Composizione scatola */}
      {box.contenuto?.length > 0 && (
        <div className="mt-3 rounded bg-slate-50 p-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Contenuto</div>
          {box.contenuto.map((c, i) => (
            <div key={i} className="flex justify-between text-xs py-0.5">
              <span className="font-mono">{c.ean}{c.fnsku ? ` · ${c.fnsku}` : ""}</span>
              <span>×{c.quantita}</span>
            </div>
          ))}
        </div>
      )}

      {/* Upload etichette */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <input ref={amazonRef} type="file" accept="application/pdf" className="hidden"
                 data-testid={`cd-amazon-input-${box.id}`}
                 onChange={(e) => e.target.files[0] && upload("amazon", e.target.files[0])} />
          {box.etichetta_amazon_pdf_url ? (
            <a href={fileUrl(box.etichetta_amazon_pdf_url)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cd-amazon-done-${box.id}`}>
              <CheckCircle2 className="h-4 w-4" /> Amazon caricata
            </a>
          ) : (
            <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "amazon"}
                    onClick={() => amazonRef.current.click()} data-testid={`cd-amazon-btn-${box.id}`}>
              {uploading === "amazon" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF Amazon
            </Button>
          )}
        </div>
        <div>
          <input ref={upsRef} type="file" accept="application/pdf" className="hidden"
                 data-testid={`cd-ups-input-${box.id}`}
                 onChange={(e) => e.target.files[0] && upload("ups", e.target.files[0])} />
          {box.etichetta_ups_pdf_url ? (
            <a href={fileUrl(box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cd-ups-done-${box.id}`}>
              <CheckCircle2 className="h-4 w-4" /> UPS caricata
            </a>
          ) : (
            <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "ups"}
                    onClick={() => upsRef.current.click()} data-testid={`cd-ups-btn-${box.id}`}>
              {uploading === "ups" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF UPS
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

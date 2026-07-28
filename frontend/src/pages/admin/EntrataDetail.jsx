import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import ProcessTimeline from "@/components/ProcessTimeline";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, PackageCheck, Upload, FileText, Save } from "lucide-react";

function azioneErrore(e) {
  if (e?.response?.status === 403)
    return "Azione riservata all'amministratore: esci e rientra come admin.";
  return e?.response?.data?.detail || "Operazione non riuscita. Riprova.";
}

function parseDocumentiNote(note = "") {
  const match = String(note || "").match(/\[DOCUMENTI\]([\s\S]*?)\[\/DOCUMENTI\]/);
  if (!match) return { notePulita: note || "", documenti: [] };
  let documenti = [];
  try {
    const parsed = JSON.parse((match[1] || "").trim());
    if (Array.isArray(parsed)) documenti = parsed;
  } catch (_) {
    documenti = [];
  }
  return { notePulita: String(note || "").replace(match[0], "").trim(), documenti };
}

export default function AdminEntrataDetail() {
  const { id } = useParams();
  const [entrata, setEntrata] = useState(null);
  const [docTipo, setDocTipo] = useState("DDT");
  const [uploading, setUploading] = useState(false);
  const [righeEdit, setRigheEdit] = useState({});
  const [savingRighe, setSavingRighe] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.get(`/entrate/${id}`).then((r) => {
    setEntrata(r.data);
    setRigheEdit(Object.fromEntries((r.data.righe || []).map((row) => [row.id, String(row.quantita || "")])));
  });
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

  const uploadDocumento = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo", docTipo);
      await api.post(`/entrate/${id}/documento`, fd);
      toast.success("Documento caricato");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const salvaQuantita = async () => {
    if (!entrata) return;
    const righeDaSalvare = entrata.righe.map((row) => ({
      id: row.id,
      originale: Number(row.quantita || 0),
      quantita: Number(righeEdit[row.id] || 0),
    }));
    if (righeDaSalvare.some((row) => !Number.isFinite(row.quantita) || row.quantita <= 0)) {
      toast.error("Le quantita devono essere maggiori di zero.");
      return;
    }

    setSavingRighe(true);
    try {
      await Promise.all(righeDaSalvare
        .filter((row) => row.quantita !== row.originale)
        .map((row) => api.put(`/entrate-righe/${row.id}`, { quantita: row.quantita })));
      toast.success("Quantita entrata aggiornate");
      load();
    } catch (e) {
      toast.error(azioneErrore(e));
    } finally {
      setSavingRighe(false);
    }
  };

  if (!entrata)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const note = parseDocumentiNote(entrata.note || "");
  const entrataTimeline = [
    { label: "Annunciata", date: entrata.data_annuncio, done: true, actor: "Cliente" },
    { label: "Ricevuta", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", current: entrata.stato === "in_attesa", actor: "Staff" },
    { label: "A magazzino", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Dopo ricezione" },
    { label: "Archiviabile", date: entrata.data_ricezione, done: entrata.stato !== "in_attesa", empty: "Quando ricevuta" },
  ];

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
          {note.notePulita && <p className="text-sm text-muted-foreground mt-2">{note.notePulita}</p>}
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

      <ProcessTimeline
        title="Timeline entrata"
        description="Tracciamento rapido della pratica dal cliente al magazzino."
        steps={entrataTimeline}
      />

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">Contenuto arrivo (EAN · FNSKU · quantità)</h2>
            <p className="mt-1 text-sm text-muted-foreground">Se il cliente segnala numeri errati dopo la ricezione, correggi qui i pezzi ricevuti.</p>
          </div>
          <Button variant="outline" onClick={salvaQuantita} disabled={savingRighe} data-testid="admin-save-entrata-righe">
            {savingRighe ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salva quantita
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EAN</TableHead>
              <TableHead>FNSKU</TableHead>
              <TableHead className="text-right">Quantità</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entrata.righe.map((rg) => (
              <TableRow key={rg.id} data-testid={`riga-${rg.id}`}>
                <TableCell className="font-mono text-xs">{rg.ean || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{rg.fnsku || "—"}</TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={1}
                    value={righeEdit[rg.id] ?? ""}
                    onChange={(event) => setRigheEdit({ ...righeEdit, [rg.id]: event.target.value })}
                    className="ml-auto h-8 w-24 text-right"
                    data-testid={`admin-entrata-qta-${rg.id}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          Gli FNSKU mancanti possono essere completati nella sezione <b>Preparazioni</b>.
        </p>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">Documenti pratica</h2>
            <p className="text-sm text-muted-foreground">DDT, tracking, foto merce o altri file utili legati a questa entrata.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["DDT", "Tracking", "Foto merce", "Altro"].map((tipo) => (
              <button
                key={tipo}
                onClick={() => setDocTipo(tipo)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${docTipo === tipo ? "border-teal-700 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {tipo}
              </button>
            ))}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              data-testid="entrata-doc-input"
              onChange={(e) => e.target.files?.[0] && uploadDocumento(e.target.files[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="entrata-doc-upload">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Carica {docTipo}
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {note.documenti.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-sm text-muted-foreground">Nessun documento caricato.</div>
          )}
          {note.documenti.map((doc, index) => (
            <a
              key={`${doc.url}-${index}`}
              href={fileUrl(doc.url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50"
              data-testid={`entrata-doc-${index}`}
            >
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950">{doc.tipo || "Documento"}</span>
                <span className="block truncate text-xs text-muted-foreground">{doc.nome || doc.url}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Barcode, Camera, Check, CheckCircle2,
  ClipboardCheck, Loader2, MapPin, Minus, PackageSearch, Plus, RotateCcw, X,
} from "lucide-react";
import { api } from "@/lib/api";
import CameraScanner from "@/components/wms/CameraScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function WmsAppInventoryCount() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const scanRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/wms/inventario/${id}`);
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Inventario non disponibile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const focus = () => setCameraOpen(true);
    window.addEventListener("wms-focus-scanner", focus);
    return () => window.removeEventListener("wms-focus-scanner", focus);
  }, []);

  const updateCount = async (payload, successMessage) => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/inventario/${id}/conteggio`, payload);
      setData(response.data);
      setCode("");
      if (navigator.vibrate) navigator.vibrate(60);
      if (successMessage) toast.success(successMessage);
      window.setTimeout(() => scanRef.current?.focus(), 35);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Conteggio non registrato");
      return false;
    } finally {
      setWorking(false);
    }
  };

  const scan = async (rawCode = code) => {
    const value = String(rawCode || "").trim();
    if (!value) return;
    if (normalize(value) === normalize(data?.session?.location?.codice)) {
      setCameraOpen(false);
      setCode("");
      toast.success(`Posizione ${data.session.location.codice} confermata`);
      return;
    }
    const success = await updateCount({ codice: value, delta: 1, cliente_id: clientId !== "all" ? clientId : undefined });
    if (success) setCameraOpen(false);
  };

  const complete = async (confirmDifferences = false) => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/inventario/${id}/completa`, { conferma_differenze: confirmDifferences });
      setData(response.data);
      setCompleteOpen(false);
      toast.success("Inventario completato e stock aggiornato");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile completare l'inventario");
    } finally {
      setWorking(false);
    }
  };

  const requestComplete = () => {
    const pending = Number(data?.summary?.righe || 0) - Number(data?.summary?.verificate || 0);
    if (pending > 0) {
      toast.error(`Restano ${pending} referenze da verificare`);
      return;
    }
    if (data?.summary?.anomalie > 0) setCompleteOpen(true);
    else complete(false);
  };

  const cancel = async () => {
    setWorking(true);
    try {
      await api.post(`/wms/inventario/${id}/annulla`, {});
      toast.success("Inventario annullato");
      navigate("/wms-app/inventario", { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile annullare l'inventario");
    } finally {
      setWorking(false);
    }
  };

  if (loading && !data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  if (!data) return null;

  const { session, counts, summary } = data;
  const active = session.stato === "in_corso";
  const pending = summary.righe - summary.verificate;
  const progress = summary.righe ? Math.round((summary.verificate / summary.righe) * 100) : 100;

  return (
    <div className="space-y-5 pb-8" data-testid="wms-app-inventory-count">
      <header>
        <button type="button" onClick={() => navigate("/wms-app/inventario")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli inventari"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-extrabold uppercase text-teal-700">Inventario posizione</p><h1 className="mt-1 font-mono text-3xl font-black">{session.location?.codice}</h1><p className="mt-2 text-sm text-slate-500">{capitalize(session.location?.tipo)} · {session.location?.zona || "Magazzino"}</p></div>
          <StatusBadge status={session.stato} />
        </div>
      </header>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          <SummaryValue label="Atteso" value={summary.atteso} />
          <SummaryValue label="Contato" value={summary.contato} />
          <SummaryValue label="Differenza" value={pending > 0 ? "—" : signed(summary.differenza)} danger={pending === 0 && summary.differenza !== 0} />
        </div>
        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center justify-between text-xs"><span className="font-bold">{summary.verificate} di {summary.righe} verificate</span><span className="text-slate-500">{progress}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${summary.anomalie ? "bg-amber-500" : "bg-teal-600"}`} style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      {active && (
        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <div><h2 className="flex items-center gap-2 text-lg font-black"><Barcode className="h-5 w-5 text-teal-700" /> Scansiona prodotto</h2><p className="mt-1 text-xs text-slate-500">Ogni scansione aggiunge un pezzo al conteggio.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); scan(); }} className="flex gap-2">
            <Input ref={scanRef} value={code} onChange={(event) => setCode(event.target.value)} className="h-14 min-w-0 flex-1 font-mono text-base" placeholder="EAN o FNSKU" autoComplete="off" autoFocus />
            <Button type="button" size="icon" variant="outline" className="h-14 w-14 shrink-0" onClick={() => setCameraOpen(true)} aria-label="Apri fotocamera"><Camera className="h-5 w-5" /></Button>
            <Button type="submit" size="icon" className="h-14 w-14 shrink-0" disabled={working || !code.trim()} aria-label="Registra scansione">{working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}</Button>
          </form>
          {counts.length > 0 && <Button type="button" variant="outline" className="h-11 w-full" disabled={working} onClick={() => updateCount({ conferma_atteso: true }, "Quantità attese confermate")}><ClipboardCheck className="mr-2 h-4 w-4" /> Conferma tutte come attese</Button>}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-black">Prodotti nella posizione</h2><p className="mt-1 text-sm text-slate-500">Verifica ogni referenza presente.</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold">{counts.length}</span></div>
        {counts.length ? (
          <div className="space-y-3">
            {counts.map((count) => <CountCard key={count.id} count={count} active={active} working={working} onSet={(quantity) => updateCount({ count_id: count.id, quantita: quantity })} />)}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-6 text-center"><PackageSearch className="h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">Posizione attesa vuota</h3><p className="mt-1 text-sm text-slate-500">Scansiona un prodotto trovato oppure conferma la posizione vuota.</p></div>
        )}
      </section>

      {active ? (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button type="button" variant="outline" className="h-12 px-4 text-red-600" onClick={() => setCancelOpen(true)} disabled={working} aria-label="Annulla inventario"><X className="h-5 w-5" /></Button>
          <Button type="button" className="h-12 font-black" onClick={requestComplete} disabled={working}>{working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />} {pending ? `Completa (${pending} da verificare)` : "Completa inventario"}</Button>
        </div>
      ) : <Button type="button" variant="outline" className="h-12 w-full" onClick={() => navigate("/wms-app/inventario")}><ArrowLeft className="mr-2 h-4 w-4" /> Torna allo storico</Button>}

      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="product" onDetected={scan} />

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-w-[calc(100%-24px)] rounded-md sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Conferma rettifiche</DialogTitle><DialogDescription>Il conteggio presenta {summary.anomalie} differenze per un totale di {signed(summary.differenza)} pezzi. Lo stock WMS verrà aggiornato.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" onClick={() => setCompleteOpen(false)}>Rivedi</Button><Button type="button" onClick={() => complete(true)} disabled={working}>Conferma e rettifica</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-[calc(100%-24px)] rounded-md sm:max-w-md">
          <DialogHeader><DialogTitle>Annullare l’inventario?</DialogTitle><DialogDescription>I conteggi inseriti verranno conservati nello storico come annullati e non modificheranno lo stock.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Continua conteggio</Button><Button type="button" variant="destructive" onClick={cancel} disabled={working}>Annulla inventario</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CountCard({ count, active, working, onSet }) {
  const [draft, setDraft] = useState(String(count.quantita_contata));
  useEffect(() => { setDraft(String(count.quantita_contata)); }, [count.quantita_contata]);
  const difference = Number(count.quantita_contata || 0) - Number(count.quantita_attesa || 0);
  const commit = () => {
    const value = Math.max(0, Math.floor(Number(draft || 0)));
    setDraft(String(value));
    if (value !== count.quantita_contata || !count.verificata) onSet(value);
  };
  return (
    <article className={`rounded-md border bg-white p-4 ${count.verificata ? difference === 0 ? "border-emerald-200" : "border-amber-300" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${count.verificata ? difference === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{count.verificata ? difference === 0 ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" /> : <PackageSearch className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1"><h3 className="font-black">{count.titolo || "Titolo non disponibile"}</h3><p className="mt-1 break-all font-mono text-xs text-slate-500">{count.ean || "EAN assente"} · {count.fnsku || "FNSKU assente"}</p></div>
        <div className="text-right"><span className="text-[10px] font-bold uppercase text-slate-400">Atteso</span><strong className="block text-xl">{count.quantita_attesa}</strong></div>
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
        {active ? <>
          <Button type="button" size="icon" variant="outline" className="h-11 w-11 shrink-0" disabled={working || Number(draft) <= 0} onClick={() => { const value = Math.max(0, Number(draft || 0) - 1); setDraft(String(value)); onSet(value); }} aria-label="Riduci quantità"><Minus className="h-4 w-4" /></Button>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} type="number" min="0" inputMode="numeric" className="h-11 min-w-0 flex-1 text-center text-lg font-black" aria-label="Quantità contata" />
          <Button type="button" size="icon" variant="outline" className="h-11 w-11 shrink-0" disabled={working} onClick={() => { const value = Number(draft || 0) + 1; setDraft(String(value)); onSet(value); }} aria-label="Aumenta quantità"><Plus className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" className="h-11 shrink-0 px-3 text-xs" disabled={working} onClick={() => { setDraft(String(count.quantita_attesa)); onSet(count.quantita_attesa); }}>Atteso</Button>
        </> : <div className="flex w-full items-center justify-between"><span className="text-sm font-bold text-slate-500">Contato</span><strong className="text-xl">{count.quantita_contata}</strong></div>}
      </div>
      {count.verificata && difference !== 0 && <div className="mt-3 flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><span>Differenza rilevata</span><strong>{signed(difference)} pz</strong></div>}
      {active && count.verificata && <button type="button" onClick={() => { setDraft("0"); onSet(0); }} className="mt-3 flex items-center gap-1 text-xs font-bold text-slate-500" disabled={working}><RotateCcw className="h-3.5 w-3.5" /> Segna zero</button>}
    </article>
  );
}

function SummaryValue({ label, value, danger }) { return <div className={`p-4 text-center ${danger ? "text-amber-700" : ""}`}><strong className="block text-xl font-black">{value}</strong><span className="mt-1 block text-[10px] font-bold uppercase text-slate-400">{label}</span></div>; }
function StatusBadge({ status }) { const styles = status === "completata" ? "bg-emerald-100 text-emerald-800" : status === "annullata" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"; const label = status === "completata" ? "Completato" : status === "annullata" ? "Annullato" : "In corso"; return <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${styles}`}>{label}</span>; }
function signed(value) { const number = Number(value || 0); return number > 0 ? `+${number}` : String(number); }
function normalize(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, ""); }
function capitalize(value) { const text = String(value || ""); return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Posizione"; }

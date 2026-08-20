import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Barcode, CheckCircle2, ChevronRight, CirclePause,
  Clock3, Loader2, MapPin, PackageCheck, Plus, RotateCcw, ShieldAlert, Trash2,
} from "lucide-react";

const DISPOSITIONS = [
  { value: "disponibile", label: "Disponibile", icon: CheckCircle2, active: "border-teal-600 bg-teal-50 text-teal-800" },
  { value: "danneggiato", label: "Danneggiato", icon: AlertTriangle, active: "border-red-500 bg-red-50 text-red-700" },
  { value: "quarantena", label: "Quarantena", icon: ShieldAlert, active: "border-amber-500 bg-amber-50 text-amber-800" },
];

export default function WmsAppInbound() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { loadEntries } = useOutletContext();
  const scanRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [disposition, setDisposition] = useState("disponibile");
  const [locationId, setLocationId] = useState("");
  const [locationDialog, setLocationDialog] = useState(false);
  const [differenceDialog, setDifferenceDialog] = useState(false);
  const [newLocation, setNewLocation] = useState({ codice: "", zona: "", tipo: "scaffale" });

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/wms/inbound/${id}`);
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Inbound non disponibile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => data?.entrata?.righe || [], [data]);
  const activeLocations = useMemo(
    () => (data?.locations || []).filter((location) => location.stato === "attiva"),
    [data],
  );
  const selectedRow = rows.find((row) => row.id === selectedRowId) || null;
  const summary = useMemo(() => rows.reduce((acc, row) => {
    acc.expected += Number(row.atteso || 0);
    acc.available += Number(row.ricevuto_disponibile || 0);
    acc.damaged += Number(row.danneggiato || 0);
    acc.quarantine += Number(row.quarantena || 0);
    acc.missing += Number(row.mancante || 0);
    return acc;
  }, { expected: 0, available: 0, damaged: 0, quarantine: 0, missing: 0 }), [rows]);
  const registered = summary.available + summary.damaged + summary.quarantine;
  const progress = summary.expected > 0 ? Math.min(100, (registered / summary.expected) * 100) : 0;
  const closed = data?.entrata?.stato === "ricevuto" && !data?.active_session;

  useEffect(() => {
    if (!data || locationId) return;
    const preferred = activeLocations.find((location) => location.codice === "INBOUND-01") || activeLocations[0];
    if (preferred) setLocationId(preferred.id);
  }, [activeLocations, data, locationId]);

  useEffect(() => {
    if (disposition !== "quarantena") return;
    const quarantine = activeLocations.find((location) => location.tipo === "quarantena");
    if (quarantine) setLocationId(quarantine.id);
  }, [activeLocations, disposition]);

  useEffect(() => {
    const focus = () => window.setTimeout(() => scanRef.current?.focus(), 50);
    window.addEventListener("wms-focus-scanner", focus);
    return () => window.removeEventListener("wms-focus-scanner", focus);
  }, []);

  const start = async () => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/inbound/${id}/avvia`, {});
      setData(response.data);
      await loadEntries();
      toast.success("Ricezione avviata");
      window.setTimeout(() => scanRef.current?.focus(), 80);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Sessione non avviata");
    } finally {
      setWorking(false);
    }
  };

  const chooseRow = (row) => {
    setSelectedRowId(row.id);
    setCode(row.ean || row.fnsku || "");
    setQuantity(1);
    window.setTimeout(() => scanRef.current?.focus(), 50);
  };

  const register = async (event) => {
    event?.preventDefault();
    if (!data?.active_session) return start();
    setWorking(true);
    try {
      const response = await api.post(`/wms/inbound/${id}/movimenti`, {
        codice: code,
        entrata_riga_id: selectedRowId,
        quantita: Number(quantity),
        disposizione: disposition,
        location_id: locationId,
      });
      setData(response.data);
      setCode("");
      setSelectedRowId(null);
      setQuantity(1);
      toast.success("Quantità registrata");
      window.setTimeout(() => scanRef.current?.focus(), 50);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Ricezione non registrata");
      window.setTimeout(() => scanRef.current?.select(), 50);
    } finally {
      setWorking(false);
    }
  };

  const removeMovement = async (movement) => {
    setWorking(true);
    try {
      const response = await api.delete(`/wms/inbound/movimenti/${movement.id}`);
      setData(response.data);
      toast.success("Registrazione annullata");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Registrazione non annullata");
    } finally {
      setWorking(false);
    }
  };

  const complete = async (withDifferences = false) => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/inbound/${id}/completa`, { chiudi_con_differenze: withDifferences });
      setData(response.data);
      setDifferenceDialog(false);
      await loadEntries();
      toast.success("Inbound chiuso e stock aggiornato");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Inbound non chiuso");
    } finally {
      setWorking(false);
    }
  };

  const createLocation = async () => {
    setWorking(true);
    try {
      const response = await api.post("/wms/ubicazioni", newLocation);
      await load();
      setLocationId(response.data.id);
      setLocationDialog(false);
      setNewLocation({ codice: "", zona: "", tipo: "scaffale" });
      toast.success("Ubicazione creata");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Ubicazione non creata");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  if (!data) return <EmptyInbound onBack={() => navigate("/wms-app")} />;

  const entry = data.entrata;
  return (
    <div className="space-y-6 pb-24" data-testid="wms-app-inbound">
      <header>
        <button type="button" onClick={() => navigate("/wms-app")} className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200" aria-label="Torna agli inbound">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-teal-700">Ricezione inbound</p>
            <h1 className="mt-1 truncate text-2xl font-black">{entry.cliente_ragione_sociale}</h1>
            <p className="mt-2 text-sm text-slate-500">{capitalize(entry.tipo)} · {entry.colli || 1} {Number(entry.colli || 1) === 1 ? "collo" : "colli"}</p>
          </div>
          <EntryStatus entry={entry} active={Boolean(data.active_session)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Meta label="DDT" value={entry.ddt || "Non indicato"} />
          <Meta label="Corriere" value={entry.corriere || "Non indicato"} />
          <Meta label="Tracking" value={entry.tracking || "Non indicato"} wide />
        </div>
      </header>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-end justify-between gap-3">
          <div><p className="text-sm font-bold text-slate-500">Avanzamento</p><div className="mt-1 text-3xl font-black">{registered}<span className="text-lg text-slate-400">/{summary.expected}</span></div></div>
          <strong className="text-sm text-teal-700">{Math.round(progress)}%</strong>
        </div>
        <Progress value={progress} className="mt-3 h-2" />
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <MiniKpi label="Disponibili" value={summary.available} tone="teal" />
          <MiniKpi label="Problemi" value={summary.damaged + summary.quarantine} tone="amber" />
          <MiniKpi label="Mancanti" value={summary.missing} tone="slate" />
        </div>
      </section>

      {!closed ? (
        <form onSubmit={register} className="rounded-md border-2 border-teal-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="flex items-center gap-2 text-lg font-black"><Barcode className="h-5 w-5 text-teal-700" /> Scansiona merce</h2><p className="mt-1 text-xs text-slate-500">EAN o FNSKU</p></div>
            <span className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${data.active_session ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>{data.active_session ? "Attiva" : "Da avviare"}</span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wms-app-scan">Codice prodotto</Label>
              <Input id="wms-app-scan" ref={scanRef} value={code} onChange={(event) => { setCode(event.target.value); setSelectedRowId(null); }} className="h-14 font-mono text-lg" placeholder="Scansiona o inserisci il codice" autoFocus autoComplete="off" disabled={!data.active_session} />
              {selectedRow && <p className="truncate text-xs font-bold text-teal-700">{selectedRow.titolo || "Prodotto selezionato"} · {selectedRow.mancante} mancanti</p>}
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
              <div className="space-y-2"><Label htmlFor="wms-app-quantity">Quantità</Label><Input id="wms-app-quantity" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-12 text-lg font-black" disabled={!data.active_session} /></div>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><Label>Ubicazione</Label><button type="button" className="text-xs font-bold text-teal-700 disabled:text-slate-300" onClick={() => setLocationDialog(true)} disabled={!data.active_session}>Nuova</button></div>
                <Select value={locationId} onValueChange={setLocationId} disabled={!data.active_session}><SelectTrigger className="h-12"><SelectValue placeholder="Seleziona" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.codice} · {location.zona || location.tipo}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {DISPOSITIONS.map((item) => <button key={item.value} type="button" onClick={() => setDisposition(item.value)} disabled={!data.active_session} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-bold ${disposition === item.value ? item.active : "border-slate-200 text-slate-500"}`}><item.icon className="h-5 w-5" />{item.label}</button>)}
            </div>

            <Button type="submit" className="h-14 w-full text-base font-black" disabled={working || (Boolean(data.active_session) && ((!code && !selectedRowId) || !locationId))}>
              {working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : data.active_session ? <Plus className="mr-2 h-5 w-5" /> : <PackageCheck className="mr-2 h-5 w-5" />}
              {data.active_session ? "Registra quantità" : "Avvia ricezione"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="h-6 w-6 shrink-0" /><div><div className="font-black">Inbound completato</div><div className="text-sm">La merce è già registrata nello stock.</div></div></div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-black">Contenuto arrivo</h2><p className="mt-1 text-sm text-slate-500">Tocca un prodotto per riceverlo.</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold">{rows.length}</span></div>
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {rows.map((row) => <InboundRow key={row.id} row={row} active={selectedRowId === row.id} disabled={!data.active_session || row.mancante <= 0} onClick={() => chooseRow(row)} />)}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-black">Registrazioni</h2><p className="mt-1 text-sm text-slate-500">Ultimi movimenti di questa entrata.</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold">{data.movements.length}</span></div>
        {data.movements.length === 0 ? <div className="rounded-md border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">Nessuna scansione registrata</div> : (
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {data.movements.slice(0, 20).map((movement) => <MovementRow key={movement.id} movement={movement} canDelete={data.active_session?.id === movement.session_id} working={working} onDelete={() => removeMovement(movement)} />)}
          </div>
        )}
      </section>

      {data.active_session && (
        <div className="fixed inset-x-0 bottom-[73px] z-30 mx-auto w-full max-w-3xl border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="h-12" onClick={() => navigate("/wms-app?view=active")}><CirclePause className="mr-2 h-4 w-4" /> Sospendi</Button><Button className="h-12" onClick={() => summary.missing > 0 ? setDifferenceDialog(true) : complete(false)} disabled={working}><PackageCheck className="mr-2 h-4 w-4" /> Chiudi</Button></div>
        </div>
      )}

      <Dialog open={locationDialog} onOpenChange={setLocationDialog}>
        <DialogContent className="max-w-[calc(100%-32px)] rounded-md">
          <DialogHeader><DialogTitle>Nuova ubicazione</DialogTitle><DialogDescription>Crea una posizione utilizzabile subito.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2"><div className="space-y-2"><Label htmlFor="wms-location-code">Codice</Label><Input id="wms-location-code" value={newLocation.codice} onChange={(event) => setNewLocation((current) => ({ ...current, codice: event.target.value.toUpperCase() }))} placeholder="A-01-02" /></div><div className="space-y-2"><Label htmlFor="wms-location-zone">Zona</Label><Input id="wms-location-zone" value={newLocation.zona} onChange={(event) => setNewLocation((current) => ({ ...current, zona: event.target.value }))} placeholder="Scaffale A" /></div><div className="space-y-2"><Label>Tipo</Label><Select value={newLocation.tipo} onValueChange={(value) => setNewLocation((current) => ({ ...current, tipo: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scaffale">Scaffale</SelectItem><SelectItem value="pallet">Pallet</SelectItem><SelectItem value="terra">Terra</SelectItem><SelectItem value="quarantena">Quarantena</SelectItem></SelectContent></Select></div></div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setLocationDialog(false)}>Annulla</Button><Button onClick={createLocation} disabled={working || !newLocation.codice.trim()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Crea</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={differenceDialog} onOpenChange={setDifferenceDialog}>
        <DialogContent className="max-w-[calc(100%-32px)] rounded-md">
          <DialogHeader><DialogTitle>Chiudere con differenze?</DialogTitle><DialogDescription>Mancano {summary.missing} pezzi. Le quantità non ricevute non entreranno nello stock.</DialogDescription></DialogHeader>
          <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /> Sospendi se altra merce deve ancora arrivare. Chiudi solo dopo il controllo completo.</div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setDifferenceDialog(false)}>Continua</Button><Button variant="destructive" onClick={() => complete(true)} disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Chiudi con differenze</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value, wide = false }) {
  return <div className={`min-w-0 rounded-md bg-slate-50 px-3 py-2 ${wide ? "col-span-2" : ""}`}><span className="block text-[10px] font-black uppercase text-slate-400">{label}</span><strong className="mt-1 block truncate font-mono text-xs">{value}</strong></div>;
}

function MiniKpi({ label, value, tone }) {
  const colors = { teal: "bg-teal-50 text-teal-800", amber: "bg-amber-50 text-amber-800", slate: "bg-slate-100 text-slate-700" };
  return <div className={`rounded-md px-2 py-3 ${colors[tone]}`}><div className="text-xl font-black">{value}</div><div className="mt-1 truncate text-[10px] font-bold">{label}</div></div>;
}

function InboundRow({ row, active, disabled, onClick }) {
  const registered = Number(row.registrato || 0);
  const progress = row.atteso > 0 ? Math.min(100, (registered / row.atteso) * 100) : 0;
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`w-full p-4 text-left transition ${active ? "bg-teal-50 ring-2 ring-inset ring-teal-500" : "hover:bg-slate-50"} disabled:cursor-default disabled:opacity-75`}>
      <div className="flex items-start gap-3">
        <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${row.mancante ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{row.mancante ? <Barcode className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1"><div className="truncate font-bold">{row.titolo || "Titolo non disponibile"}</div><div className="mt-1 truncate font-mono text-xs text-slate-500">{row.ean || "EAN assente"} · {row.fnsku || "FNSKU assente"}</div><Progress value={progress} className="mt-3 h-1.5" /></div>
        <div className="shrink-0 text-right"><div className="text-base font-black">{registered}/{row.atteso}</div><div className={`mt-1 text-[10px] font-bold ${row.mancante ? "text-amber-700" : "text-emerald-700"}`}>{row.mancante ? `${row.mancante} mancanti` : "Completa"}</div></div>
        {!disabled && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-400" />}
      </div>
    </button>
  );
}

function MovementRow({ movement, canDelete, working, onDelete }) {
  const Icon = movement.disposizione === "danneggiato" ? AlertTriangle : movement.disposizione === "quarantena" ? ShieldAlert : CheckCircle2;
  const colors = movement.disposizione === "danneggiato" ? "bg-red-50 text-red-700" : movement.disposizione === "quarantena" ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-700";
  return <div className="flex items-center gap-3 p-4"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${colors}`}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{movement.riga?.titolo || movement.riga?.ean || "Referenza"}</div><div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{movement.location?.codice || "—"}</span><span>{formatTime(movement.created_at)}</span></div></div><div className="text-right"><div className="text-lg font-black">+{movement.quantita}</div><div className="text-[10px] font-bold capitalize text-slate-500">{movement.disposizione}</div></div>{canDelete && <Button type="button" size="icon" variant="ghost" disabled={working} onClick={onDelete} aria-label="Annulla registrazione"><Trash2 className="h-4 w-4 text-red-600" /></Button>}</div>;
}

function EntryStatus({ entry, active }) {
  if (active) return <span className="flex shrink-0 items-center gap-1 rounded-md bg-slate-950 px-2 py-1 text-[10px] font-black uppercase text-white"><Clock3 className="h-3 w-3" /> In corso</span>;
  if (entry.stato === "ricevuto") return <span className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Completato</span>;
  return <span className="flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-800"><Clock3 className="h-3 w-3" /> Da ricevere</span>;
}

function EmptyInbound({ onBack }) {
  return <div className="flex min-h-[65dvh] flex-col items-center justify-center text-center"><RotateCcw className="h-9 w-9 text-slate-300" /><h1 className="mt-4 text-xl font-black">Inbound non disponibile</h1><p className="mt-2 text-sm text-slate-500">Controlla l'entrata e riprova.</p><Button variant="outline" className="mt-5" onClick={onBack}>Torna agli arrivi</Button></div>;
}

function capitalize(value) { const text = String(value || ""); return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Entrata"; }
function formatTime(value) { return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }

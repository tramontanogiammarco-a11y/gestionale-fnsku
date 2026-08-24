import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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
  AlertTriangle, ArrowLeft, Barcode, Box, CheckCircle2, CirclePause, Clock3,
  Loader2, MapPin, PackageCheck, Plus, RotateCcw, ShieldAlert, Trash2,
} from "lucide-react";

const DISPOSITIONS = [
  { value: "disponibile", label: "Disponibile", icon: CheckCircle2, cls: "border-emerald-500 bg-emerald-50 text-emerald-800" },
  { value: "danneggiato", label: "Danneggiato", icon: AlertTriangle, cls: "border-rose-500 bg-rose-50 text-rose-800" },
  { value: "quarantena", label: "Quarantena", icon: ShieldAlert, cls: "border-amber-500 bg-amber-50 text-amber-800" },
];

export default function WmsInbound() {
  const { id } = useParams();
  const navigate = useNavigate();
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
  const activeLocations = useMemo(() => (data?.locations || []).filter((location) => location.stato === "attiva"), [data]);
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
    const defaultLocation = activeLocations.find((location) => location.codice === "INBOUND-01") || activeLocations[0];
    if (defaultLocation) setLocationId(defaultLocation.id);
  }, [activeLocations, data, locationId]);

  useEffect(() => {
    if (disposition !== "quarantena") return;
    const quarantine = activeLocations.find((location) => location.tipo === "quarantena");
    if (quarantine) setLocationId(quarantine.id);
  }, [activeLocations, disposition]);

  const start = async () => {
    setWorking(true);
    try {
      const response = await api.post(`/wms/inbound/${id}/avvia`, {});
      setData(response.data);
      toast.success("Sessione di ricezione avviata");
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
    setQuantity(Math.max(1, Math.min(Number(row.mancante || 1), 1)));
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
      toast.success("Ricezione registrata");
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
      toast.success("Movimento annullato");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Movimento non annullato");
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

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  if (!data) return <EmptyInbound onBack={() => navigate("/wms")} />;

  const entry = data.entrata;
  return (
    <div className="space-y-5 pb-24" data-testid="admin-wms-inbound">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/wms")} aria-label="Torna agli inbound">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-black sm:text-3xl">Ricezione inbound</h1>
              <EntryStatus entry={entry} active={Boolean(data.active_session)} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.cliente_ragione_sociale} · {capitalize(entry.tipo)} · {entry.colli || 1} {Number(entry.colli || 1) === 1 ? "collo" : "colli"}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>DDT <strong>{entry.ddt || "non indicato"}</strong></span>
              <span>Corriere <strong>{entry.corriere || "non indicato"}</strong></span>
              <span>Tracking <strong className="font-mono">{entry.tracking || "non indicato"}</strong></span>
            </div>
          </div>
        </div>
      </header>

      <section className="border-y border-slate-200 bg-white py-4">
        <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 xl:grid-cols-5">
          <Kpi label="Attesi" value={summary.expected} tone="slate" />
          <Kpi label="Disponibili" value={summary.available} tone="emerald" />
          <Kpi label="Danneggiati" value={summary.damaged} tone="rose" />
          <Kpi label="Quarantena" value={summary.quarantine} tone="amber" />
          <Kpi label="Mancanti" value={summary.missing} tone={summary.missing ? "sky" : "emerald"} className="col-span-2 sm:col-span-1" />
        </div>
        <div className="mt-4 flex items-center gap-3 px-4">
          <Progress value={progress} className="h-2 flex-1" />
          <span className="text-xs font-bold text-slate-600">{Math.round(progress)}%</span>
        </div>
      </section>

      {!closed && (
        <form onSubmit={register} className="border border-teal-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black"><Barcode className="h-5 w-5 text-teal-700" /> Scansiona merce</h2>
              <p className="mt-1 text-xs text-muted-foreground">EAN o FNSKU · quantità · ubicazione · esito</p>
            </div>
            {data.active_session
              ? selectedRow && <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">{selectedRow.mancante} mancanti</Badge>
              : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Da avviare</Badge>}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.5fr)_120px_minmax(220px,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="wms-scan">EAN o FNSKU</Label>
              <Input
                id="wms-scan"
                ref={scanRef}
                value={code}
                onChange={(event) => { setCode(event.target.value); setSelectedRowId(null); }}
                className="h-12 font-mono text-base"
                placeholder="Scansiona il codice"
                autoFocus
                autoComplete="off"
                disabled={!data.active_session}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wms-quantity">Quantità</Label>
              <Input id="wms-quantity" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-12 text-base font-bold" disabled={!data.active_session} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Ubicazione</Label>
                <button type="button" className="text-xs font-bold text-teal-700 hover:text-teal-900 disabled:text-slate-400" onClick={() => setLocationDialog(true)} disabled={!data.active_session}>Nuova</button>
              </div>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-12" disabled={!data.active_session}><SelectValue placeholder="Seleziona ubicazione" /></SelectTrigger>
                <SelectContent>
                  {activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.codice} · {location.zona || location.tipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" className="h-12 px-6" disabled={working || (Boolean(data.active_session) && ((!code && !selectedRowId) || !locationId))}>
              {working
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : data.active_session
                  ? <Plus className="mr-2 h-4 w-4" />
                  : <PackageCheck className="mr-2 h-4 w-4" />}
              {data.active_session ? "Registra" : "Avvia ricezione"}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {DISPOSITIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setDisposition(item.value)}
                disabled={!data.active_session}
                className={`flex min-h-12 items-center justify-center gap-2 border px-2 text-xs font-bold transition sm:text-sm ${disposition === item.value ? item.cls : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <item.icon className="h-4 w-4 shrink-0" /> <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </form>
      )}

      {closed && (
        <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div><div className="font-black">Inbound completato</div><div className="text-sm">La merce disponibile è già conteggiata nello stock.</div></div>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><h2 className="text-lg font-black">Righe dell'entrata</h2><p className="mt-1 text-xs text-muted-foreground">Tocca una riga per predisporre la scansione manualmente.</p></div>
          <Badge variant="secondary">{rows.length} referenze</Badge>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((row) => <InboundRow key={row.id} row={row} active={selectedRowId === row.id} disabled={!data.active_session || row.mancante <= 0} onClick={() => chooseRow(row)} />)}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-black">Ultime registrazioni</h2><p className="mt-1 text-xs text-muted-foreground">Ogni movimento resta tracciato per operatore e ubicazione.</p></div>
          <Badge variant="secondary">{data.movements.length}</Badge>
        </div>
        {data.movements.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-muted-foreground">Nessuna scansione registrata.</div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 bg-white">
            {data.movements.slice(0, 20).map((movement) => (
              <div key={movement.id} className="flex items-center gap-3 p-3 sm:p-4">
                <MovementIcon disposition={movement.disposizione} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{movement.riga?.titolo || movement.riga?.ean || "Referenza"}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{movement.codice_scansionato}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {movement.location?.codice || "—"}</span>
                    <span>{formatTime(movement.created_at)}</span>
                  </div>
                </div>
                <div className="text-right"><div className="text-lg font-black">+{movement.quantita}</div><div className="text-[11px] font-bold capitalize text-slate-500">{movement.disposizione}</div></div>
                {data.active_session?.id === movement.session_id && (
                  <Button type="button" size="icon" variant="ghost" disabled={working} onClick={() => removeMovement(movement)} aria-label="Annulla movimento">
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.active_session && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:left-[var(--admin-sidebar-width,0px)]">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
            <div className="hidden sm:block"><div className="text-sm font-black">Sessione in corso</div><div className="text-xs text-muted-foreground">{summary.missing ? `${summary.missing} pezzi ancora da verificare` : "Tutto contabilizzato"}</div></div>
            <Button variant="outline" onClick={() => navigate("/wms")}><CirclePause className="mr-2 h-4 w-4" /> Sospendi</Button>
            <Button onClick={() => summary.missing > 0 ? setDifferenceDialog(true) : complete(false)} disabled={working}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />} Chiudi inbound
            </Button>
          </div>
        </div>
      )}

      <Dialog open={locationDialog} onOpenChange={setLocationDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuova ubicazione</DialogTitle><DialogDescription>Crea una posizione fisica utilizzabile subito per il putaway.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label htmlFor="location-code">Codice</Label><Input id="location-code" value={newLocation.codice} onChange={(event) => setNewLocation((current) => ({ ...current, codice: event.target.value.toUpperCase() }))} placeholder="A-01-02" /></div>
            <div className="space-y-2"><Label htmlFor="location-zone">Zona</Label><Input id="location-zone" value={newLocation.zona} onChange={(event) => setNewLocation((current) => ({ ...current, zona: event.target.value }))} placeholder="Scaffale A" /></div>
            <div className="space-y-2"><Label>Tipo</Label><Select value={newLocation.tipo} onValueChange={(value) => setNewLocation((current) => ({ ...current, tipo: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scaffale">Scaffale</SelectItem><SelectItem value="pallet">Pallet</SelectItem><SelectItem value="terra">Terra</SelectItem><SelectItem value="quarantena">Quarantena</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setLocationDialog(false)}>Annulla</Button><Button onClick={createLocation} disabled={working || !newLocation.codice.trim()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Crea ubicazione</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={differenceDialog} onOpenChange={setDifferenceDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Chiudere con differenze?</DialogTitle><DialogDescription>Mancano {summary.missing} pezzi rispetto a quanto annunciato. Le quantità non ricevute non entreranno nello stock.</DialogDescription></DialogHeader>
          <div className="flex gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Usa “Sospendi” se la merce deve ancora arrivare. Chiudi solo se il pallet è stato verificato completamente.</div>
          <DialogFooter><Button variant="outline" onClick={() => setDifferenceDialog(false)}>Continua ricezione</Button><Button variant="destructive" onClick={() => complete(true)} disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Chiudi con differenze</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InboundRow({ row, active, disabled, onClick }) {
  const registered = Number(row.registrato || 0);
  const progress = row.atteso > 0 ? Math.min(100, (registered / row.atteso) * 100) : 0;
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`w-full border bg-white p-4 text-left transition ${active ? "border-teal-500 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300"} disabled:cursor-default disabled:opacity-75`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="truncate font-bold">{row.titolo || "Titolo non disponibile"}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"><span>EAN {row.ean || "—"}</span><span>FNSKU {row.fnsku || "—"}</span></div></div>
        <div className="shrink-0 text-right"><div className="text-lg font-black">{registered}/{row.atteso}</div><div className={`text-[11px] font-bold ${row.mancante ? "text-sky-700" : "text-emerald-700"}`}>{row.mancante ? `${row.mancante} mancanti` : "Completa"}</div></div>
      </div>
      <Progress value={progress} className="mt-3 h-1.5" />
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
        <span className="bg-emerald-50 px-2 py-1 text-emerald-800">Disponibili {row.ricevuto_disponibile}</span>
        {row.danneggiato > 0 && <span className="bg-rose-50 px-2 py-1 text-rose-800">Danneggiati {row.danneggiato}</span>}
        {row.quarantena > 0 && <span className="bg-amber-50 px-2 py-1 text-amber-800">Quarantena {row.quarantena}</span>}
      </div>
    </button>
  );
}

function Kpi({ label, value, tone, className = "" }) {
  const colors = { slate: "text-slate-950", emerald: "text-emerald-700", rose: "text-rose-700", amber: "text-amber-700", sky: "text-sky-700" };
  return <div className={`bg-white px-4 py-3 ${className}`}><div className={`text-2xl font-black ${colors[tone]}`}>{value}</div><div className="mt-1 text-xs font-bold text-slate-500">{label}</div></div>;
}

function EntryStatus({ entry, active }) {
  if (active) return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800"><Clock3 className="mr-1 h-3 w-3" /> In ricezione</Badge>;
  if (entry.stato === "ricevuto") return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" /> Completato</Badge>;
  return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800"><Box className="mr-1 h-3 w-3" /> Da ricevere</Badge>;
}

function MovementIcon({ disposition }) {
  if (disposition === "danneggiato") return <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-rose-50 text-rose-700"><AlertTriangle className="h-4 w-4" /></span>;
  if (disposition === "quarantena") return <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-amber-50 text-amber-700"><ShieldAlert className="h-4 w-4" /></span>;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>;
}

function EmptyInbound({ onBack }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"><RotateCcw className="h-8 w-8 text-slate-300" /><div><h1 className="text-xl font-black">Inbound non disponibile</h1><p className="mt-1 text-sm text-muted-foreground">Controlla l'entrata e riprova.</p></div><Button variant="outline" onClick={onBack}>Torna al WMS</Button></div>;
}

function capitalize(value) { const text = String(value || ""); return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Entrata"; }
function formatTime(value) { return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Archive, Barcode, Camera, CheckCircle2, ChevronRight,
  ClipboardCheck, History, Loader2, MapPin, Play, RefreshCw, Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import CameraScanner from "@/components/wms/CameraScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

export default function WmsAppInventory() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [locationCode, setLocationCode] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await api.get("/wms/inventario");
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Inventario non disponibile");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase) return undefined;
    let timer;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load({ quiet: true }), 300);
    };
    const channel = supabase.channel(`wms-inventory-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wms_inventory_sessions" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "wms_inventory_counts" }, schedule)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const sessions = useMemo(() => {
    const needle = normalize(search);
    return (data?.sessions || []).filter((session) => {
      if (tab === "active" && session.stato !== "in_corso") return false;
      if (tab === "history" && session.stato === "in_corso") return false;
      return !needle || [session.location?.codice, session.location?.zona, session.operator?.name, session.operator?.email]
        .some((value) => normalize(value).includes(needle));
    });
  }, [data, search, tab]);

  const start = async (rawCode = locationCode) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return;
    setWorking(true);
    try {
      const response = await api.post("/wms/inventario/avvia", { codice: code });
      setStartOpen(false);
      setCameraOpen(false);
      setLocationCode("");
      navigate(`/wms-app/inventario/${response.data.session.id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile avviare l'inventario");
    } finally {
      setWorking(false);
    }
  };

  if (loading && !data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const summary = data?.summary || {};
  return (
    <div className="wms-page" data-testid="wms-app-inventory">
      <header className="wms-page-header">
        <div>
          <p className="wms-eyebrow">Controllo fisico</p>
          <h1 className="wms-title">Inventario</h1>
          <p className="wms-subtitle">Scansiona una posizione e verifica la quantità reale.</p>
        </div>
        <Button type="button" size="icon" variant="outline" onClick={() => load()} disabled={refreshing} aria-label="Aggiorna inventari">
          {refreshing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        </Button>
      </header>

      <Button type="button" className="h-14 w-full text-base font-black" onClick={() => setStartOpen(true)} data-testid="wms-start-inventory">
        <Barcode className="mr-2 h-5 w-5" /> Nuovo inventario
      </Button>

      <section className="grid grid-cols-2 gap-3">
        <Kpi icon={Play} label="In corso" value={summary.in_corso || 0} tone="amber" />
        <Kpi icon={CheckCircle2} label="Completati" value={summary.completate || 0} tone="teal" />
        <Kpi icon={AlertTriangle} label="Con differenze" value={summary.con_differenze || 0} tone={summary.con_differenze ? "red" : "green"} />
        <Kpi icon={MapPin} label="Posizioni contate" value={summary.posizioni_contate || 0} tone="ink" />
      </section>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Sessioni inventario">
          <TabButton active={tab === "active"} onClick={() => setTab("active")} icon={ClipboardCheck}>In corso</TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")} icon={History}>Storico</TabButton>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 pl-10" placeholder="Cerca posizione o operatore" />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">{tab === "active" ? "Conteggi aperti" : "Conteggi conclusi"}</h2><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold">{sessions.length}</span></div>
        {sessions.length ? (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
            {sessions.map((session) => <SessionRow key={session.id} session={session} onClick={() => navigate(`/wms-app/inventario/${session.id}`)} />)}
          </div>
        ) : <EmptyState active={tab === "active"} onStart={() => setStartOpen(true)} />}
      </section>

      <Sheet open={startOpen} onOpenChange={setStartOpen}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-3xl rounded-t-lg border-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
            <SheetTitle className="text-xl font-black">Nuovo inventario</SheetTitle>
            <SheetDescription>Scansiona il barcode della posizione pallet o slot.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
            <Button type="button" className="h-14 w-full text-base font-black" onClick={() => setCameraOpen(true)}><Camera className="mr-2 h-5 w-5" /> Scansiona posizione</Button>
            <form onSubmit={(event) => { event.preventDefault(); start(); }} className="flex gap-2">
              <Input value={locationCode} onChange={(event) => setLocationCode(event.target.value.toUpperCase())} className="h-12 min-w-0 flex-1 font-mono" placeholder="P1+A1 o S1+A1" autoComplete="off" />
              <Button type="submit" className="h-12 shrink-0" disabled={working || !locationCode.trim()}>{working ? <Loader2 className="h-5 w-5 animate-spin" /> : "Avvia"}</Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <CameraScanner open={cameraOpen} onOpenChange={setCameraOpen} purpose="location" onDetected={start} />
    </div>
  );
}

function SessionRow({ session, onClick }) {
  const completed = session.stato === "completata";
  const cancelled = session.stato === "annullata";
  const progress = session.righe ? Math.round((session.verificate / session.righe) * 100) : 100;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${completed ? "bg-emerald-50 text-emerald-700" : cancelled ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>
        {completed ? <CheckCircle2 className="h-5 w-5" /> : cancelled ? <Archive className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><strong className="font-mono text-base">{session.location?.codice || "Posizione rimossa"}</strong>{session.anomalie > 0 && <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-700">{session.anomalie} differenze</span>}</div>
        <p className="mt-1 text-xs text-slate-500">{formatDate(session.completed_at || session.started_at)} · {session.operator?.name || session.operator?.email || "Operatore"}</p>
        {!completed && !cancelled && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-teal-600" style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className="text-right"><strong>{session.contato}</strong><span className="block text-[10px] uppercase text-slate-400">pezzi</span></div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

function Kpi({ icon: Icon, label, value, tone }) {
  const tones = { amber: "border-amber-200 bg-amber-50 text-amber-950", teal: "border-teal-200 bg-teal-50 text-teal-950", red: "border-red-200 bg-red-50 text-red-950", green: "border-emerald-200 bg-emerald-50 text-emerald-950", ink: "border-slate-900 bg-slate-950 text-white" };
  return <div className={`min-h-28 rounded-md border p-4 ${tones[tone]}`}><Icon className="h-5 w-5" /><strong className="mt-3 block text-2xl font-black">{value}</strong><span className="mt-1 block text-xs font-bold opacity-70">{label}</span></div>;
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-bold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Icon className="h-4 w-4" />{children}</button>;
}

function EmptyState({ active, onStart }) {
  return <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-6 text-center"><ClipboardCheck className="h-9 w-9 text-slate-300" /><h3 className="mt-3 font-black">{active ? "Nessun conteggio aperto" : "Nessun inventario concluso"}</h3><p className="mt-1 text-sm text-slate-500">{active ? "Scansiona una posizione per iniziare." : "Gli inventari completati compariranno qui."}</p>{active && <Button type="button" variant="outline" className="mt-4" onClick={onStart}>Nuovo inventario</Button>}</div>;
}

function normalize(value) { return String(value || "").trim().toLowerCase(); }
function formatDate(value) { return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Data non disponibile"; }

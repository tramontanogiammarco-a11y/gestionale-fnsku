import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertTriangle, Boxes, ChevronRight, Clock3, Layers3, Loader2, PackageCheck, RefreshCw, ScanLine, Settings, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { loadWmsOrders, peekWmsOrders } from "@/lib/wmsOrdersPrefetch";
import { prefetchWmsPickingQueue } from "@/lib/wmsPickingQueuePrefetch";

const STATUS_LABELS = {
  in_attesa_refill: "In attesa refill",
  da_preparare: "Da preparare",
  in_preparazione: "In preparazione",
  pronto: "Pronto",
  spedito: "Spedito",
};

export default function WmsAppOrders() {
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const initialOverview = useRef(peekWmsOrders(clientId)?.data || null).current;
  const [data, setData] = useState(initialOverview);
  const [massData, setMassData] = useState(initialOverview?.preparation?.mass || null);
  const [monoData, setMonoData] = useState(initialOverview?.preparation?.mono || null);
  const [galluseData, setGalluseData] = useState(initialOverview?.preparation?.galluse || null);
  const [refillData, setRefillData] = useState(initialOverview?.preparation?.refill || null);
  const [view, setView] = useState("tasks");
  const [tab, setTab] = useState("oggi");
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingModes, setLoadingModes] = useState(true);
  const requestVersion = useRef(0);

  const load = useCallback(async ({ force = false } = {}) => {
    const version = ++requestVersion.current;
    setRefreshing(true);
    setLoadingModes(true);
    try {
      const response = await loadWmsOrders(clientId, { force });
      if (version !== requestVersion.current) return;
      setData(response.data);
      setMassData(response.data.preparation?.mass || null);
      setMonoData(response.data.preparation?.mono || null);
      setGalluseData(response.data.preparation?.galluse || null);
      setRefillData(response.data.preparation?.refill || null);
    } catch (error) {
      if (version !== requestVersion.current) return;
      toast.error(error.response?.data?.detail || error.message || "Ordini non disponibili");
    } finally {
      if (version === requestVersion.current) {
        setRefreshing(false);
        setLoadingModes(false);
      }
    }
  }, [clientId]);

  useEffect(() => {
    prefetchWmsPickingQueue("mono", clientId)
      .finally(() => prefetchWmsPickingQueue("massivo", clientId));
  }, [clientId]);

  useEffect(() => {
    const cached = peekWmsOrders(clientId)?.data || null;
    setData(cached);
    setMassData(cached?.preparation?.mass || null);
    setMonoData(cached?.preparation?.mono || null);
    setGalluseData(cached?.preparation?.galluse || null);
    setRefillData(cached?.preparation?.refill || null);
    load({ force: Boolean(cached) });
  }, [clientId, load]);

  const visible = useMemo(() => {
    const orders = data?.orders || [];
    const massOrderIds = new Set([
      ...(massData?.groups || []).flatMap((group) => group.orders.map((order) => order.id)),
      ...(massData?.batches || []).flatMap((batch) => batch.orders.map((item) => item.order_id)),
      ...(monoData?.groups || []).flatMap((group) => group.orders.map((order) => order.id)),
      ...(monoData?.batches || []).flatMap((batch) => batch.orders.map((item) => item.order_id)),
      ...(galluseData?.batches || []).flatMap((batch) => batch.orders.map((item) => item.order_id)),
      ...(galluseData?.rounds || []).flatMap((round) => round.orders.map((order) => order.id)),
    ]);
    const individual = orders.filter((order) => !massOrderIds.has(order.id) && ["da_preparare", "in_preparazione"].includes(order.wms_status));
    return tab === "oggi" ? individual.filter((order) => order.wave !== "prossima") : individual.filter((order) => order.wave === "prossima");
  }, [data, massData, monoData, galluseData, tab]);

  const settings = data?.settings || {};
  const summary = data?.summary || {};
  const activeMassOrders = (massData?.batches || [])
    .filter((batch) => ["in_corso", "da_confermare_bag"].includes(batch.stato))
    .reduce((sum, batch) => sum + (batch.orders?.length || 0), 0);
  const availableMassOrders = (massData?.groups || []).reduce((sum, group) => sum + group.numero_ordini, 0);
  const activeMonoOrders = (monoData?.batches || [])
    .filter((batch) => ["in_corso", "da_confermare_bag"].includes(batch.stato))
    .reduce((sum, batch) => sum + (batch.orders?.length || 0), 0);
  const availableMonoOrders = (monoData?.groups || []).reduce((sum, group) => sum + group.numero_ordini, 0);
  const refillTasks = Number(refillData?.tasks || 0);
  const activeGalluse = (galluseData?.batches || []).find((batch) => ["da_associare_bag", "in_corso"].includes(batch.stato));
  const nextGalluseRound = (galluseData?.rounds || [])[0];
  const startGalluse = async () => {
    if (activeGalluse) {
      navigate(`/wms-app/picking-galluse/${activeGalluse.id}`);
      return;
    }
    if (!nextGalluseRound) {
      toast.error("Non ci sono ordini 1x1 disponibili per il Metodo Galluse.");
      return;
    }
    navigate("/wms-app/picking-galluse?scan=1");
  };
  return (
    <div className="wms-page" data-testid="wms-orders">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Outbound</p><h1 className="wms-title">Ordini</h1><p className="wms-subtitle">Scegli il metodo e inizia il prossimo compito.</p></div>
        <Button type="button" size="icon" variant="outline" onClick={() => load({ force: true })} disabled={refreshing} aria-label="Aggiorna ordini">{refreshing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}</Button>
      </header>

      <button type="button" onClick={() => navigate("/wms-app/configurazione?section=cutoff")} className="flex w-full items-center gap-3 rounded-md bg-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-200/70">
        <Clock3 className={`h-5 w-5 shrink-0 ${settings.cutoff_passed ? "text-amber-700" : "text-emerald-700"}`} />
        <span className="min-w-0 flex-1"><strong className="block text-sm">Limite ordini {settings.cutoff_time}</strong><span className="mt-0.5 block text-xs text-slate-500">{settings.cutoff_passed ? "I nuovi ordini passano alla prossima giornata" : "Giornata operativa aperta"}</span></span>
        <Settings className="h-4 w-4 text-slate-500" />
      </button>

      <div className="wms-view-tabs" role="tablist" aria-label="Vista ordini">
        <TabButton active={view === "tasks"} onClick={() => setView("tasks")}>Attività in sospeso</TabButton>
        <TabButton active={view === "operations"} onClick={() => setView("operations")}>Operativa magazzino</TabButton>
      </div>

      {view === "tasks" ? <section>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-xl font-extrabold">Scegli il compito</h2><p className="mt-1 text-xs font-medium text-slate-500">I conteggi si aggiornano automaticamente.</p></div>{loadingModes && <Loader2 className="h-4 w-4 animate-spin text-teal-700" />}</div>
        <div className="grid grid-cols-2 gap-2.5">
          <TaskCard icon={Layers3} title="Massivo" detail="Ordini uguali insieme" count={activeMassOrders || availableMassOrders} unit="ordini" tone="teal" active={activeMassOrders > 0} onIntent={() => prefetchWmsPickingQueue("massivo", clientId)} onClick={() => navigate("/wms-app/picking-massivo")} />
          <TaskCard icon={ShoppingCart} title="Galluse" detail="Un ordine per bag" count={activeGalluse?.numero_bag || nextGalluseRound?.totale_ordini || 0} unit="ordini" tone="sky" active={Boolean(activeGalluse)} onClick={startGalluse} />
          <TaskCard icon={ScanLine} title="Mono-prodotto" detail="Un pezzo per ordine" count={activeMonoOrders || availableMonoOrders} unit="ordini" tone="violet" active={activeMonoOrders > 0} onIntent={() => prefetchWmsPickingQueue("mono", clientId)} onClick={() => navigate("/wms-app/picking-mono")} />
          <TaskCard icon={Boxes} title="Refill" detail="Rifornisci gli slot" count={refillTasks} unit="attività" tone="amber" attention={refillTasks > 0} onClick={() => navigate("/wms-app/refill")} />
        </div>
      </section> : <section>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Giornata ordini">
          <TabButton active={tab === "oggi"} onClick={() => setTab("oggi")}>Oggi <span>{(summary.arretrati || 0) + (summary.oggi || 0)}</span>{summary.arretrati > 0 && <span className="text-[10px] text-amber-700">· {summary.arretrati} arretrati</span>}</TabButton>
          <TabButton active={tab === "prossima"} onClick={() => setTab("prossima")}>Prossima <span>{summary.prossima || 0}</span></TabButton>
        </div>
        <div className="mb-3 mt-5 flex items-center justify-between"><h2 className="text-xl font-extrabold">{tab === "oggi" ? "Da lavorare oggi" : "Prossima giornata"}</h2><span className="text-xs font-bold text-slate-500">{tab === "oggi" ? formatDate(settings.today) : formatDate(settings.tomorrow)}</span></div>
        {!data
          ? <div className="flex min-h-40 items-center justify-center rounded-md border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>
          : visible.length
            ? <div className="space-y-2">{visible.map((order) => <OrderRow key={order.id} order={order} onClick={() => setSelected(order)} />)}</div>
            : <EmptyOrders next={tab === "prossima"} />}
      </section>}

      <OrderSheet
        order={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        onOperate={(order) => {
          setSelected(null);
          navigate(order.wms_status === "da_preparare" ? "/wms-app/picking-galluse" : `/wms-app/picking/${order.id}`);
        }}
      />
    </div>
  );
}

function TaskCard({ icon: Icon, title, detail, count, unit, tone, active, attention, onIntent, onClick }) {
  const colors = {
    teal: "bg-teal-50 text-teal-800",
    sky: "bg-sky-50 text-sky-800",
    violet: "bg-violet-50 text-violet-800",
    amber: "bg-amber-50 text-amber-800",
  };
  return <button type="button" onPointerEnter={onIntent} onFocus={onIntent} onTouchStart={onIntent} onClick={onClick} className={`relative flex min-h-40 flex-col rounded-md border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${attention ? "border-amber-300" : "border-slate-200"}`}>
    <span className={`flex h-11 w-11 items-center justify-center rounded-md ${colors[tone]}`}><Icon className="h-5 w-5" /></span>
    <strong className="mt-3 block text-base font-extrabold leading-tight">{title}</strong>
    <span className="mt-1 block min-h-8 text-xs leading-4 text-slate-500">{detail}</span>
    <span className="mt-auto flex items-end gap-1.5 pt-3"><strong className="text-3xl font-black leading-none">{count}</strong><span className="pb-0.5 text-xs font-bold text-slate-500">{unit}</span></span>
    {active && <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-emerald-500" aria-label="Compito attivo" />}
  </button>;
}

function OrderRow({ order, onClick }) {
  const pieces = (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
  const missing = (order.items || []).filter((item) => !item.referenza_id).length;
  return (
    <button type="button" onClick={onClick} className="w-full rounded-md border border-slate-200 bg-white p-3.5 text-left transition hover:border-teal-400 active:bg-slate-50">
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${order.wave === "arretrati" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"}`}><ShoppingCart className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-lg">{order.order_name}</strong><SourceBadge order={order} />{order.wave === "arretrati" && <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-800">Arretrato</span>}</span><span className="mt-1 block text-xs text-slate-500">{order.cliente_ragione_sociale}</span></span>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
      </div>
      <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-3 text-center"><OrderStat label="Righe" value={(order.items || []).length} /><OrderStat label="Pezzi" value={pieces} /><OrderStat label="Stato" value={STATUS_LABELS[order.wms_status] || order.wms_status} compact /></div>
      {missing > 0 && <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"><AlertTriangle className="h-4 w-4" /> {missing} {missing === 1 ? "riga non collegata" : "righe non collegate"}</div>}
    </button>
  );
}

function OrderSheet({ order, open, onOpenChange, onOperate }) {
  const missing = (order?.items || []).filter((item) => !item.referenza_id).length;
  const actionLabel = order?.wms_status === "in_preparazione" ? "Continua picking" : "Apri Metodo Galluse";
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0"><SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left"><SheetTitle className="flex items-center gap-2 text-xl font-black">Ordine {order?.order_name}{order && <SourceBadge order={order} />}</SheetTitle><SheetDescription>{order?.cliente_ragione_sociale} · {order ? formatDateTime(order.processed_at) : ""}</SheetDescription></SheetHeader>{order && <div className="pb-[max(24px,env(safe-area-inset-bottom))]"><div className="grid grid-cols-3 gap-2 p-5"><Metric label="Righe" value={order.items?.length || 0} tone="slate" /><Metric label="Pezzi" value={(order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0)} tone="teal" /><Metric label="Giornata" value={formatDay(order.operational_date)} tone="blue" small /></div><div className="divide-y divide-slate-100 border-y border-slate-100">{(order.items || []).map((item) => <div key={item.id} className="flex items-start gap-3 p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100"><Boxes className="h-4 w-4" /></span><div className="min-w-0 flex-1"><strong className="block">{item.titolo}</strong><span className="mt-1 block break-all font-mono text-xs text-slate-500">SKU {item.sku || "assente"} · EAN {item.ean || "assente"}</span></div><strong className="shrink-0">×{item.quantita}</strong></div>)}</div><div className="p-5"><Button className="h-14 w-full text-base font-black" disabled={missing > 0} onClick={() => onOperate(order)}><ShoppingCart className="mr-2 h-5 w-5" />{actionLabel}</Button>{missing > 0 && <p className="mt-3 text-center text-xs font-bold text-amber-700">Collega prima tutte le righe alle referenze.</p>}</div></div>}</SheetContent></Sheet>;
}

function SourceBadge({ order }) {
  const isCsv = order?.shop_domain === "csv-import";
  return <span className={`rounded-md px-2 py-1 text-[9px] font-black uppercase ${isCsv ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>{isCsv ? "CSV" : "Shopify"}</span>;
}

function Metric({ label, value, tone, small }) {
  const colors = { teal: "text-teal-800", amber: "text-amber-800", blue: "text-sky-800", slate: "text-slate-900" };
  return <div className="min-h-16 p-3 text-center"><strong className={`block font-bold ${small ? "text-base" : `text-2xl ${colors[tone]}`}`}>{value}</strong><span className="mt-1 block text-[9px] font-bold uppercase text-slate-500">{label}</span></div>;
}
function TabButton({ active, onClick, children }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex h-12 items-center justify-center gap-2 rounded-md text-sm font-extrabold transition ${active ? "bg-white text-slate-950 shadow-[0_3px_10px_rgba(15,23,42,0.06)]" : "text-slate-500"}`}>{children}</button>; }
function OrderStat({ label, value, compact }) { return <span className="px-2"><strong className={`block ${compact ? "text-[11px]" : "text-base"}`}>{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-400">{label}</span></span>; }
function EmptyOrders({ next }) { return <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center"><PackageCheck className="h-9 w-9 text-emerald-600" /><h3 className="mt-3 font-black">Nessun ordine</h3><p className="mt-1 text-sm text-slate-500">{next ? "Non sono ancora entrati ordini per la prossima giornata." : "La coda operativa di oggi è vuota."}</p></div>; }
function formatDate(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }) : ""; }
function formatDay(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "—"; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Data non disponibile"; }

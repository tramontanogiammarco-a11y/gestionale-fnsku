import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertTriangle, Boxes, ChevronRight, Clock3, Layers3, Loader2, PackageCheck, RefreshCw, Settings, ShoppingCart } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

const STATUS_LABELS = {
  da_preparare: "Da preparare",
  in_preparazione: "In preparazione",
  pronto: "Pronto",
  spedito: "Spedito",
};

export default function WmsAppOrders() {
  const navigate = useNavigate();
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [massData, setMassData] = useState(null);
  const [galluseData, setGalluseData] = useState(null);
  const [tab, setTab] = useState("oggi");
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [startingGalluse, setStartingGalluse] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams();
      if (clientId && clientId !== "all") query.set("cliente_id", clientId);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const [response, massResponse, galluseResponse] = await Promise.all([
        api.get(`/wms/ordini${suffix}`),
        api.get(`/wms/picking-massivo${suffix}`),
        api.get(`/wms/picking-galluse${suffix}`),
      ]);
      setData(response.data);
      setMassData(massResponse.data);
      setGalluseData(galluseResponse.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Ordini non disponibili");
    } finally {
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const orders = data?.orders || [];
    const massOrderIds = new Set([
      ...(massData?.groups || []).flatMap((group) => group.orders.map((order) => order.id)),
      ...(massData?.batches || []).flatMap((batch) => batch.orders.map((item) => item.order_id)),
      ...(galluseData?.batches || []).flatMap((batch) => batch.orders.map((item) => item.order_id)),
      ...(galluseData?.candidates || []).map((order) => order.id),
    ]);
    const individual = orders.filter((order) => !massOrderIds.has(order.id) && ["da_preparare", "in_preparazione"].includes(order.wms_status));
    return tab === "oggi" ? individual.filter((order) => order.wave !== "prossima") : individual.filter((order) => order.wave === "prossima");
  }, [data, massData, galluseData, tab]);

  if (!data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const settings = data.settings || {};
  const summary = data.summary || {};
  const activeMassOrders = (massData?.batches || [])
    .filter((batch) => ["in_corso", "da_confermare_bag"].includes(batch.stato))
    .reduce((sum, batch) => sum + (batch.orders?.length || 0), 0);
  const availableMassOrders = (massData?.groups || []).reduce((sum, group) => sum + group.numero_ordini, 0);
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
    setStartingGalluse(true);
    try {
      const response = await api.post("/wms/picking-galluse/avvia", {
        cliente_id: nextGalluseRound.cliente_id,
        offset: nextGalluseRound.offset,
      });
      navigate(`/wms-app/picking-galluse/${response.data.batch.id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Carrello Galluse non avviato");
    } finally {
      setStartingGalluse(false);
    }
  };
  return (
    <div className="wms-page" data-testid="wms-orders">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Flusso outbound</p><h1 className="wms-title">Ordini</h1><p className="wms-subtitle">Scegli il metodo e avvia il prossimo compito.</p></div>
        <Button type="button" size="icon" variant="outline" onClick={load} disabled={refreshing} aria-label="Aggiorna ordini">{refreshing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}</Button>
      </header>

      <button type="button" onClick={() => navigate("/wms-app/configurazione?section=cutoff")} className="flex w-full items-center gap-3 rounded-md border border-slate-200/75 bg-white px-4 py-3 text-left shadow-[0_4px_16px_rgba(15,23,42,0.035)] transition hover:border-slate-300">
        <span className={`flex h-9 w-9 items-center justify-center rounded-md ${settings.cutoff_passed ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}><Clock3 className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">Limite ordini {settings.cutoff_time}</strong><span className="mt-0.5 block text-xs text-slate-500">{settings.cutoff_passed ? "I nuovi ordini passano a domani" : "Giornata ancora aperta"}</span></span>
        <Settings className="h-5 w-5" />
      </button>

      <section>
        <div className="mb-3"><p className="text-[11px] font-extrabold uppercase text-slate-500">Modalità di preparazione</p><h2 className="mt-1.5 text-xl font-extrabold">Prepara ordini</h2></div>
        <div className="space-y-2">
          <button type="button" onClick={startGalluse} disabled={startingGalluse} className="wms-action-row disabled:opacity-60"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-800"><ShoppingCart className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block font-extrabold">Metodo Galluse</strong><span className="mt-1 block text-xs font-medium text-slate-500">{activeGalluse ? `Riprendi carrello · ${activeGalluse.numero_bag} ordini` : nextGalluseRound ? `${nextGalluseRound.totale_ordini} ordini · ${nextGalluseRound.numero_compiti} compiti` : "Nessun compito disponibile"}</span></span><ChevronRight className="h-5 w-5 text-slate-400" /></button>
          <button type="button" onClick={() => navigate("/wms-app/picking-massivo")} className="wms-action-row"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-800"><Layers3 className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block font-extrabold">Massivo</strong><span className="mt-1 block text-xs font-medium text-slate-500">{activeMassOrders || availableMassOrders} ordini disponibili</span></span><ChevronRight className="h-5 w-5 text-slate-400" /></button>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Metric label="Arretrati" value={summary.arretrati || 0} tone={summary.arretrati ? "amber" : "slate"} />
        <Metric label="Oggi" value={summary.oggi || 0} tone="teal" />
        <Metric label="Prossimi" value={summary.prossima || 0} tone="blue" />
      </section>

      <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200/70 bg-slate-100/80 p-1" role="tablist" aria-label="Giornata ordini">
        <TabButton active={tab === "oggi"} onClick={() => setTab("oggi")}>Oggi <span>{(summary.arretrati || 0) + (summary.oggi || 0)}</span></TabButton>
        <TabButton active={tab === "prossima"} onClick={() => setTab("prossima")}>Prossima <span>{summary.prossima || 0}</span></TabButton>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-extrabold">{tab === "oggi" ? "Da lavorare oggi" : "Prossima giornata"}</h2><span className="text-xs font-bold text-slate-500">{tab === "oggi" ? formatDate(settings.today) : formatDate(settings.tomorrow)}</span></div>
        {visible.length ? <div className="space-y-3">{visible.map((order) => <OrderRow key={order.id} order={order} onClick={() => setSelected(order)} />)}</div> : <EmptyOrders next={tab === "prossima"} />}
      </section>

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

function OrderRow({ order, onClick }) {
  const pieces = (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
  const missing = (order.items || []).filter((item) => !item.referenza_id).length;
  return (
    <button type="button" onClick={onClick} className="w-full rounded-md border border-slate-200/75 bg-white p-4 text-left shadow-[0_5px_18px_rgba(15,23,42,0.04)] transition hover:-translate-y-px hover:border-teal-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
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
  const colors = { teal: "bg-teal-50 text-teal-950", amber: "bg-amber-50 text-amber-950", blue: "bg-sky-50 text-sky-950", slate: "bg-slate-100 text-slate-900" };
  return <div className={`min-h-24 rounded-md border border-white/70 p-3 ${colors[tone]}`}><strong className={`block font-extrabold ${small ? "text-base" : "text-2xl"}`}>{value}</strong><span className="mt-2 block text-[10px] font-extrabold uppercase opacity-60">{label}</span></div>;
}
function TabButton({ active, onClick, children }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex h-12 items-center justify-center gap-2 rounded-md text-sm font-extrabold transition ${active ? "bg-white text-slate-950 shadow-[0_3px_10px_rgba(15,23,42,0.06)]" : "text-slate-500"}`}>{children}</button>; }
function OrderStat({ label, value, compact }) { return <span className="px-2"><strong className={`block ${compact ? "text-[11px]" : "text-base"}`}>{value}</strong><span className="mt-1 block text-[9px] font-black uppercase text-slate-400">{label}</span></span>; }
function EmptyOrders({ next }) { return <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center"><PackageCheck className="h-9 w-9 text-emerald-600" /><h3 className="mt-3 font-black">Nessun ordine</h3><p className="mt-1 text-sm text-slate-500">{next ? "Non sono ancora entrati ordini per la prossima giornata." : "La coda operativa di oggi è vuota."}</p></div>; }
function formatDate(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }) : ""; }
function formatDay(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "—"; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Data non disponibile"; }

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Boxes, CheckCircle2, Clock3, PackageCheck,
  RefreshCw, ScanLine, TriangleAlert, UserRoundCheck, Warehouse,
} from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { exceptionGuidance } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

const EVENT_LABELS = {
  "order.created": "Ordine acquisito",
  "order.status_changed": "Stato ordine aggiornato",
  "order.exception": "Ordine in eccezione",
  "order.cancelled": "Ordine annullato",
  "order.shipped": "Ordine spedito",
  "stock.transferred": "Stock movimentato",
  "inbound.received": "Merce ricevuta",
  "picking.stock_removed": "Prelievo registrato",
  "inventory.counted": "Conteggio registrato",
  "inventory.verified": "Inventario verificato",
  "picking.status_changed": "Picking aggiornato",
  "picking.massivo.status_changed": "Picking massivo aggiornato",
  "picking.galluse.status_changed": "Picking Galluse aggiornato",
  "packing.status_changed": "Packing aggiornato",
  "inbound.status_changed": "Ricezione aggiornata",
  "inventory.status_changed": "Inventario aggiornato",
  "packing.packaging_used": "Imballaggio utilizzato",
};

const WORK_ICONS = {
  picking: ScanLine,
  picking_massivo: Boxes,
  picking_galluse: Boxes,
  packing: PackageCheck,
  inbound: Warehouse,
  inventory: CheckCircle2,
};

function dateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function duration(minutes = 0) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function humanStatus(value) {
  return String(value || "").replaceAll("_", " ");
}

function eventDetail(event) {
  if (event.event_type === "stock.transferred") {
    return `${event.metadata?.quantity || event.quantity_delta || 0} pz · ${event.location_from || "origine"} → ${event.location_to || "destinazione"}`;
  }
  if (event.event_type === "inbound.received") {
    return `${Math.abs(Number(event.quantity_delta || 0))} pz in ${event.location_to || "ubicazione"}`;
  }
  if (event.event_type === "picking.stock_removed") {
    return `${Math.abs(Number(event.quantity_delta || 0))} pz da ${event.location_from || "ubicazione"}`;
  }
  if (event.event_type.startsWith("inventory.")) {
    return `${event.metadata?.title || event.product_key || "Prodotto"} · contati ${event.metadata?.counted ?? "-"}, attesi ${event.metadata?.expected ?? "-"}`;
  }
  if (event.product_key) return event.product_key;
  return [event.order_name, event.status_from && `${humanStatus(event.status_from)} → ${humanStatus(event.status_to)}`].filter(Boolean).join(" · ") || humanStatus(event.status_to) || "Operazione registrata";
}

export default function WmsControlRoom() {
  const { clientId } = useOutletContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const suffix = clientId ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
      const response = await api.get(`/wms/control-room${suffix}`);
      setData(response.data);
      setLastRefresh(new Date());
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const urgentWork = useMemo(() => (data?.work || []).filter((row) => row.stalled), [data]);
  if (loading && !data) return <PageLoader />;

  return <div data-testid="wms-control-room">
    <PageIntro
      eyebrow="Regia operativa"
      title="Control Room"
      description="Una sola coda per anomalie, lavorazioni attive e responsabilità. Lo storico è registrato automaticamente e non può essere riscritto."
      action={<div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:inline">Aggiornata {lastRefresh ? dateTime(lastRefresh) : "-"}</span><Button variant="outline" className="h-10 rounded-md" onClick={() => load()}><RefreshCw className="mr-2 h-4 w-4" />Aggiorna</Button></div>}
    />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Eccezioni" value={data?.summary?.exceptions || 0} hint="Da risolvere" icon={AlertTriangle} tone={(data?.summary?.exceptions || 0) ? "rose" : "emerald"} />
      <Metric label="Lavorazioni attive" value={data?.summary?.active_work || 0} hint="In tutte le aree" icon={Activity} tone="sky" />
      <Metric label="Fermate oltre 45 min" value={data?.summary?.stalled || 0} hint="Priorità operativa" icon={Clock3} tone={(data?.summary?.stalled || 0) ? "amber" : "emerald"} />
      <Metric label="Operatori al lavoro" value={data?.summary?.active_operators || 0} hint="Con attività aperta" icon={UserRoundCheck} tone="teal" />
      <Metric label="Eventi oggi" value={data?.summary?.events_today || 0} hint="Azioni tracciate" icon={CheckCircle2} tone="violet" />
    </div>

    {(data?.summary?.exceptions || urgentWork.length) > 0 && <section className="mt-4 border border-rose-200 bg-rose-50">
      <div className="flex items-center gap-3 border-b border-rose-200 px-5 py-4"><TriangleAlert className="h-5 w-5 text-rose-700" /><div><h3 className="font-extrabold text-rose-950">Da gestire adesso</h3><p className="text-xs text-rose-700">Prima le eccezioni, poi le lavorazioni ferme.</p></div></div>
      <div className="grid divide-y divide-rose-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="divide-y divide-rose-100 bg-white/70">
          {(data?.exceptions || []).slice(0, 5).map((order) => { const guide = exceptionGuidance(order); return <div key={order.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{order.order_name}</strong><StatusPill tone="rose">{order.exception_type || "eccezione"}</StatusPill></div><p className="mt-2 text-xs font-semibold text-rose-800">{guide.reason}</p><p className="mt-1 text-xs leading-5 text-slate-600">{guide.action}</p></div>; })}
          {!data?.exceptions?.length && <div className="p-5 text-sm font-bold text-emerald-700">Nessuna eccezione ordine.</div>}
        </div>
        <div className="divide-y divide-rose-100 bg-white/70">
          {urgentWork.slice(0, 5).map((row) => <WorkRow key={`${row.kind}-${row.id}`} row={row} urgent />)}
          {!urgentWork.length && <div className="p-5 text-sm font-bold text-emerald-700">Nessuna lavorazione ferma.</div>}
        </div>
      </div>
      <div className="border-t border-rose-200 px-5 py-3 text-right"><Link to="/wms/exceptions" className="text-sm font-extrabold text-rose-800 hover:underline">Apri tutte le eccezioni</Link></div>
    </section>}

    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.15fr]">
      <Panel title="Lavorazioni aperte" description="Picking, packing, ricezioni e inventari in corso">
        {(data?.work || []).length ? <div className="max-h-[620px] divide-y divide-slate-100 overflow-y-auto">{data.work.map((row) => <WorkRow key={`${row.kind}-${row.id}`} row={row} />)}</div> : <EmptyState title="Nessuna lavorazione aperta" description="Il magazzino non ha sessioni operative in corso." />}
      </Panel>
      <Panel title="Registro operativo" description="Cronologia append-only delle azioni di magazzino">
        {(data?.events || []).length ? <div className="max-h-[620px] divide-y divide-slate-100 overflow-y-auto">{data.events.map((event) => <EventRow key={event.id} event={event} />)}</div> : <EmptyState title="Registro pronto" description="Le prossime azioni saranno registrate qui automaticamente." />}
      </Panel>
    </div>
  </div>;
}

function WorkRow({ row, urgent = false }) {
  const Icon = WORK_ICONS[row.kind] || Activity;
  return <div className={cn("grid gap-3 px-5 py-4 sm:grid-cols-[42px_minmax(0,1fr)_auto]", urgent && "bg-amber-50/70")}>
    <span className={cn("flex h-10 w-10 items-center justify-center rounded-md", urgent ? "bg-amber-100 text-amber-900" : "bg-slate-950 text-white")}><Icon className="h-5 w-5" /></span>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{row.label}</strong><StatusPill tone={urgent ? "amber" : "sky"}>{humanStatus(row.stato)}</StatusPill></div><p className="mt-1 truncate text-sm text-slate-600">{row.detail || "Lavorazione"}</p><p className="mt-1 text-xs font-semibold text-teal-800">{row.operator?.name || row.operator?.email || "Non assegnata"}{row.client_name ? ` · ${row.client_name}` : ""}</p></div>
    <div className="text-left sm:text-right"><p className={cn("text-sm font-extrabold", urgent ? "text-amber-800" : "text-slate-700")}>{duration(row.age_minutes)}</p><p className="mt-1 text-[10px] uppercase text-slate-400">tempo aperta</p></div>
  </div>;
}

function EventRow({ event }) {
  const negative = Number(event.quantity_delta || 0) < 0;
  return <div className="grid gap-3 px-5 py-4 sm:grid-cols-[10px_minmax(0,1fr)_auto]">
    <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", event.event_type.includes("exception") ? "bg-rose-500" : negative ? "bg-amber-500" : "bg-teal-500")} />
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{EVENT_LABELS[event.event_type] || humanStatus(event.event_type)}</strong>{event.client_name && <span className="text-[10px] font-bold uppercase text-slate-400">{event.client_name}</span>}</div><p className="mt-1 text-sm text-slate-600">{eventDetail(event)}</p><p className="mt-1 text-xs font-semibold text-teal-800">{event.operator?.name || event.operator?.email || "Sistema"}</p></div>
    <time className="text-xs text-slate-500 sm:text-right">{dateTime(event.created_at)}</time>
  </div>;
}

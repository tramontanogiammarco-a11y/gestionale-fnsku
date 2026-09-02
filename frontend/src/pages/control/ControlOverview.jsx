import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Boxes, CheckCircle2, MessageSquareText, ShoppingCart, Truck } from "lucide-react";
import { exceptionGuidance, loadControlData, EXCEPTION_STATUSES, formatDate, orderPieces, ORDER_STATUS, SHIPMENT_STATUS } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

export default function ControlOverview() {
  const context = useOutletContext();
  const { clientId, clients, isStaff } = context;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; setData(null); loadControlData({ clientId, clients, isStaff }).then((value) => live && setData(value)).catch((e) => live && setError(e.message)); return () => { live = false; }; }, [clientId, clients, isStaff]);
  const metrics = useMemo(() => data ? deriveMetrics(data) : null, [data]);
  if (!data) return <PageLoader />;
  return <div>
    <PageIntro eyebrow={context.isStaff ? "Vista globale Aimago" : "Il tuo centro logistico"} title="Control Tower" description="Ordini, stock, consegne ed eccezioni in un unico punto, aggiornati con i dati operativi del magazzino." />
    {error && <p className="mb-4 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Stock disponibile" value={metrics.stock.toLocaleString("it-IT")} hint={`${data.stock.length} SKU visibili`} icon={Boxes} />
      <Metric label="Ordini aperti" value={metrics.openOrders} hint={`${metrics.pieces} pezzi da gestire`} icon={ShoppingCart} tone="sky" />
      <Metric label="In viaggio" value={metrics.inTransit} hint="Spedizioni attive" icon={Truck} tone="violet" />
      <Metric label="Eccezioni" value={metrics.exceptions.length} hint="Richiedono attenzione" icon={AlertTriangle} tone={metrics.exceptions.length ? "rose" : "emerald"} />
      <Metric label="Ticket aperti" value={metrics.openTickets} hint="Conversazioni da seguire" icon={MessageSquareText} tone="amber" />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
      <Panel title="Andamento ordini" description="Ordini ricevuti negli ultimi 14 giorni"><div className="h-72 p-4"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.trend}><defs><linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.26}/><stop offset="100%" stopColor="#0f766e" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid stroke="#e2e8f0" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }}/><Tooltip/><Area type="monotone" dataKey="ordini" stroke="#0f766e" strokeWidth={3} fill="url(#ordersFill)"/></AreaChart></ResponsiveContainer></div></Panel>
      <Panel title="Stato lavorazioni" description="Distribuzione degli ordini"><div className="grid grid-cols-2 gap-px bg-slate-100">{Object.entries(ORDER_STATUS).filter(([key]) => key !== "annullato").map(([key, status]) => <div key={key} className="bg-white p-5"><StatusPill tone={status.tone}>{status.label}</StatusPill><p className="mt-3 text-2xl font-extrabold">{data.orders.filter((o) => o.wms_status === key).length}</p></div>)}</div></Panel>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <Panel title="Prodotti più richiesti" description="Per quantità negli ordini visibili"><div className="h-72 p-4">{metrics.topProducts.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={metrics.topProducts} layout="vertical" margin={{ left: 8, right: 16 }}><CartesianGrid stroke="#e2e8f0" horizontal={false}/><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={140} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#334155" }}/><Tooltip/><Bar dataKey="pezzi" fill="#0f766e" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer> : <EmptyState title="Nessun prodotto" />}</div></Panel>
      <Panel title="Eccezioni recenti" description="Ordini e consegne che richiedono un intervento">{metrics.exceptions.length ? <div className="divide-y divide-slate-100">{metrics.exceptions.slice(0,6).map((row) => <div key={row.key} className="flex items-start gap-3 px-5 py-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-extrabold">{row.title}</p><StatusPill tone={row.kind === "stock" ? "amber" : "rose"}>{row.label}</StatusPill></div><p className="mt-1 text-xs font-semibold text-rose-700">{row.guidance.reason}</p><p className="mt-1 text-xs leading-5 text-slate-500">{row.guidance.action}</p><p className="mt-1 text-[10px] text-slate-400">{formatDate(row.updated_at, true)}</p></div></div>)}</div> : <div className="flex min-h-72 items-center justify-center gap-3 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-6 w-6"/> Nessuna eccezione attiva</div>}</Panel>
    </div>
  </div>;
}

function deriveMetrics(data) {
  const stock = data.stock.reduce((sum, row) => sum + Number(row.disponibile || 0), 0);
  const activeOrders = data.orders.filter((o) => !["spedito", "annullato", "hold"].includes(o.wms_status));
  const productMap = new Map();
  data.orders.forEach((order) => (order.items || []).forEach((item) => { const name = item.titolo || item.sku || item.ean || "Prodotto"; productMap.set(name, (productMap.get(name) || 0) + Number(item.quantita || 0)); }));
  const topProducts = [...productMap].map(([name, pezzi]) => ({ name: name.length > 22 ? `${name.slice(0,21)}…` : name, pezzi })).sort((a,b) => b.pezzi-a.pezzi).slice(0,7);
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (13-i)); return d; });
  const trend = days.map((day) => ({ label: day.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }), ordini: data.orders.filter((o) => { const d = new Date(o.processed_at || o.created_at); return d.toDateString() === day.toDateString(); }).length }));
  const orderExceptions = data.orders.filter((order) => order.wms_status === "eccezione" || order.exception_type).map((order) => ({ key: `order-${order.id}`, kind: order.exception_type || "stock", title: order.order_name || "Ordine", label: order.exception_type === "indirizzo" ? "Indirizzo" : "Stock", guidance: exceptionGuidance(order), updated_at: order.gate_checked_at || order.updated_at }));
  const shipmentExceptions = data.shipments.filter((shipment) => EXCEPTION_STATUSES.has(shipment.stato)).map((shipment) => ({ key: `shipment-${shipment.id}`, kind: "consegna", title: shipment.order?.order_name || shipment.tracking || "Spedizione", label: SHIPMENT_STATUS[shipment.stato] || shipment.stato, guidance: exceptionGuidance(shipment), updated_at: shipment.tracking_updated_at || shipment.updated_at || shipment.created_at }));
  const exceptions = [...orderExceptions, ...shipmentExceptions].sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  return { stock, openOrders: activeOrders.length, pieces: activeOrders.reduce((s,o) => s + orderPieces(o),0), inTransit: data.shipments.filter((s) => ["creata","in_transito","in_consegna"].includes(s.stato)).length, exceptions, openTickets: data.tickets.filter((t) => !["risolto","chiuso"].includes(t.status)).length, topProducts, trend };
}

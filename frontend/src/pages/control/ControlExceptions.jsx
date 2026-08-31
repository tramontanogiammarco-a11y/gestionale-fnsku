import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertTriangle, Boxes, MapPin, MessageSquarePlus, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { exceptionGuidance, EXCEPTION_STATUSES, formatDate, queryForClient, SHIPMENT_STATUS } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

const FILTERS = [["all", "Tutte"], ["indirizzo", "Indirizzi"], ["stock", "Stock"], ["consegna", "Consegne"]];

export default function ControlExceptions() {
  const context = useOutletContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ recheck = false } = {}) => {
    setError("");
    if (recheck && context.isStaff) {
      setChecking(true);
      try {
        await api.post("/wms/order-gate/recheck", { cliente_id: context.clientId, limit: 100 });
      } catch (requestError) {
        setError(requestError.message || "Impossibile ricontrollare gli ordini");
      } finally {
        setChecking(false);
      }
    }
    const suffix = queryForClient(context.clientId);
    const [ordersResponse, shipmentsResponse] = await Promise.all([
      api.get(`/shopify/orders${suffix}`),
      api.get(`/wms/spedizioni${suffix}`),
    ]);
    setData({ orders: ordersResponse.data || [], shipments: shipmentsResponse.data || [] });
  }, [context.clientId, context.isStaff]);

  useEffect(() => { setData(null); load({ recheck: context.isStaff }); }, [context.isStaff, load]);

  const exceptions = useMemo(() => {
    if (!data) return [];
    const orderRows = data.orders.filter((order) => order.wms_status === "eccezione" || order.exception_type).map((order) => ({
      id: `order-${order.id}`,
      kind: order.exception_type || "stock",
      order,
      title: order.order_name || "Ordine",
      subtitle: order.exception_type === "indirizzo" ? "Indirizzo da correggere" : "Disponibilita insufficiente",
      guidance: exceptionGuidance(order),
      updated_at: order.gate_checked_at || order.updated_at,
    }));
    const shipmentRows = data.shipments.filter((shipment) => EXCEPTION_STATUSES.has(shipment.stato)).map((shipment) => ({
      id: `shipment-${shipment.id}`,
      kind: "consegna",
      order: shipment.order,
      order_id: shipment.order_id,
      title: shipment.order?.order_name || shipment.tracking || "Spedizione",
      subtitle: SHIPMENT_STATUS[shipment.stato] || shipment.stato,
      guidance: exceptionGuidance(shipment),
      updated_at: shipment.tracking_updated_at || shipment.updated_at,
    }));
    return [...orderRows, ...shipmentRows].filter((row) => filter === "all" || row.kind === filter)
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  }, [data, filter]);

  if (!data) return <PageLoader />;
  const counts = {
    indirizzo: data.orders.filter((order) => order.exception_type === "indirizzo").length,
    stock: data.orders.filter((order) => order.exception_type === "stock").length,
    consegna: data.shipments.filter((shipment) => EXCEPTION_STATUSES.has(shipment.stato)).length,
  };

  return <div>
    <PageIntro eyebrow="Coda operativa" title="Eccezioni" description="Indirizzi, stock e problemi di consegna raccolti in un'unica coda. Gli ordini tornano automaticamente in preparazione quando i controlli vengono superati." action={context.isStaff && <Button onClick={() => load({ recheck: true })} disabled={checking}><RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />Ricontrolla</Button>} />
    {error && <div className="mb-4 border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Indirizzi" value={counts.indirizzo} hint="Da verificare o correggere" icon={MapPin} tone={counts.indirizzo ? "rose" : "emerald"} />
      <Metric label="Stock" value={counts.stock} hint="SKU o quantita mancanti" icon={Boxes} tone={counts.stock ? "amber" : "emerald"} />
      <Metric label="Consegne" value={counts.consegna} hint="Eccezioni del corriere" icon={Truck} tone={counts.consegna ? "rose" : "emerald"} />
    </div>
    <Panel className="mt-4" title="Da risolvere" description={`${exceptions.length} elementi`}>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3">{FILTERS.map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-extrabold ${filter === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>)}</div>
      {exceptions.length ? <div className="divide-y divide-slate-100">{exceptions.map((row) => <div key={row.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[auto_1fr_0.8fr_auto] lg:items-center">
        <span className={`flex h-11 w-11 items-center justify-center rounded-md ${row.kind === "stock" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>{row.kind === "indirizzo" ? <MapPin className="h-5 w-5" /> : row.kind === "stock" ? <Boxes className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span>
        <div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold">{row.title}</p><StatusPill tone={row.kind === "stock" ? "amber" : "rose"}>{row.subtitle}</StatusPill></div><p className="mt-2 text-xs text-slate-500">{formatDate(row.updated_at, true)}</p></div>
        <div><p className="text-[10px] font-extrabold uppercase text-slate-400">Problema</p><p className="mt-1 text-sm font-bold text-slate-800">{row.guidance.reason}</p><p className="mt-2 text-[10px] font-extrabold uppercase text-teal-700">Cosa fare</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{row.guidance.action}</p></div>
        <Button variant="outline" size="sm" onClick={() => navigate(`/wms/tickets?order_id=${row.order?.id || row.order_id || ""}&category=${row.kind === "consegna" ? "spedizione" : row.kind}`)}><MessageSquarePlus className="mr-2 h-4 w-4" />Apri ticket</Button>
      </div>)}</div> : <EmptyState title="Nessuna eccezione attiva" description="Gli ordini e le spedizioni sono regolari." />}
    </Panel>
  </div>;
}

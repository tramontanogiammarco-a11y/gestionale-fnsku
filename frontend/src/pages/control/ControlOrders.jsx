import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { MapPin, MoreHorizontal, PackageOpen, PauseCircle, Search, ShoppingCart, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { formatDate, ORDER_STATUS, orderPieces, queryForClient } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

const FILTERS = [["all","Tutti"], ...Object.entries(ORDER_STATUS).map(([key,value]) => [key,value.label])];

export default function ControlOrders() {
  const context = useOutletContext(); const navigate = useNavigate();
  const [orders,setOrders] = useState(null); const [filter,setFilter] = useState("all"); const [search,setSearch] = useState("");
  useEffect(() => { let live=true; setOrders(null); api.get(`/shopify/orders${queryForClient(context.clientId)}`).then((r) => live && setOrders(r.data || [])); return () => { live=false; }; }, [context.clientId]);
  const visible = useMemo(() => (orders || []).filter((o) => (filter === "all" || o.wms_status === filter) && [o.order_name,o.customer_email,o.ship_name,o.cliente_ragione_sociale].join(" ").toLowerCase().includes(search.toLowerCase())), [orders,filter,search]);
  if (!orders) return <PageLoader />;
  const requestAction = (order, action) => navigate(`/wms/tickets?order_id=${order.id}&category=ordine&action=${action}`);
  const active = orders.filter((o) => !["spedito","annullato"].includes(o.wms_status));
  return <div><PageIntro eyebrow="Flusso outbound" title="Ordini" description="Segui ogni ordine dal suo ingresso fino alla spedizione. Le richieste di modifica vengono registrate come ticket tracciabili." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Ordini visibili" value={orders.length} icon={ShoppingCart}/><Metric label="Aperti" value={active.length} hint={`${active.reduce((s,o) => s + orderPieces(o),0)} pezzi`} icon={PackageOpen} tone="amber"/><Metric label="Spediti" value={orders.filter((o) => o.wms_status === "spedito").length} icon={PackageOpen} tone="emerald"/></div>
    <Panel className="mt-4" title="Elenco ordini" description={`${visible.length} risultati`} action={<div className="relative w-60"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca ordine" className="h-9 pl-9"/></div>}>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3">{FILTERS.map(([key,label]) => <button key={key} onClick={() => setFilter(key)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-extrabold ${filter === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>)}</div>
      {visible.length ? <div className="divide-y divide-slate-100">{visible.map((order) => { const status=ORDER_STATUS[order.wms_status] || {label:order.wms_status,tone:"slate"}; return <div key={order.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[1.1fr_0.8fr_0.65fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold">{order.order_name || "Ordine"}</p><StatusPill tone={status.tone}>{status.label}</StatusPill></div><p className="mt-1 text-xs text-slate-500">{order.ship_name || order.customer_email || "Destinatario non indicato"}</p>{context.isStaff && <p className="mt-1 text-xs font-bold text-teal-700">{order.cliente_ragione_sociale}</p>}</div><div><p className="text-[10px] font-extrabold uppercase text-slate-400">Contenuto</p><p className="mt-1 text-sm font-bold">{(order.items || []).length} SKU · {orderPieces(order)} pezzi</p></div><div><p className="text-[10px] font-extrabold uppercase text-slate-400">Ricevuto</p><p className="mt-1 text-sm font-bold">{formatDate(order.processed_at || order.created_at)}</p></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm">Gestisci<MoreHorizontal className="ml-2 h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>requestAction(order,"pausa")}><PauseCircle/>Metti in pausa</DropdownMenuItem><DropdownMenuItem onSelect={()=>requestAction(order,"indirizzo")}><MapPin/>Modifica indirizzo</DropdownMenuItem><DropdownMenuItem onSelect={()=>requestAction(order,"prodotti")}><Replace/>Modifica prodotti</DropdownMenuItem><DropdownMenuItem onSelect={()=>requestAction(order,"assistenza")}><ShoppingCart/>Altra richiesta</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>; })}</div> : <EmptyState title="Nessun ordine" description="Non ci sono ordini compatibili con il filtro selezionato."/>}
    </Panel>
  </div>;
}

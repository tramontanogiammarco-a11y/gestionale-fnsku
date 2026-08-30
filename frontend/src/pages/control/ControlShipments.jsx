import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertTriangle, CheckCircle2, MessageSquarePlus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { EXCEPTION_STATUSES, formatDate, queryForClient, SHIPMENT_STATUS } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

export default function ControlShipments() {
 const context=useOutletContext(); const navigate=useNavigate(); const [rows,setRows]=useState(null); const [search,setSearch]=useState("");
 useEffect(() => { let live=true; setRows(null); api.get(`/wms/spedizioni${queryForClient(context.clientId)}`).then((r) => live && setRows(r.data || [])); return () => { live=false; }; }, [context.clientId]);
 const visible=useMemo(() => (rows || []).filter((s) => [s.tracking,s.corriere,s.order?.order_name,s.stato].join(" ").toLowerCase().includes(search.toLowerCase())),[rows,search]);
 if(!rows) return <PageLoader/>; const exceptions=rows.filter((s) => EXCEPTION_STATUSES.has(s.stato));
 return <div><PageIntro eyebrow="Ultimo miglio" title="Spedizioni" description="Tracking, corrieri, consegne ed eccezioni operative raccolti in una sola vista."/>
 <div className="grid gap-3 sm:grid-cols-3"><Metric label="Spedizioni" value={rows.length} icon={Truck}/><Metric label="Consegnate" value={rows.filter((s)=>s.stato==="consegnata").length} icon={CheckCircle2} tone="emerald"/><Metric label="Eccezioni" value={exceptions.length} icon={AlertTriangle} tone={exceptions.length ? "rose":"emerald"}/></div>
 <Panel className="mt-4" title="Monitor spedizioni" description={`${visible.length} risultati`} action={<div className="relative w-60"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Tracking o ordine" className="h-9 pl-9"/></div>}>
 {visible.length ? <div className="divide-y divide-slate-100">{visible.map((s) => <div key={s.id} className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_0.7fr_0.75fr_auto] md:items-center"><div><p className="font-extrabold">{s.order?.order_name || "Spedizione"}</p><p className="mt-1 font-mono text-xs text-slate-500">{s.tracking || "Tracking non disponibile"}</p></div><div><p className="text-[10px] font-extrabold uppercase text-slate-400">Corriere</p><p className="mt-1 text-sm font-bold uppercase">{s.corriere || "Da assegnare"}</p></div><div><StatusPill tone={EXCEPTION_STATUSES.has(s.stato) ? "rose" : s.stato === "consegnata" ? "emerald" : "sky"}>{SHIPMENT_STATUS[s.stato] || s.stato}</StatusPill><p className="mt-2 text-xs text-slate-500">{formatDate(s.tracking_updated_at || s.updated_at || s.created_at,true)}</p></div><Button variant="outline" size="sm" onClick={()=>navigate(`/wms/tickets?order_id=${s.order_id || ""}&category=spedizione`)}><MessageSquarePlus className="mr-2 h-4 w-4"/>Assistenza</Button></div>)}</div> : <EmptyState title="Nessuna spedizione" description="Le spedizioni compariranno quando gli ordini pronti riceveranno un'etichetta."/>}
 </Panel></div>;
}

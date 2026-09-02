import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Ban, Check, Download, Eye, FileCheck2, FileSpreadsheet, Loader2, MessageSquarePlus, PackageOpen, PauseCircle, Pencil, PlayCircle, Plus, ReceiptText, RefreshCw, Save, Search, ShoppingCart, Trash2, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { exceptionGuidance, formatDate, ORDER_STATUS, orderPieces, queryForClient } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

const FILTERS = [["all","Tutti"], ...Object.entries(ORDER_STATUS).map(([key,value]) => [key,value.label])];
const EMPTY_ORDER_FORM = {ship_name:"",ship_company:"",ship_address1:"",ship_address2:"",ship_zip:"",ship_city:"",ship_province:"",ship_country:"Italia",ship_country_code:"IT",customer_phone:"",customer_email:"",note:"",items:[]};

export default function ControlOrders() {
  const context = useOutletContext(); const navigate = useNavigate();
  const [orders,setOrders] = useState(null); const [filter,setFilter] = useState("all"); const [search,setSearch] = useState("");
  const [csvOpen,setCsvOpen] = useState(false);
  const [editingOrder,setEditingOrder] = useState(null);
  const [cancellingOrder,setCancellingOrder] = useState(null);
  const [shippingOrder,setShippingOrder] = useState(null);
  const [detailOrder,setDetailOrder] = useState(null);
  const [rechecking,setRechecking] = useState(false);
  const [holdUpdating,setHoldUpdating] = useState(null);
  const loadOrders = useCallback(() => { setOrders(null); return api.get(`/shopify/orders${queryForClient(context.clientId)}`).then((r) => setOrders(r.data || [])); }, [context.clientId]);
  const recheckOrders = useCallback(async () => {
    setRechecking(true);
    try {
      const { data } = await api.post("/wms/order-gate/recheck", { pending_only: false, limit: 500, cliente_id: context.clientId || null });
      await loadOrders();
      toast.success(`${data.checked || 0} ordini ricontrollati · ${data.unblocked || 0} sbloccati`);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Ricontrollo non riuscito");
    } finally {
      setRechecking(false);
    }
  }, [context.clientId, loadOrders]);
  useEffect(() => { loadOrders(); }, [loadOrders]);
  const toggleHold = async (order) => {
    setHoldUpdating(order.id);
    const releasing = order.wms_status === "hold";
    try {
      await api.put(`/shopify/orders/${order.id}`, { action: releasing ? "release_hold" : "hold" });
      toast.success(releasing ? `Ordine ${order.order_name} riattivato` : `Ordine ${order.order_name} messo in HOLD`);
      await loadOrders();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Stato HOLD non aggiornato");
    } finally {
      setHoldUpdating(null);
    }
  };
  const visible = useMemo(() => (orders || []).filter((o) => (filter === "all" || o.wms_status === filter) && [o.order_name,o.customer_email,o.ship_name,o.cliente_ragione_sociale].join(" ").toLowerCase().includes(search.toLowerCase())), [orders,filter,search]);
  if (!orders) return <PageLoader />;
  const requestAction = (order, action) => navigate(`/wms/tickets?order_id=${order.id}&category=ordine&action=${action}`);
  const active = orders.filter((o) => !["spedito","annullato","hold"].includes(o.wms_status));
  return <div><PageIntro eyebrow="Flusso outbound" title="Ordini" description="Segui ogni ordine dal suo ingresso fino alla spedizione. Le richieste di modifica vengono registrate come ticket tracciabili." action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={recheckOrders} disabled={rechecking}>{rechecking?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<RefreshCw className="mr-2 h-4 w-4"/>}Ricontrolla e sblocca</Button><Button onClick={()=>setCsvOpen(true)} disabled={context.isStaff && !context.clientId}><Upload className="mr-2 h-4 w-4"/>Importa ordini CSV</Button></div>} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Ordini visibili" value={orders.length} icon={ShoppingCart}/><Metric label="Aperti" value={active.length} hint={`${active.reduce((s,o) => s + orderPieces(o),0)} pezzi`} icon={PackageOpen} tone="amber"/><Metric label="Spediti" value={orders.filter((o) => o.wms_status === "spedito").length} icon={PackageOpen} tone="emerald"/></div>
    <Panel className="mt-4" title="Elenco ordini" description={`${visible.length} risultati`} action={<div className="relative w-60"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca ordine" className="h-9 pl-9"/></div>}>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3">{FILTERS.map(([key,label]) => <button key={key} onClick={() => setFilter(key)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-extrabold ${filter === key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>)}</div>
      {visible.length ? <div className="divide-y divide-slate-100">{visible.map((order) => {
        const status=ORDER_STATUS[order.wms_status] || {label:order.wms_status,tone:"slate"};
        const paused=order.wms_status === "hold";
        const editable=["in_verifica","eccezione","in_attesa_refill","da_preparare"].includes(order.wms_status);
        const holdable=["in_verifica","eccezione","in_attesa_refill","da_preparare"].includes(order.wms_status);
        const cancellable=["da_preparare","hold"].includes(order.wms_status);
        const guidance=order.wms_status === "eccezione" || order.exception_type ? exceptionGuidance(order) : null;
        return <div key={order.id} className="grid gap-4 px-5 py-5 xl:grid-cols-[1.05fr_0.65fr_0.55fr_auto] xl:items-center"><button type="button" className="text-left" onClick={()=>setDetailOrder(order)}><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold hover:text-teal-700">{order.order_name || "Ordine"}</p><StatusPill tone={status.tone}>{status.label}</StatusPill></div><p className="mt-1 text-xs text-slate-500">{order.ship_name || order.customer_email || "Destinatario non indicato"}</p>{guidance && <div className="mt-3 border-l-2 border-rose-400 pl-3"><p className="text-xs font-extrabold text-rose-700">{guidance.reason}</p><p className="mt-1 text-xs leading-5 text-slate-600">{guidance.action}</p></div>}{context.isStaff && <p className="mt-1 text-xs font-bold text-teal-700">{order.cliente_ragione_sociale}</p>}</button><div><p className="text-[10px] font-extrabold uppercase text-slate-400">Contenuto</p><p className="mt-1 text-sm font-bold">{(order.items || []).length} SKU · {orderPieces(order)} pezzi</p><p className="mt-1 text-xs font-extrabold text-teal-700">{order.cost_summary?.total == null ? "Costo da calcolare" : `Totale stimato € ${Number(order.cost_summary.total).toFixed(2)}`}</p></div><div><p className="text-[10px] font-extrabold uppercase text-slate-400">Ricevuto</p><p className="mt-1 text-sm font-bold">{formatDate(order.processed_at || order.created_at)}</p></div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" onClick={()=>setDetailOrder(order)}><Eye className="mr-2 h-4 w-4"/>Dettaglio</Button><Button variant="outline" size="sm" onClick={()=>setShippingOrder(order)}><Truck className="mr-2 h-4 w-4"/>Corriere{order.selected_carrier ? ` · ${order.selected_carrier.toUpperCase()}` : ""}</Button><Button variant="outline" size="sm" onClick={()=>setEditingOrder(order)} disabled={!editable} title={editable?"Modifica ordine":paused?"Riattiva l'ordine prima di modificarlo":"Picking già iniziato"}><Pencil className="mr-2 h-4 w-4"/>Modifica</Button>{(holdable || paused) && <Button variant="outline" size="sm" className={paused?"border-emerald-200 text-emerald-700 hover:bg-emerald-50":"border-amber-200 text-amber-800 hover:bg-amber-50"} onClick={()=>toggleHold(order)} disabled={holdUpdating===order.id}>{holdUpdating===order.id?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:paused?<PlayCircle className="mr-2 h-4 w-4"/>:<PauseCircle className="mr-2 h-4 w-4"/>}{paused?"Riattiva":"HOLD"}</Button>}{cancellable && <Button variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={()=>setCancellingOrder(order)}><Ban className="mr-2 h-4 w-4"/>Annulla</Button>}<Button size="sm" onClick={()=>requestAction(order,"assistenza")}><MessageSquarePlus className="mr-2 h-4 w-4"/>Apri ticket</Button></div></div>;
      })}</div> : <EmptyState title="Nessun ordine" description="Non ci sono ordini compatibili con il filtro selezionato."/>}
    </Panel><CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} clientId={context.clientId} onImported={recheckOrders}/><OrderDetailDialog order={detailOrder} onOpenChange={(open)=>!open&&setDetailOrder(null)} onCarrier={()=>{setShippingOrder(detailOrder);setDetailOrder(null);}} onLoaded={loadOrders}/><ShippingQuoteDialog order={shippingOrder} onOpenChange={(open)=>!open&&setShippingOrder(null)} onSaved={loadOrders}/><EditOrderDialog order={editingOrder} onOpenChange={(open)=>!open&&setEditingOrder(null)} onSaved={recheckOrders}/><CancelOrderDialog order={cancellingOrder} onOpenChange={(open)=>!open&&setCancellingOrder(null)} onCancelled={loadOrders}/>
  </div>;
}

function OrderDetailDialog({ order, onOpenChange, onCarrier, onLoaded }) {
  const [detail,setDetail]=useState(null); const [error,setError]=useState("");
  useEffect(()=>{
    if(!order)return;
    setDetail(null); setError("");
    api.get(`/wms/orders/${order.id}/cost-detail`)
      .then(({data})=>setDetail(data))
      .catch((requestError)=>setError(requestError.response?.data?.detail||requestError.message||"Dettaglio non disponibile"));
  },[order]);
  const close=(open)=>{onOpenChange(open);if(!open&&detail?.quote?.automatic_choice)onLoaded();};
  const money=(value)=>value==null?"Da calcolare":`€ ${Number(value).toFixed(2)}`;
  const selectedCarrier=detail?.quote?.selected_carrier||detail?.quote?.recommended||order?.selected_carrier;
  return <Dialog open={Boolean(order)} onOpenChange={close}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Ordine {order?.order_name}</DialogTitle><DialogDescription>Contenuto, imballaggio e costo completo dell’ordine.</DialogDescription></DialogHeader>
    {error?<div className="border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div>:!detail?<div className="flex min-h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700"/></div>:<div className="space-y-5">
      <div className="grid gap-3 bg-slate-950 p-4 text-white sm:grid-cols-[1fr_auto]"><div><p className="text-xs font-extrabold uppercase text-teal-300">Destinatario</p><p className="mt-1 text-lg font-black">{detail.order.ship_name||"Non indicato"}</p><p className="mt-1 text-sm text-slate-300">{[detail.order.ship_address1,detail.order.ship_address2,detail.order.ship_zip,detail.order.ship_city,detail.order.ship_province].filter(Boolean).join(" · ")}</p></div><div className="sm:text-right"><p className="text-xs font-extrabold uppercase text-teal-300">Totale stimato</p><p className="mt-1 text-3xl font-black">{money(detail.costs.total)}</p></div></div>
      <section><h3 className="mb-2 text-sm font-extrabold">Prodotti nell’ordine</h3><div className="divide-y divide-slate-100 border border-slate-200">{detail.order.items.map((item)=><div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-bold">{item.titolo||"Prodotto"}</p><p className="mt-1 text-xs text-slate-500">{[item.sku&&`SKU ${item.sku}`,item.ean&&`EAN ${item.ean}`,item.fnsku&&`FNSKU ${item.fnsku}`].filter(Boolean).join(" · ")||"Codice non indicato"}</p></div><p className="text-lg font-black">x{Number(item.quantita||0)}</p></div>)}</div></section>
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]"><section className="border border-slate-200 p-4"><p className="text-xs font-extrabold uppercase text-slate-400">Imballaggio associato</p>{detail.packaging?<><p className="mt-2 text-lg font-black">{detail.packaging.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{detail.packaging.packaging_code}</p><p className="mt-4 text-sm font-bold">Costo {money(detail.packaging.total)}</p></>:<><p className="mt-2 font-bold text-slate-700">Da definire durante il packing</p><p className="mt-1 text-xs leading-5 text-slate-500">Il costo verrà aggiunto appena l’operatore scansiona scatola o busta.</p></>}</section>
        <section className="border border-slate-200"><div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><ReceiptText className="h-5 w-5 text-teal-700"/><h3 className="font-extrabold">Dettaglio costi</h3></div><div className="divide-y divide-slate-100 text-sm"><CostRow label={`Spedizione ${selectedCarrier?selectedCarrier.toUpperCase():""}`} hint={detail.quote?`${detail.quote.billable_weight_kg} kg tassabili · ${detail.quote.zone.label}`:detail.quote_error} value={money(detail.costs.shipping)}/><CostRow label="Gestione ordine · primo pezzo" hint="Tariffa base prevista dal listino" value={money(detail.costs.base_fee)}/><CostRow label={`${detail.costs.extra_pieces} pezzi aggiuntivi`} hint={`${money(detail.costs.extra_unit_fee)} per pezzo extra`} value={money(detail.costs.extra_total)}/><CostRow label="Imballaggio" hint={detail.packaging?.name||"Sarà definito durante il packing"} value={money(detail.costs.packaging)}/><div className="flex items-center justify-between bg-teal-50 px-4 py-4"><span className="font-black text-teal-950">Totale ordine</span><span className="text-xl font-black text-teal-950">{money(detail.costs.total)}</span></div></div></section></div>
      {detail.quote_error&&<div className="border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">Spedizione non calcolata: {detail.quote_error}</div>}
    </div>}
    <DialogFooter className="gap-2"><Button variant="outline" onClick={()=>close(false)}>Chiudi</Button><Button onClick={onCarrier} disabled={!detail}><Truck className="mr-2 h-4 w-4"/>Cambia corriere</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function CostRow({label,hint,value}) { return <div className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="font-bold">{label}</p>{hint&&<p className="mt-0.5 text-xs text-slate-500">{hint}</p>}</div><p className="shrink-0 font-black">{value}</p></div>; }

function ShippingQuoteDialog({ order, onOpenChange, onSaved }) {
  const [quote,setQuote]=useState(null); const [selected,setSelected]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{ if(!order)return; setQuote(null);setError("");api.get(`/wms/orders/${order.id}/shipping-quote`).then(({data})=>{setQuote(data);setSelected(data.selected_carrier||data.recommended);}).catch((requestError)=>setError(requestError.response?.data?.detail||requestError.message||"Preventivo non disponibile")); },[order]);
  const confirm=async()=>{if(!selected)return;setBusy(true);try{await api.post(`/wms/orders/${order.id}/shipping-choice`,{carrier:selected});toast.success(`${selected.toUpperCase()} confermato per ${order.order_name}`);onOpenChange(false);await onSaved();}catch(requestError){toast.error(requestError.response?.data?.detail||requestError.message);}finally{setBusy(false);}};
  return <Dialog open={Boolean(order)} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Spedizione {order?.order_name}</DialogTitle><DialogDescription>Preventivo simulato sul listino del cliente. Il sistema propone automaticamente il corriere più conveniente.</DialogDescription></DialogHeader>
    {error ? <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : !quote ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700"/></div> : <div className="space-y-4">
      <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-md border border-slate-200 bg-slate-50"><QuoteMetric label="Zona" value={quote.zone.label}/><QuoteMetric label="Peso reale" value={`${quote.actual_weight_kg} kg`}/><QuoteMetric label="Peso tassabile" value={`${quote.billable_weight_kg} kg`}/></div>
      {quote.estimated_references > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><b>{quote.estimated_references} referenze con misure stimate.</b> Il preventivo funziona, ma peso e dimensioni vanno confermati nella sezione Stock/Referenze.</div>}
      <div className="grid gap-3 sm:grid-cols-2">{quote.carriers.map((carrier)=><button type="button" key={carrier.carrier} onClick={()=>!quote.locked&&setSelected(carrier.carrier)} className={`relative border p-4 text-left transition ${selected===carrier.carrier?"border-teal-600 bg-teal-50 ring-1 ring-teal-600":"border-slate-200 bg-white hover:border-slate-400"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black">{carrier.name}</p><p className="text-xs text-slate-500">{carrier.service}</p><p className="mt-1 text-xs font-bold text-slate-700">{carrier.zone?.label || quote.zone.label}</p></div>{quote.recommended===carrier.carrier&&<span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase text-emerald-800">Consigliato</span>}</div><p className="mt-5 text-3xl font-black">€ {carrier.net.toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">€ {carrier.gross.toFixed(2)} IVA inclusa{carrier.surcharge ? ` · supplemento € ${carrier.surcharge.toFixed(2)}` : ""}</p><p className="mt-2 text-[10px] font-black uppercase text-slate-400">{carrier.rate_source === "csv" ? "Tariffario cliente" : "Tariffa demo di fallback"}</p>{selected===carrier.carrier&&<Check className="absolute bottom-4 right-4 h-5 w-5 text-teal-700"/>}</button>)}</div>
      <div className={`rounded-md p-3 text-sm ${quote.locked?"bg-rose-50 text-rose-800":"bg-slate-100 text-slate-700"}`}>{quote.locked?<b>{quote.lock_reason}</b>:"Puoi cambiare e confermare il corriere fino all'avvio del packing."}</div>
    </div>}
    <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Chiudi</Button><Button onClick={confirm} disabled={busy||!quote||quote.locked||!selected}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Conferma {selected?.toUpperCase()}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function QuoteMetric({label,value}) { return <div className="min-w-0 p-3"><p className="text-[10px] font-extrabold uppercase text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black" title={value}>{value}</p></div>; }

function CancelOrderDialog({ order, onOpenChange, onCancelled }) {
  const [busy,setBusy]=useState(false);
  const cancel=async()=>{setBusy(true);try{await api.put(`/shopify/orders/${order.id}`,{action:"cancel"});toast.success(`Ordine ${order.order_name} annullato`);onOpenChange(false);await onCancelled();}catch(error){toast.error(error.response?.data?.detail||error.message||"Ordine non annullato");}finally{setBusy(false);}};
  return <Dialog open={Boolean(order)} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Annullare {order?.order_name}?</DialogTitle><DialogDescription>L’ordine passerà da Nuovo ad Annullato e non potrà più entrare nel picking.</DialogDescription></DialogHeader><DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={()=>onOpenChange(false)} disabled={busy}>Mantieni ordine</Button><Button type="button" className="bg-rose-700 text-white hover:bg-rose-800" onClick={cancel} disabled={busy}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Ban className="mr-2 h-4 w-4"/>}Conferma annullamento</Button></DialogFooter></DialogContent></Dialog>;
}

function CsvImportDialog({ open, onOpenChange, clientId, onImported }) {
  const [rows,setRows] = useState([]); const [fileName,setFileName] = useState(""); const [preview,setPreview] = useState(null); const [busy,setBusy] = useState(false);
  const reset = () => { setRows([]); setFileName(""); setPreview(null); };
  const handleOpen = (next) => { onOpenChange(next); if (!next) reset(); };
  const readFile = (file) => { reset(); if (!file) return; setFileName(file.name); Papa.parse(file,{header:true,skipEmptyLines:"greedy",transformHeader:(header)=>header.trim(),complete:({data,errors})=>{if(errors.length) return toast.error(`CSV non leggibile: ${errors[0].message}`);setRows(data || []);},error:(error)=>toast.error(error.message || "Impossibile leggere il CSV")}); };
  const check = async () => { if(!rows.length) return toast.error("Seleziona un file CSV"); setBusy(true); try { const {data}=await api.post("/wms/ordini/import-csv",{cliente_id:clientId,rows,dry_run:true}); setPreview(data); if(data.valid) toast.success("CSV valido e pronto"); } catch(error) { toast.error(error.response?.data?.detail || error.message); } finally { setBusy(false); } };
  const importRows = async () => { if(!preview?.valid) return; setBusy(true); try { const {data}=await api.post("/wms/ordini/import-csv",{cliente_id:clientId,rows,dry_run:false}); toast.success(`${data.imported} ordini importati`); handleOpen(false); await onImported(); } catch(error) { toast.error(error.response?.data?.detail || error.message); } finally { setBusy(false); } };
  const downloadTemplate = () => { const sample={numero_ordine:"ORD-1001",ean:"8050000000000",sku:"SKU-001",quantita:2,titolo:"Prodotto esempio",data_ordine:"2026-08-30",destinatario:"Mario Rossi",azienda:"",indirizzo:"Via Roma 1",cap:"00100",citta:"Roma",provincia:"RM",codice_paese:"IT",telefono:"",email:"",note:""}; const href=URL.createObjectURL(new Blob([Papa.unparse([sample])],{type:"text/csv;charset=utf-8"})); const link=document.createElement("a"); link.href=href; link.download="modello-ordini-aimago.csv"; link.click(); URL.revokeObjectURL(href); };
  return <Dialog open={open} onOpenChange={handleOpen}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Importa ordini da CSV</DialogTitle><DialogDescription>Una riga per prodotto. Le righe con lo stesso numero ordine verranno raggruppate automaticamente.</DialogDescription></DialogHeader>
    <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><label className="inline-flex h-10 cursor-pointer items-center rounded-md bg-slate-950 px-4 text-sm font-bold text-white"><Upload className="mr-2 h-4 w-4"/>Scegli CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={(event)=>readFile(event.target.files?.[0])}/></label><Button type="button" variant="outline" onClick={downloadTemplate}><Download className="mr-2 h-4 w-4"/>Scarica modello</Button>{fileName && <span className="text-sm font-semibold text-slate-600">{fileName} · {rows.length} righe</span>}</div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"><b>Colonne minime:</b> numero_ordine, quantita e almeno una tra ean, sku o fnsku. Per la spedizione aggiungi destinatario, indirizzo, cap, citta, provincia e codice_paese.</div>
      {preview && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><CsvMetric label="Ordini" value={preview.totals?.orders}/><CsvMetric label="Righe" value={preview.totals?.rows}/><CsvMetric label="Pezzi" value={preview.totals?.pieces}/><CsvMetric label="Non collegati" value={preview.totals?.unmatched} warn={preview.totals?.unmatched}/></div>{preview.errors?.length>0 && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{preview.errors.slice(0,8).map((error)=><div key={error}>{error}</div>)}</div>}{preview.valid && <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><FileCheck2 className="h-5 w-5"/>File controllato: pronto per l’importazione.</div>}</div>}
    </div><DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={check} disabled={busy || !rows.length}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<FileSpreadsheet className="mr-2 h-4 w-4"/>}Controlla file</Button><Button type="button" onClick={importRows} disabled={busy || !preview?.valid}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Importa ordini</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function CsvMetric({label,value,warn}) { return <div className={`rounded-md p-3 text-center ${warn?"bg-amber-50 text-amber-900":"bg-slate-100 text-slate-900"}`}><div className="text-xl font-black">{value ?? 0}</div><div className="text-[10px] font-extrabold uppercase">{label}</div></div>; }

function EditOrderDialog({ order, onOpenChange, onSaved }) {
  const [form,setForm]=useState(EMPTY_ORDER_FORM); const [references,setReferences]=useState([]); const [saving,setSaving]=useState(false);
  useEffect(()=>{ if(!order)return; setForm({...EMPTY_ORDER_FORM,ship_name:order.ship_name||"",ship_company:order.ship_company||"",ship_address1:order.ship_address1||"",ship_address2:order.ship_address2||"",ship_zip:order.ship_zip||"",ship_city:order.ship_city||"",ship_province:order.ship_province||"",ship_country:order.ship_country||"Italia",ship_country_code:order.ship_country_code||"IT",customer_phone:order.customer_phone||"",customer_email:order.customer_email||"",note:order.note||"",items:(order.items||[]).map((item)=>({referenza_id:item.referenza_id||"",quantita:Number(item.quantita)||1}))}); api.get(`/referenze?cliente_id=${encodeURIComponent(order.cliente_id)}`).then(({data})=>setReferences(data||[])).catch((error)=>toast.error(error.response?.data?.detail||error.message)); },[order]);
  const field=(name,value)=>setForm((current)=>({...current,[name]:value}));
  const itemField=(index,name,value)=>setForm((current)=>({...current,items:current.items.map((item,itemIndex)=>itemIndex===index?{...item,[name]:value}:item)}));
  const addItem=()=>setForm((current)=>({...current,items:[...current.items,{referenza_id:"",quantita:1}]}));
  const removeItem=(index)=>setForm((current)=>({...current,items:current.items.filter((_,itemIndex)=>itemIndex!==index)}));
  const save=async()=>{ if(!form.ship_name.trim()||!form.ship_address1.trim()||!form.ship_zip.trim()||!form.ship_city.trim())return toast.error("Completa destinatario, indirizzo, CAP e città"); if(!form.items.length||form.items.some((item)=>!item.referenza_id||Number(item.quantita)<=0))return toast.error("Completa referenza e quantità di ogni prodotto"); setSaving(true); try{await api.put(`/shopify/orders/${order.id}`,form);toast.success("Ordine aggiornato e rimesso in verifica");onOpenChange(false);await onSaved();}catch(error){toast.error(error.response?.data?.detail||error.message);}finally{setSaving(false);}};
  return <Dialog open={Boolean(order)} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Modifica {order?.order_name}</DialogTitle><DialogDescription>Aggiorna destinatario e contenuto finché il picking non è iniziato.</DialogDescription></DialogHeader>
    <div className="space-y-6"><section><h3 className="mb-3 text-sm font-extrabold">Destinatario e consegna</h3><div className="grid gap-3 sm:grid-cols-2"><OrderField label="Nome e cognome" value={form.ship_name} onChange={(v)=>field("ship_name",v)}/><OrderField label="Azienda" value={form.ship_company} onChange={(v)=>field("ship_company",v)}/><OrderField label="Indirizzo" value={form.ship_address1} onChange={(v)=>field("ship_address1",v)}/><OrderField label="Interno / scala" value={form.ship_address2} onChange={(v)=>field("ship_address2",v)}/><OrderField label="CAP" value={form.ship_zip} onChange={(v)=>field("ship_zip",v)}/><OrderField label="Città" value={form.ship_city} onChange={(v)=>field("ship_city",v)}/><OrderField label="Provincia" value={form.ship_province} onChange={(v)=>field("ship_province",v)}/><OrderField label="Codice paese" value={form.ship_country_code} onChange={(v)=>field("ship_country_code",v.toUpperCase())}/><OrderField label="Telefono" value={form.customer_phone} onChange={(v)=>field("customer_phone",v)}/><OrderField label="Email" type="email" value={form.customer_email} onChange={(v)=>field("customer_email",v)}/></div></section>
      <section><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-extrabold">Prodotti nell’ordine</h3><Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="mr-2 h-4 w-4"/>Aggiungi prodotto</Button></div><div className="space-y-2">{form.items.map((item,index)=><div key={`${index}-${item.referenza_id}`} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_120px_40px] sm:items-end"><div><label className="text-xs font-bold">Referenza</label><Select value={item.referenza_id||undefined} onValueChange={(value)=>itemField(index,"referenza_id",value)}><SelectTrigger className="mt-1"><SelectValue placeholder="Seleziona prodotto"/></SelectTrigger><SelectContent>{references.map((reference)=><SelectItem key={reference.id} value={reference.id}>{reference.titolo} · {reference.sku||reference.ean||reference.fnsku}</SelectItem>)}</SelectContent></Select></div><div><label className="text-xs font-bold">Quantità</label><Input className="mt-1" type="number" min="1" step="1" value={item.quantita} onChange={(event)=>itemField(index,"quantita",Number(event.target.value))}/></div><Button type="button" variant="ghost" size="icon" className="text-rose-700" onClick={()=>removeItem(index)} aria-label="Rimuovi prodotto"><Trash2 className="h-4 w-4"/></Button></div>)}</div></section>
      <div><label className="text-xs font-bold">Note ordine</label><textarea className="mt-1 min-h-20 w-full rounded-md border border-slate-200 p-3 text-sm" value={form.note} onChange={(event)=>field("note",event.target.value)}/></div>
    </div><DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Annulla</Button><Button onClick={save} disabled={saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salva modifiche</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function OrderField({label,value,onChange,type="text"}) { return <div><label className="text-xs font-bold">{label}</label><Input className="mt-1" type={type} value={value} onChange={(event)=>onChange(event.target.value)}/></div>; }

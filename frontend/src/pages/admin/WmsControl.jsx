import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronRight, ClipboardCheck,
  Download, Loader2, PackageCheck, PackageOpen, RefreshCw, RotateCcw, ScanLine,
  Truck, Warehouse,
} from "lucide-react";

const VIEWS = [
  { key: "control", label: "Controllo", icon: Warehouse },
  { key: "inbound", label: "Inbound", icon: PackageOpen },
  { key: "picking", label: "Picking", icon: ScanLine },
  { key: "packing", label: "Packing", icon: Boxes },
  { key: "outbound", label: "Outbound", icon: Truck },
];

const ORDER_STATUS = {
  da_preparare: { label: "Da prelevare", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  in_preparazione: { label: "Picking", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  pronto: { label: "Packing", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  spedito: { label: "Spedito", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  annullato: { label: "Annullato", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

export default function WmsControl() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState(() => {
    const requested = searchParams.get("view");
    return VIEWS.some((item) => item.key === requested) ? requested : "control";
  });
  const [data, setData] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [creatingShipment, setCreatingShipment] = useState(null);

  const load = useCallback(async () => {
    try {
      const [entrate, preps, orders, shipments, boxes] = await Promise.all([
        api.get("/entrate"),
        api.get("/preparazioni"),
        api.get("/shopify/orders"),
        api.get("/wms/spedizioni"),
        api.get("/box"),
      ]);
      setData({
        entrate: entrate.data || [],
        preps: preps.data || [],
        orders: orders.data || [],
        shipments: shipments.data || [],
        boxes: boxes.data || [],
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile caricare il WMS");
      setData({ entrate: [], preps: [], orders: [], shipments: [], boxes: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const model = useMemo(() => buildModel(data), [data]);

  const setOrderStatus = async (order, wmsStatus) => {
    setUpdating(order.id);
    try {
      await api.put(`/shopify/orders/${order.id}/stato`, { wms_status: wmsStatus });
      toast.success(`Ordine ${order.order_name} aggiornato`);
      setSelectedOrder((current) => current?.id === order.id ? { ...current, wms_status: wmsStatus } : current);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Stato non aggiornato");
    } finally {
      setUpdating(null);
    }
  };

  const createShipment = async (order) => {
    setCreatingShipment(order.id);
    try {
      await api.post("/wms/spedizioni", { order_id: order.id, corriere: "brt", colli: 1 });
      toast.success("Bozza outbound creata");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Spedizione non creata");
    } finally {
      setCreatingShipment(null);
    }
  };

  if (!data) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-5" data-testid="admin-wms-control">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-teal-700">
            <span className="h-2 w-2 rounded-full bg-teal-500" /> Centro operativo
          </div>
          <h1 className="font-heading text-3xl font-black tracking-tight">WMS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Inbound, picking, packing e outbound.</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" /> Aggiorna</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Inbound da ricevere" value={model.inbound.length} detail={`${model.inboundPieces} pezzi annunciati`} icon={PackageOpen} tone="amber" onClick={() => setView("inbound")} />
        <MetricCard label="Ordini da prelevare" value={model.picking.length} detail={`${model.pickingPieces} pezzi in coda`} icon={ScanLine} tone="sky" onClick={() => setView("picking")} />
        <MetricCard label="Da imballare" value={model.packing.length} detail={`${model.boxesReady} box Amazon pronti`} icon={Boxes} tone="violet" onClick={() => setView("packing")} />
        <MetricCard label="Outbound aperti" value={model.outbound.length} detail={`${model.shippedToday} spediti oggi`} icon={Truck} tone="emerald" onClick={() => setView("outbound")} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            onClick={() => setView(item.key)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${view === item.key ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-900"}`}
          >
            <item.icon className="h-4 w-4" /> {item.label}
            {item.key !== "control" && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{model.counts[item.key]}</span>}
          </button>
        ))}
      </div>

      {view === "control" && <ControlView model={model} setView={setView} navigate={navigate} onSelectOrder={setSelectedOrder} />}
      {view === "inbound" && <InboundView rows={model.inbound} navigate={navigate} />}
      {view === "picking" && <OrdersView rows={model.picking} updating={updating} onSelect={setSelectedOrder} onStatus={setOrderStatus} />}
      {view === "packing" && <PackingView rows={model.packing} shipmentByOrder={model.shipmentByOrder} creating={creatingShipment} onSelect={setSelectedOrder} onCreateShipment={createShipment} navigate={navigate} />}
      {view === "outbound" && <OutboundView shipments={model.outbound} amazonBoxes={model.amazonOutbound} navigate={navigate} />}

      <OrderSheet order={selectedOrder} open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)} updating={updating} onStatus={setOrderStatus} />
    </div>
  );
}

function buildModel(data) {
  const source = data || { entrate: [], preps: [], orders: [], shipments: [], boxes: [] };
  const inbound = source.entrate.filter((row) => ["in_attesa", "in_lavorazione"].includes(row.stato));
  const picking = source.orders.filter((row) => ["da_preparare", "in_preparazione"].includes(row.wms_status));
  const packing = source.orders.filter((row) => row.wms_status === "pronto");
  const outbound = source.shipments.filter((row) => !["annullata"].includes(row.stato));
  const amazonOutbound = source.boxes.filter((row) => ["pronto", "spedito"].includes(row.stato));
  const shipmentByOrder = Object.fromEntries(outbound.filter((row) => row.order_id).map((row) => [row.order_id, row]));
  const today = new Date().toDateString();
  const pieces = (rows) => rows.reduce((sum, row) => sum + (row.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0);
  return {
    ...source,
    inbound,
    picking,
    packing,
    outbound,
    amazonOutbound,
    shipmentByOrder,
    inboundPieces: inbound.reduce((sum, row) => sum + (row.righe || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0),
    pickingPieces: pieces(picking),
    boxesReady: source.boxes.filter((row) => row.stato === "pronto").length,
    shippedToday: source.boxes.filter((row) => row.stato === "spedito" && row.data_spedito && new Date(row.data_spedito).toDateString() === today).length,
    counts: { inbound: inbound.length, picking: picking.length, packing: packing.length, outbound: outbound.length },
    anomalies: [
      ...source.orders.flatMap((order) => (order.items || []).filter((item) => !item.referenza_id).map((item) => ({ type: "reference", order, item }))),
      ...source.shipments.filter((shipment) => shipment.stato === "errore").map((shipment) => ({ type: "shipment", shipment })),
    ],
  };
}

function ControlView({ model, setView, navigate, onSelectOrder }) {
  const queue = [
    ...model.inbound.slice(0, 3).map((row) => ({ id: `in-${row.id}`, title: row.cliente_ragione_sociale, meta: `${row.tipo} · ${(row.righe || []).length} referenze`, label: row.stato === "in_lavorazione" ? "Continua" : "Ricevi", tone: "amber", action: () => navigate(`/admin/wms/inbound/${row.id}`) })),
    ...model.picking.slice(0, 5).map((row) => ({ id: `pick-${row.id}`, title: `${row.order_name} · ${row.cliente_ragione_sociale}`, meta: `${(row.items || []).length} righe · ${orderPieces(row)} pezzi`, label: row.wms_status === "da_preparare" ? "Avvia picking" : "Continua", tone: "sky", action: () => onSelectOrder(row) })),
  ].slice(0, 7);
  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <Card className="overflow-hidden">
        <SectionHeader title="Coda operativa" count={queue.length} />
        <div className="divide-y divide-slate-100">
          {queue.length === 0 ? <EmptyState icon={CheckCircle2} text="Nessuna attività urgente" /> : queue.map((item) => (
            <button key={item.id} onClick={item.action} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50">
              <span className={`h-9 w-1 rounded-full ${item.tone === "amber" ? "bg-amber-400" : "bg-sky-500"}`} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.meta}</div></div>
              <span className="hidden text-xs font-bold text-teal-700 sm:inline">{item.label}</span><ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <SectionHeader title="Controlli" count={model.anomalies.length} />
        {model.anomalies.length === 0 ? <EmptyState icon={CheckCircle2} text="Nessuna anomalia aperta" /> : (
          <div className="divide-y divide-slate-100">
            {model.anomalies.slice(0, 6).map((issue, index) => (
              <div key={`${issue.type}-${index}`} className="flex gap-3 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div><div className="text-sm font-bold">{issue.type === "reference" ? "Referenza da collegare" : "Errore spedizione"}</div><div className="mt-1 text-xs text-muted-foreground">{issue.type === "reference" ? `${issue.order.order_name} · ${issue.item.titolo}` : issue.shipment.errore}</div></div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-slate-100 p-4"><Button variant="outline" className="w-full" onClick={() => setView(model.picking.length ? "picking" : "outbound")}>Apri operazioni <ArrowRight className="ml-2 h-4 w-4" /></Button></div>
      </Card>
    </div>
  );
}

function InboundView({ rows, navigate }) {
  return <Card className="overflow-hidden"><SectionHeader title="Inbound aperti" count={rows.length} />
    <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Corriere</TableHead><TableHead>Righe</TableHead><TableHead>Pezzi</TableHead><TableHead>Stato</TableHead><TableHead>Annunciata</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{rows.length === 0 ? <EmptyRow colSpan={8} text="Nessun inbound da ricevere" /> : rows.map((row) => <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/admin/wms/inbound/${row.id}`)}><TableCell className="font-bold">{row.cliente_ragione_sociale}</TableCell><TableCell className="capitalize">{row.tipo}</TableCell><TableCell>{row.corriere || "—"}</TableCell><TableCell>{row.righe?.length || 0}</TableCell><TableCell>{(row.righe || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0)}</TableCell><TableCell><Badge variant="outline" className={row.stato === "in_lavorazione" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-amber-200 bg-amber-50 text-amber-800"}>{row.stato === "in_lavorazione" ? "In ricezione" : "Da ricevere"}</Badge></TableCell><TableCell>{formatDate(row.data_annuncio)}</TableCell><TableCell><Button size="sm" variant="outline">{row.stato === "in_lavorazione" ? "Continua" : "Ricevi"} <ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody>
    </Table></Card>;
}

function OrdersView({ rows, updating, onSelect, onStatus }) {
  return <Card className="overflow-hidden"><SectionHeader title="Coda picking" count={rows.length} />
    <Table><TableHeader><TableRow><TableHead>Ordine</TableHead><TableHead>Cliente</TableHead><TableHead>Righe</TableHead><TableHead>Pezzi</TableHead><TableHead>Stato</TableHead><TableHead>Avanzamento</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{rows.length === 0 ? <EmptyRow colSpan={7} text="Nessun ordine da prelevare" /> : rows.map((order) => { const missing = (order.items || []).filter((item) => !item.referenza_id).length; const active = order.wms_status === "in_preparazione"; return <TableRow key={order.id}><TableCell><button className="text-left font-black hover:text-teal-700" onClick={() => onSelect(order)}>{order.order_name}</button><div className="text-[11px] text-muted-foreground">{order.shop_domain}</div></TableCell><TableCell>{order.cliente_ragione_sociale}</TableCell><TableCell>{order.items?.length || 0}</TableCell><TableCell>{orderPieces(order)}</TableCell><TableCell><OrderStatus value={order.wms_status} />{missing > 0 && <div className="mt-1 text-[11px] font-bold text-amber-700">{missing} non collegate</div>}</TableCell><TableCell className="min-w-36"><Progress value={active ? 50 : 10} className="h-1.5" /></TableCell><TableCell className="text-right"><Button size="sm" disabled={updating === order.id || missing > 0} onClick={() => onStatus(order, active ? "pronto" : "in_preparazione")}>{updating === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <><PackageCheck className="mr-1 h-4 w-4" /> Picking completato</> : <><ScanLine className="mr-1 h-4 w-4" /> Avvia</>}</Button></TableCell></TableRow>; })}</TableBody>
    </Table></Card>;
}

function PackingView({ rows, shipmentByOrder, creating, onSelect, onCreateShipment, navigate }) {
  return <div className="grid gap-4 lg:grid-cols-2">{rows.length === 0 ? <Card className="lg:col-span-2"><EmptyState icon={PackageCheck} text="Nessun ordine in packing" /></Card> : rows.map((order) => { const shipment = shipmentByOrder[order.id]; return <Card key={order.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><button onClick={() => onSelect(order)} className="text-lg font-black hover:text-teal-700">{order.order_name}</button><div className="mt-1 text-xs text-muted-foreground">{order.cliente_ragione_sociale} · {orderPieces(order)} pezzi</div></div><OrderStatus value={order.wms_status} /></div><div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 text-sm"><div><span className="text-xs text-muted-foreground">Righe</span><div className="font-bold">{order.items?.length || 0}</div></div><div><span className="text-xs text-muted-foreground">Outbound</span><div className="font-bold">{shipment ? shipment.stato : "Da creare"}</div></div></div><div className="mt-4 flex gap-2"><Button variant="outline" onClick={() => onSelect(order)}><ClipboardCheck className="mr-2 h-4 w-4" /> Distinta</Button>{shipment ? <Button onClick={() => navigate("/admin/ordini-wms")}>Apri spedizione <ArrowRight className="ml-2 h-4 w-4" /></Button> : <Button disabled={creating === order.id} onClick={() => onCreateShipment(order)}>{creating === order.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />} Crea outbound</Button>}</div></Card>; })}</div>;
}

function OutboundView({ shipments, amazonBoxes, navigate }) {
  return <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]"><Card className="overflow-hidden"><SectionHeader title="Spedizioni e-commerce" count={shipments.length} /><Table><TableHeader><TableRow><TableHead>Ordine</TableHead><TableHead>Corriere</TableHead><TableHead>Stato</TableHead><TableHead>Tracking</TableHead><TableHead /></TableRow></TableHeader><TableBody>{shipments.length === 0 ? <EmptyRow colSpan={5} text="Nessun outbound e-commerce" /> : shipments.map((row) => <TableRow key={row.id}><TableCell className="font-bold">{row.order?.order_name || "Manuale"}</TableCell><TableCell className="uppercase">{row.corriere}</TableCell><TableCell><ShipmentStatus value={row.stato} /></TableCell><TableCell className="font-mono text-xs">{row.tracking || "—"}</TableCell><TableCell>{row.label_url && <Button size="icon" variant="outline" asChild><a href={row.label_url} target="_blank" rel="noreferrer" aria-label="Scarica etichetta"><Download className="h-4 w-4" /></a></Button>}</TableCell></TableRow>)}</TableBody></Table></Card><Card className="overflow-hidden"><SectionHeader title="Outbound Amazon" count={amazonBoxes.length} /><div className="divide-y divide-slate-100">{amazonBoxes.length === 0 ? <EmptyState icon={Boxes} text="Nessun box pronto o spedito" /> : amazonBoxes.slice(0, 12).map((box) => <button key={box.id} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50" onClick={() => navigate("/admin/composizione-box")}><Boxes className="h-4 w-4 text-teal-700" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">Box {box.numero_box} · {box.cliente_ragione_sociale}</div><div className="text-xs text-muted-foreground">{box.preparazione_numero ? `Preparazione ${box.preparazione_numero}` : "Senza preparazione"}</div></div><Badge variant="outline">{box.stato}</Badge></button>)}</div></Card></div>;
}

function OrderSheet({ order, open, onOpenChange, updating, onStatus }) {
  if (!order) return null;
  const missing = (order.items || []).filter((item) => !item.referenza_id).length;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl"><SheetHeader><SheetTitle className="text-2xl font-black">{order.order_name}</SheetTitle><SheetDescription>{order.cliente_ragione_sociale} · {orderPieces(order)} pezzi</SheetDescription></SheetHeader><div className="mt-6 flex items-center justify-between border-y border-slate-200 py-4"><OrderStatus value={order.wms_status} /><div className="flex gap-2">{order.wms_status !== "da_preparare" && <Button size="sm" variant="outline" disabled={updating === order.id} onClick={() => onStatus(order, order.wms_status === "pronto" ? "in_preparazione" : "da_preparare")}><RotateCcw className="mr-1 h-4 w-4" /> Indietro</Button>}{order.wms_status === "da_preparare" && <Button size="sm" disabled={missing > 0 || updating === order.id} onClick={() => onStatus(order, "in_preparazione")}><ScanLine className="mr-1 h-4 w-4" /> Avvia picking</Button>}{order.wms_status === "in_preparazione" && <Button size="sm" disabled={updating === order.id} onClick={() => onStatus(order, "pronto")}><PackageCheck className="mr-1 h-4 w-4" /> Completa picking</Button>}</div></div>{missing > 0 && <div className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {missing} {missing === 1 ? "riga non è collegata" : "righe non sono collegate"} alle referenze.</div>}<div className="mt-6 space-y-2">{(order.items || []).map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-md border border-slate-200 p-4"><div><div className="font-bold">{item.titolo}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>EAN {item.ean || "—"}</span><span>SKU {item.sku || "—"}</span></div></div><div className="text-right"><div className="text-xl font-black">×{item.quantita}</div><div className={`mt-1 text-[10px] font-bold uppercase ${item.referenza_id ? "text-emerald-700" : "text-amber-700"}`}>{item.referenza_id ? "Collegata" : "Da collegare"}</div></div></div>)}</div></SheetContent></Sheet>;
}

function MetricCard({ label, value, detail, icon: Icon, tone, onClick }) {
  const tones = { amber: "bg-amber-50 text-amber-700", sky: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700" };
  return <button onClick={onClick} className="group rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow"><div className="flex items-start justify-between"><div className={`flex h-9 w-9 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700" /></div><div className="mt-4 text-3xl font-black text-slate-950">{value}</div><div className="mt-1 text-sm font-bold text-slate-800">{label}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></button>;
}

function SectionHeader({ title, count }) { return <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="text-base font-black">{title}</h2><Badge variant="secondary">{count}</Badge></div>; }
function OrderStatus({ value }) { const item = ORDER_STATUS[value] || { label: value, cls: "bg-slate-100 text-slate-700" }; return <Badge variant="outline" className={item.cls}>{item.label}</Badge>; }
function ShipmentStatus({ value }) { const cls = value === "creata" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : value === "errore" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-slate-50 text-slate-700"; return <Badge variant="outline" className={cls}>{value}</Badge>; }
function EmptyState({ icon: Icon, text }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"><Icon className="h-7 w-7 text-slate-300" /><span>{text}</span></div>; }
function EmptyRow({ colSpan, text }) { return <TableRow><TableCell colSpan={colSpan} className="py-12 text-center text-muted-foreground">{text}</TableCell></TableRow>; }
function orderPieces(order) { return (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0); }
function formatDate(value) { return value ? new Date(value).toLocaleDateString("it-IT") : "—"; }

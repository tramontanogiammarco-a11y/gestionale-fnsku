import { useEffect, useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ArrowRight, PackageCheck, PackageOpen, ShoppingCart, Warehouse } from "lucide-react";
import { prefetchWmsOrders } from "@/lib/wmsOrdersPrefetch";
import { prefetchWmsPickingQueue } from "@/lib/wmsPickingQueuePrefetch";
import { prefetchWmsStock } from "@/lib/wmsStockPrefetch";
import { prefetchWmsRoute } from "@/lib/wmsRoutePrefetch";

export default function WmsAppDashboard() {
  const navigate = useNavigate();
  const { entries, allEntries, clientId } = useOutletContext();

  useEffect(() => {
    let queueTimer;
    let cancelled = false;
    const prepareOrders = async () => {
      prefetchWmsRoute("orders");
      await prefetchWmsOrders(clientId);
      if (!cancelled) {
        queueTimer = window.setTimeout(() => prefetchWmsPickingQueue("mono", clientId), 300);
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(prepareOrders, { timeout: 800 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
        window.clearTimeout(queueTimer);
      };
    }
    const timerId = window.setTimeout(prepareOrders, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      window.clearTimeout(queueTimer);
    };
  }, [clientId]);

  const model = useMemo(() => {
    const source = entries || [];
    return {
      waiting: source.filter((entry) => entry.stato === "in_attesa"),
      active: source.filter((entry) => entry.stato === "in_lavorazione"),
    };
  }, [entries]);

  const currentInbound = model.active[0];

  return (
    <div className="wms-page" data-testid="wms-app-dashboard">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Operazioni</p><h1 className="wms-title">Magazzino</h1><p className="wms-subtitle">Attività operative e compiti da completare.</p></div>
      </header>

      {currentInbound && (
        <button
          type="button"
          onClick={() => navigate(`/wms-app/inbound/${currentInbound.id}`)}
          className="flex w-full items-center gap-3 rounded-md border border-teal-300 bg-teal-50 p-3.5 text-left transition hover:border-teal-500"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"><PackageOpen className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase text-teal-700">Continua da qui</span><strong className="mt-1 block truncate text-lg">Ricezione {currentInbound.cliente_ragione_sociale || "Cliente"}</strong></span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </button>
      )}

      <section>
        <h2 className="mb-3 text-xl font-extrabold">Operativa magazzino</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <FlowButton tone="teal" icon={PackageOpen} title="Arrivi" detail="Ricevi e ubica merce" value={allEntries === null ? "—" : model.waiting.length} unit="in attesa" onIntent={() => prefetchWmsRoute("home")} onClick={() => navigate("/wms-app/arrivi")} />
          <FlowButton tone="blue" icon={ShoppingCart} title="Ordini" detail="Avvia il picking" value="4" unit="metodi" onIntent={() => { prefetchWmsRoute("orders"); prefetchWmsOrders(clientId); }} onClick={() => navigate("/wms-app/ordini")} />
          <FlowButton tone="amber" icon={PackageCheck} title="Packing" detail="Carrelli, bag, etichette" value="Scan" unit="pronto" onIntent={() => prefetchWmsRoute("packing")} onClick={() => navigate("/packing-station")} />
          <FlowButton tone="slate" icon={Warehouse} title="Stock" detail="Ubicazioni e movimenti" value="Live" unit="inventario" onIntent={() => { prefetchWmsRoute("stock"); prefetchWmsStock(clientId); }} onClick={() => navigate("/wms-app/ubicazioni")} />
        </div>
      </section>
    </div>
  );
}

function FlowButton({ icon: Icon, title, detail, value, unit, onClick, onIntent, tone = "teal" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-800",
    blue: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
    slate: "bg-slate-100 text-slate-800",
  };
  return (
    <button type="button" onPointerDown={onIntent} onPointerEnter={onIntent} onFocus={onIntent} onClick={onClick} className="relative flex min-h-40 flex-col rounded-md border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <ArrowRight className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
      <strong className="mt-3 block text-base font-extrabold">{title}</strong>
      <span className="mt-1 block text-xs leading-4 text-slate-500">{detail}</span>
      <span className="mt-auto flex items-end gap-1.5 pt-3"><strong className="text-2xl font-black leading-none">{value}</strong><span className="pb-0.5 text-[11px] font-bold text-slate-500">{unit}</span></span>
    </button>
  );
}

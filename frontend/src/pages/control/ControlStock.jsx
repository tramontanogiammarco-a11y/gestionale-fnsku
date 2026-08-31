import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Boxes, PackageCheck, Search, Warehouse } from "lucide-react";
import { Input } from "@/components/ui/input";
import { loadControlData } from "./controlData";
import { EmptyState, Metric, PageIntro, PageLoader, Panel, StatusPill } from "./ControlUi";

export default function ControlStock() {
  const context = useOutletContext();
  const { clientId, clients, isStaff } = context;
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  useEffect(() => { let live = true; setData(null); loadControlData({ clientId, clients, isStaff }).then((v) => live && setData(v)); return () => { live = false; }; }, [clientId, clients, isStaff]);
  const rows = useMemo(() => (data?.stock || []).filter((row) => [row.titolo,row.ean,row.fnsku,...(row.skus || []),row.cliente_nome].join(" ").toLowerCase().includes(search.toLowerCase())), [data, search]);
  if (!data) return <PageLoader />;
  const totals = data.stock.reduce((acc,row) => ({ received: acc.received + Number(row.ricevuto || 0), available: acc.available + Number(row.disponibile || 0), prep: acc.prep + Number(row.in_preparazione || 0) }), { received:0, available:0, prep:0 });
  return <div><PageIntro eyebrow="Inventario" title="Stock" description="Disponibilità reale per SKU, inclusi pezzi impegnati nelle preparazioni e bundle realizzabili." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Disponibili" value={totals.available.toLocaleString("it-IT")} icon={PackageCheck}/><Metric label="In preparazione" value={totals.prep.toLocaleString("it-IT")} icon={Boxes} tone="amber"/><Metric label="Unità ricevute" value={totals.received.toLocaleString("it-IT")} icon={Warehouse} tone="sky"/></div>
    <Panel className="mt-4" title="Catalogo disponibile" description={`${rows.length} referenze`} action={<div className="relative w-64 max-w-full"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca prodotto o codice" className="h-9 pl-9"/></div>}>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-5 py-3">Prodotto</th>{context.isStaff && !context.clientId && <th className="px-5 py-3">Cliente</th>}<th className="px-5 py-3">EAN / SKU</th><th className="px-5 py-3 text-right">Ricevuto</th><th className="px-5 py-3 text-right">Impegnato</th><th className="px-5 py-3 text-right">Disponibile</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={`${row.cliente_id || "client"}-${row.ean}`} className="hover:bg-slate-50"><td className="px-5 py-4"><p className="font-extrabold">{row.titolo || "Senza titolo"}</p>{row.is_bundle && <StatusPill tone="violet">Bundle</StatusPill>}</td>{context.isStaff && !context.clientId && <td className="px-5 py-4 text-slate-600">{row.cliente_nome || "—"}</td>}<td className="px-5 py-4 font-mono text-xs text-slate-500"><p><span className="mr-2 font-sans text-[10px] font-bold uppercase text-slate-400">EAN</span>{row.ean || "—"}</p><p className="mt-1"><span className="mr-2 font-sans text-[10px] font-bold uppercase text-slate-400">SKU</span>{(row.skus || [])[0] || "—"}</p></td><td className="px-5 py-4 text-right font-bold">{row.ricevuto || 0}</td><td className="px-5 py-4 text-right font-bold text-amber-700">{row.in_preparazione || 0}</td><td className="px-5 py-4 text-right text-base font-extrabold text-teal-800">{row.disponibile || 0}</td></tr>)}</tbody></table></div> : <EmptyState title="Nessuna referenza trovata" description="Modifica la ricerca oppure seleziona un altro cliente."/>}
    </Panel>
  </div>;
}

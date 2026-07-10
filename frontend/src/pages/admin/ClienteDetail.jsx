import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Boxes, ClipboardList, Loader2, PackageOpen, Receipt, Tags, Warehouse } from "lucide-react";

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function lastSevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - index));
    return { key: d.toISOString().slice(0, 10), giorno: d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) };
  });
}

export default function AdminClienteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get("/clienti"),
      api.get(`/referenze?cliente_id=${id}`),
      api.get(`/magazzino?cliente_id=${id}`),
      api.get(`/entrate?cliente_id=${id}`),
      api.get(`/preparazioni?cliente_id=${id}`),
      api.get(`/box?cliente_id=${id}`),
    ]).then(([clienti, referenze, magazzino, entrate, preparazioni, box]) => {
      setData({
        cliente: (clienti.data || []).find((c) => c.id === id),
        referenze: referenze.data || [],
        magazzino: magazzino.data || [],
        entrate: entrate.data || [],
        preparazioni: preparazioni.data || [],
        box: box.data || [],
      });
    });
  }, [id]);

  const stats = useMemo(() => {
    if (!data) return null;
    const pezziDisponibili = data.magazzino.reduce((sum, item) => sum + Number(item.disponibile || 0), 0);
    const pezziPrep = data.preparazioni.reduce((sum, prep) => sum + (prep.righe || []).reduce((inner, r) => inner + Number(r.quantita || 0), 0), 0);
    const boxPronti = data.box.filter((b) => b.stato === "pronto").length;
    const docsMancanti = data.box.filter((b) => b.stato === "pronto" && !b.etichetta_amazon_pdf_url && !b.etichetta_ups_pdf_url).length;
    const trend = lastSevenDays().map((day) => ({
      giorno: day.giorno,
      entrate: data.entrate.filter((e) => e.data_annuncio && dayKey(e.data_annuncio) === day.key).length,
      preparazioni: data.preparazioni.filter((p) => p.created_at && dayKey(p.created_at) === day.key).length,
      box: data.box.filter((b) => b.created_at && dayKey(b.created_at) === day.key).length,
    }));
    const servizi = {};
    data.preparazioni.forEach((prep) => {
      (prep.righe || []).forEach((r) => {
        (r.servizi || []).forEach((s) => { servizi[s] = (servizi[s] || 0) + Number(r.quantita || 0); });
      });
    });
    const serviziChart = Object.entries(servizi).map(([name, value]) => ({ name, value }));
    return { pezziDisponibili, pezziPrep, boxPronti, docsMancanti, trend, serviziChart };
  }, [data]);

  if (!data || !stats) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!data.cliente) {
    return <Card className="p-10 text-center text-muted-foreground">Cliente non trovato.</Card>;
  }

  const kpis = [
    { label: "Referenze", value: data.referenze.length, icon: Tags, to: `/admin/referenze?cliente_id=${id}`, tone: "bg-teal-50 text-teal-700" },
    { label: "Disponibili", value: stats.pezziDisponibili, icon: Warehouse, to: `/admin/referenze?cliente_id=${id}`, tone: "bg-emerald-50 text-emerald-700" },
    { label: "Entrate", value: data.entrate.length, icon: PackageOpen, to: `/admin/entrate`, tone: "bg-sky-50 text-sky-700" },
    { label: "Preparazioni", value: data.preparazioni.length, icon: ClipboardList, to: `/admin/preparazioni`, tone: "bg-indigo-50 text-indigo-700" },
    { label: "Box", value: data.box.length, icon: Boxes, to: `/admin/box`, tone: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div className="space-y-6" data-testid="admin-cliente-detail">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1fr_320px]">
          <div className="p-6">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/clienti")} className="-ml-2 mb-3">
              <ArrowLeft className="mr-2 h-4 w-4" /> Clienti
            </Button>
            <h1 className="font-heading text-4xl font-black tracking-tight">{data.cliente.ragione_sociale}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{data.cliente.email}</p>
            {data.cliente.note && <p className="mt-3 max-w-3xl text-sm text-slate-600">{data.cliente.note}</p>}
          </div>
          <div className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-teal-200">Azioni rapide</div>
            <div className="mt-4 grid gap-2">
              <Button variant="secondary" onClick={() => navigate(`/admin/fatturazione?cliente_id=${id}`)}>
                <Receipt className="mr-2 h-4 w-4" /> Calcola fattura
              </Button>
              <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={() => navigate("/admin/composizione-box")}>
                <Boxes className="mr-2 h-4 w-4" /> Componi box
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {kpis.map((kpi) => (
          <Card key={kpi.label} onClick={() => navigate(kpi.to)} className="cursor-pointer p-5 transition-all hover:-translate-y-1 hover:shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{kpi.label}</div>
                <div className="mt-3 font-heading text-3xl font-black">{kpi.value}</div>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpi.tone}`}><kpi.icon className="h-5 w-5" /></div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Trend cliente</h2>
          <p className="text-xs text-muted-foreground">Movimenti degli ultimi 7 giorni.</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="giorno" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip />
                <Area dataKey="entrate" type="monotone" stroke="#0284c7" fill="#0284c7" fillOpacity={0.12} strokeWidth={2} />
                <Area dataKey="preparazioni" type="monotone" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.1} strokeWidth={2} />
                <Area dataKey="box" type="monotone" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Servizi usati</h2>
          <p className="text-xs text-muted-foreground">Quantità pezzi per lavorazione.</p>
          {stats.serviziChart.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">Nessun servizio ancora.</div>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.serviziChart}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ActivityCard title="Ultime entrate" empty="Nessuna entrata" rows={data.entrate.slice(0, 5).map((e) => ({
          id: e.id,
          title: `${e.tipo} · ${e.righe?.length || 0} ref.`,
          meta: new Date(e.data_annuncio).toLocaleDateString("it-IT"),
          status: e.stato,
          to: `/admin/entrate/${e.id}`,
        }))} />
        <ActivityCard title="Ultime preparazioni" empty="Nessuna preparazione" rows={data.preparazioni.slice(0, 5).map((p) => ({
          id: p.id,
          title: `${p.righe?.length || 0} righe · ${p.righe?.reduce((a, r) => a + Number(r.quantita || 0), 0) || 0} pezzi`,
          meta: new Date(p.created_at).toLocaleDateString("it-IT"),
          status: p.stato,
          tipo: "prep",
          to: `/admin/preparazioni/${p.id}`,
        }))} />
        <ActivityCard title="Box recenti" empty="Nessun box" rows={data.box.slice(0, 5).map((b) => ({
          id: b.id,
          title: b.numero_box,
          meta: `${b.contenuto?.length || 0} referenze`,
          status: b.stato,
          tipo: "box",
          to: "/admin/box",
        }))} />
      </div>
    </div>
  );
}

function ActivityCard({ title, rows, empty }) {
  const navigate = useNavigate();
  return (
    <Card className="p-5">
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      <div className="mt-4 divide-y divide-slate-100">
        {rows.length === 0 && <div className="py-8 text-sm text-muted-foreground">{empty}</div>}
        {rows.map((row) => (
          <button key={row.id} onClick={() => navigate(row.to)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
            <span>
              <span className="block text-sm font-semibold">{row.title}</span>
              <span className="block text-xs text-muted-foreground">{row.meta}</span>
            </span>
            <StatusBadge stato={row.status} tipo={row.tipo} />
          </button>
        ))}
      </div>
    </Card>
  );
}

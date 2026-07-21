import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { STATI_BOX, STATI_ENTRATA, STATI_PREP } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Boxes, CheckCircle2, ClipboardCheck, ClipboardList,
  FileWarning, Link2Off, Loader2, PackageOpen, Ruler, Tags, TrendingUp, Users,
} from "lucide-react";

const CHART_COLORS = ["#0f766e", "#0284c7", "#f59e0b", "#64748b", "#10b981"];

function statusRows(map, labels) {
  return Object.keys(labels).map((key, index) => ({
    key,
    name: labels[key].label,
    value: map?.[key] || 0,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [entrate, setEntrate] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data));
    api.get("/entrate").then((r) => setEntrate(r.data.slice(0, 8)));
  }, []);

  if (!stats)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  const kpis = [
    { label: "Referenze", value: stats.totale_referenze, icon: Tags, tone: "text-teal-700 bg-teal-50", to: "/admin/referenze" },
    { label: "Entrate", value: stats.totale_entrate, icon: PackageOpen, tone: "text-sky-700 bg-sky-50", to: "/admin/entrate" },
    { label: "Preparazioni", value: stats.totale_preparazioni ?? 0, icon: ClipboardList, tone: "text-indigo-700 bg-indigo-50", to: "/admin/preparazioni" },
    { label: "Box", value: stats.totale_box, icon: Boxes, tone: "text-amber-700 bg-amber-50", to: "/admin/box" },
    { label: "Clienti", value: stats.totale_clienti ?? 0, icon: Users, tone: "text-emerald-700 bg-emerald-50", to: "/admin/clienti" },
  ];
  const entrateChart = statusRows(stats.entrate_per_stato, STATI_ENTRATA);
  const prepChart = statusRows(stats.preparazioni_per_stato, STATI_PREP);
  const boxChart = statusRows(stats.box_per_stato, STATI_BOX);
  const serviziChart = Object.entries(stats.servizio_usage || {}).map(([name, value], index) => ({
    name,
    value,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));
  const workload = [
    { name: "Entrate", value: stats.totale_entrate || 0, fill: "#0284c7" },
    { name: "Preparazioni", value: stats.totale_preparazioni || 0, fill: "#4f46e5" },
    { name: "Box", value: stats.totale_box || 0, fill: "#f59e0b" },
  ];
  const urgenti = [
    { label: "Entrate in attesa", value: stats.entrate_per_stato?.in_attesa || 0, to: "/admin/entrate?stato=in_attesa" },
    { label: "Prep richieste", value: stats.preparazioni_per_stato?.richiesta || 0, to: "/admin/preparazioni" },
    { label: "Box pronti", value: stats.box_per_stato?.pronto || 0, to: "/admin/box" },
  ];
  const controlli = stats.controlli || {};
  const checks = [
    { label: "Box pronti senza etichette", value: controlli.box_pronti_senza_etichette || 0, icon: FileWarning, to: "/admin/composizione-box", detail: "Da completare prima della spedizione" },
    { label: "Box senza peso o dimensioni", value: controlli.box_dati_incompleti || 0, icon: Ruler, to: "/admin/composizione-box", detail: "Dati necessari per corriere e Amazon" },
    { label: "Box attivi non collegati", value: controlli.box_senza_preparazione || 0, icon: Link2Off, to: "/admin/composizione-box", detail: "Vanno associati alla preparazione corretta" },
    { label: "Preparazioni pronte senza box", value: controlli.preparazioni_pronte_senza_box || 0, icon: ClipboardList, to: "/admin/preparazioni", detail: "Richieste ancora da comporre" },
    { label: "Referenze senza FNSKU", value: controlli.referenze_senza_fnsku || 0, icon: Tags, to: "/admin/referenze", detail: "Da completare prima dell'imballaggio" },
    { label: "Referenze senza EAN", value: controlli.referenze_senza_ean || 0, icon: Tags, to: "/admin/referenze", detail: "Consentite, ma da verificare quando disponibile" },
  ];

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div className="overflow-hidden rounded-lg border border-slate-200/70 bg-white/85 shadow-sm backdrop-blur">
        <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
          <div className="p-6">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Control tower
            </div>
            <h1 className="font-heading text-4xl font-black tracking-tight text-balance">Dashboard prep center</h1>
            <p className="text-muted-foreground text-sm mt-1">Volumi, priorità e flussi operativi in un colpo d'occhio.</p>
          </div>
          <div className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-teal-200">Oggi da guardare</div>
              <div className={`rounded-md px-2 py-1 text-xs font-bold ${controlli.totale ? "bg-amber-400 text-slate-950" : "bg-emerald-400 text-slate-950"}`}>
                {controlli.totale ? `${controlli.totale} controlli` : "Tutto in ordine"}
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {urgenti.map((item) => (
                <button key={item.label} onClick={() => navigate(item.to)} className="flex items-center justify-between rounded-md bg-white/8 px-3 py-2 text-left transition-colors hover:bg-white/14">
                  <span className="text-sm text-slate-200">{item.label}</span>
                  <span className="font-heading text-xl font-black">{item.value}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden" data-testid="dashboard-centro-controllo">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <div className="flex items-center gap-2">
              {controlli.totale ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              <h2 className="font-heading text-lg font-bold">Centro controllo</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Dati e passaggi che richiedono attenzione prima di completare le spedizioni.</p>
          </div>
          <span className="text-sm font-bold text-slate-700">{controlli.totale || 0} da verificare</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3">
          {checks.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.to)}
              className="group flex min-h-24 items-center gap-3 border-b border-slate-100 p-4 text-left transition-colors hover:bg-slate-50 md:border-r"
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${item.value ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                {item.value ? <item.icon className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">{item.label}</span>
                  <span className="font-heading text-xl font-black">{item.value}</span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((k, i) => (
          <Card key={k.label} onClick={() => navigate(k.to)} style={{ animationDelay: `${i * 60}ms` }} className="animate-fade-up p-5 flex items-start justify-between overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-bold">{k.label}</div>
              <div className="font-heading text-4xl font-black mt-3 tracking-tight">{k.value}</div>
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                Apri dettaglio <ArrowUpRight className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${k.tone}`}>
              <k.icon className="h-5 w-5" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-heading text-lg font-bold">Trend operativo</h2>
              <p className="text-xs text-muted-foreground">Entrate, preparazioni e box creati negli ultimi 7 giorni.</p>
            </div>
            <TrendingUp className="h-5 w-5 text-teal-700" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend_operativo || []}>
                <defs>
                  <linearGradient id="colorEntrate" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPrep" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="giorno" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip />
                <Area type="monotone" dataKey="entrate" stroke="#0284c7" fill="url(#colorEntrate)" strokeWidth={2} />
                <Area type="monotone" dataKey="preparazioni" stroke="#4f46e5" fill="url(#colorPrep)" strokeWidth={2} />
                <Area type="monotone" dataKey="box" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Mix workload</h2>
          <p className="text-xs text-muted-foreground">Peso relativo dei flussi aperti.</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={workload} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={4}>
                  {workload.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2">
            {workload.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.fill }} />{item.name}</span>
                <span className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { title: "Entrate per stato", data: entrateChart, status: STATI_ENTRATA, base: "/admin/entrate?stato=" },
          { title: "Preparazioni per stato", data: prepChart, status: STATI_PREP, base: "/admin/preparazioni" },
          { title: "Box per stato", data: boxChart, status: STATI_BOX, base: "/admin/box" },
        ].map((chart) => (
          <Card key={chart.title} className="p-5">
            <h2 className="font-heading text-lg font-bold">{chart.title}</h2>
            <div className="mt-4 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chart.data.map((entry) => <Cell key={entry.key} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {chart.data.map((row) => (
                <button key={row.key} onClick={() => navigate(chart.base.includes("?") ? `${chart.base}${row.key}` : chart.base)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white">
                  {row.name}: {row.value}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Servizi più richiesti</h2>
          <p className="text-xs text-muted-foreground">Pezzi per lavorazione nelle preparazioni.</p>
          {serviziChart.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">Nessun servizio ancora richiesto.</div>
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serviziChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {serviziChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Clienti più attivi</h2>
          <p className="text-xs text-muted-foreground">Classifica per numero preparazioni.</p>
          <div className="mt-4 grid gap-2">
            {(stats.top_clienti || []).length === 0 && <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">Nessun dato cliente.</div>}
            {(stats.top_clienti || []).map((cliente, index) => (
              <button
                key={cliente.cliente_id}
                onClick={() => navigate(`/admin/clienti/${cliente.cliente_id}`)}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:bg-white"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-950 text-xs font-black text-white">{index + 1}</span>
                  <span className="truncate text-sm font-semibold">{cliente.nome}</span>
                </span>
                <span className="text-sm font-bold text-teal-700">{cliente.preparazioni}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">Ultime entrate</h2>
          <button onClick={() => navigate("/admin/entrate")} className="text-sm font-bold text-teal-700 hover:text-teal-900">
            Vedi tutte
          </button>
        </div>
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {entrate.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nessuna entrata.</div>}
          {entrate.map((e) => (
            <div
              key={e.id}
              data-testid={`dashboard-entrata-${e.id}`}
              className="flex items-center justify-between gap-4 p-4 cursor-pointer transition-colors hover:bg-slate-50"
              onClick={() => navigate(`/admin/entrate/${e.id}`)}
            >
              <div>
                <div className="font-medium text-sm">
                  {e.cliente_ragione_sociale} · <span className="capitalize">{e.tipo}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.righe?.length || 0} referenze · {new Date(e.data_annuncio).toLocaleDateString("it-IT")}
                </div>
              </div>
              <StatusBadge stato={e.stato} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

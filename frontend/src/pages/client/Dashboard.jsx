import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { STATI_BOX, STATI_ENTRATA, STATI_PREP } from "@/lib/statuses";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Loader2,
  Plus,
  Tags,
  Truck,
  Warehouse,
} from "lucide-react";

const COLORS = ["#0f766e", "#0284c7", "#f59e0b", "#4f46e5", "#10b981"];

function countBy(rows, key) {
  return (rows || []).reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});
}

function statusRows(map, labels) {
  return Object.keys(labels).map((key, index) => ({
    key,
    name: labels[key].label,
    value: map?.[key] || 0,
    fill: COLORS[index % COLORS.length],
  }));
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function lastSevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      giorno: date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }),
    };
  });
}

export default function ClientDashboard() {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get("/referenze"),
      api.get("/magazzino"),
      api.get("/entrate"),
      api.get("/preparazioni"),
      api.get("/box"),
    ]).then(([referenze, magazzino, entrate, preparazioni, box]) => {
      setData({
        referenze: referenze.data || [],
        magazzino: magazzino.data || [],
        entrate: entrate.data || [],
        preparazioni: preparazioni.data || [],
        box: box.data || [],
      });
    });
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const pezziDisponibili = data.magazzino.reduce((sum, item) => sum + Number(item.disponibile || 0), 0);
    const pezziInPreparazione = data.preparazioni
      .filter((prep) => ["richiesta", "in_lavorazione"].includes(prep.stato))
      .reduce((sum, prep) => sum + (prep.righe || []).reduce((inner, row) => inner + Number(row.quantita || 0), 0), 0);
    const boxPronti = data.box.filter((box) => box.stato === "pronto").length;
    const pdfDaCaricare = data.box.filter((box) => (
      box.stato === "pronto" && (!box.etichetta_amazon_pdf_url || !box.etichetta_ups_pdf_url)
    )).length;
    const senzaFnsku = data.referenze.filter((ref) => !ref.fnsku).length;
    const entrateMap = countBy(data.entrate, "stato");
    const prepMap = countBy(data.preparazioni, "stato");
    const boxMap = countBy(data.box, "stato");
    const trend = lastSevenDays().map((day) => ({
      giorno: day.giorno,
      entrate: data.entrate.filter((row) => row.data_annuncio && dayKey(row.data_annuncio) === day.key).length,
      preparazioni: data.preparazioni.filter((row) => row.created_at && dayKey(row.created_at) === day.key).length,
      box: data.box.filter((row) => row.created_at && dayKey(row.created_at) === day.key).length,
    }));
    const topStock = [...data.magazzino]
      .filter((item) => Number(item.disponibile || 0) > 0)
      .sort((a, b) => Number(b.disponibile || 0) - Number(a.disponibile || 0))
      .slice(0, 6)
      .map((item) => ({
        name: item.titolo || item.ean,
        shortName: (item.titolo || item.ean || "").slice(0, 18),
        value: Number(item.disponibile || 0),
      }));

    return {
      pezziDisponibili,
      pezziInPreparazione,
      boxPronti,
      pdfDaCaricare,
      senzaFnsku,
      entrateMap,
      prepMap,
      boxMap,
      trend,
      topStock,
    };
  }, [data]);

  if (!data || !stats) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const kpis = [
    { label: "Referenze", value: data.referenze.length, icon: Tags, to: "/app/referenze", tone: "bg-teal-50 text-teal-700" },
    { label: "Disponibili", value: stats.pezziDisponibili, icon: Warehouse, to: "/app/magazzino", tone: "bg-emerald-50 text-emerald-700" },
    { label: "In prep", value: stats.pezziInPreparazione, icon: ClipboardList, to: "/app/preparazioni", tone: "bg-indigo-50 text-indigo-700" },
    { label: "Box pronti", value: stats.boxPronti, icon: Boxes, to: "/app/box", tone: "bg-amber-50 text-amber-700" },
  ];
  const workload = [
    { name: "Entrate", value: data.entrate.length, fill: "#0284c7" },
    { name: "Preparazioni", value: data.preparazioni.length, fill: "#4f46e5" },
    { name: "Box", value: data.box.length, fill: "#f59e0b" },
  ];
  const alerts = [
    { label: "Referenze senza FNSKU", value: stats.senzaFnsku, to: "/app/referenze" },
    { label: "Entrate in attesa", value: stats.entrateMap.in_attesa || 0, to: "/app/entrate" },
    { label: "PDF box da caricare", value: stats.pdfDaCaricare, to: "/app/box" },
  ];
  const notifications = [
    ...data.entrate
      .filter((e) => e.stato === "ricevuto")
      .map((e) => ({
        kind: "Merce ricevuta",
        title: `${e.tipo} arrivata al prep center`,
        meta: `${e.righe?.length || 0} referenze · ${new Date(e.data_ricezione || e.data_annuncio).toLocaleDateString("it-IT")}`,
        to: `/app/entrate/${e.id}`,
        date: e.data_ricezione || e.data_annuncio,
        icon: CheckCircle2,
        tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
      })),
    ...data.preparazioni
      .filter((p) => p.stato === "pronto")
      .map((p) => ({
        kind: "Preparazione pronta",
        title: "La preparazione è pronta",
        meta: `${p.righe?.reduce((a, r) => a + Number(r.quantita || 0), 0) || 0} pezzi pronti`,
        to: `/app/preparazioni/${p.id}`,
        date: p.data_pronto || p.created_at,
        icon: CheckCircle2,
        tone: "bg-teal-50 text-teal-700 border-teal-200",
      })),
    ...data.box
      .filter((b) => b.stato === "pronto" && (!b.etichetta_amazon_pdf_url || !b.etichetta_ups_pdf_url))
      .map((b) => ({
        kind: "Etichette mancanti",
        title: `${b.numero_box} pronto: carica PDF etichette`,
        meta: `${b.contenuto?.length || 0} referenze nel box`,
        to: "/app/box",
        date: b.created_at,
        icon: FileWarning,
        tone: "bg-amber-50 text-amber-700 border-amber-200",
      })),
    ...data.box
      .filter((b) => b.stato === "spedito")
      .map((b) => ({
        kind: "Box spedito",
        title: `${b.numero_box} spedito`,
        meta: b.data_spedito ? new Date(b.data_spedito).toLocaleDateString("it-IT") : "Spedizione completata",
        to: "/app/spedizioni",
        date: b.data_spedito || b.created_at,
        icon: Truck,
        tone: "bg-slate-50 text-slate-700 border-slate-200",
      })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 6);

  return (
    <div className="space-y-6" data-testid="client-dashboard">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1fr_340px]">
          <div className="p-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
              Portale operativo
            </div>
            <h1 className="font-heading text-4xl font-black tracking-tight">Ciao, tutto sotto controllo</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Qui trovi stock, preparazioni, box e spedizioni senza dover saltare tra mille pagine.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => navigate("/app/entrate")}>
                <Plus className="mr-2 h-4 w-4" /> Nuova entrata
              </Button>
              <Button variant="outline" onClick={() => navigate("/app/preparazioni")}>
                <ClipboardList className="mr-2 h-4 w-4" /> Nuova preparazione
              </Button>
            </div>
          </div>
          <div className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-teal-200">Cose da fare</div>
            <div className="mt-4 grid gap-2">
              {alerts.map((item) => (
                <button
                  key={item.label}
                  onClick={() => navigate(item.to)}
                  className="flex items-center justify-between rounded-md bg-white/8 px-3 py-2 text-left transition-colors hover:bg-white/14"
                >
                  <span className="text-sm text-slate-200">{item.label}</span>
                  <span className="font-heading text-xl font-black">{item.value}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Card className="p-5" data-testid="client-notifications">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold flex items-center gap-2">
              <Bell className="h-5 w-5 text-teal-700" /> Notifiche automatiche
            </h2>
            <p className="text-xs text-muted-foreground">Aggiornamenti generati dagli stati delle tue pratiche.</p>
          </div>
          <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">{notifications.length}</span>
        </div>
        {notifications.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">
            Nessuna notifica operativa in questo momento.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {notifications.map((item, index) => (
              <button
                key={`${item.kind}-${index}`}
                onClick={() => navigate(item.to)}
                className={`flex items-start gap-3 rounded-md border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${item.tone}`}
                data-testid={`client-notification-${index}`}
              >
                <item.icon className="mt-0.5 h-5 w-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{item.kind}</span>
                  <span className="block truncate text-sm font-bold">{item.title}</span>
                  <span className="block truncate text-xs opacity-80">{item.meta}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <Card
            key={kpi.label}
            onClick={() => navigate(kpi.to)}
            style={{ animationDelay: `${index * 60}ms` }}
            className="animate-fade-up cursor-pointer p-5 transition-all hover:-translate-y-1 hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{kpi.label}</div>
                <div className="mt-3 font-heading text-4xl font-black tracking-tight">{kpi.value}</div>
              </div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${kpi.tone}`}>
                <kpi.icon className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
              Apri <ArrowUpRight className="h-3.5 w-3.5" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-heading text-lg font-bold">Trend ultimi 7 giorni</h2>
              <p className="text-xs text-muted-foreground">Entrate annunciate, preparazioni richieste e box creati.</p>
            </div>
            <Truck className="h-5 w-5 text-teal-700" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend}>
                <defs>
                  <linearGradient id="clientEntrate" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="clientPrep" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="giorno" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip />
                <Area type="monotone" dataKey="entrate" stroke="#0284c7" fill="url(#clientEntrate)" strokeWidth={2} />
                <Area type="monotone" dataKey="preparazioni" stroke="#4f46e5" fill="url(#clientPrep)" strokeWidth={2} />
                <Area type="monotone" dataKey="box" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-heading text-lg font-bold">Attivita</h2>
          <p className="text-xs text-muted-foreground">Distribuzione dei tuoi flussi.</p>
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
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.fill }} />
                  {item.name}
                </span>
                <span className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusChart title="Entrate" rows={statusRows(stats.entrateMap, STATI_ENTRATA)} />
        <StatusChart title="Preparazioni" rows={statusRows(stats.prepMap, STATI_PREP)} />
        <StatusChart title="Box" rows={statusRows(stats.boxMap, STATI_BOX)} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-bold">Stock piu alto</h2>
            <p className="text-xs text-muted-foreground">Le referenze con piu pezzi disponibili.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/app/magazzino")}>Apri magazzino</Button>
        </div>
        {stats.topStock.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-muted-foreground">
            Appena arriva merce ricevuta dal prep center, qui comparira lo stock disponibile.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topStock}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="shortName" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#0f766e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusChart({ title, rows }) {
  return (
    <Card className="p-5">
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      <div className="mt-4 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {rows.map((row) => <Cell key={row.key} fill={row.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

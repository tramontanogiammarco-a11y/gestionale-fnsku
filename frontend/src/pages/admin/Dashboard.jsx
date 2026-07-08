import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { STATI_ENTRATA } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowUpRight, Boxes, ClipboardCheck, Loader2, PackageOpen, Tags, Users } from "lucide-react";

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
    { label: "Referenze", value: stats.totale_referenze, icon: Tags, tone: "text-teal-700 bg-teal-50" },
    { label: "Entrate totali", value: stats.totale_entrate, icon: PackageOpen, tone: "text-sky-700 bg-sky-50" },
    { label: "Box", value: stats.totale_box, icon: Boxes, tone: "text-amber-700 bg-amber-50" },
    { label: "Clienti", value: stats.totale_clienti ?? 0, icon: Users, tone: "text-emerald-700 bg-emerald-50" },
  ];

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Operatività live
          </div>
          <h1 className="font-heading text-4xl font-black tracking-tight text-balance">Dashboard prep center</h1>
          <p className="text-muted-foreground text-sm mt-1">Volumi, stati e ultime entrate in un colpo d'occhio.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Ambiente</div>
          <div className="mt-1 text-sm font-bold text-slate-900">Supabase production</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <Card key={k.label} style={{ animationDelay: `${i * 60}ms` }} className="animate-fade-up p-5 flex items-start justify-between overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg">
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

      <div className="rounded-lg border border-slate-200/70 bg-white/70 p-4 shadow-sm backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">Entrate per stato</h2>
          <span className="text-xs font-semibold text-muted-foreground">Click per filtrare</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.keys(STATI_ENTRATA).map((s) => (
            <Card
              key={s}
              data-testid={`stat-${s}`}
              className="p-4 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => navigate(`/admin/entrate?stato=${s}`)}
            >
              <div className="font-heading text-3xl font-bold">{stats.entrate_per_stato[s] ?? 0}</div>
              <div className="mt-2">
                <StatusBadge stato={s} />
              </div>
            </Card>
          ))}
        </div>
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

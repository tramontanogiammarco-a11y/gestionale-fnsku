import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { STATI_ENTRATA } from "@/lib/statuses";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Tags, Boxes, Users, PackageOpen, Loader2 } from "lucide-react";

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
    { label: "Referenze", value: stats.totale_referenze, icon: Tags },
    { label: "Entrate totali", value: stats.totale_entrate, icon: PackageOpen },
    { label: "Box", value: stats.totale_box, icon: Boxes },
    { label: "Clienti", value: stats.totale_clienti ?? 0, icon: Users },
  ];

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Panoramica operativa del prep center.</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-5 flex items-center justify-between hover:shadow-sm transition-shadow">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{k.label}</div>
              <div className="font-heading text-3xl font-bold mt-1">{k.value}</div>
            </div>
            <k.icon className="h-8 w-8 text-blue-500/70" />
          </Card>
        ))}
      </div>

      {/* Entrate per stato */}
      <div>
        <h2 className="font-heading text-lg font-semibold mb-3">Entrate per stato</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.keys(STATI_ENTRATA).map((s) => (
            <Card
              key={s}
              data-testid={`stat-${s}`}
              className="p-4 cursor-pointer hover:shadow-sm transition-shadow"
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

      {/* Ultime entrate */}
      <div>
        <h2 className="font-heading text-lg font-semibold mb-3">Ultime entrate</h2>
        <Card className="divide-y">
          {entrate.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nessuna entrata.</div>}
          {entrate.map((e) => (
            <div
              key={e.id}
              data-testid={`dashboard-entrata-${e.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer"
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

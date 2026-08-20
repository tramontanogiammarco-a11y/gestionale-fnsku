import { ChevronRight, Network, Printer, Ruler, Settings2, Timer, Warehouse } from "lucide-react";
import { toast } from "sonner";

const GROUPS = [
  {
    title: "Configurazione operativa",
    items: [
      { icon: Warehouse, label: "Configurazione del magazzino" },
      { icon: Settings2, label: "Personalizzazione dei compiti" },
      { icon: Timer, label: "Orario limite" },
    ],
  },
  {
    title: "Stazione di imballaggio",
    items: [
      { icon: Ruler, label: "Dimensioni etichette" },
      { icon: Printer, label: "Inizializza la stazione" },
      { icon: Settings2, label: "Gestisci stazione" },
      { icon: Network, label: "Imposta rete" },
    ],
  },
];

export default function WmsAppSettings() {
  return (
    <div className="space-y-7" data-testid="wms-app-settings">
      <header><p className="text-xs font-extrabold uppercase text-teal-700">Sistema</p><h1 className="mt-1 text-3xl font-black">Configurazione</h1></header>
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="mb-3 text-sm font-bold text-slate-400">{group.title}</h2>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {group.items.map((item) => (
              <button key={item.label} type="button" onClick={() => toast.info(`${item.label}: prossimo collegamento operativo`)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-slate-50">
                <item.icon className="h-5 w-5 text-slate-500" /><span className="flex-1 font-semibold">{item.label}</span><ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

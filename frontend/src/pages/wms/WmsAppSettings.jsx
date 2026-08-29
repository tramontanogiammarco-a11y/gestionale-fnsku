import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Clock3, Loader2, Network, Printer, Ruler, Save, Settings2, Timer, Warehouse } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

const OTHER_GROUPS = [
  {
    title: "Configurazione operativa",
    items: [
      { icon: Warehouse, label: "Configurazione del magazzino" },
      { icon: Settings2, label: "Personalizzazione dei compiti" },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [cutoffOpen, setCutoffOpen] = useState(searchParams.get("section") === "cutoff");
  const [cutoff, setCutoff] = useState("12:00");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const response = await api.get("/wms/configurazione");
      setData(response.data);
      setCutoff(response.data.settings?.cutoff_time || "12:00");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Configurazione non disponibile");
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (searchParams.get("section") === "cutoff") setCutoffOpen(true);
  }, [searchParams]);

  const closeCutoff = () => {
    setCutoffOpen(false);
    if (searchParams.has("section")) {
      const next = new URLSearchParams(searchParams);
      next.delete("section");
      setSearchParams(next, { replace: true });
    }
  };

  const saveCutoff = async () => {
    setSaving(true);
    try {
      const response = await api.put("/wms/configurazione", { cutoff_time: cutoff });
      setData(response.data);
      setCutoff(response.data.settings?.cutoff_time || cutoff);
      toast.success(`Orario limite aggiornato alle ${response.data.settings?.cutoff_time || cutoff}`);
      closeCutoff();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Impossibile salvare l'orario");
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const settings = data.settings || {};
  const summary = data.summary || {};
  return (
    <div className="wms-page" data-testid="wms-app-settings">
      <header className="wms-page-header"><div><p className="wms-eyebrow">Sistema</p><h1 className="wms-title">Configurazione</h1><p className="wms-subtitle">Regole operative del magazzino.</p></div></header>

      <section>
        <h2 className="mb-3 text-sm font-bold text-slate-400">Giornata ordini</h2>
        <button type="button" onClick={() => setCutoffOpen(true)} className="flex min-h-20 w-full items-center gap-3 rounded-md border border-teal-200 bg-white px-4 text-left shadow-sm hover:bg-teal-50">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Timer className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><strong className="block">Orario limite</strong><span className="mt-1 block text-xs text-slate-500">Assegna gli ordini alla giornata operativa.</span></span>
          <span className="rounded-md bg-slate-950 px-3 py-2 font-mono text-sm font-black text-white">{settings.cutoff_time}</span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2"><MiniMetric label="Arretrati" value={summary.arretrati || 0} tone={summary.arretrati ? "amber" : "slate"} /><MiniMetric label="Oggi" value={summary.oggi || 0} tone="teal" /><MiniMetric label="Prossimi" value={summary.prossima || 0} tone="blue" /></div>
      </section>

      {OTHER_GROUPS.map((group) => (
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

      <Sheet open={cutoffOpen} onOpenChange={(open) => { if (!open) closeCutoff(); else setCutoffOpen(true); }}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-3xl rounded-t-lg border-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl font-black"><Clock3 className="h-5 w-5 text-teal-700" /> Orario limite</SheetTitle>
            <SheetDescription>Gli ordini entrati entro questo orario appartengono alla giornata corrente. Quelli successivi passano alla giornata seguente.</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 p-5 pb-[max(24px,env(safe-area-inset-bottom))]">
            <div className="space-y-2"><Label htmlFor="wms-cutoff" className="font-bold">Ora limite giornaliera</Label><Input id="wms-cutoff" type="time" value={cutoff} onChange={(event) => setCutoff(event.target.value)} className="h-16 font-mono text-2xl font-black" step="60" /></div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><strong className="block text-slate-950">Fuso orario: Europe/Rome</strong><p className="mt-2">Esempio: con limite alle {cutoff || "--:--"}, un ordine delle {cutoff || "--:--"} resta nella giornata; quello ricevuto un minuto dopo entra nella successiva.</p></div>
            <Button type="button" className="h-14 w-full text-base font-black" onClick={saveCutoff} disabled={saving || !cutoff}>{saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />} Salva orario limite</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MiniMetric({ label, value, tone }) {
  const colors = { teal: "bg-teal-50 text-teal-950", blue: "bg-sky-50 text-sky-950", amber: "bg-amber-50 text-amber-950", slate: "bg-slate-100 text-slate-900" };
  return <div className={`rounded-md p-3 ${colors[tone]}`}><strong className="block text-xl">{value}</strong><span className="mt-1 block text-[10px] font-black uppercase opacity-60">{label}</span></div>;
}

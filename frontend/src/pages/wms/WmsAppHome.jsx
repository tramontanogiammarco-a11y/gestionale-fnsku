import { useMemo } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Barcode, Box, CheckCircle2, Clock3, Loader2, PackageOpen,
  RefreshCw, ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const VIEW_META = {
  open: { title: "Arrivi da ricevere", empty: "Nessun arrivo da ricevere" },
  active: { title: "Ricezioni in corso", empty: "Nessuna ricezione in corso" },
  history: { title: "Inbound completati", empty: "Nessun inbound completato" },
};

export default function WmsAppHome() {
  const navigate = useNavigate();
  const { entries, allEntries, loadEntries } = useOutletContext();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const view = VIEW_META[requestedView] ? requestedView : "open";

  const model = useMemo(() => {
    const source = entries || [];
    return {
      open: source.filter((entry) => entry.stato === "in_attesa"),
      active: source.filter((entry) => entry.stato === "in_lavorazione"),
      history: source.filter((entry) => !["in_attesa", "in_lavorazione"].includes(entry.stato))
        .sort((a, b) => String(b.data_ricezione || b.data_annuncio || "").localeCompare(String(a.data_ricezione || a.data_annuncio || "")))
        .slice(0, 30),
    };
  }, [entries]);

  if (allEntries === null) {
    return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;
  }

  const rows = model[view];
  const meta = VIEW_META[view];
  const openPieces = [...model.open, ...model.active].reduce((sum, entry) => sum + entryPieces(entry), 0);

  return (
    <div className="wms-page" data-testid="wms-app-home">
      <section>
        <div className="wms-page-header">
          <div>
            <p className="wms-eyebrow">Inbound</p>
            <h1 className="wms-title">Arrivi</h1>
          </div>
          <Button size="icon" variant="outline" onClick={loadEntries} aria-label="Aggiorna inbound"><RefreshCw className="h-5 w-5" /></Button>
        </div>

        <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200 rounded-md border border-slate-200 bg-white">
          <SummaryCard icon={PackageOpen} value={model.open.length} label="Da ricevere" tone="teal" />
          <SummaryCard icon={ScanLine} value={model.active.length} label="In corso" tone="ink" />
        </div>
        <div className="mt-2 flex items-center justify-between border-b border-slate-200 px-1 py-2.5">
          <div className="flex items-center gap-3"><Box className="h-5 w-5 text-teal-700" /><span className="text-sm font-bold">Pezzi ancora da verificare</span></div>
          <strong className="text-xl">{openPieces}</strong>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">{meta.title}</h2>
          </div>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{rows.length}</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-md border border-slate-200 bg-white px-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-teal-600" />
            <h3 className="mt-4 text-lg font-black">{meta.empty}</h3>
            <p className="mt-2 text-sm text-slate-500">La lista si aggiorna quando un cliente annuncia nuova merce.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((entry) => (
              <InboundCard
                key={entry.id}
                entry={entry}
                onClick={() => navigate(`/wms-app/inbound/${entry.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ icon: Icon, value, label, tone }) {
  return (
    <div className="flex min-h-20 items-center gap-3 p-3.5">
      <Icon className={`h-5 w-5 ${tone === "teal" ? "text-teal-700" : "text-slate-700"}`} />
      <div><div className="text-2xl font-bold">{value}</div><div className="text-xs font-semibold text-slate-500">{label}</div></div>
    </div>
  );
}

function InboundCard({ entry, onClick }) {
  const active = entry.stato === "in_lavorazione";
  const historical = !["in_attesa", "in_lavorazione"].includes(entry.stato);
  const status = historical ? "Completato" : active ? "In ricezione" : "Da ricevere";
  const StatusIcon = historical ? CheckCircle2 : active ? Barcode : Clock3;
  return (
    <button type="button" onClick={onClick} className="group flex min-h-44 flex-col rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400" data-testid={`wms-inbound-card-${entry.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-md ${historical ? "bg-emerald-50 text-emerald-700" : active ? "bg-slate-950 text-white" : "bg-teal-50 text-teal-700"}`}>
          <StatusIcon className="h-6 w-6" />
        </div>
        <span className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${historical ? "bg-emerald-50 text-emerald-700" : active ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-700"}`}>{status}</span>
      </div>
      <h3 className="mt-4 truncate text-lg font-bold">{entry.cliente_ragione_sociale || "Cliente"}</h3>
      <p className="mt-1 text-sm text-slate-500"><span className="capitalize">{entry.tipo || "Arrivo"}</span> · {entry.colli || 1} {Number(entry.colli || 1) === 1 ? "collo" : "colli"}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
        <div><span className="block text-xs text-slate-400">Referenze</span><strong>{entry.righe?.length || 0}</strong></div>
        <div><span className="block text-xs text-slate-400">Pezzi</span><strong>{entryPieces(entry)}</strong></div>
      </div>
      <div className="mt-auto flex items-center justify-between pt-4 text-sm font-bold text-teal-700">
        <span>{historical ? "Apri storico" : active ? "Continua ricezione" : "Avvia ricezione"}</span><ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </div>
    </button>
  );
}

function entryPieces(entry) {
  return (entry.righe || []).reduce((sum, row) => sum + Number(row.quantita || 0), 0);
}

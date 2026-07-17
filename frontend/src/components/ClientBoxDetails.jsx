import { Box, PackageCheck, Ruler, Scale } from "lucide-react";

function totalPieces(box) {
  return (box.contenuto || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
}

function dimensionsLabel(box) {
  if (!box.lunghezza_cm || !box.larghezza_cm || !box.altezza_cm) return "Dimensioni n/d";
  return `${box.lunghezza_cm} x ${box.larghezza_cm} x ${box.altezza_cm} cm`;
}

export function ClientBoxDetails({ box, titoli = {}, testIdPrefix = "client-box-details" }) {
  const details = [
    { label: "Box", value: box.numero_box || "-", icon: Box },
    { label: "Peso", value: box.peso_kg ? `${box.peso_kg} kg` : "Peso n/d", icon: Scale },
    { label: "Dimensioni", value: dimensionsLabel(box), icon: Ruler },
    { label: "Pezzi", value: totalPieces(box), icon: PackageCheck },
  ];

  return (
    <div className="mt-3 rounded-md border border-border bg-slate-50 p-3" data-testid={`${testIdPrefix}-${box.id}`}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Dati per etichette</div>
      <div className="grid grid-cols-2 gap-2">
        {details.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded border border-slate-200 bg-white px-2 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
            <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Contenuto</div>
        {box.contenuto?.length > 0 ? (
          <div className="mt-1 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {box.contenuto.map((item, index) => (
              <div key={`${item.ean}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 px-2 py-2 text-xs" data-testid={`${testIdPrefix}-row-${box.id}-${index}`}>
                <div className="min-w-0">
                  {titoli[item.ean] && <div className="truncate font-medium text-slate-900">{titoli[item.ean]}</div>}
                  <div className="font-mono text-[11px] leading-5 text-slate-600">
                    EAN {item.ean || "-"}
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                    {item.fnsku ? ` · FNSKU ${item.fnsku}` : ""}
                  </div>
                </div>
                <div className="self-center rounded bg-slate-100 px-2 py-1 font-semibold text-slate-900">
                  x{item.quantita || 0}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 rounded border border-slate-200 bg-white px-2 py-3 text-xs text-muted-foreground">
            Nessun contenuto registrato.
          </div>
        )}
      </div>
    </div>
  );
}

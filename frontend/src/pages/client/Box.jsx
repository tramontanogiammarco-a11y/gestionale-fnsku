import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientBoxDetails } from "@/components/ClientBoxDetails";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Upload, FileText, CheckCircle2, Layers, ChevronDown, PackageCheck, CalendarDays } from "lucide-react";

function sharedLabelUrl(box) {
  return box?.etichetta_amazon_pdf_url && box.etichetta_amazon_pdf_url === box.etichetta_ups_pdf_url
    ? box.etichetta_amazon_pdf_url
    : null;
}

function labelTimestamp(url) {
  const match = String(url || "").match(/gruppo-(\d+)/);
  return match ? Number(match[1]) : 0;
}

function numeroBoxValue(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function sortBoxes(boxes) {
  return [...boxes].sort((a, b) => {
    const diff = numeroBoxValue(a.numero_box) - numeroBoxValue(b.numero_box);
    return diff || String(a.numero_box || "").localeCompare(String(b.numero_box || ""), "it", { numeric: true });
  });
}

function boxDate(box) {
  const sharedUrl = sharedLabelUrl(box);
  const groupTs = labelTimestamp(sharedUrl);
  return new Date(box.data_spedito || (groupTs ? groupTs : null) || box.created_at || Date.now());
}

function shipmentDate(boxes, labelUrl) {
  const shippedDates = (boxes || [])
    .map((box) => box.data_spedito ? new Date(box.data_spedito) : null)
    .filter((date) => date && !Number.isNaN(date.getTime()));
  if (shippedDates.length) return new Date(Math.max(...shippedDates.map((date) => date.getTime())));
  const groupTs = labelTimestamp(labelUrl);
  if (groupTs) return new Date(groupTs);
  const createdDates = (boxes || [])
    .map((box) => box.created_at ? new Date(box.created_at) : null)
    .filter((date) => date && !Number.isNaN(date.getTime()));
  return createdDates.length ? new Date(Math.max(...createdDates.map((date) => date.getTime()))) : null;
}

function monthKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function dateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function availableMonths(boxes) {
  return [...new Set((boxes || []).map((box) => monthKey(boxDate(box))).filter(Boolean))]
    .sort()
    .reverse();
}

function totalPieces(boxes) {
  return boxes.reduce((sum, box) => (
    sum + (box.contenuto || []).reduce((lineSum, item) => lineSum + Number(item.quantita || 0), 0)
  ), 0);
}

function buildSpedizioni(boxes) {
  const labelCounts = boxes.reduce((acc, box) => {
    const url = sharedLabelUrl(box);
    if (url) acc[url] = (acc[url] || 0) + 1;
    return acc;
  }, {});
  const groups = new Map();
  const singles = [];

  for (const box of boxes || []) {
    const url = sharedLabelUrl(box);
    if (url && labelCounts[url] > 1) {
      if (!groups.has(url)) groups.set(url, []);
      groups.get(url).push(box);
    } else {
      singles.push(box);
    }
  }

  const spedizioni = Array.from(groups.entries())
    .map(([url, groupBoxes]) => ({
      key: `shipment:${url}`,
      type: "shipment",
      labelUrl: url,
      boxes: sortBoxes(groupBoxes),
      ts: labelTimestamp(url),
      date: shipmentDate(groupBoxes, url),
    }))
    .sort((a, b) => a.ts - b.ts);

  if (singles.length) {
    spedizioni.push({
      key: "singles",
      type: "singles",
      labelUrl: null,
      boxes: sortBoxes(singles),
      ts: Number.MAX_SAFE_INTEGER,
      date: null,
    });
  }

  return spedizioni.map((group, index) => ({
    ...group,
    title: group.type === "shipment" ? `Spedizione ${index + 1}` : "Box singoli / da etichettare",
    dateLabel: group.type === "shipment" ? dateLabel(group.date) : "",
  }));
}

export default function ClientBox() {
  const [boxes, setBoxes] = useState(null);
  const [titoli, setTitoli] = useState({});
  const [view, setView] = useState("attivi");
  const [monthFilter, setMonthFilter] = useState("all");
  const [selected, setSelected] = useState([]);
  const [groupUploading, setGroupUploading] = useState(false);
  const groupLabelsRef = useRef();

  const load = () => api.get("/box").then((r) => {
    setBoxes(r.data);
    setSelected((current) => current.filter((id) => (r.data || []).some((box) => box.id === id && box.stato === "pronto")));
  });
  useEffect(() => {
    load();
    api.get("/referenze").then((r) => {
      const m = {}; r.data.forEach((x) => (m[x.ean] = x.titolo)); setTitoli(m);
    });
  }, []);

  const monthOptions = useMemo(() => availableMonths(boxes || []), [boxes]);
  const visibleByState = (boxes || []).filter((b) => view === "archivio" ? b.stato === "spedito" : b.stato !== "spedito");
  const visibleBoxes = visibleByState.filter((box) => (
    monthFilter === "all" || monthKey(boxDate(box)) === monthFilter
  ));
  const spedizioni = useMemo(() => buildSpedizioni(visibleBoxes), [visibleBoxes]);
  const groupableBoxes = visibleBoxes.filter((b) => b.stato === "pronto");
  const selectedBoxes = visibleBoxes.filter((b) => selected.includes(b.id));
  const sharedPdfCounts = countSharedLabelUrls(boxes || []);

  const toggleBox = (boxId) => {
    setSelected((current) => (
      current.includes(boxId) ? current.filter((id) => id !== boxId) : [...current, boxId]
    ));
  };

  const toggleAllReady = () => {
    const ids = groupableBoxes.map((box) => box.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const uploadGroup = async (file) => {
    if (!selected.length) {
      toast.error("Seleziona almeno una box pronta");
      return;
    }
    setGroupUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("box_ids", JSON.stringify(selected));
      const { data } = await api.post("/box/etichette-gruppo", fd);
      toast.success(`PDF collegato a ${data.aggiornate || selected.length} box`);
      setSelected([]);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Errore nel caricamento del PDF gruppo");
    } finally {
      setGroupUploading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="client-box">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">I miei box</h1>
        <p className="text-muted-foreground text-sm mt-1">Carica le etichette singole oppure un PDF unico per piu box pronte.</p>
      </div>

      {boxes && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {[
              ["attivi", "Attivi", boxes.filter((b) => b.stato !== "spedito").length],
              ["archivio", "Archivio", boxes.filter((b) => b.stato === "spedito").length],
            ].map(([key, label, count]) => (
              <Button
                key={key}
                size="sm"
                variant={view === key ? "default" : "outline"}
                onClick={() => {
                  setView(key);
                  setSelected([]);
                }}
                data-testid={`box-view-${key}`}
              >
                {label} <span className="ml-2 rounded-full bg-white/20 px-2 text-xs">{count}</span>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3 w-3" /> Mese
              </label>
              <Select
                value={monthFilter}
                onValueChange={(value) => {
                  setMonthFilter(value);
                  setSelected([]);
                }}
              >
                <SelectTrigger className="h-9 w-44" data-testid="box-month-filter">
                  <SelectValue placeholder="Tutti i mesi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i mesi</SelectItem>
                  {monthOptions.map((key) => (
                    <SelectItem key={key} value={key}>{monthLabel(key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMonthFilter("all");
                setSelected([]);
              }}
              disabled={monthFilter === "all"}
              data-testid="box-month-all"
            >
              Tutti i mesi
            </Button>
          </div>
        </div>
      )}

      {boxes && view === "attivi" && groupableBoxes.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-heading font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Etichette gruppo
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Seleziona le box pronte e carica una sola volta il PDF con tutte le etichette Amazon e UPS.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={toggleAllReady} data-testid="cbox-select-ready">
                {groupableBoxes.every((box) => selected.includes(box.id)) ? "Deseleziona pronte" : "Seleziona pronte"}
              </Button>
              <input
                ref={groupLabelsRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                data-testid="cbox-group-labels-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadGroup(file);
                }}
              />
              <Button
                disabled={selected.length === 0 || groupUploading}
                onClick={() => groupLabelsRef.current.click()}
                data-testid="cbox-group-labels-btn"
              >
                {groupUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Carica PDF gruppo ({selected.length})
              </Button>
            </div>
          </div>
          {selectedBoxes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {selectedBoxes.map((box) => (
                <span key={box.id} className="rounded-full border border-border bg-slate-50 px-2 py-1 font-mono">
                  {box.numero_box}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {!boxes ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : visibleBoxes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {monthFilter !== "all"
            ? `Nessun box per ${monthLabel(monthFilter)}.`
            : (view === "archivio" ? "Nessun box archiviato." : "Nessun box attivo.")}
        </Card>
      ) : (
        <div className="space-y-3">
          {spedizioni.map((group) => (
            <ShipmentGroup
              key={group.key}
              group={group}
              titoli={titoli}
              onDone={load}
              selected={selected}
              toggleBox={toggleBox}
              sharedPdfCounts={sharedPdfCounts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShipmentGroup({ group, titoli, onDone, selected, toggleBox, sharedPdfCounts }) {
  const [open, setOpen] = useState(true);
  const readyCount = group.boxes.filter((box) => box.stato === "pronto").length;
  const shippedCount = group.boxes.filter((box) => box.stato === "spedito").length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid={`cbox-spedizione-${group.key}`}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition hover:bg-slate-50"
            data-testid={`cbox-spedizione-trigger-${group.key}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                <PackageCheck className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-heading text-base font-semibold">{group.title}</span>
                  {group.dateLabel && <span className="text-xs font-medium text-muted-foreground">{group.dateLabel}</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {group.boxes.length} box · {totalPieces(group.boxes)} pezzi · {readyCount} pronti · {shippedCount} spediti
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {group.labelUrl && (
                <a
                  href={fileUrl(group.labelUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`cbox-spedizione-labels-${group.key}`}
                >
                  <FileText className="h-3 w-3" /> PDF etichette gruppo
                </a>
              )}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-3 border-t bg-slate-50/60 p-3 md:grid-cols-2">
            {group.boxes.map((b) => (
              <BoxItem
                key={b.id}
                box={b}
                titoli={titoli}
                onDone={onDone}
                selected={selected.includes(b.id)}
                onToggle={() => toggleBox(b.id)}
                selectable={b.stato === "pronto"}
                sharedCount={sharedPdfCounts[b.etichetta_amazon_pdf_url] || 0}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function BoxItem({ box, titoli, onDone, selected, onToggle, selectable, sharedCount }) {
  const labelsRef = useRef();
  const [uploading, setUploading] = useState(null);

  const upload = async (file) => {
    setUploading("etichette");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/box/${box.id}/etichette`, fd);
      toast.success("PDF etichette caricato");
      onDone();
    } catch (e) {
      toast.error("Errore nel caricamento");
    } finally { setUploading(null); }
  };

  const puoCaricare = box.stato === "pronto" || box.stato === "in_preparazione";

  return (
    <Card className="p-4" data-testid={`cbox-${box.id}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectable && (
            <Checkbox checked={selected} onCheckedChange={onToggle} data-testid={`cbox-select-${box.id}`} />
          )}
          <div className="font-heading font-semibold font-mono">{box.numero_box}</div>
        </div>
        <StatusBadge stato={box.stato} tipo="box" />
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {box.contenuto?.length || 0} referenze · {box.contenuto?.reduce((a, c) => a + (c.quantita || 0), 0) || 0} pezzi
      </div>

      <ClientBoxDetails box={box} titoli={titoli} testIdPrefix="cbox-dati-etichette" />

      <div className="mt-4">
        <input ref={labelsRef} type="file" accept="application/pdf" className="hidden"
               data-testid={`cbox-labels-input-${box.id}`}
               onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        {box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url ? (
          <a href={fileUrl(box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url)} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs text-emerald-600" data-testid={`cbox-labels-done-${box.id}`}>
            <CheckCircle2 className="h-4 w-4" /> {sharedCount > 1 ? `PDF gruppo (${sharedCount} box)` : "PDF etichette caricato"}
          </a>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={!puoCaricare || uploading === "etichette"}
                  onClick={() => labelsRef.current.click()} data-testid={`cbox-labels-btn-${box.id}`}>
            {uploading === "etichette" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} PDF etichette Amazon + UPS
          </Button>
        )}
      </div>
      {!puoCaricare && box.stato === "spedito" && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1"><FileText className="h-3 w-3" /> Box spedito.</p>
      )}
    </Card>
  );
}

function countSharedLabelUrls(boxes) {
  return boxes.reduce((acc, box) => {
    const url = box.etichetta_amazon_pdf_url && box.etichetta_amazon_pdf_url === box.etichetta_ups_pdf_url
      ? box.etichetta_amazon_pdf_url
      : null;
    if (url) acc[url] = (acc[url] || 0) + 1;
    return acc;
  }, {});
}

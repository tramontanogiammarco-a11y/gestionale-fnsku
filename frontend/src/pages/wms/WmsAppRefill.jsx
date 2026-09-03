import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  ArrowRight, Check, CheckCircle2, Loader2, PackageOpen, RefreshCw, Route, ScanLine, Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import CameraScanner from "@/components/wms/CameraScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function boundedQuantity(value, minimum, maximum) {
  const quantity = Math.floor(Number(String(value || "").replace(/\D/g, "")) || 0);
  return Math.max(Number(minimum || 0), Math.min(Number(maximum || 0), quantity));
}

export default function WmsAppRefill() {
  const { clientId } = useOutletContext();
  const [queueData, setQueueData] = useState(null);
  const [missionData, setMissionData] = useState(null);
  const [selected, setSelected] = useState({});
  const [working, setWorking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);

  const loadMission = useCallback(async (missionId) => {
    const response = await api.get(`/wms/refill/${missionId}`);
    setMissionData(response.data);
    return response.data;
  }, []);

  const load = useCallback(async (synchronize = false) => {
    const query = new URLSearchParams();
    if (clientId && clientId !== "all") query.set("cliente_id", clientId);
    if (synchronize) await api.post("/wms/order-gate/recheck", { include_ready: true, limit: 500, cliente_id: clientId !== "all" ? clientId : null });
    const response = await api.get(`/wms/refill${query.toString() ? `?${query}` : ""}`);
    setQueueData(response.data);
    if (response.data.active_mission?.id) await loadMission(response.data.active_mission.id);
    else setMissionData(null);
  }, [clientId, loadMission]);

  useEffect(() => {
    load(true).catch((error) => toast.error(error.response?.data?.detail || "Coda refill non disponibile"));
  }, [load]);

  const mission = missionData?.mission || null;
  const current = missionData?.current_line || null;
  const selectedCount = Object.keys(selected).length;
  const expected = useMemo(() => {
    if (!mission || !current) return null;
    if (mission.stato === "configurazione") return { code: "BAG LIBERA", type: "bag", label: "Associa una bag" };
    if (mission.stato === "prelievo") return current.pallet_scanned_at
      ? { code: current.bag_code, type: "bag", label: "Metti il prodotto nella bag" }
      : { code: current.source?.codice, type: "location", label: "Raggiungi e scansiona il pallet" };
    if (mission.stato === "deposito") return current.putaway_bag_scanned_at
      ? { code: current.target?.codice, type: "location", label: "Deposita e scansiona lo slot" }
      : { code: current.bag_code, type: "bag", label: "Prendi e scansiona la bag" };
    return null;
  }, [current, mission]);

  const openScanner = useCallback(() => {
    if (!expected || working) return;
    setScannerSession((value) => value + 1);
    setCameraOpen(true);
  }, [expected, working]);

  useEffect(() => {
    window.addEventListener("wms-focus-scanner", openScanner);
    return () => window.removeEventListener("wms-focus-scanner", openScanner);
  }, [openScanner]);

  const toggleTask = (task) => {
    setSelected((currentSelection) => {
      const next = { ...currentSelection };
      if (next[task.key]) delete next[task.key];
      else next[task.key] = Number(task.quantita || 0);
      return next;
    });
  };

  const startMission = async () => {
    if (!selectedCount || working) return;
    setWorking(true);
    try {
      const response = await api.post("/wms/refill/avvia", {
        cliente_id: clientId !== "all" ? clientId : null,
        lines: Object.entries(selected).map(([key, quantita]) => ({ key, quantita })),
      });
      setMissionData(response.data);
      toast.success(`Missione creata: associa ${response.data.summary.total} bag.`);
      window.setTimeout(() => setCameraOpen(true), 250);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Missione refill non creata");
    } finally {
      setWorking(false);
    }
  };

  const handleDetected = async (code) => {
    if (!mission || !current || working) return;
    setCameraOpen(false);
    setWorking(true);
    try {
      const response = mission.stato === "configurazione"
        ? await api.post(`/wms/refill/${mission.id}/bag`, { bag_code: code })
        : await api.post(`/wms/refill/${mission.id}/scan`, { code });
      setMissionData(response.data);
      if (navigator.vibrate) navigator.vibrate(60);
      const finished = response.data.mission.stato === "completata";
      if (finished) {
        toast.success("Missione refill completata. Bag liberate e ordini ricontrollati.");
        await load(false);
      } else {
        toast.success(successMessage(mission.stato, current));
        window.setTimeout(() => {
          setScannerSession((value) => value + 1);
          setCameraOpen(true);
        }, 350);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Scansione non valida");
      if (navigator.vibrate) navigator.vibrate(180);
      window.setTimeout(() => {
        setScannerSession((value) => value + 1);
        setCameraOpen(true);
      }, 500);
    } finally {
      setWorking(false);
    }
  };

  if (!queueData) return <div className="flex min-h-[65dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  const scannerContext = current && expected ? {
    compact: true,
    eyebrow: mission.stato === "configurazione" ? "Bag temporanea" : mission.stato === "prelievo" ? "Fase pallet" : "Fase slot",
    progressText: mission.stato === "configurazione"
      ? `${missionData.summary.bags_ready}/${missionData.summary.total} bag`
      : mission.stato === "prelievo"
        ? `${missionData.summary.picked}/${missionData.summary.total} prelievi`
        : `${missionData.summary.completed}/${missionData.summary.total} depositi`,
    location: expected.code,
    requested: current.quantita,
    recommended: mission.stato === "prelievo" && current.pallet_scanned_at
      ? Number(current.recommended_quantity || current.quantita)
      : null,
    title: current.titolo,
  } : null;

  return (
    <div className="wms-page" data-testid="wms-refill">
      <header className="wms-page-header">
        <div><p className="wms-eyebrow">Rifornimento picking</p><h1 className="wms-title">Refill</h1></div>
        <Button size="icon" variant="outline" onClick={() => load(true)} disabled={working} aria-label="Aggiorna"><RefreshCw className={`h-5 w-5 ${working ? "animate-spin" : ""}`} /></Button>
      </header>

      {!mission ? (
        <RefillSelection
          data={queueData}
          selected={selected}
          setSelected={setSelected}
          toggleTask={toggleTask}
          onStart={startMission}
          working={working}
        />
      ) : mission.stato === "completata" ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-7 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" />
          <h2 className="mt-4 text-xl font-black text-emerald-950">Missione completata</h2>
        </section>
      ) : (
        <ActiveMission data={missionData} expected={expected} onScan={openScanner} working={working} />
      )}

      {cameraOpen && expected && <CameraScanner key={`refill-${scannerSession}`} open onOpenChange={setCameraOpen} purpose={expected.type} context={scannerContext} allowManual={false} onDetected={handleDetected} />}
    </div>
  );
}

function RefillSelection({ data, selected, setSelected, toggleTask, onStart, working }) {
  const queue = data.queue || [];
  if (!queue.length) return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50 p-7 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" />
      <h2 className="mt-4 text-xl font-black text-emerald-950">Nessun refill in attesa</h2>
      <p className="mt-2 text-sm text-emerald-800">Gli ordini coperti dagli slot possono entrare nel picking.</p>
    </section>
  );
  const allSelected = queue.every((task) => selected[task.key] != null);
  return (
    <>
      <section className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div><strong className="text-lg font-black">{queue.length} referenze</strong><span className="block text-xs font-bold text-slate-500">Scegli quelle da rifornire adesso</span></div>
        <Button type="button" variant="ghost" onClick={() => setSelected(allSelected ? {} : Object.fromEntries(queue.map((task) => [task.key, task.quantita])))}>{allSelected ? "Deseleziona" : "Seleziona tutte"}</Button>
      </section>
      <div className="space-y-2">
        {queue.map((task) => {
          const active = selected[task.key] != null;
          return <section key={task.key} className={`rounded-md border p-3 ${active ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white"}`}>
            <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => toggleTask(task)}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border ${active ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white"}`}>{active && <Check className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate">{task.product.titolo}</strong><span className="mt-1 block font-mono text-xs text-slate-500">{task.product.fnsku || task.product.ean}</span></span>
              <span className="shrink-0 text-right"><strong className="block text-lg">{task.quantita} pz</strong><span className="text-[10px] font-black uppercase text-slate-500">consigliati</span></span>
            </button>
            <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold">{task.source.codice} <ArrowRight className="mx-1 inline h-3 w-3" /> {task.target.codice}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={task.quantita}
                max={task.maximum_quantity}
                value={active ? selected[task.key] : task.quantita}
                disabled={!active}
                onChange={(event) => setSelected((current) => ({ ...current, [task.key]: boundedQuantity(event.target.value, task.quantita, task.maximum_quantity) }))}
                className="h-10 w-24 text-center font-black"
                aria-label={`Quantità ${task.product.titolo}`}
              />
              <span className="text-xs font-bold text-slate-500">max {task.maximum_quantity}</span>
            </div>
          </section>;
        })}
      </div>
      <Button type="button" className="sticky bottom-20 h-14 w-full text-base font-black shadow-lg" onClick={onStart} disabled={!Object.keys(selected).length || working}>
        {working ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Route className="mr-2 h-5 w-5" />} Crea missione · {Object.keys(selected).length}
      </Button>
    </>
  );
}

function ActiveMission({ data, expected, onScan, working }) {
  const { mission, lines, summary, current_line: current } = data;
  const phase = mission.stato === "configurazione" ? 0 : mission.stato === "prelievo" ? 1 : 2;
  const ordered = [...lines].sort((left, right) => (phase === 2 ? left.target_sequence - right.target_sequence : left.source_sequence - right.source_sequence));
  return (
    <>
      <section className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 bg-white text-center">
        {["Bag", "Pallet", "Slot"].map((label, index) => <div key={label} className={`p-3 ${index === phase ? "bg-teal-700 text-white" : index < phase ? "bg-emerald-50 text-emerald-800" : "text-slate-400"}`}><strong className="block text-lg">{index < phase ? <Check className="mx-auto h-5 w-5" /> : index + 1}</strong><span className="text-[10px] font-black uppercase">{label}</span></div>)}
      </section>

      {current && <section className="border-2 border-slate-950 bg-white p-4">
        <p className="text-[11px] font-black uppercase text-teal-700">{expected?.label}</p>
        <div className="mt-2 flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-black">{current.titolo}</h2><p className="mt-1 font-mono text-xs text-slate-500">{current.fnsku || current.ean}</p></div><strong className="shrink-0 text-2xl">{current.quantita} pz</strong></div>
        {mission.stato === "prelievo" && current.pallet_scanned_at && <div className="mt-4 flex items-center justify-between border border-amber-300 bg-amber-50 p-3 text-amber-950">
          <span><span className="block text-[10px] font-black uppercase">Fabbisogno ordini pending</span><strong className="mt-1 block text-sm">Quantità consigliata</strong></span>
          <strong className="text-3xl font-black">{current.recommended_quantity || current.quantita} pz</strong>
        </div>}
        <div className="mt-4 flex items-center justify-between rounded-md bg-slate-100 p-3"><span className="font-mono text-xl font-black">{expected?.code}</span><ScanLine className="h-6 w-6 text-teal-700" /></div>
        <Button type="button" className="mt-3 h-14 w-full text-base font-black" onClick={onScan} disabled={working}><ScanLine className="mr-2 h-5 w-5" /> Scansiona</Button>
      </section>}

      <section>
        <div className="mb-2 flex items-end justify-between"><div><p className="wms-eyebrow">Percorso ottimizzato</p><h2 className="text-lg font-black">{phase === 0 ? "Associa le bag" : phase === 1 ? "Zona pallet" : "Zona slot"}</h2></div><span className="text-xs font-bold text-slate-500">{phase === 0 ? summary.bags_ready : phase === 1 ? summary.picked : summary.completed}/{summary.total}</span></div>
        <div className="space-y-2">
          {ordered.map((line, index) => {
            const done = phase === 0 ? Boolean(line.bag_id) : phase === 1 ? ["in_bag", "completata"].includes(line.stato) : line.stato === "completata";
            const active = line.id === current?.id;
            return <div key={line.id} className={`flex items-center gap-3 rounded-md border p-3 ${active ? "border-teal-500 bg-teal-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? "bg-emerald-600 text-white" : active ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate">{phase === 0 ? line.titolo : phase === 1 ? line.source?.codice : `${line.bag_code} → ${line.target?.codice}`}</strong><span className="block truncate text-xs text-slate-500">{phase === 0 ? (line.bag_code || "Bag da scansionare") : phase === 1 ? `${line.titolo} · ${line.bag_code}` : `${line.titolo} · ${line.quantita} pz`}</span></span>
              {phase === 1 ? <PackageOpen className="h-5 w-5 text-slate-500" /> : phase === 2 ? <Warehouse className="h-5 w-5 text-slate-500" /> : null}
            </div>;
          })}
        </div>
      </section>
    </>
  );
}

function successMessage(status, line) {
  if (status === "configurazione") return "Bag associata alla referenza.";
  if (status === "prelievo" && !line.pallet_scanned_at) return `Pallet confermato. Consigliato: ${line.recommended_quantity || line.quantita} pezzi. Sposta ${line.quantita} pezzi nella bag ${line.bag_code}.`;
  if (status === "prelievo") return "Prodotto confermato nella bag.";
  if (status === "deposito" && !line.putaway_bag_scanned_at) return `Bag confermata. Porta ${line.quantita} pezzi nello slot ${line.target?.codice}.`;
  return "Refill registrato e bag liberata.";
}

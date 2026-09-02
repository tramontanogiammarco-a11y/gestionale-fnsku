import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Boxes, Check, ClipboardCheck, Copy, KeyRound, Loader2, PackageCheck, Plus,
  RefreshCw, ScanLine, ShieldCheck, ToggleLeft, ToggleRight, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const EVENT_FILTERS = [
  ["all", "Tutte"],
  ["picking", "Picking"],
  ["packing", "Packing"],
  ["stock", "Stock e inventario"],
];

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

function dateTime(value) {
  if (!value) return "Nessuna attività";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function eventMatches(event, filter) {
  if (filter === "all") return true;
  if (filter === "picking") return event.type.startsWith("picking");
  if (filter === "stock") return ["movimento_stock", "inventario", "ricezione"].includes(event.type);
  return event.type === filter;
}

export default function WmsOperators() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("all");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/wms/operatori?limit=500");
      setData(response.data);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const events = useMemo(() => (data?.events || []).filter((event) =>
    (selectedId === "all" || event.operator_id === selectedId) && eventMatches(event, filter)
  ), [data, filter, selectedId]);
  const selected = data?.operators?.find((operator) => operator.id === selectedId);

  return (
    <div className="space-y-6" data-testid="wms-operators">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase text-teal-700">Squadra di magazzino</p>
          <h2 className="mt-1 text-3xl font-extrabold">Operatori</h2>
          <p className="mt-2 text-sm text-slate-500">Credenziali operative e responsabilità di ogni attività WMS.</p>
        </div>
        <CreateOperatorDialog onSaved={load} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Operatori" value={data?.summary?.total || 0} icon={Users} tone="slate" />
        <Kpi label="Attivi" value={data?.summary?.active || 0} icon={ShieldCheck} tone="emerald" />
        <Kpi label="Attività oggi" value={data?.summary?.today || 0} icon={ClipboardCheck} tone="amber" />
        <Kpi label="Picking registrati" value={data?.summary?.picking || 0} icon={ScanLine} tone="cyan" />
        <Kpi label="Packing registrati" value={data?.summary?.packing || 0} icon={PackageCheck} tone="violet" />
      </div>

      <div className="grid min-h-[580px] gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="overflow-hidden rounded-md border-slate-200 shadow-none">
          <div className="border-b border-slate-200 p-4">
            <h3 className="font-extrabold">Account operatori</h3>
            <p className="mt-1 text-xs text-slate-500">Seleziona una persona per isolare la sua attività.</p>
          </div>
          {loading ? <Loading /> : (
            <div className="divide-y divide-slate-100">
              <button type="button" onClick={() => setSelectedId("all")} className={cn("flex w-full items-center gap-3 p-4 text-left transition", selectedId === "all" ? "bg-slate-950 text-white" : "hover:bg-slate-50")}>
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-md", selectedId === "all" ? "bg-white/10" : "bg-slate-100")}><Users className="h-5 w-5" /></span>
                <span><strong className="block text-sm">Tutta la squadra</strong><span className={cn("text-xs", selectedId === "all" ? "text-slate-300" : "text-slate-500")}>{data?.events?.length || 0} attività registrate</span></span>
              </button>
              {(data?.operators || []).map((operator) => (
                <OperatorRow key={operator.id} operator={operator} selected={selectedId === operator.id} onSelect={() => setSelectedId(operator.id)} onSaved={load} />
              ))}
              {!data?.operators?.length && <div className="p-10 text-center text-sm text-slate-500">Crea il primo operatore per iniziare.</div>}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden rounded-md border-slate-200 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div><h3 className="font-extrabold">Storico attività</h3><p className="mt-1 text-xs text-slate-500">{selected ? selected.name : "Tutti gli operatori"} · {events.length} eventi</p></div>
            <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1">
              {EVENT_FILTERS.map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn("rounded px-3 py-2 text-xs font-bold transition", filter === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900")}>{label}</button>)}
            </div>
          </div>
          {loading ? <Loading /> : <ActivityTimeline events={events} operators={data?.operators || []} />}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }) {
  const colors = { slate: "bg-slate-100 text-slate-700", emerald: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800", cyan: "bg-cyan-100 text-cyan-800", violet: "bg-violet-100 text-violet-800" };
  return <Card className="rounded-md border-slate-200 p-4 shadow-none"><div className="flex items-center justify-between"><div><p className="text-[11px] font-extrabold uppercase text-slate-500">{label}</p><p className="mt-2 text-3xl font-extrabold">{value}</p></div><span className={cn("flex h-11 w-11 items-center justify-center rounded-md", colors[tone])}><Icon className="h-5 w-5" /></span></div></Card>;
}

function OperatorRow({ operator, selected, onSelect, onSaved }) {
  const toggle = async (event) => {
    event.stopPropagation();
    try {
      await api.post("/wms/operatori/manage", { action: "status", operator_id: operator.id, active: !operator.operator_active });
      toast.success(operator.operator_active ? "Operatore disattivato" : "Operatore riattivato");
      onSaved();
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail || error.message)); }
  };
  return <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} className={cn("w-full cursor-pointer p-4 text-left transition", selected ? "bg-teal-50" : "hover:bg-slate-50")}>
    <div className="flex items-start gap-3">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-extrabold", operator.operator_active ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-500")}>{(operator.name || operator.email).slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm">{operator.name}</strong><Badge variant="outline" className={cn("rounded text-[10px]", operator.operator_active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-500")}>{operator.operator_active ? "Attivo" : "Disattivato"}</Badge></span><span className="mt-1 block truncate text-xs text-slate-500">{operator.email}</span><span className="mt-2 block text-[11px] text-slate-500">Ultima: {dateTime(operator.last_activity_at)}</span></span>
      <span className="flex shrink-0 gap-1"><ResetOperatorPassword operator={operator} /><Button type="button" variant="ghost" size="icon" className={cn("h-8 w-8", operator.operator_active ? "text-emerald-700" : "text-slate-400")} onClick={toggle} title={operator.operator_active ? "Disattiva" : "Riattiva"}>{operator.operator_active ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}</Button></span>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Mini value={operator.picking_count} label="Picking" /><Mini value={operator.packing_count} label="Packing" /><Mini value={operator.stock_count} label="Stock" /></div>
  </div>;
}

function Mini({ value, label }) { return <span className="rounded border border-slate-200 bg-white px-2 py-1.5"><strong className="block text-sm">{value}</strong><span className="text-[10px] uppercase text-slate-400">{label}</span></span>; }

function ActivityTimeline({ events, operators }) {
  const operatorMap = new Map(operators.map((row) => [row.id, row]));
  const icons = { picking: ScanLine, picking_massivo: Boxes, picking_galluse: Boxes, packing: PackageCheck, movimento_stock: RefreshCw, inventario: ClipboardCheck, ricezione: Boxes };
  if (!events.length) return <div className="flex min-h-[420px] flex-col items-center justify-center text-center"><ClipboardCheck className="h-10 w-10 text-slate-300" /><p className="mt-3 font-bold">Nessuna attività per questo filtro</p><p className="mt-1 text-sm text-slate-500">Le nuove operazioni appariranno qui automaticamente.</p></div>;
  return <div className="max-h-[690px] overflow-y-auto p-4"><div className="space-y-2">{events.map((event) => { const Icon = icons[event.type] || ClipboardCheck; const operator = operatorMap.get(event.operator_id); return <div key={event.id} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[42px_minmax(0,1fr)_auto]"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white"><Icon className="h-5 w-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{event.title}</strong>{event.status && <Badge variant="outline" className="rounded text-[10px]">{String(event.status).replaceAll("_", " ")}</Badge>}</div><p className="mt-1 text-sm text-slate-600">{event.detail}</p><p className="mt-1 text-xs font-semibold text-teal-800">{operator?.name || operator?.email || "Operatore non disponibile"}</p></div><time className="text-xs text-slate-500 sm:text-right">{dateTime(event.timestamp)}</time></div>; })}</div></div>;
}

function CreateOperatorDialog({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);
  const setPassword = () => setForm((current) => ({ ...current, password: temporaryPassword() }));
  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 10) return toast.error("Compila nome, email e password di almeno 10 caratteri");
    setSaving(true);
    try {
      await api.post("/wms/operatori/manage", { action: "create", ...form });
      try { await navigator.clipboard.writeText(`${form.email}\n${form.password}`); } catch (_) {}
      toast.success("Operatore creato. Credenziali copiate.");
      setOpen(false); setForm({ name: "", email: "", password: "" }); onSaved();
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail || error.message)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next && !form.password) setPassword(); }}><DialogTrigger asChild><Button className="h-11 rounded-md bg-slate-950 px-5 hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" />Nuovo operatore</Button></DialogTrigger><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Crea credenziali operatore</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>Nome e cognome</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div><div><Label>Email di accesso</Label><Input type="email" className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div><div><Label>Password temporanea</Label><div className="mt-1 flex gap-2"><Input className="font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><Button type="button" variant="outline" size="icon" onClick={setPassword}><RefreshCw className="h-4 w-4" /></Button></div></div><div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs leading-5 text-cyan-950">L’operatore accederà soltanto ad App operativa e Packing station. Al salvataggio email e password vengono copiate negli appunti.</div></div><DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crea e copia credenziali</Button></DialogFooter></DialogContent></Dialog>;
}

function ResetOperatorPassword({ operator }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const generate = () => { setPassword(temporaryPassword()); setSaved(false); };
  const save = async () => { setSaving(true); try { await api.post("/wms/operatori/manage", { action: "password", operator_id: operator.id, password }); await navigator.clipboard.writeText(`${operator.email}\n${password}`); setSaved(true); toast.success("Nuova password verificata e copiata"); } catch (error) { toast.error(formatApiError(error.response?.data?.detail || error.message)); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) generate(); }}><DialogTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={(event) => event.stopPropagation()} title="Reimposta password"><KeyRound className="h-4 w-4" /></Button></DialogTrigger><DialogContent onClick={(event) => event.stopPropagation()} className="sm:max-w-lg"><DialogHeader><DialogTitle>Nuova password operatore</DialogTitle></DialogHeader><div className="space-y-4"><div className="rounded-md bg-slate-50 p-3"><strong>{operator.name}</strong><p className="mt-1 text-xs text-slate-500">{operator.email}</p></div><div><Label>Password temporanea</Label><div className="mt-1 flex gap-2"><Input className="font-mono" value={password} onChange={(e) => { setPassword(e.target.value); setSaved(false); }} /><Button variant="outline" size="icon" onClick={generate}><RefreshCw className="h-4 w-4" /></Button>{saved && <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(`${operator.email}\n${password}`)}><Copy className="h-4 w-4" /></Button>}</div></div><p className="text-xs text-slate-500">La password precedente non può essere visualizzata. Questa nuova password viene verificata prima della conferma.</p></div><DialogFooter><Button onClick={save} disabled={saving || saved || password.length < 10}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saved ? <><Check className="mr-2 h-4 w-4" />Attiva e copiata</> : "Imposta e copia"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Loading() { return <div className="flex min-h-[280px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>; }

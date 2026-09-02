import { useEffect, useMemo, useState } from "react";
import { BadgeEuro, Boxes, CheckCircle2, Loader2, MapPin, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { CarrierTariffCsv } from "@/pages/admin/Clienti";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const WEIGHT_BANDS = [
  { key: "0-3", label: "0-3 kg", from: 0, to: 3 },
  { key: "3-5", label: "3-5 kg", from: 3.01, to: 5 },
  { key: "5-10", label: "5-10 kg", from: 5.01, to: 10 },
  { key: "10-20", label: "10-20 kg", from: 10.01, to: 20 },
  { key: "20-30", label: "20-30 kg", from: 20.01, to: 30 },
];
const RATE_ROWS = [
  { carrier: "gls", zone: "Nazionale" },
  { carrier: "gls", zone: "Disagiati" },
  { carrier: "brt", zone: "Nazionale" },
  { carrier: "brt", zone: "Disagiati" },
];
const cellKey = (carrier, zone, band) => `${carrier}:${zone.toLowerCase()}:${band}`;
const FULFILLMENT_FEES = [
  ["wms_order_base_fee", "Gestione ordine", "Per ogni ordine imballato"],
  ["wms_extra_item_fee", "Pezzo extra", "Per ogni pezzo oltre il primo"],
  ["wms_pack_scatola_piccola", "Scatola piccola", "Barcode SCATOLA-PICCOLA"],
  ["wms_pack_scatola_media", "Scatola media", "Barcode SCATOLA-MEDIA"],
  ["wms_pack_scatola_grande", "Scatola grande", "Barcode SCATOLA-GRANDE"],
  ["wms_pack_busta_corriere", "Busta corriere", "Barcode BUSTA-CORRIERE"],
];

function OperationalFees({ client, onSaved }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValues(Object.fromEntries(FULFILLMENT_FEES.map(([key]) => [key, String(client?.listino?.[key] ?? 0)])));
  }, [client]);
  const save = async () => {
    setSaving(true);
    try {
      const normalized = Object.fromEntries(FULFILLMENT_FEES.map(([key]) => {
        const value = Number(String(values[key] ?? "").replace(",", "."));
        if (!Number.isFinite(value) || value < 0) throw new Error("Inserisci solo prezzi validi e non negativi");
        return [key, value];
      }));
      const { data } = await api.put(`/clienti/${client.id}`, { listino: { ...(client.listino || {}), ...normalized } });
      onSaved(data);
      toast.success("Costi operativi salvati");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setSaving(false);
    }
  };
  return <Card className="p-5">
    <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-11 w-11 items-center justify-center bg-amber-50 text-amber-800"><Boxes className="h-5 w-5"/></span><div><p className="font-extrabold">Picking, packing e imballaggi</p><p className="text-xs text-slate-500">Costi applicati automaticamente quando il packing viene completato.</p></div></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{FULFILLMENT_FEES.map(([key, label, hint]) => <label key={key} className="border border-slate-200 bg-slate-50 p-3"><span className="block text-sm font-extrabold">{label}</span><span className="mt-0.5 block text-xs text-slate-500">{hint}</span><div className="relative mt-3"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">€</span><Input value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} inputMode="decimal" className="bg-white pl-7"/></div></label>)}</div>
    <div className="mt-4 flex justify-end"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Salva costi operativi</Button></div>
  </Card>;
}

function PackagingStock() {
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = () => api.get("/wms/packaging").then(({ data }) => setItems(data || []));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setSaving(true);
    try {
      await Promise.all(items.map((item) => api.post("/wms/packaging/stock", { code: item.code, quantity: Number(item.stock_quantity || 0) })));
      toast.success("Scorte imballaggi aggiornate");
      await load();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setSaving(false);
    }
  };
  const print = async () => {
    try {
      const { data } = await api.get("/wms/packaging/etichette", { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const frame = document.createElement("iframe");
      frame.className = "hidden";
      frame.src = url;
      frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 300000); };
      document.body.appendChild(frame);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    }
  };
  return <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-extrabold">Scorte imballaggi</p><p className="mt-1 text-xs text-slate-500">Ogni scansione scala una confezione per ordine.</p></div><Button variant="outline" onClick={print}><Printer className="mr-2 h-4 w-4"/>Stampa i 4 barcode</Button></div>
    {!items ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin"/></div> : <div className="mt-4 space-y-2">{items.map((item, index) => <div key={item.code} className="grid grid-cols-[1fr_110px] items-center gap-3 border border-slate-200 p-3"><div><strong className="block text-sm">{item.name}</strong><code className="text-xs text-slate-500">{item.barcode}</code></div><Input type="number" min="0" value={item.stock_quantity} onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, stock_quantity: event.target.value } : entry))} aria-label={`Scorta ${item.name}`}/></div>)}</div>}
    <Button className="mt-4 w-full" onClick={save} disabled={!items || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Salva giacenze</Button>
  </Card>;
}

function CarrierRateMatrix({ clientId }) {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setLoading(true);
    api.get(`/clienti/${clientId}/carrier-rates`).then(({ data }) => {
      const next = {};
      for (const rate of data || []) {
        const zone = String(rate.zone_name || "").toLowerCase().includes("disagiat") ? "Disagiati" : "Nazionale";
        const band = WEIGHT_BANDS.find((item) => Math.abs(Number(rate.weight_to_kg) - item.to) < 0.01);
        if (band) next[cellKey(rate.carrier, zone, band.key)] = String(rate.price ?? "");
      }
      setValues(next);
    }).catch((error) => toast.error(formatApiError(error.response?.data?.detail || error.message))).finally(() => setLoading(false));
  }, [clientId]);
  const save = async () => {
    const missing = RATE_ROWS.flatMap((row) => WEIGHT_BANDS.map((band) => cellKey(row.carrier, row.zone, band.key)))
      .filter((key) => values[key] === "" || values[key] == null || !Number.isFinite(Number(String(values[key]).replace(",", "."))));
    if (missing.length) return toast.error(`Completa tutti i 20 prezzi: ne mancano ${missing.length}`);
    const rules = RATE_ROWS.flatMap((row) => WEIGHT_BANDS.map((band) => ({
      carrier: row.carrier,
      service: "Standard 24/48h",
      zone_name: row.zone,
      weight_from_kg: band.from,
      weight_to_kg: band.to,
      price: Number(String(values[cellKey(row.carrier, row.zone, band.key)]).replace(",", ".")),
      surcharge: 0,
      postal_codes: [],
      provinces: [],
      priority: row.zone === "Disagiati" ? 10 : 0,
    })));
    setSaving(true);
    try {
      await api.post(`/clienti/${clientId}/carrier-rates/replace`, { rules });
      toast.success("Prezzario cliente salvato");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setSaving(false);
    }
  };
  return <div>
    <div className="overflow-x-auto border border-slate-200">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3 text-left">Corriere</th><th className="p-3 text-left">Zona</th>{WEIGHT_BANDS.map((band) => <th key={band.key} className="p-3 text-left">{band.label}</th>)}</tr></thead>
        <tbody>{RATE_ROWS.map((row) => <tr key={`${row.carrier}-${row.zone}`} className="border-t border-slate-200">
          <td className="p-3 font-black uppercase">{row.carrier}</td>
          <td className="p-3 font-bold text-slate-600">{row.zone}</td>
          {WEIGHT_BANDS.map((band) => { const key = cellKey(row.carrier, row.zone, band.key); return <td key={key} className="p-2"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">€</span><Input aria-label={`${row.carrier} ${row.zone} ${band.label}`} value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} inputMode="decimal" placeholder="0,00" className="pl-7" disabled={loading}/></div></td>; })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-4 flex items-center justify-between gap-4"><p className="text-xs text-slate-500">I CAP disagiati vengono applicati automaticamente. Prezzi IVA esclusa.</p><Button onClick={save} disabled={loading || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Salva prezzario</Button></div>
  </div>;
}

export default function WmsPricing() {
  const [clients, setClients] = useState(null);
  const [postalStats, setPostalStats] = useState(null);
  const [clientId, setClientId] = useState("");
  useEffect(() => {
    api.get("/clienti").then(({ data }) => {
      setClients(data || []);
      setClientId((current) => current || data?.[0]?.id || "");
    });
  }, []);
  useEffect(() => {
    api.get("/wms/postal-codes/stats").then(({ data }) => setPostalStats(data)).catch(() => setPostalStats({}));
  }, []);
  const client = useMemo(() => (clients || []).find((item) => item.id === clientId), [clients, clientId]);
  const updateClient = (nextClient) => setClients((current) => current.map((item) => item.id === nextClient.id ? nextClient : item));
  if (!clients) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700"/></div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-extrabold uppercase text-teal-700">Amministrazione</p><h2 className="mt-1 text-3xl font-black">Prezzari clienti</h2><p className="mt-2 text-sm text-slate-500">Tariffe GLS/BRT per fascia di peso e zona di destinazione.</p></div>
      <div className="w-full sm:w-80"><label className="text-xs font-extrabold uppercase text-slate-500">Cliente</label><Select value={clientId} onValueChange={setClientId}><SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="Seleziona cliente"/></SelectTrigger><SelectContent>{clients.map((item)=><SelectItem key={item.id} value={item.id}>{item.ragione_sociale}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {clientId && <Card className="p-5"><div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-11 w-11 items-center justify-center bg-teal-50 text-teal-800"><BadgeEuro className="h-5 w-5"/></span><div><p className="font-extrabold">{client?.ragione_sociale}</p><p className="text-xs text-slate-500">Inserisci il prezzo di ogni fascia per questo cliente.</p></div></div><CarrierRateMatrix key={clientId} clientId={clientId}/></Card>}
    {client && <OperationalFees key={`fees-${client.id}`} client={client} onSaved={updateClient}/>} 
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <Card className="p-5"><div className="mb-5"><p className="font-extrabold">Importazione avanzata CSV</p><p className="mt-1 text-xs text-slate-500">Per listini con servizi, supplementi o regole aggiuntive.</p></div>{clientId ? <CarrierTariffCsv key={`csv-${clientId}`} clienteId={clientId}/> : <p className="py-12 text-center text-sm text-slate-500">Nessun cliente disponibile.</p>}</Card>
      <Card className="p-5">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center bg-sky-50 text-sky-800"><MapPin className="h-5 w-5"/></span><div><p className="font-extrabold">Anagrafica CAP</p><p className="text-xs text-slate-500">Copertura nazionale condivisa</p></div></div>
        {!postalStats ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-teal-700"/></div> : <>
          <div className="mt-5 grid grid-cols-2 border border-slate-200">
            <div className="border-b border-r border-slate-200 p-3"><p className="text-2xl font-black">{Number(postalStats.postal_codes || 0).toLocaleString("it-IT")}</p><p className="text-xs font-bold uppercase text-slate-500">CAP italiani</p></div>
            <div className="border-b border-slate-200 p-3"><p className="text-2xl font-black">{Number(postalStats.municipality_rows || 0).toLocaleString("it-IT")}</p><p className="text-xs font-bold uppercase text-slate-500">Comuni/CAP</p></div>
            <div className="border-r border-slate-200 p-3"><p className="text-2xl font-black">{postalStats.provinces || 0}</p><p className="text-xs font-bold uppercase text-slate-500">Province</p></div>
            <div className="p-3"><p className="text-2xl font-black">{postalStats.regions || 0}</p><p className="text-xs font-bold uppercase text-slate-500">Regioni</p></div>
          </div>
          <div className="mt-4 flex gap-2 bg-emerald-50 p-3 text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/><p className="text-xs font-semibold leading-5">Anagrafica italiana caricata. I preventivi rifiutano automaticamente CAP non presenti.</p></div>
          <div className="mt-3 border-l-2 border-teal-600 pl-3"><p className="text-xs font-bold">GLS {postalStats.gls_remote_postal_codes || 0} · BRT {postalStats.brt_remote_postal_codes || 0} CAP disagiati</p><p className="mt-1 text-xs leading-5 text-slate-500">Elenco condiviso per il test, inclusi {postalStats.gls_legacy_postal_codes || 0} CAP legacy. Potremo separare BRT quando avremo il suo elenco ufficiale.</p></div>
        </>}
      </Card>
    </div>
    <PackagingStock/>
  </div>;
}

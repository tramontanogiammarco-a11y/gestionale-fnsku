import { useEffect, useMemo, useState } from "react";
import { BadgeEuro, Boxes, CalendarDays, CheckCircle2, ClipboardList, Loader2, MapPin, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { CarrierTariffCsv } from "@/components/CarrierTariffCsv";
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
const PREP_FEES = [
  { key: "fnsku", label: "Etichetta FNSKU", hint: "Costo per ogni etichetta applicata" },
  { key: "transparency", label: "Transparency", hint: "Costo per ogni etichetta Transparency applicata" },
  { key: "busta", label: "Busta trasparente", hint: "Costo per ogni pezzo lavorato" },
  { key: "nastratura", label: "Nastratura", hint: "Costo per ogni pezzo lavorato" },
  { key: "pluriball", label: "Pluriball", hint: "Costo per ogni pezzo lavorato" },
  { key: "bundle", label: "Creazione bundle", hint: "Costo per ogni bundle preparato" },
  { key: "inscatolamento", label: "Inscatolamento", hint: "Costo per ogni box preparato" },
  { key: "scatola_60", label: "Scatola 60 x 40 x 40", hint: "Costo per ogni scatola Prep" },
  { key: "scatola_40", label: "Scatola 40 x 30 x 30", hint: "Costo per ogni scatola Prep" },
];
const LOGISTICS_FEES = [
  { key: "stoccaggio_slot", label: "Slot / mese", hint: "Costo mensile per ogni slot occupato" },
  { key: "stoccaggio_pallet", label: "Pallet / mese", hint: "Costo mensile per ogni pallet stoccato" },
  { key: "entrata_scatola", label: "Entrata scatola", hint: "Costo per ogni scatola ricevuta" },
  { key: "entrata_pallet", label: "Entrata pallet", hint: "Costo per ogni pallet ricevuto" },
  { key: "wms_order_base_fee", label: "Gestione ordine", hint: "Per ogni ordine imballato" },
  { key: "wms_extra_item_fee", label: "Pezzo extra", hint: "Per ogni pezzo oltre il primo" },
  { key: "wms_pack_scatola_piccola", label: "Scatola piccola", hint: "Barcode SCATOLA-PICCOLA" },
  { key: "wms_pack_scatola_media", label: "Scatola media", hint: "Barcode SCATOLA-MEDIA" },
  { key: "wms_pack_scatola_grande", label: "Scatola grande", hint: "Barcode SCATOLA-GRANDE" },
  { key: "wms_pack_busta_corriere", label: "Busta corriere", hint: "Barcode BUSTA-CORRIERE" },
];
const GENERAL_FEES = [
  { key: "sped_peso_volumetrico_divisore", label: "Divisore peso volumetrico", hint: "Usato per calcolare il peso tassabile", prefix: "" },
  { key: "iva", label: "IVA", hint: "Aliquota applicata in fattura", prefix: "", suffix: "%" },
];
const ALL_CLIENT_FEES = [...PREP_FEES, ...LOGISTICS_FEES, ...GENERAL_FEES];

const today = () => new Date().toLocaleDateString("en-CA");

function valuesAtDate(base, versions, effectiveDate) {
  return (versions || [])
    .filter((version) => version.effective_from <= effectiveDate)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    .reduce((values, version) => ({ ...values, [version.price_key]: Number(version.amount || 0) }), { ...(base || {}) });
}

function FeeGroup({ title, description, icon: Icon, fields, values, onChange }) {
  return <section className="border-b border-slate-100 py-5 first:pt-0 last:border-b-0 last:pb-0">
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-slate-100 text-slate-700"><Icon className="h-5 w-5"/></span>
      <div><h3 className="font-extrabold">{title}</h3><p className="text-xs text-slate-500">{description}</p></div>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {fields.map(({ key, label, hint, prefix = "€", suffix = "" }) => <label key={key} className="border border-slate-200 bg-slate-50 p-3">
        <span className="block text-sm font-extrabold">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
        <div className="relative mt-3">
          {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{prefix}</span>}
          <Input
            aria-label={label}
            value={values[key] ?? ""}
            onChange={(event) => onChange(key, event.target.value)}
            inputMode="decimal"
            className={`bg-white ${prefix ? "pl-7" : ""} ${suffix ? "pr-9" : ""}`}
          />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{suffix}</span>}
        </div>
      </label>)}
    </div>
  </section>;
}

function ClientPriceList({ client, effectiveDate }) {
  const [values, setValues] = useState({});
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setLoading(true);
    api.get(`/clienti/${client.id}/price-versions`).then(({ data }) => {
      setVersions(data || []);
      const active = valuesAtDate(client.listino, data, effectiveDate);
      setValues(Object.fromEntries(ALL_CLIENT_FEES.map(({ key }) => [key, String(active[key] ?? 0)])));
    }).catch((error) => toast.error(formatApiError(error.response?.data?.detail || error.message))).finally(() => setLoading(false));
  }, [client, effectiveDate]);
  const save = async () => {
    setSaving(true);
    try {
      const normalized = Object.fromEntries(ALL_CLIENT_FEES.map(({ key }) => {
        const value = Number(String(values[key] ?? "").replace(",", "."));
        if (!Number.isFinite(value) || value < 0) throw new Error("Inserisci solo prezzi validi e non negativi");
        return [key, value];
      }));
      await api.post(`/clienti/${client.id}/price-versions`, { effective_from: effectiveDate, prices: normalized });
      const { data } = await api.get(`/clienti/${client.id}/price-versions`);
      setVersions(data || []);
      toast.success(`Costi validi dal ${new Date(`${effectiveDate}T12:00:00`).toLocaleDateString("it-IT")}`);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setSaving(false);
    }
  };
  const changeValue = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  return <Card className="p-5">
    <div className="mb-5 border-b border-slate-100 pb-4">
      <p className="font-extrabold">Listino operativo completo</p>
      <p className="mt-1 text-xs text-slate-500">Un solo listino per Amazon Prep, logistica, stoccaggio, imballaggi e parametri fiscali.</p>
    </div>
    {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin"/></div> : <div>
      <FeeGroup title="Amazon Prep" description="Lavorazioni richieste nelle preparazioni FBA." icon={ClipboardList} fields={PREP_FEES} values={values} onChange={changeValue}/>
      <FeeGroup title="Logistica WMS" description="Entrate, stoccaggio, ordini, picking, packing e materiali." icon={Boxes} fields={LOGISTICS_FEES} values={values} onChange={changeValue}/>
      <FeeGroup title="Parametri generali" description="Calcolo del peso tassabile e aliquota fiscale del cliente." icon={BadgeEuro} fields={GENERAL_FEES} values={values} onChange={changeValue}/>
    </div>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">{new Set(versions.map((version) => version.effective_from)).size} decorrenze salvate. La fattura usa la tariffa valida alla data del movimento.</p><Button onClick={save} disabled={loading || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Salva tutto con decorrenza</Button></div>
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

function CarrierRateMatrix({ clientId, effectiveDate }) {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setLoading(true);
    api.get(`/clienti/${clientId}/carrier-rates?effective_on=${effectiveDate}`).then(({ data }) => {
      const next = {};
      for (const rate of data || []) {
        const zone = String(rate.zone_name || "").toLowerCase().includes("disagiat") ? "Disagiati" : "Nazionale";
        const band = WEIGHT_BANDS.find((item) => Math.abs(Number(rate.weight_to_kg) - item.to) < 0.01);
        if (band) next[cellKey(rate.carrier, zone, band.key)] = String(rate.price ?? "");
      }
      setValues(next);
    }).catch((error) => toast.error(formatApiError(error.response?.data?.detail || error.message))).finally(() => setLoading(false));
  }, [clientId, effectiveDate]);
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
      await api.post(`/clienti/${clientId}/carrier-rates/replace`, { rules, effective_from: effectiveDate });
      toast.success(`Prezzario valido dal ${new Date(`${effectiveDate}T12:00:00`).toLocaleDateString("it-IT")}`);
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
  const [effectiveDate, setEffectiveDate] = useState(today());
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
  if (!clients) return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700"/></div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-extrabold uppercase text-teal-700">Amministrazione</p><h2 className="mt-1 text-3xl font-black">Prezzari clienti</h2><p className="mt-2 text-sm text-slate-500">Unico punto per Amazon Prep, logistica, stoccaggio, imballaggi e corrieri.</p></div>
      <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[320px_190px]">
        <div><label className="text-xs font-extrabold uppercase text-slate-500">Cliente</label><Select value={clientId} onValueChange={setClientId}><SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="Seleziona cliente"/></SelectTrigger><SelectContent>{clients.map((item)=><SelectItem key={item.id} value={item.id}>{item.ragione_sociale}</SelectItem>)}</SelectContent></Select></div>
        <label><span className="flex items-center gap-1 text-xs font-extrabold uppercase text-slate-500"><CalendarDays className="h-3.5 w-3.5"/>In vigore dal</span><Input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value || today())} className="mt-1 bg-white"/></label>
      </div>
    </div>
    <div className="border-l-4 border-teal-600 bg-teal-50 p-4 text-sm text-teal-950"><strong>Decorrenza unica.</strong> I salvataggi qui sotto entrano in vigore il {new Date(`${effectiveDate}T12:00:00`).toLocaleDateString("it-IT")}. Una data passata ricalcola automaticamente fatture, PDF ed Excel del periodo interessato.</div>
    {client && <ClientPriceList key={`fees-${client.id}-${effectiveDate}`} client={client} effectiveDate={effectiveDate}/>}
    {clientId && <Card className="p-5"><div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-11 w-11 items-center justify-center bg-teal-50 text-teal-800"><BadgeEuro className="h-5 w-5"/></span><div><p className="font-extrabold">Spedizioni GLS e BRT</p><p className="text-xs text-slate-500">Inserisci il prezzo di ogni fascia per {client?.ragione_sociale}.</p></div></div><CarrierRateMatrix key={`${clientId}-${effectiveDate}`} clientId={clientId} effectiveDate={effectiveDate}/></Card>}
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <Card className="p-5"><div className="mb-5"><p className="font-extrabold">Importazione avanzata CSV</p><p className="mt-1 text-xs text-slate-500">Per listini con servizi, supplementi o regole aggiuntive.</p></div>{clientId ? <CarrierTariffCsv key={`csv-${clientId}-${effectiveDate}`} clienteId={clientId} effectiveFrom={effectiveDate}/> : <p className="py-12 text-center text-sm text-slate-500">Nessun cliente disponibile.</p>}</Card>
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

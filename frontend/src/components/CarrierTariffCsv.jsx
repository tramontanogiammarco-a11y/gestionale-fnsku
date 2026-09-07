import { useCallback, useEffect, useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function downloadCarrierTemplate() {
  const csv = [
    "corriere,servizio,zona,peso_da_kg,peso_a_kg,prezzo,supplemento,cap,province,priorita",
    "GLS,Standard 24/48h,Nazionale,0,1,5.90,0,,,0",
    "GLS,Standard 24/48h,Nazionale,1.01,3,6.90,0,,,0",
    "GLS,Standard 24/48h,Calabria Sicilia Sardegna,0,3,8.90,0,,CS|CZ|KR|RC|VV|AG|CL|CT|EN|ME|PA|RG|SR|TP|CA|NU|OR|SS|SU,5",
    "GLS,Standard 24/48h,CAP disagiati,0,3,8.90,2.00,90010|90020|90*,,10",
    "BRT,Standard 24/48h,Nazionale,0,1,6.20,0,,,0",
    "BRT,Standard 24/48h,Nazionale,1.01,3,7.10,0,,,0",
    "BRT,Standard 24/48h,CAP disagiati,0,3,8.40,1.50,90010|90020|90*,,10",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "modello-listino-corrieri.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CarrierTariffCsv({ clienteId, effectiveFrom }) {
  const [rates, setRates] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => api.get(`/clienti/${clienteId}/carrier-rates${effectiveFrom ? `?effective_on=${effectiveFrom}` : ""}`).then(({ data }) => setRates(data)),
    [clienteId, effectiveFrom]
  );

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return toast.error("Seleziona il CSV del tariffario");
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (effectiveFrom) formData.append("effective_from", effectiveFrom);
      const { data } = await api.post(`/clienti/${clienteId}/carrier-rates/import`, formData);
      toast.success(`${data.imported} tariffe importate`);
      setFile(null);
      await load();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setBusy(false);
    }
  };

  const gls = rates.filter((rate) => rate.carrier === "gls").length;
  const brt = rates.filter((rate) => rate.carrier === "brt").length;
  const special = rates.filter((rate) => rate.postal_codes?.length || rate.provinces?.length).length;

  return <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-bold">Tariffario spedizioni CSV</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">L'importazione salva una versione completa{effectiveFrom ? ` valida dal ${new Date(`${effectiveFrom}T12:00:00`).toLocaleDateString("it-IT")}` : " valida da oggi"}. I CAP accettano valori esatti o prefissi come <code>90*</code>; separa più CAP o province con <code>|</code>.</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={downloadCarrierTemplate}><Download className="mr-2 h-4 w-4"/>Modello CSV</Button>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
      <Input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)}/>
      <Button type="button" onClick={upload} disabled={busy || !file}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileUp className="mr-2 h-4 w-4"/>}Importa tariffario</Button>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
      <span className="border border-slate-200 bg-white px-2 py-1">{rates.length} righe</span>
      <span className="border border-slate-200 bg-white px-2 py-1">GLS {gls}</span>
      <span className="border border-slate-200 bg-white px-2 py-1">BRT {brt}</span>
      <span className="border border-slate-200 bg-white px-2 py-1">Zone speciali {special}</span>
    </div>
  </div>;
}

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ImageOff, Layers, Save } from "lucide-react";

export default function AdminReferenze() {
  const [referenze, setReferenze] = useState(null);
  const [clienti, setClienti] = useState([]);
  const [filtro, setFiltro] = useState("all");
  const [eanEdit, setEanEdit] = useState({});
  const [fnskuEdit, setFnskuEdit] = useState({});
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => { api.get("/clienti").then((r) => setClienti(r.data)); }, []);
  const load = useCallback(() => {
    const q = filtro !== "all" ? `?cliente_id=${filtro}` : "";
    api.get(`/referenze${q}`).then((r) => {
      setReferenze(r.data);
      const ee = {};
      const fe = {};
      r.data.forEach((x) => {
        ee[x.id] = x.ean || "";
        fe[x.id] = x.fnsku || "";
      });
      setEanEdit(ee);
      setFnskuEdit(fe);
    });
  }, [filtro]);
  useEffect(() => { load(); }, [load]);

  const salvaTutte = async () => {
    if (!referenze?.length) return;
    const modificate = referenze.filter((r) => (
      optionalText(eanEdit[r.id]) !== optionalText(r.ean)
      || optionalText(fnskuEdit[r.id]) !== optionalText(r.fnsku)
    ));
    if (!modificate.length) {
      toast.info("Nessuna modifica da salvare");
      return;
    }

    setSavingAll(true);
    try {
      await Promise.all(modificate.map((r) => api.put(`/referenze/${r.id}`, {
        ean: optionalText(eanEdit[r.id]),
        fnsku: optionalText(fnskuEdit[r.id]),
      })));
      toast.success(`${modificate.length} referenze salvate`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Impossibile salvare le referenze");
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-referenze">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Referenze</h1>
          <p className="text-muted-foreground text-sm mt-1">Prodotti caricati dai clienti.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={salvaTutte} disabled={!referenze?.length || savingAll} data-testid="ref-save-all">
            {savingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salva modifiche
          </Button>
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-56" data-testid="filtro-cliente"><SelectValue placeholder="Tutti i clienti" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i clienti</SelectItem>
              {clienti.map((c) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        {!referenze ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead>Titolo</TableHead>
                <TableHead>EAN</TableHead>
                <TableHead>FNSKU</TableHead>
                <TableHead>Origine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referenze.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Nessuna referenza.</TableCell></TableRow>
              )}
              {referenze.map((r) => (
                <TableRow key={r.id} data-testid={`ref-row-${r.id}`}>
                  <TableCell>
                    {r.foto_url ? (
                      <img src={fileUrl(r.foto_url)} alt="" className="h-10 w-10 rounded object-cover border" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center"><ImageOff className="h-4 w-4 text-slate-400" /></div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium max-w-xs truncate">
                    <div className="flex items-center gap-2">
                      {r.is_bundle && (
                        <Badge variant="secondary" className="gap-1 shrink-0"><Layers className="h-3 w-3" /> Bundle</Badge>
                      )}
                      <span className="truncate">{r.titolo}</span>
                    </div>
                    {r.is_bundle && r.componenti?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground font-normal mt-0.5">
                        {r.componenti.map((c) => `${c.quantita}× ${c.ean}`).join(" + ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      data-testid={`ref-ean-${r.id}`}
                      value={eanEdit[r.id] ?? ""}
                      onChange={(e) => setEanEdit({ ...eanEdit, [r.id]: e.target.value })}
                      placeholder="da aggiungere"
                      className="h-8 w-40 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      data-testid={`ref-fnsku-${r.id}`}
                      value={fnskuEdit[r.id] ?? ""}
                      onChange={(e) => setFnskuEdit({ ...fnskuEdit, [r.id]: e.target.value })}
                      placeholder="da aggiungere"
                      className="h-8 w-40 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell><span className="text-xs capitalize">{r.origine}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

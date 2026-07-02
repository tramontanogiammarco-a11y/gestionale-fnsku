import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Barcode, Plus, Trash2, Loader2 } from "lucide-react";

// Generatore etichette FNSKU standalone (Code128 -> PDF)
export default function LabelGenerator() {
  const [rows, setRows] = useState([{ fnsku: "", titolo: "", copie: 1 }]);
  const [formato, setFormato] = useState("50x30");
  const [formati, setFormati] = useState(["50x30"]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/etichette/formati").then((r) => setFormati(r.data.formati)); }, []);

  const update = (i, k, v) => {
    const next = [...rows]; next[i][k] = v; setRows(next);
  };
  const addRow = () => setRows([...rows, { fnsku: "", titolo: "", copie: 1 }]);
  const delRow = (i) => setRows(rows.filter((_, idx) => idx !== i));

  const genera = async () => {
    const items = rows
      .filter((r) => r.fnsku.trim())
      .map((r) => ({ fnsku: r.fnsku.trim(), titolo: r.titolo, copie: Number(r.copie) || 1 }));
    if (items.length === 0) { toast.error("Inserisci almeno un FNSKU"); return; }
    setLoading(true);
    try {
      const res = await api.post("/etichette/genera", { items, formato, mostra_titolo: true }, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
      toast.success("PDF generato");
    } catch (e) {
      // messaggio errore dal backend (blob -> testo)
      let msg = "Errore nella generazione";
      try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) {}
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="label-generator">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Generatore etichette FNSKU</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Codice a barre Code128, PDF con dimensioni reali stampabili.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div>
            <Label className="text-xs">Formato etichetta</Label>
            <Select value={formato} onValueChange={setFormato}>
              <SelectTrigger className="w-40 mt-1" data-testid="lg-formato"><SelectValue /></SelectTrigger>
              <SelectContent>
                {formati.map((f) => <SelectItem key={f} value={f}>{f} mm</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
            <div className="col-span-4">FNSKU</div>
            <div className="col-span-5">Titolo (opzionale)</div>
            <div className="col-span-2">Copie</div>
            <div className="col-span-1"></div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`lg-row-${i}`}>
              <Input className="col-span-4 font-mono" data-testid={`lg-fnsku-${i}`} value={r.fnsku} onChange={(e) => update(i, "fnsku", e.target.value)} placeholder="X001ABCDE1" />
              <Input className="col-span-5" data-testid={`lg-titolo-${i}`} value={r.titolo} onChange={(e) => update(i, "titolo", e.target.value)} placeholder="Nome prodotto" />
              <Input type="number" min={1} className="col-span-2" data-testid={`lg-copie-${i}`} value={r.copie} onChange={(e) => update(i, "copie", e.target.value)} />
              <Button variant="ghost" size="icon" className="col-span-1" onClick={() => delRow(i)} data-testid={`lg-del-${i}`} disabled={rows.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={addRow} data-testid="lg-add-row"><Plus className="h-4 w-4 mr-1" /> Aggiungi riga</Button>
          <Button onClick={genera} disabled={loading} data-testid="lg-genera">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Barcode className="h-4 w-4 mr-2" />}
            Genera PDF
          </Button>
        </div>
      </Card>
    </div>
  );
}

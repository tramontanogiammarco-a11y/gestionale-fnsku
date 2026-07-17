import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, UserPlus, Pencil, ChevronRight } from "lucide-react";

const DEFAULT_LISTINO = {
  fnsku: 0.10, busta: 0, nastratura: 0, pluriball: 0,
  inscatolamento: 0, scatola_60: 0, scatola_40: 0, stoccaggio_pallet: 0, entrata_pallet: 0, entrata_scatola: 0, iva: 22,
};

const PREZZO_FIELDS = [
  ["fnsku", "FNSKU (€/pezzo)"],
  ["busta", "Busta trasparente (€/pezzo)"],
  ["nastratura", "Nastratura (€/pezzo)"],
  ["pluriball", "Pluriball (€/pezzo)"],
  ["inscatolamento", "Inscatolamento (€/box)"],
  ["scatola_60", "Scatola 60×40×40 (€/pz)"],
  ["scatola_40", "Scatola 40×30×30 (€/pz)"],
  ["stoccaggio_pallet", "Stoccaggio (€/pallet·mese)"],
  ["entrata_pallet", "Entrata pallet (€/pallet)"],
  ["entrata_scatola", "Entrata scatola (€/scatola)"],
  ["iva", "IVA (%)"],
];

function parseListinoNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeListino(listino) {
  return Object.fromEntries(
    Object.entries({ ...DEFAULT_LISTINO, ...(listino || {}) }).map(([key, value]) => [key, parseListinoNumber(value)])
  );
}

function ListinoFields({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {PREZZO_FIELDS.map(([key, label]) => (
        <div key={key}>
          <Label className="text-xs">{label}</Label>
          <Input
            type="text"
            inputMode="decimal"
            data-testid={`listino-${key}`}
            value={value[key] ?? 0}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className="mt-1"
          />
        </div>
      ))}
    </div>
  );
}

export default function AdminClienti() {
  const [clienti, setClienti] = useState(null);
  const navigate = useNavigate();

  const load = () => api.get("/clienti").then((r) => setClienti(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="admin-clienti">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Clienti</h1>
          <p className="text-muted-foreground text-sm mt-1">Account, credenziali e listino prezzi personalizzato.</p>
        </div>
        <NuovoClienteDialog onCreated={load} />
      </div>

      <Card>
        {!clienti ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ragione sociale</TableHead>
                <TableHead>Email (login)</TableHead>
                <TableHead>FNSKU</TableHead>
                <TableHead>Inscat.</TableHead>
                <TableHead>Stocc./pallet</TableHead>
                <TableHead>IVA</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clienti.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Nessun cliente.</TableCell></TableRow>
              )}
              {clienti.map((c) => {
                const l = c.listino || {};
                return (
                  <TableRow key={c.id} data-testid={`cliente-row-${c.id}`} className="cursor-pointer" onClick={() => navigate(`/admin/clienti/${c.id}`)}>
                    <TableCell className="font-medium">{c.ragione_sociale}</TableCell>
                    <TableCell className="font-mono text-xs">{c.email}</TableCell>
                    <TableCell className="text-xs">€ {Number(l.fnsku || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">€ {Number(l.inscatolamento || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">€ {Number(l.stoccaggio_pallet || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{Number(l.iva ?? 22)}%</TableCell>
                    <TableCell className="text-right">
                      <ModificaClienteDialog cliente={c} onSaved={load} />
                      <ChevronRight className="ml-2 inline h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function NuovoClienteDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ragione_sociale: "", email: "", password: "", note: "" });
  const [listino, setListino] = useState({ ...DEFAULT_LISTINO });
  const [saving, setSaving] = useState(false);

  const salva = async () => {
    if (!form.ragione_sociale || !form.email || !form.password) {
      toast.error("Compila ragione sociale, email e password");
      return;
    }
    setSaving(true);
    try {
      const listinoNum = normalizeListino(listino);
      await api.post("/clienti", { ...form, listino: listinoNum });
      toast.success("Cliente creato con credenziali e listino");
      setOpen(false);
      setForm({ ragione_sociale: "", email: "", password: "", note: "" });
      setListino({ ...DEFAULT_LISTINO });
      onCreated();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="nuovo-cliente-btn"><UserPlus className="h-4 w-4 mr-2" /> Nuovo cliente</Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader><DialogTitle>Nuovo account cliente</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ragione sociale</Label>
              <Input data-testid="cliente-ragione" value={form.ragione_sociale} onChange={(e) => setForm({ ...form, ragione_sociale: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Email (login)</Label>
              <Input data-testid="cliente-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Password</Label>
              <Input data-testid="cliente-password" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1" placeholder="Assegna una password" />
            </div>
            <div>
              <Label>Note</Label>
              <Textarea data-testid="cliente-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Listino prezzi</Label>
            <div className="mt-2"><ListinoFields value={listino} onChange={setListino} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="cliente-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crea account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModificaClienteDialog({ cliente, onSaved }) {
  const [open, setOpen] = useState(false);
  const [ragione, setRagione] = useState(cliente.ragione_sociale);
  const [note, setNote] = useState(cliente.note || "");
  const [listino, setListino] = useState({ ...DEFAULT_LISTINO, ...(cliente.listino || {}) });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRagione(cliente.ragione_sociale);
    setNote(cliente.note || "");
    setListino({ ...DEFAULT_LISTINO, ...(cliente.listino || {}) });
  }, [open, cliente]);

  const salva = async () => {
    setSaving(true);
    try {
      const listinoNum = normalizeListino(listino);
      await api.put(`/clienti/${cliente.id}`, { ragione_sociale: ragione, note, listino: listinoNum });
      toast.success("Cliente aggiornato");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`edit-cliente-${cliente.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader><DialogTitle>Modifica cliente e listino</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ragione sociale</Label>
              <Input data-testid="edit-ragione" value={ragione} onChange={(e) => setRagione(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Note</Label>
              <Textarea data-testid="edit-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Listino prezzi</Label>
            <div className="mt-2"><ListinoFields value={listino} onChange={setListino} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="edit-cliente-salva">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

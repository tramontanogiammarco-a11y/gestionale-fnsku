import { useEffect, useState } from "react";
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
import { Loader2, Plus, UserPlus } from "lucide-react";

export default function AdminClienti() {
  const [clienti, setClienti] = useState(null);

  const load = () => api.get("/clienti").then((r) => setClienti(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="admin-clienti">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Clienti</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestione account e credenziali dei venditori.</p>
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
                <TableHead>Note</TableHead>
                <TableHead>Creato il</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clienti.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10">Nessun cliente.</TableCell></TableRow>
              )}
              {clienti.map((c) => (
                <TableRow key={c.id} data-testid={`cliente-row-${c.id}`}>
                  <TableCell className="font-medium">{c.ragione_sociale}</TableCell>
                  <TableCell className="font-mono text-xs">{c.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{c.note || "—"}</TableCell>
                  <TableCell>{new Date(c.created_at).toLocaleDateString("it-IT")}</TableCell>
                </TableRow>
              ))}
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
  const [saving, setSaving] = useState(false);

  const salva = async () => {
    if (!form.ragione_sociale || !form.email || !form.password) {
      toast.error("Compila ragione sociale, email e password");
      return;
    }
    setSaving(true);
    try {
      await api.post("/clienti", form);
      toast.success("Cliente creato con credenziali di accesso");
      setOpen(false);
      setForm({ ragione_sociale: "", email: "", password: "", note: "" });
      onCreated();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="nuovo-cliente-btn"><UserPlus className="h-4 w-4 mr-2" /> Nuovo cliente</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuovo account cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Ragione sociale</Label>
            <Input data-testid="cliente-ragione" value={form.ragione_sociale} onChange={(e) => setForm({ ...form, ragione_sociale: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Email (per il login)</Label>
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
        <DialogFooter>
          <Button onClick={salva} disabled={saving} data-testid="cliente-salva-btn">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crea account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

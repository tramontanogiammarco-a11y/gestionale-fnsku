import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Grid3X3, Loader2, Minus, Plus, ScanLine, ShoppingBag, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CameraScanner from "@/components/wms/CameraScanner";

const DEFAULT_CART = "CARRELLO-01";

export default function WmsAppCartBags() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [cartCode, setCartCode] = useState("");
  const [bagCode, setBagCode] = useState("");
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [scanner, setScanner] = useState(null);
  const [working, setWorking] = useState(false);
  const [draftGrid, setDraftGrid] = useState({ righe: 2, colonne: 5 });

  const applySnapshot = useCallback((next) => {
    setSnapshot(next);
    setCartCode(next.cart.codice);
    setDraftGrid({ righe: Number(next.cart.righe), colonne: Number(next.cart.colonne) });
  }, []);

  const loadDefault = useCallback(async () => {
    try {
      const response = await api.get(`/wms/carrelli/${DEFAULT_CART}`);
      applySnapshot(response.data);
    } catch (error) {
      if (error.response?.status !== 404) toast.error(error.response?.data?.detail || "Carrello non disponibile");
    }
  }, [applySnapshot]);
  useEffect(() => { loadDefault(); }, [loadDefault]);

  const scanCart = async (rawValue) => {
    const codice = String(rawValue || cartCode).trim().toUpperCase();
    if (!codice) return toast.error("Scansiona prima il carrello.");
    setWorking(true);
    try {
      const response = await api.post("/wms/carrelli/scansiona", { codice });
      applySnapshot(response.data);
      setScanner(null);
      toast.success(`Carrello ${response.data.cart.codice} pronto da configurare`);
      navigator.vibrate?.([50, 30, 50]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Carrello non valido");
      navigator.vibrate?.(160);
    } finally { setWorking(false); }
  };

  const saveGrid = async () => {
    if (!snapshot) return;
    setWorking(true);
    try {
      const response = await api.put(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}`, draftGrid);
      applySnapshot(response.data);
      toast.success("Griglia carrello aggiornata");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Griglia non aggiornata");
    } finally { setWorking(false); }
  };

  const assignBag = async (rawValue) => {
    const codice = String(rawValue || bagCode).trim().toUpperCase();
    if (!snapshot || !selectedPosition) return;
    if (!codice) return toast.error("Scansiona la bag da inserire.");
    setWorking(true);
    try {
      const response = await api.post(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}/bag`, { posizione: selectedPosition, bag_code: codice });
      applySnapshot(response.data);
      setBagCode("");
      setScanner(null);
      toast.success(`Bag ${codice} inserita in posizione ${selectedPosition}`);
      navigator.vibrate?.([50, 30, 50]);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Bag non assegnata");
      navigator.vibrate?.(160);
    } finally { setWorking(false); }
  };

  const removeBag = async (position) => {
    if (!snapshot || !window.confirm(`Liberare la posizione ${position}?`)) return;
    setWorking(true);
    try {
      const response = await api.post(`/wms/carrelli/${encodeURIComponent(snapshot.cart.codice)}/rimuovi-bag`, { posizione: position });
      applySnapshot(response.data);
      toast.success("Bag rimossa dalla griglia");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Bag non rimossa");
    } finally { setWorking(false); }
  };

  const positionMap = useMemo(() => Object.fromEntries((snapshot?.positions || []).map((item) => [Number(item.posizione), item])), [snapshot]);
  const configured = snapshot?.positions?.length || 0;
  const capacity = Number(snapshot?.capacity || 0);
  const scannerPurpose = scanner === "cart" ? "cart" : "bag";

  return <div className="wms-page pb-24" data-testid="wms-cart-bags">
    <header>
      <button type="button" onClick={() => navigate("/wms-app/strumenti")} className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Torna agli strumenti"><ArrowLeft className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white"><ShoppingCart className="h-6 w-6" /></span><div><p className="text-xs font-black uppercase text-teal-700">Configurazione operativa</p><h1 className="mt-1 text-3xl font-black">Carrelli / Bag</h1><p className="mt-2 text-sm text-slate-500">Scansiona il carrello, scegli la griglia e poi assegna una bag a ogni casella.</p></div></div>
    </header>

    <section className="border-2 border-slate-950 bg-white p-4">
      <p className="text-xs font-black uppercase text-teal-700">1. Carrello</p>
      <h2 className="mt-1 text-xl font-black">Scansiona il master del carrello</h2>
      <div className="mt-4 flex gap-2"><Input value={cartCode} onChange={(event) => setCartCode(event.target.value.toUpperCase())} placeholder={DEFAULT_CART} className="h-14 flex-1 font-mono text-lg" autoComplete="off" /><Button type="button" className="h-14 px-4" onClick={() => setScanner("cart")} disabled={working} aria-label="Apri fotocamera carrello"><ScanLine className="h-5 w-5" /></Button></div>
      <Button type="button" variant="outline" className="mt-2 h-11 w-full" onClick={() => scanCart()} disabled={!cartCode.trim() || working}>Apri carrello</Button>
    </section>

    {snapshot && <>
      <section className="rounded-md border border-teal-200 bg-teal-50 p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-teal-700">Carrello attivo</p><h2 className="mt-1 font-mono text-2xl font-black text-teal-950">{snapshot.cart.codice}</h2></div><span className="rounded-md bg-white px-3 py-2 text-sm font-black text-teal-800">{configured}/{capacity} bag</span></div>
        {snapshot.cart.codice === DEFAULT_CART && <p className="mt-3 text-xs font-semibold text-teal-900">Le prime 10 caselle sono le bag fisse del Metodo Galluse.</p>}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2"><Grid3X3 className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-black">2. Griglia del carrello</h2></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><GridStepper label="Righe" value={draftGrid.righe} onChange={(righe) => setDraftGrid((current) => ({ ...current, righe }))} min={1} max={6} /><GridStepper label="Colonne" value={draftGrid.colonne} onChange={(colonne) => setDraftGrid((current) => ({ ...current, colonne }))} min={1} max={10} /></div>
        <Button type="button" variant="outline" className="mt-4 h-11 w-full" onClick={saveGrid} disabled={working || (draftGrid.righe === Number(snapshot.cart.righe) && draftGrid.colonne === Number(snapshot.cart.colonne))}>Salva griglia {draftGrid.righe} x {draftGrid.colonne}</Button>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase text-teal-700">3. Bag</p><h2 className="mt-1 text-lg font-black">Tocca una casella e scansionala</h2></div><ShoppingBag className="h-6 w-6 text-slate-500" /></div>
        <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Number(snapshot.cart.colonne)}, minmax(0, 1fr))` }}>
          {Array.from({ length: capacity }, (_, index) => index + 1).map((position) => {
            const item = positionMap[position];
            const active = selectedPosition === position;
            return <div key={position} className={`relative min-h-24 overflow-hidden rounded-md border transition ${active ? "border-teal-700 bg-teal-50 ring-2 ring-teal-200" : item ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50 hover:border-teal-400"}`}>
              <button type="button" onClick={() => { setSelectedPosition(position); setBagCode(""); }} className="h-full min-h-24 w-full p-2 pr-8 text-left">
                <span className="block text-[10px] font-black uppercase text-slate-500">Pos. {position}</span>
                {item ? <><strong className="mt-2 block truncate font-mono text-sm">{item.bag_code}</strong><span className="mt-1 block text-[10px] font-bold text-emerald-700">{item.bag?.stato === "disponibile" ? "Libera" : item.bag?.stato || "Configurata"}</span></> : <span className="mt-3 flex items-center gap-1 text-xs font-bold text-slate-400"><Plus className="h-3.5 w-3.5" /> Bag</span>}
              </button>
              {item && <button type="button" onClick={() => removeBag(position)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-white text-rose-600" aria-label={`Rimuovi ${item.bag_code}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>;
          })}
        </div>
        {selectedPosition && <div className="mt-4 rounded-md border-2 border-teal-500 bg-teal-50 p-3"><div className="flex items-center justify-between"><span className="text-sm font-black text-teal-950">Posizione {selectedPosition}</span><button type="button" onClick={() => setSelectedPosition(null)} className="text-xs font-bold text-slate-500">Annulla</button></div><div className="mt-3 flex gap-2"><Input value={bagCode} onChange={(event) => setBagCode(event.target.value.toUpperCase())} placeholder="B-12345" className="h-12 flex-1 font-mono" autoComplete="off" /><Button type="button" className="h-12 px-4" onClick={() => setScanner("bag")} disabled={working} aria-label="Scansiona bag"><ScanLine className="h-5 w-5" /></Button></div><Button type="button" variant="outline" className="mt-2 h-10 w-full bg-white" onClick={() => assignBag()} disabled={!bagCode.trim() || working}>Assegna bag alla posizione {selectedPosition}</Button></div>}
      </section>
    </>}

    {scanner && <CameraScanner open onOpenChange={(open) => { if (!open) setScanner(null); }} purpose={scannerPurpose} onDetected={(value) => { if (scanner === "cart") scanCart(value); else assignBag(value); }} />}
    {working && <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center"><span className="flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-xl"><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio</span></div>}
  </div>;
}

function GridStepper({ label, value, onChange, min, max }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><span className="block text-xs font-black uppercase text-slate-500">{label}</span><div className="mt-2 flex items-center justify-between"><Button type="button" variant="outline" size="icon" className="h-9 w-9 bg-white" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}><Minus className="h-4 w-4" /></Button><strong className="font-mono text-2xl">{value}</strong><Button type="button" variant="outline" size="icon" className="h-9 w-9 bg-white" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}><Plus className="h-4 w-4" /></Button></div></div>;
}

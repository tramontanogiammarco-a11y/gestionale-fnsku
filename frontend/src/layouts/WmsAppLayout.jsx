import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  Archive, ArrowLeftRight, Barcode, ChevronRight, CircleHelp, History, Home, PackageCheck,
  LogOut, Menu, PackageOpen, Search, Settings, ShoppingCart,
  SlidersHorizontal, UserRound, Warehouse, RefreshCcw,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import logo from "@/assets/logo-transparent.png";
import { toast } from "sonner";
import UniversalScanner from "@/components/wms/UniversalScanner";

const ACTIVE_STATES = new Set(["in_attesa", "in_lavorazione"]);

export default function WmsAppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [entries, setEntries] = useState(null);
  const [clientId, setClientId] = useState("all");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const response = await api.get("/entrate");
      setEntries(response.data || []);
    } catch (error) {
      setEntries([]);
      toast.error(error.response?.data?.detail || "Impossibile caricare gli inbound");
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  const clients = useMemo(() => {
    const rows = new Map();
    for (const entry of entries || []) {
      const id = entry.cliente_id;
      if (!id) continue;
      const current = rows.get(id) || {
        id,
        name: entry.cliente_ragione_sociale || "Cliente",
        open: 0,
        total: 0,
      };
      current.total += 1;
      if (ACTIVE_STATES.has(entry.stato)) current.open += 1;
      rows.set(id, current);
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const selectedClient = clients.find((client) => client.id === clientId);
  const companyLabel = selectedClient?.name || "Tutte le aziende";
  const filteredEntries = clientId === "all"
    ? (entries || [])
    : (entries || []).filter((entry) => entry.cliente_id === clientId);

  const focusScanner = () => {
    if (location.pathname.includes("/wms-app/inbound/") || location.pathname.includes("/wms-app/picking/") || location.pathname.includes("/wms-app/picking-massivo/") || location.pathname.includes("/wms-app/picking-galluse/") || location.pathname.includes("/wms-app/packing/") || location.pathname.includes("/wms-app/movimenta-stock") || /^\/wms-app\/inventario\/[^/]+$/.test(location.pathname)) {
      window.dispatchEvent(new Event("wms-focus-scanner"));
      return;
    }
    setScannerOpen(true);
  };

  const signOut = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="wms-shell min-h-dvh text-slate-950" data-testid="wms-app-layout">
      <div className="wms-app-frame mx-auto min-h-dvh w-full max-w-3xl shadow-[0_0_48px_rgba(15,23,42,0.07)]">
        <header className="wms-topbar sticky top-0 z-40 border-b">
          <div className="flex h-[68px] items-center gap-2.5 px-4 sm:px-6">
            <button type="button" onClick={() => navigate("/wms-app")} className="mr-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition hover:bg-slate-100" aria-label="Home WMS"><img src={logo} alt="Aimago" className="h-8 w-8 object-contain" /></button>
            <button
              type="button"
              onClick={() => setCompanyOpen(true)}
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200/80 bg-white/80 px-3.5 text-left text-sm font-bold shadow-[0_2px_8px_rgba(15,23,42,0.035)] transition hover:border-slate-300"
              aria-label="Seleziona azienda"
              data-testid="wms-company-picker"
            >
              <span className="truncate">{companyLabel}</span>
              <ChevronRight className="ml-auto h-4 w-4 rotate-90 text-slate-500" />
            </button>
            <IconButton label="Scansiona" onClick={focusScanner}><Barcode className="h-5 w-5" /></IconButton>
            <IconButton label="Menu" onClick={() => setMenuOpen(true)}><Menu className="h-5 w-5" /></IconButton>
          </div>
        </header>

        <main className="px-4 pb-28 pt-7 sm:px-6 sm:pt-8">
          <Outlet context={{ entries: filteredEntries, allEntries: entries, clientId, clients, loadEntries }} />
        </main>

        <BottomNavigation />
      </div>

      <CompanySheet
        open={companyOpen}
        onOpenChange={setCompanyOpen}
        clients={clients}
        selected={clientId}
        totalOpen={(entries || []).filter((entry) => ACTIVE_STATES.has(entry.stato)).length}
        onSelect={(value) => { setClientId(value); setCompanyOpen(false); }}
      />

      <UniversalScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        clientId={clientId}
        onViewLocation={(code) => {
          setScannerOpen(false);
          navigate(`/wms-app/ubicazioni?code=${encodeURIComponent(code)}`);
        }}
      />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="flex w-[88%] max-w-sm flex-col border-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 pb-5 pt-8 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white"><UserRound className="h-7 w-7" /></div>
              <div className="min-w-0">
                <SheetTitle className="truncate text-xl font-black">{user?.name || "Operatore"}</SheetTitle>
                <SheetDescription className="truncate">{user?.email}</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <nav className="flex-1 space-y-1 px-4 py-5">
            <MenuLink icon={ArrowLeftRight} label="Movimenta stock" active={location.pathname.includes("/movimenta-stock")} onClick={() => { setMenuOpen(false); navigate("/wms-app/movimenta-stock"); }} />
            <MenuLink icon={RefreshCcw} label="Refill" active={location.pathname.includes("/refill")} onClick={() => { setMenuOpen(false); navigate("/wms-app/refill"); }} />
            <MenuLink icon={Archive} label="Inventario" active={location.pathname.includes("/inventario")} onClick={() => { setMenuOpen(false); navigate("/wms-app/inventario"); }} />
            <MenuLink icon={Search} label="Cerca prodotto" active={location.pathname.includes("/cerca-prodotto")} onClick={() => { setMenuOpen(false); navigate("/wms-app/cerca-prodotto"); }} />
            <MenuLink icon={History} label="Storico bag" active={location.pathname.includes("/bag-storico")} onClick={() => { setMenuOpen(false); navigate("/wms-app/bag-storico"); }} />
            <MenuLink icon={SlidersHorizontal} label="Strumenti" active={location.pathname.includes("/strumenti")} onClick={() => { setMenuOpen(false); navigate("/wms-app/strumenti"); }} />
            <MenuLink icon={Settings} label="Configurazione" active={location.pathname.includes("/configurazione")} onClick={() => { setMenuOpen(false); navigate("/wms-app/configurazione"); }} />
          </nav>
          <div className="border-t border-slate-100 p-4">
            <button type="button" onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left font-bold text-red-600 hover:bg-red-50">
              <LogOut className="h-5 w-5" /> Esci
            </button>
            <div className="mt-3 flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <img src={logo} alt="Aimago" className="h-8 w-auto" />
              <div><div className="text-xs font-bold">Aimago WMS</div><div className="text-[11px] text-slate-400">Versione operativa</div></div>
            </div>
            <button type="button" onClick={() => toast.info("Manuale operatore: prossimo collegamento")} className="mt-3 flex w-full items-center gap-3 rounded-md border border-slate-200 px-4 py-3 text-left font-semibold"><CircleHelp className="h-5 w-5" /> Manuale operatore</button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function IconButton({ label, onClick, children }) {
  const primary = label === "Scansiona";
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition ${primary ? "bg-slate-950 text-white shadow-[0_5px_16px_rgba(15,23,42,0.2)] hover:bg-teal-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{children}</button>;
}

function BottomNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const items = [
    { label: "Home", icon: Home, active: location.pathname === "/wms-app", action: () => navigate("/wms-app") },
    { label: "Arrivi", icon: PackageOpen, active: location.pathname.includes("/arrivi") || location.pathname.includes("/inbound/"), action: () => navigate("/wms-app/arrivi") },
    { label: "Ordini", icon: ShoppingCart, active: location.pathname.includes("/ordini") || location.pathname.includes("/picking"), action: () => navigate("/wms-app/ordini") },
    { label: "Stock", icon: Warehouse, active: location.pathname.includes("/ubicazioni") || location.pathname.includes("/cerca-prodotto") || location.pathname.includes("/movimenta-stock") || location.pathname.includes("/refill"), action: () => navigate("/wms-app/ubicazioni") },
    { label: "Packing", icon: PackageCheck, active: location.pathname.includes("/packing"), action: () => navigate("/packing-station") },
  ];
  return (
    <nav className="wms-bottom-nav fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl border-t px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5" aria-label="Navigazione WMS">
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => (
          <button key={item.label} type="button" onClick={item.action} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-extrabold transition ${item.active ? "text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
            <span className={`flex h-7 w-10 items-center justify-center rounded-md transition ${item.active ? "bg-teal-50" : ""}`}><item.icon className={`h-[19px] w-[19px] ${item.active ? "stroke-[2.5]" : ""}`} /></span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function CompanySheet({ open, onOpenChange, clients, selected, totalOpen, onSelect }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[75dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg border-0 bg-white p-0">
        <SheetHeader className="border-b border-slate-100 px-5 pb-4 pt-6 text-left">
          <SheetTitle className="text-xl font-black">Azienda</SheetTitle>
          <SheetDescription>Filtra gli arrivi del magazzino.</SheetDescription>
        </SheetHeader>
        <div className="divide-y divide-slate-100 pb-[max(18px,env(safe-area-inset-bottom))]">
          <CompanyRow name="Tutte le aziende" count={totalOpen} selected={selected === "all"} onClick={() => onSelect("all")} />
          {clients.map((client) => <CompanyRow key={client.id} name={client.name} count={client.open} selected={selected === client.id} onClick={() => onSelect(client.id)} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CompanyRow({ name, count, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 px-5 py-4 text-left ${selected ? "bg-teal-50" : "hover:bg-slate-50"}`}>
      <Warehouse className={`h-5 w-5 ${selected ? "text-teal-700" : "text-slate-500"}`} />
      <span className="min-w-0 flex-1 truncate font-bold">{name}</span>
      <span className="text-sm text-slate-500">{count} aperti</span>
      {selected && <span className="h-3 w-3 rounded-full bg-teal-700" />}
    </button>
  );
}

function MenuLink({ icon: Icon, label, active, soon, onClick }) {
  return (
    <button type="button" onClick={onClick || (() => toast.info(`${label}: modulo in sviluppo`))} className={`flex w-full items-center gap-3 rounded-md px-4 py-3 text-left font-semibold ${active ? "bg-slate-950 text-white" : "text-slate-800 hover:bg-slate-50"}`}>
      <Icon className="h-5 w-5" /><span className="flex-1">{label}</span>{soon && <span className="text-[10px] font-bold uppercase text-slate-400">Presto</span>}{!soon && <ChevronRight className="h-4 w-4 opacity-50" />}
    </button>
  );
}

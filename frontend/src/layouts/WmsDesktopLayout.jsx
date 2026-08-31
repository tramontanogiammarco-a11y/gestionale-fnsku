import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  AlertTriangle, Boxes, LayoutDashboard, LogOut, MapPinned, MessageSquareText,
  PackageSearch, Receipt, RotateCcw, ShoppingCart, Smartphone, Truck, Users, Warehouse,
  PlugZap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import logo from "@/assets/logo.png";

const CORE_NAV = [
  { to: "/wms", end: true, label: "Panoramica", icon: LayoutDashboard },
  { to: "/wms/stock", label: "Stock", icon: Warehouse },
  { to: "/wms/orders", label: "Ordini", icon: ShoppingCart },
  { to: "/wms/exceptions", label: "Eccezioni", icon: AlertTriangle },
  { to: "/wms/shipments", label: "Spedizioni", icon: Truck },
  { to: "/wms/returns", label: "Resi", icon: RotateCcw },
  { to: "/wms/billing", label: "Fatturazione", icon: Receipt },
  { to: "/wms/tickets", label: "Ticket", icon: MessageSquareText },
];

const ADMIN_NAV = [
  { to: "/admin/clienti", label: "Clienti", icon: Users },
  { to: "/wms/mappa", label: "Magazzino 3D", icon: MapPinned },
  { to: "/admin", label: "Amazon Prep", icon: PackageSearch },
  { to: "/wms-app", label: "App operativa", icon: Smartphone },
  { to: "/packing-station", label: "Packing station", icon: Boxes },
];

const CLIENT_NAV = [
  { to: "/wms/integrations", label: "Integrazioni", icon: PlugZap },
];

export default function WmsDesktopLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isStaff = user?.role === "admin" || user?.role === "staff";
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("all");

  useEffect(() => {
    if (!isStaff) return;
    api.get("/clienti").then((response) => setClients(response.data || [])).catch(() => setClients([]));
  }, [isStaff]);

  useEffect(() => {
    if (!isStaff) return;
    api.post("/wms/order-gate/recheck", {
      cliente_id: clientId === "all" ? null : clientId,
      pending_only: true,
      limit: 50,
    }).catch(() => {});
  }, [clientId, isStaff]);

  const current = useMemo(() => {
    const all = [...CORE_NAV, ...(isStaff ? ADMIN_NAV : CLIENT_NAV)];
    return [...all].sort((a, b) => b.to.length - a.to.length)
      .find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)) || CORE_NAV[0];
  }, [isStaff, location.pathname]);

  const selectedClient = clients.find((client) => client.id === clientId);
  const signOut = async () => { await logout(); navigate("/login", { replace: true }); };

  return (
    <div className="min-h-screen bg-[#f4f6f7] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200/80 bg-white lg:flex">
        <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5">
          <img src={logo} alt="Aimago" className="h-10 w-10 object-contain" />
          <div><div className="text-base font-extrabold">Aimago</div><div className="text-[10px] font-extrabold uppercase text-teal-700">Logistics Control</div></div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Control Tower">
          <NavGroup label="Control Tower" items={CORE_NAV} />
          {isStaff && <NavGroup label="Operazioni Aimago" items={ADMIN_NAV} className="mt-6" />}
          {!isStaff && <NavGroup label="Collegamenti" items={CLIENT_NAV} className="mt-6" />}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-3 rounded-md bg-slate-50 p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-50 text-sm font-extrabold text-teal-800">{(user?.name || user?.email || "A").slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{user?.name || "Utente"}</strong><span className="block truncate text-[11px] text-slate-500">{isStaff ? "Aimago" : "Cliente"}</span></span>
            <button type="button" onClick={signOut} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label="Esci"><LogOut className="h-[18px] w-[18px]" /></button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="flex min-h-[72px] items-center gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 lg:hidden"><img src={logo} alt="Aimago" className="h-9 w-9 object-contain" /><div><div className="text-sm font-extrabold">Aimago</div><div className="text-[10px] text-slate-500">{current.label}</div></div></div>
            <div className="hidden min-w-0 lg:block"><p className="text-[10px] font-extrabold uppercase text-teal-700">Control Tower</p><h1 className="truncate text-lg font-extrabold">{current.label}</h1></div>
            <div className="ml-auto flex items-center gap-3">
              {isStaff ? (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="h-10 w-[190px] border-slate-200 bg-white text-sm font-bold sm:w-[250px]" aria-label="Filtra cliente"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Tutti i clienti</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.ragione_sociale}</SelectItem>)}</SelectContent>
                </Select>
              ) : <span className="hidden items-center gap-2 text-xs font-bold text-slate-500 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Dati aggiornati</span>}
              <button type="button" onClick={signOut} className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700 lg:hidden" aria-label="Esci"><LogOut className="h-5 w-5" /></button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 lg:hidden" aria-label="Control Tower mobile">{[...CORE_NAV, ...(!isStaff ? CLIENT_NAV : [])].map((item) => <MobileNavLink key={item.to} item={item} />)}</nav>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1500px] animate-fade-up"><Outlet context={{ clientId: clientId === "all" ? null : clientId, clients, selectedClient, isStaff }} /></div>
        </main>
      </div>
    </div>
  );
}

function NavGroup({ label, items, className }) {
  return <div className={className}><p className="mb-2 px-3 text-[10px] font-extrabold uppercase text-slate-400">{label}</p><div className="space-y-1">{items.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-md px-3 text-sm font-bold transition", isActive ? "bg-slate-950 text-white shadow-[0_5px_16px_rgba(15,23,42,0.14)]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950")}><item.icon className="h-[18px] w-[18px]" /><span>{item.label}</span></NavLink>)}</div></div>;
}

function MobileNavLink({ item }) {
  return <NavLink to={item.to} end={item.end} className={({ isActive }) => cn("flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-bold", isActive ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500")}><item.icon className="h-4 w-4" />{item.label}</NavLink>;
}

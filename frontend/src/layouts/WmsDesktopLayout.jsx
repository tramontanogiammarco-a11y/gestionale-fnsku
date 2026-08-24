import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Boxes, LayoutDashboard, LogOut, MapPinned, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

const NAV_ITEMS = [
  { to: "/wms", end: true, label: "Centro operativo", icon: LayoutDashboard },
  { to: "/wms/ordini", label: "Ordini", icon: ShoppingCart },
  { to: "/wms/mappa", label: "Mappa 3D", icon: MapPinned },
  { to: "/packing-station", label: "Packing station", icon: Boxes },
];

export default function WmsDesktopLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => { await logout(); navigate("/login", { replace: true }); };

  return <div className="min-h-screen bg-[#f3f6f6] text-slate-950">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3"><img src={logo} alt="Aimago" className="h-9 w-9 object-contain" /><div><div className="text-base font-black">Aimago WMS</div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">Warehouse control</div></div></div>
        <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label="Navigazione WMS">{NAV_ITEMS.map((item) => <WmsNavLink key={item.to} item={item} />)}</nav>
        <div className="ml-auto flex items-center gap-3"><span className="hidden text-xs font-semibold text-slate-500 sm:inline">{user?.name || user?.email || "Operatore"}</span><button type="button" onClick={signOut} title="Esci" aria-label="Esci" className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700"><LogOut className="h-5 w-5" /></button></div>
      </div>
      <nav className="flex overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden" aria-label="Navigazione WMS mobile">{NAV_ITEMS.map((item) => <WmsNavLink key={item.to} item={item} mobile />)}</nav>
    </header>
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
  </div>;
}

function WmsNavLink({ item, mobile = false }) {
  return <NavLink to={item.to} end={item.end} className={({ isActive }) => cn("flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-bold transition-colors", isActive ? "bg-teal-100 text-teal-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950", mobile && "text-xs")}><item.icon className="h-4 w-4" />{item.label}</NavLink>;
}

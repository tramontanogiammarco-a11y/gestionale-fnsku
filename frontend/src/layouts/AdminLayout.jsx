import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, PackageOpen, Users, Boxes, Tags, Barcode, LogOut, ClipboardList, PackagePlus, Receipt, PlugZap, ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import GlobalSearch from "@/components/GlobalSearch";
import logo from "@/assets/logo.png";

const NAV = [
  { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, id: "dashboard" },
  { to: "/admin/entrate", label: "Ricezione merce", icon: PackageOpen, id: "entrate" },
  { to: "/admin/preparazioni", label: "Preparazioni", icon: ClipboardList, id: "preparazioni" },
  { to: "/admin/ordini-wms", label: "Ordini WMS", icon: ShoppingCart, id: "ordini-wms" },
  { to: "/admin/composizione-box", label: "Composizione Box", icon: PackagePlus, id: "composizione-box" },
  { to: "/admin/box", label: "Box", icon: Boxes, id: "box" },
  { to: "/admin/referenze", label: "Referenze", icon: Tags, id: "referenze" },
  { to: "/admin/etichette", label: "Etichette FNSKU", icon: Barcode, id: "etichette" },
  { to: "/admin/clienti", label: "Clienti", icon: Users, id: "clienti" },
  { to: "/admin/fatturazione", label: "Fatturazione", icon: Receipt, id: "fatturazione" },
  { to: "/admin/integrazioni", label: "Integrazioni", icon: PlugZap, id: "integrazioni" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-72 flex-col fixed h-screen p-4">
        <div className="app-surface flex h-full flex-col overflow-hidden">
          <div className="px-5 py-5 border-b border-slate-200/70">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Logo" className="h-12 w-auto object-contain" />
              <div className="min-w-0">
                <div className="font-heading text-base font-black tracking-tight">Aimago</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Staff Control</div>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-teal-700">Workspace</div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">Prep Center FBA</div>
            </div>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.end}
                data-testid={`nav-${item.id}`}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all",
                    isActive
                      ? "admin-nav-active bg-slate-950 text-white shadow-md shadow-slate-950/15"
                      : "text-slate-600 hover:bg-white hover:text-slate-950 hover:shadow-sm"
                  )
                }
              >
                <span className="admin-nav-icon flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition-colors group-hover:bg-teal-50 group-hover:text-teal-700">
                  <item.icon className="h-4 w-4" />
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-slate-200/70 p-4">
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Account</div>
              <div className="mt-1 truncate text-xs font-semibold text-slate-700">{user?.email}</div>
            </div>
            <button
              data-testid="logout-btn"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:text-slate-950 hover:shadow-md"
            >
              <LogOut className="h-4 w-4" /> Esci
            </button>
          </div>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-20 nav-glass text-slate-900">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Logo" className="h-8 w-auto object-contain" />
            <span className="font-heading font-black text-sm">Aimago Staff</span>
          </div>
          <button className="rounded-md p-2 text-slate-600" onClick={handleLogout} data-testid="logout-btn-mobile" aria-label="Esci">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-200/70 px-2">
          {NAV.map((item) => (
            <NavLink
              key={`mobile-${item.id}`}
              to={item.to}
              end={item.end}
              data-testid={`nav-mobile-${item.id}`}
              className={({ isActive }) => cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold",
                isActive ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="flex-1 md:ml-72 pt-28 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1460px] animate-fade-up">
          <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(320px,560px)_1fr]">
            <GlobalSearch />
            <div className="hidden items-center justify-end text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 lg:flex">
              Workspace live
            </div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

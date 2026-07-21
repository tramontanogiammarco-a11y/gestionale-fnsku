import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  Barcode, Boxes, ClipboardList, LayoutDashboard, LogOut, PackageOpen, PackagePlus,
  PlugZap, Receipt, ShoppingCart, Tags, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import GlobalSearch from "@/components/GlobalSearch";
import logo from "@/assets/logo.png";

const NAV_SECTIONS = [
  {
    label: "Panoramica",
    items: [{ to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, id: "dashboard" }],
  },
  {
    label: "Operazioni",
    items: [
      { to: "/admin/entrate", label: "Ricezione merce", icon: PackageOpen, id: "entrate" },
      { to: "/admin/preparazioni", label: "Preparazioni", icon: ClipboardList, id: "preparazioni" },
      { to: "/admin/composizione-box", label: "Composizione box", icon: PackagePlus, id: "composizione-box" },
      { to: "/admin/box", label: "Box e spedizioni", icon: Boxes, id: "box" },
      { to: "/admin/ordini-wms", label: "Ordini WMS", icon: ShoppingCart, id: "ordini-wms" },
    ],
  },
  {
    label: "Archivio",
    items: [
      { to: "/admin/referenze", label: "Referenze", icon: Tags, id: "referenze" },
      { to: "/admin/etichette", label: "Etichette FNSKU", icon: Barcode, id: "etichette" },
      { to: "/admin/clienti", label: "Clienti", icon: Users, id: "clienti" },
      { to: "/admin/fatturazione", label: "Fatturazione", icon: Receipt, id: "fatturazione" },
      { to: "/admin/integrazioni", label: "Integrazioni", icon: PlugZap, id: "integrazioni" },
    ],
  },
];

const NAV = NAV_SECTIONS.flatMap((section) => section.items);

function AdminNavLink({ item, mobile = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      data-testid={`${mobile ? "nav-mobile" : "nav"}-${item.id}`}
      className={({ isActive }) => cn(
        mobile
          ? "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold"
          : "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors",
        mobile && (isActive ? "border-teal-400 text-white" : "border-transparent text-slate-400"),
        !mobile && (isActive
          ? "admin-nav-active bg-teal-400 text-slate-950"
          : "text-slate-400 hover:bg-white/5 hover:text-white")
      )}
    >
      <span className={cn(
        "admin-nav-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
        mobile ? "h-5 w-5" : "bg-white/5 text-slate-400 group-hover:text-white"
      )}>
        <item.icon className="h-4 w-4" />
      </span>
      {item.label}
    </NavLink>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-[#111820] text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-white">
              <img src={logo} alt="Aimago" className="h-9 w-auto object-contain" />
            </span>
            <div>
              <div className="font-heading text-base font-black">Aimago Prep</div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-300">Staff workspace</div>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Sistema</div>
              <div className="truncate text-xs font-semibold text-slate-200">Prep Center FBA operativo</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-5">
              <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{section.label}</div>
              <div className="space-y-1">
                {section.items.map((item) => <AdminNavLink key={item.id} item={item} />)}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 px-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Account amministratore</div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-300">{user?.email}</div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Esci
          </button>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-30 bg-[#111820] text-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white">
              <img src={logo} alt="Aimago" className="h-7 w-auto object-contain" />
            </span>
            <span className="font-heading text-sm font-black">Aimago Prep</span>
          </div>
          <button className="rounded-md p-2 text-slate-300" onClick={handleLogout} data-testid="logout-btn-mobile" aria-label="Esci">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-2">
          {NAV.map((item) => <AdminNavLink key={`mobile-${item.id}`} item={item} mobile />)}
        </nav>
      </div>

      <main className="min-h-screen pt-28 md:ml-64 md:pt-0">
        <div className="sticky top-0 z-20 hidden h-[72px] items-center border-b border-slate-200 bg-white/95 px-6 backdrop-blur md:flex lg:px-8">
          <div className="w-full max-w-xl"><GlobalSearch /></div>
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Operativo
          </div>
        </div>
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mb-5 md:hidden"><GlobalSearch /></div>
          <div className="mx-auto max-w-[1480px] animate-fade-up"><Outlet /></div>
        </div>
      </main>
    </div>
  );
}

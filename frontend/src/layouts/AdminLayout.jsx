import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  Barcode, Boxes, ChevronRight, ClipboardList, LayoutDashboard, LogOut, PackageOpen,
  PackagePlus, PlugZap, Receipt, ShoppingCart, Tags, Users,
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
      title={mobile ? undefined : item.label}
      aria-label={item.label}
      data-testid={`${mobile ? "nav-mobile" : "nav"}-${item.id}`}
      className={({ isActive }) => cn(
        mobile
          ? "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold"
          : "group relative flex h-11 w-11 items-center justify-center rounded-md transition-colors",
        mobile && (isActive ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500"),
        !mobile && (isActive
          ? "bg-[#dff6f1] text-teal-800"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-950")
      )}
    >
      <item.icon className={cn("shrink-0", mobile ? "h-4 w-4" : "h-[19px] w-[19px]")} strokeWidth={1.8} />
      {mobile && item.label}
      {!mobile && (
        <span className="pointer-events-none absolute left-[54px] z-50 hidden whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg group-hover:block">
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentItem = [...NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)) || NAV[0];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center justify-center border-b border-slate-200">
          <img src={logo} alt="Aimago" className="h-10 w-10 object-contain" />
        </div>

        <nav className="flex flex-1 flex-col items-center overflow-y-auto px-3 py-3">
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.label} className={cn("flex w-full flex-col items-center gap-1", index > 0 && "mt-2 border-t border-slate-100 pt-2")}>
              {section.items.map((item) => <AdminNavLink key={item.id} item={item} />)}
            </div>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-2 border-t border-slate-200 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700" title={user?.email}>
            {(user?.email || "A").slice(0, 1).toUpperCase()}
          </div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            title="Esci"
            aria-label="Esci"
            className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-[19px] w-[19px]" strokeWidth={1.8} />
          </button>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Aimago" className="h-8 w-8 object-contain" />
            <div>
              <div className="text-sm font-bold">Aimago Prep</div>
              <div className="text-[10px] font-medium text-slate-500">{currentItem.label}</div>
            </div>
          </div>
          <button className="rounded-md p-2 text-slate-600" onClick={handleLogout} data-testid="logout-btn-mobile" aria-label="Esci">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2">
          {NAV.map((item) => <AdminNavLink key={`mobile-${item.id}`} item={item} mobile />)}
        </nav>
      </header>

      <main className="min-h-screen pt-28 md:ml-20 md:pt-0">
        <div className="sticky top-0 z-30 hidden h-16 items-center border-b border-slate-200 bg-white/95 px-6 backdrop-blur md:flex lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-bold text-slate-950">Aimago Prep</span>
            <ChevronRight className="h-4 w-4 text-slate-300" />
            <span className="font-medium text-slate-500">{currentItem.label}</span>
          </div>
          <div className="ml-auto flex w-full max-w-md items-center gap-5">
            <div className="min-w-0 flex-1"><GlobalSearch /></div>
            <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Live
            </div>
          </div>
        </div>
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mb-5 md:hidden"><GlobalSearch /></div>
          <div className="mx-auto max-w-[1520px] animate-fade-up"><Outlet /></div>
        </div>
      </main>
    </div>
  );
}

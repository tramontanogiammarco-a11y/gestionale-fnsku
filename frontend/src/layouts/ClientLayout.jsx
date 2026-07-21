import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Boxes, ClipboardList, LayoutDashboard, LogOut, PackageOpen, Receipt, Tags, Truck, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

const NAV = [
  { to: "/app", end: true, label: "Dashboard", icon: LayoutDashboard, id: "dashboard" },
  { to: "/app/referenze", label: "Referenze", icon: Tags, id: "referenze" },
  { to: "/app/magazzino", label: "Magazzino", icon: Warehouse, id: "magazzino" },
  { to: "/app/entrate", label: "Entrate", icon: PackageOpen, id: "entrate" },
  { to: "/app/preparazioni", label: "Preparazioni", icon: ClipboardList, id: "preparazioni" },
  { to: "/app/box", label: "Box", icon: Boxes, id: "box" },
  { to: "/app/spedizioni", label: "Spedizioni", icon: Truck, id: "spedizioni" },
  { to: "/app/fatturazione", label: "Fatturazione", icon: Receipt, id: "fatturazione" },
];

function ClientNavLink({ item, mobile = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      data-testid={`${mobile ? "nav-mobile" : "nav"}-${item.id}`}
      className={({ isActive }) => cn(
        mobile
          ? "flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold"
          : "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors",
        mobile && (isActive ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500"),
        !mobile && (isActive ? "bg-teal-50 text-teal-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")
      )}
    >
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", !mobile && "bg-slate-100 text-slate-500 group-hover:text-teal-700")}>
        <item.icon className="h-4 w-4" />
      </span>
      {item.label}
    </NavLink>
  );
}

export default function ClientLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Aimago" className="h-11 w-auto object-contain" />
            <div className="min-w-0">
              <div className="truncate font-heading text-sm font-black">{user?.name || "Area cliente"}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700">Portale cliente</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {NAV.map((item) => <ClientNavLink key={item.id} item={item} />)}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 rounded-md bg-slate-50 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Account cliente</div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-700">{user?.email}</div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950"
          >
            <LogOut className="h-4 w-4" /> Esci
          </button>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Aimago" className="h-9 w-auto object-contain" />
            <div>
              <div className="font-heading text-sm font-black">{user?.name || "Area cliente"}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-teal-700">Portale cliente</div>
            </div>
          </div>
          <button className="rounded-md p-2 text-slate-600" onClick={handleLogout} data-testid="logout-btn-mobile" aria-label="Esci">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2">
          {NAV.map((item) => <ClientNavLink key={`mobile-${item.id}`} item={item} mobile />)}
        </nav>
      </header>

      <main className="min-h-screen pt-28 md:ml-64 md:pt-0">
        <div className="border-b border-slate-200 bg-white px-6 py-4 lg:px-8">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Aimago Prep Center</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">Spedizioni Amazon sotto controllo</div>
            </div>
            <div className="hidden items-center gap-2 text-xs font-semibold text-slate-500 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Dati aggiornati
            </div>
          </div>
        </div>
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1400px] animate-fade-up"><Outlet /></div>
        </div>
      </main>
    </div>
  );
}

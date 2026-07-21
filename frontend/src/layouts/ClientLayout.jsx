import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Tags, PackageOpen, Boxes, Truck, LogOut, Warehouse, ClipboardList, LayoutDashboard, Receipt } from "lucide-react";
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

export default function ClientLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 nav-glass">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex min-h-[72px] items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Logo" className="h-11 w-auto object-contain" />
              <div>
                <div className="font-heading font-black text-sm leading-tight">{user?.name || "Area cliente"}</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-teal-700">Portale cliente</div>
              </div>
            </div>
            <button
              data-testid="logout-btn"
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:text-slate-950 hover:shadow-md"
            >
              <LogOut className="h-4 w-4" /> Esci
            </button>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.end}
                data-testid={`nav-${item.id}`}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors",
                    isActive
                      ? "border-teal-700 text-teal-800"
                      : "border-transparent text-slate-500 hover:text-slate-950"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 lg:py-8">
        <div className="animate-fade-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

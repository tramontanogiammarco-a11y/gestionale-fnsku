import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, PackageOpen, Users, Boxes, Tags, Barcode, LogOut, Warehouse, ClipboardList, PackagePlus, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

const NAV = [
  { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, id: "dashboard" },
  { to: "/admin/entrate", label: "Ricezione merce", icon: PackageOpen, id: "entrate" },
  { to: "/admin/preparazioni", label: "Preparazioni", icon: ClipboardList, id: "preparazioni" },
  { to: "/admin/composizione-box", label: "Composizione Box", icon: PackagePlus, id: "composizione-box" },
  { to: "/admin/box", label: "Box", icon: Boxes, id: "box" },
  { to: "/admin/referenze", label: "Referenze", icon: Tags, id: "referenze" },
  { to: "/admin/etichette", label: "Etichette FNSKU", icon: Barcode, id: "etichette" },
  { to: "/admin/clienti", label: "Clienti", icon: Users, id: "clienti" },
  { to: "/admin/fatturazione", label: "Fatturazione", icon: Receipt, id: "fatturazione" },
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
      {/* Sidebar scura — ambiente staff */}
      <aside className="hidden md:flex w-64 flex-col bg-white text-slate-700 border-r border-slate-200 fixed h-screen">
        <div className="flex items-center justify-center h-28 px-6 border-b border-slate-200">
          <img src={logo} alt="Logo" className="h-14 w-auto object-contain" />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              data-testid={`nav-${item.id}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all border-l-2",
                  isActive
                    ? "border-[#1F9FB3] bg-[#1F9FB3]/10 text-[#0f7c8c] font-semibold"
                    : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="text-xs text-slate-400 mb-2 truncate">{user?.email}</div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Esci
          </button>
        </div>
      </aside>

      {/* Top bar mobile */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Logo" className="h-7 w-auto object-contain" />
          <span className="font-heading font-bold text-sm">Gestionale FBA</span>
        </div>
        <button onClick={handleLogout} data-testid="logout-btn-mobile"><LogOut className="h-5 w-5" /></button>
      </div>

      <main className="flex-1 md:ml-64 pt-16 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] animate-fade-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

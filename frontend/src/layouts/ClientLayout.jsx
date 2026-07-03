import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Tags, PackageOpen, Boxes, Truck, LogOut, Warehouse, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

const NAV = [
  { to: "/app", end: true, label: "Referenze", icon: Tags, id: "referenze" },
  { to: "/app/magazzino", label: "Magazzino", icon: Warehouse, id: "magazzino" },
  { to: "/app/entrate", label: "Entrate", icon: PackageOpen, id: "entrate" },
  { to: "/app/preparazioni", label: "Preparazioni", icon: ClipboardList, id: "preparazioni" },
  { to: "/app/box", label: "Box", icon: Boxes, id: "box" },
  { to: "/app/spedizioni", label: "Spedizioni", icon: Truck, id: "spedizioni" },
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
      {/* Top navigation — area cliente (chiara, distinta dal backend) */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-slate-200/60 shadow-sm">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="h-11 w-11 rounded-lg bg-zinc-950 flex items-center justify-center shadow-sm">
                <img src={logo} alt="Logo" className="h-8 w-8 object-contain" />
              </div>
              <div>
                <div className="font-heading font-bold text-sm leading-tight">{user?.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Area Cliente</div>
              </div>
            </div>
            <button
              data-testid="logout-btn"
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
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
                    "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-muted-foreground hover:text-foreground"
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
        <Outlet />
      </main>
    </div>
  );
}

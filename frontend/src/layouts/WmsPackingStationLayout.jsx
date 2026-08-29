import { ArrowLeft, LogOut, PackageCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import logo from "@/assets/logo.png";
import WmsAppPacking from "@/pages/wms/WmsAppPacking";

export default function WmsPackingStationLayout() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const signOut = async () => { await logout(); navigate("/login", { replace: true }); };

  return <div className="wms-shell min-h-dvh text-slate-950">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6"><img src={logo} alt="Aimago" className="h-9 w-9 object-contain" /><div className="min-w-0 flex-1"><div className="font-black">Aimago WMS</div><div className="text-xs font-bold uppercase text-teal-700">Packing station</div></div><button type="button" onClick={() => navigate("/wms")} className="hidden h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50 sm:flex"><ArrowLeft className="h-4 w-4" /> WMS Control</button><button type="button" onClick={signOut} title="Esci" aria-label="Esci" className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700"><LogOut className="h-5 w-5" /></button></div></header>
    <main className="mx-auto min-h-[calc(100dvh-64px)] max-w-6xl px-4 py-6 sm:px-6 lg:py-8"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-slate-500"><PackageCheck className="h-4 w-4 text-teal-700" /> Postazione scanner</div><WmsAppPacking /></main>
  </div>;
}

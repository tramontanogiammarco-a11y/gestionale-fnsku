import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Boxes, Loader2, ShieldCheck, Truck } from "lucide-react";
import logo from "@/assets/logo.png";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) {
      navigate(res.user.role === "cliente" ? "/app" : "/admin", { replace: true });
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="min-h-screen grid bg-[#f4f7fb] text-slate-950 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden overflow-hidden bg-[#0c1324] p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 login-grid" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(circle_at_50%_100%,rgba(33,183,198,0.32),transparent_58%)]" />
        <div className="relative z-10 h-8" />

        <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center text-center animate-fade-up">
          <div className="logo-glow rounded-[28px] bg-white/95 px-9 py-8 shadow-2xl shadow-cyan-950/30 ring-1 ring-white/50">
            <img src={logo} alt="Aimago" className="h-64 w-auto object-contain" />
          </div>
          <h1 className="mt-10 font-heading text-6xl font-black leading-none text-white">Gestionale FBA</h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">
            Un pannello operativo per ricezione merce, magazzino virtuale, preparazioni, etichette FNSKU e spedizioni Amazon.
          </p>
          <div className="mt-9 grid w-full max-w-lg grid-cols-3 gap-3 text-left">
            <div className="rounded-lg border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
              <Boxes className="h-5 w-5 text-[#25d0c7]" />
              <p className="mt-3 text-sm font-semibold text-white">Magazzino</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
              <ShieldCheck className="h-5 w-5 text-[#f5b95b]" />
              <p className="mt-3 text-sm font-semibold text-white">Controlli</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
              <Truck className="h-5 w-5 text-[#7c8cff]" />
              <p className="mt-3 text-sm font-semibold text-white">Spedizioni</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 h-10" />
      </div>

      <div className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-9 flex flex-col items-start lg:hidden">
            <div className="rounded-2xl bg-white px-5 py-4 shadow-xl shadow-slate-200/80 ring-1 ring-slate-200">
              <img src={logo} alt="Aimago" className="h-24 w-auto object-contain" />
            </div>
            <span className="mt-4 font-heading text-2xl font-extrabold text-slate-950">Gestionale FBA</span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/70 sm:p-8">
            <div className="mb-7">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#168a99]">Area riservata</p>
              <h2 className="mt-3 font-heading text-3xl font-extrabold text-slate-950">Bentornato</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Inserisci le tue credenziali per accedere al gestionale.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@azienda.it"
                required
                className="mt-2 h-12 rounded-lg border-slate-200 bg-slate-50/80"
              />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="mt-2 h-12 rounded-lg border-slate-200 bg-slate-50/80"
              />
              </div>
              {error && (
                <p data-testid="login-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <Button data-testid="login-submit" type="submit" className="h-12 w-full rounded-lg text-base font-bold" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                Accedi
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

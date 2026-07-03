import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

const BG = "https://images.unsplash.com/photo-1592085198739-ffcad7f36b54?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzB8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBsb2dpc3RpY3MlMjB3YXJlaG91c2UlMjBuaWdodHxlbnwwfHx8fDE3ODMwODUyNjd8MA&ixlib=rb-4.1.0&q=85";

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
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Colonna hero — immagine warehouse notturna + logo grande */}
      <div className="hidden lg:flex relative flex-col items-center justify-center p-12 overflow-hidden">
        <img src={BG} alt="Magazzino" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-zinc-950/85" />
        <div className="relative z-10 flex flex-col items-center text-center text-white animate-fade-up">
          <img src={logo} alt="Logo" className="h-28 w-auto object-contain drop-shadow-[0_0_40px_rgba(31,159,179,0.55)]" />
          <h1 className="font-heading text-4xl font-black tracking-tight mt-8">Gestionale FBA</h1>
          <p className="mt-4 text-zinc-300 text-base max-w-md leading-relaxed">
            Ricezione merce, magazzino virtuale, preparazioni, etichette FNSKU e spedizioni verso Amazon — tutto in un unico posto.
          </p>
          <div className="mt-8 h-1 w-16 rounded-full bg-[#1F9FB3]" />
        </div>
      </div>

      {/* Colonna form */}
      <div className="flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img src={logo} alt="Logo" className="h-10 w-auto object-contain" />
            <span className="font-heading font-bold text-lg">Gestionale FBA</span>
          </div>
          <h2 className="font-heading text-2xl font-bold text-slate-900">Accedi</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-6">Inserisci le tue credenziali per continuare.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                className="mt-1"
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
                className="mt-1"
              />
            </div>
            {error && (
              <p data-testid="login-error" className="text-sm text-destructive">{error}</p>
            )}
            <Button data-testid="login-submit" type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Accedi
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

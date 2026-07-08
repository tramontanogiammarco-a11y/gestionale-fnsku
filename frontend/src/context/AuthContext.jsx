import { createContext, useContext, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const AuthContext = createContext(null);
const VALID_ROLES = new Set(["admin", "staff", "cliente"]);

function toAppUser(sessionUser, profile) {
  if (!sessionUser || !profile || !VALID_ROLES.has(profile.role)) return false;
  return {
    id: sessionUser.id,
    email: profile.email || sessionUser.email,
    name: profile.name,
    role: profile.role,
    cliente_id: profile.cliente_id,
  };
}

function authErrorMessage(error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("invalid login")) {
    return "Email o password non corretti";
  }
  return message || "Si è verificato un errore. Riprova.";
}

export function AuthProvider({ children }) {
  // null = verifica in corso, oggetto = autenticato, false = non autenticato
  const [user, setUser] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      if (!isSupabaseConfigured) {
        if (mounted) setUser(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData.session?.user;
      if (!sessionUser) {
        if (mounted) setUser(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("email,name,role,cliente_id")
        .eq("id", sessionUser.id)
        .single();

      if (mounted) setUser(toAppUser(sessionUser, profile));
    }

    loadUser();

    if (!isSupabaseConfigured) return () => { mounted = false; };

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    if (!isSupabaseConfigured) {
      return {
        ok: false,
        error: "Supabase non è ancora configurato. Inseriamo URL e anon key del progetto Supabase.",
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: authErrorMessage(error) };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email,name,role,cliente_id")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "Utente creato in Auth ma profilo mancante. Completa il profilo nella tabella profiles.",
      };
    }

    const appUser = toAppUser(data.user, profile);
    setUser(appUser);
    return { ok: Boolean(appUser), user: appUser, error: appUser ? undefined : "Ruolo utente non valido." };
  };

  const logout = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

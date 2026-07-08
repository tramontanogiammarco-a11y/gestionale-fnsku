import { createContext, useContext, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";

const AuthContext = createContext(null);
const VALID_ROLES = new Set(["admin", "staff", "cliente"]);

function isValidUser(data) {
  return data && typeof data === "object" && VALID_ROLES.has(data.role);
}

export function AuthProvider({ children }) {
  // null = verifica in corso, oggetto = autenticato, false = non autenticato
  const [user, setUser] = useState(null);

  useEffect(() => {
    api
      .get("/auth/me")
      .then((r) => setUser(isValidUser(r.data) ? r.data : false))
      .catch(() => setUser(false));
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (!isValidUser(data)) {
        return {
          ok: false,
          error: "Backend non ancora collegato. Completiamo il deploy del server prima di accedere.",
        };
      }
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      return { ok: false, error: formatApiError(e.response?.data?.detail) };
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (_) {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

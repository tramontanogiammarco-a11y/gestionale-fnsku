import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

// Istanza axios con invio cookie (auth via httpOnly cookie)
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Auto-refresh della sessione: se una chiamata torna 401, prova UNA volta a
// rinnovare l'access token con il refresh token (valido 7 giorni) e ripete la
// richiesta. Così l'utente non viene "buttato fuori" e non deve rifare login
// di continuo. Se il refresh fallisce davvero, redirige al login.
let refreshPromise = null;
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes("/auth/");
    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      try {
        refreshPromise = refreshPromise || api.post("/auth/refresh");
        await refreshPromise;
        refreshPromise = null;
        return api(original); // ripete la richiesta originale
      } catch (refreshErr) {
        refreshPromise = null;
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

// Costruisce URL assoluto per un file salvato (foto, PDF etichette)
export const fileUrl = (path) => (path ? `${BACKEND_URL}${path}` : null);

// Converte il detail di errore FastAPI in stringa leggibile
export function formatApiError(detail) {
  if (detail == null) return "Si è verificato un errore. Riprova.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

// Istanza axios con invio cookie (auth via httpOnly cookie)
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

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

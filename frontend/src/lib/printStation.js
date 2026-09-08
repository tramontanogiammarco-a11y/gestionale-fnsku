const STATION_CODE_KEY = "aimago.wms.printStationCode";
const PAIRED_STATION_KEY = "aimago.wms.pairedPrintStation";
const STATION_QR_PREFIX = "AIMAGO-WMS:PACKING-STATION:";
const STATION_CODE_PATTERN = /^STATION-[A-Z0-9]{8,16}$/;

function randomToken() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

export function getOrCreatePrintStationCode() {
  const current = window.localStorage.getItem(STATION_CODE_KEY);
  if (current) return current;
  const code = `STATION-${randomToken()}`;
  window.localStorage.setItem(STATION_CODE_KEY, code);
  return code;
}

export function getPairedPrintStationCode() {
  return window.localStorage.getItem(PAIRED_STATION_KEY) || "";
}

export function pairPrintStation(code) {
  const normalized = normalizePrintStationCode(code);
  if (!normalized) return "";
  window.localStorage.setItem(PAIRED_STATION_KEY, normalized);
  return normalized;
}

export function unpairPrintStation() {
  window.localStorage.removeItem(PAIRED_STATION_KEY);
}

export function normalizePrintStationCode(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const normalizedValue = rawValue.toUpperCase();
  if (STATION_CODE_PATTERN.test(normalizedValue)) return normalizedValue;

  if (normalizedValue.startsWith(STATION_QR_PREFIX)) {
    const stationCode = normalizedValue.slice(STATION_QR_PREFIX.length);
    return STATION_CODE_PATTERN.test(stationCode) ? stationCode : "";
  }

  try {
    const legacyUrl = new URL(rawValue);
    if (!["http:", "https:"].includes(legacyUrl.protocol)) return "";
    if (!/^\/wms-app\/packing-remoto\/?$/.test(legacyUrl.pathname)) return "";
    const stationCode = String(legacyUrl.searchParams.get("station") || "").trim().toUpperCase();
    return STATION_CODE_PATTERN.test(stationCode) ? stationCode : "";
  } catch {
    return "";
  }
}

export function printStationQrValue(code) {
  const normalized = normalizePrintStationCode(code);
  return normalized ? `${STATION_QR_PREFIX}${normalized}` : "";
}

export function printStationChannelName(code) {
  return `wms-print-${normalizePrintStationCode(code).toLowerCase()}`;
}

export function createPrintJobId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `job-${Date.now()}-${randomToken()}`;
}

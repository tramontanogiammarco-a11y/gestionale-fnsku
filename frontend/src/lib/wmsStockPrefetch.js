import { api } from "@/lib/api";
import { createTimedRequestCache } from "@/lib/timedRequestCache";

const cache = createTimedRequestCache(15_000);

function cacheKey(clientId) {
  return clientId && clientId !== "all" ? clientId : "all";
}

function stockPath(clientId) {
  const query = new URLSearchParams();
  if (clientId && clientId !== "all") query.set("cliente_id", clientId);
  const queryString = query.toString();
  return `/wms/stock${queryString ? `?${queryString}` : ""}`;
}

export function peekWmsStock(clientId = "all") {
  return cache.peek(cacheKey(clientId));
}

export function loadWmsStock(clientId = "all", { force = false } = {}) {
  const key = cacheKey(clientId);
  return cache.load(key, () => api.get(stockPath(clientId)), { force });
}

export function prefetchWmsStock(clientId = "all") {
  return loadWmsStock(clientId).catch(() => null);
}

import { api } from "@/lib/api";
import { createTimedRequestCache } from "@/lib/timedRequestCache";
import { subscribeWmsDataChange } from "@/lib/wmsDataEvents";

const cache = createTimedRequestCache(30_000);
subscribeWmsDataChange("stock", cache.clear);

function cacheKey(clientId) {
  return clientId && clientId !== "all" ? clientId : "all";
}

function stockPath(clientId) {
  const query = new URLSearchParams();
  if (clientId && clientId !== "all") query.set("cliente_id", clientId);
  const queryString = query.toString();
  return `/wms/stock${queryString ? `?${queryString}` : ""}`;
}

export function peekWmsStock(clientId = "all", { allowStale = false } = {}) {
  return cache.peek(cacheKey(clientId), { allowStale });
}

export function loadWmsStock(clientId = "all", { force = false } = {}) {
  const key = cacheKey(clientId);
  return cache.load(key, () => api.get(stockPath(clientId)), { force });
}

export function prefetchWmsStock(clientId = "all") {
  return loadWmsStock(clientId).catch(() => null);
}

export function invalidateWmsStock(clientId) {
  if (clientId) cache.invalidate(cacheKey(clientId));
  else cache.clear();
}

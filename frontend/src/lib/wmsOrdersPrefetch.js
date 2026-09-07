import { api } from "@/lib/api";
import { createTimedRequestCache } from "@/lib/timedRequestCache";
import { subscribeWmsDataChange } from "@/lib/wmsDataEvents";

const CACHE_TTL_MS = 20_000;
const cache = createTimedRequestCache(CACHE_TTL_MS);
subscribeWmsDataChange("orders", cache.clear);

function cacheKey(clientId) {
  return clientId && clientId !== "all" ? clientId : "all";
}

function ordersPath(clientId) {
  const query = new URLSearchParams();
  if (clientId && clientId !== "all") query.set("cliente_id", clientId);
  const queryString = query.toString();
  return `/wms/orders-overview${queryString ? `?${queryString}` : ""}`;
}

export function peekWmsOrders(clientId, { allowStale = false } = {}) {
  return cache.peek(cacheKey(clientId), { allowStale });
}

export function loadWmsOrders(clientId, { force = false } = {}) {
  const key = cacheKey(clientId);
  return cache.load(key, () => api.get(ordersPath(clientId)), { force });
}

export function prefetchWmsOrders(clientId) {
  return loadWmsOrders(clientId).catch(() => null);
}

export function invalidateWmsOrders(clientId) {
  if (clientId) cache.invalidate(cacheKey(clientId));
  else cache.clear();
}

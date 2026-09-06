import { api } from "@/lib/api";
import { createTimedRequestCache } from "@/lib/timedRequestCache";

const CACHE_TTL_MS = 15_000;
const cache = createTimedRequestCache(CACHE_TTL_MS);

function cacheKey(clientId) {
  return clientId && clientId !== "all" ? clientId : "all";
}

function ordersPath(clientId) {
  const query = new URLSearchParams();
  if (clientId && clientId !== "all") query.set("cliente_id", clientId);
  const queryString = query.toString();
  return `/wms/orders-overview${queryString ? `?${queryString}` : ""}`;
}

export function peekWmsOrders(clientId) {
  return cache.peek(cacheKey(clientId));
}

export function loadWmsOrders(clientId, { force = false } = {}) {
  const key = cacheKey(clientId);
  return cache.load(key, () => api.get(ordersPath(clientId)), { force });
}

export function prefetchWmsOrders(clientId) {
  return loadWmsOrders(clientId).catch(() => null);
}

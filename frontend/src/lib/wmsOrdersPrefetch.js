import { api } from "@/lib/api";

const CACHE_TTL_MS = 15_000;
const cache = new Map();

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
  const entry = cache.get(cacheKey(clientId));
  if (!entry?.response || Date.now() - entry.createdAt > CACHE_TTL_MS) return null;
  return entry.response;
}

export function loadWmsOrders(clientId, { force = false } = {}) {
  const key = cacheKey(clientId);
  const current = cache.get(key);
  if (!force && current && Date.now() - current.createdAt <= CACHE_TTL_MS) {
    if (current.response) return Promise.resolve(current.response);
    if (current.promise) return current.promise;
  }

  const promise = api.get(ordersPath(clientId)).then((response) => {
    cache.set(key, { response, createdAt: Date.now() });
    return response;
  }).catch((error) => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  });
  cache.set(key, { promise, createdAt: Date.now() });
  return promise;
}

export function prefetchWmsOrders(clientId) {
  return loadWmsOrders(clientId).catch(() => null);
}

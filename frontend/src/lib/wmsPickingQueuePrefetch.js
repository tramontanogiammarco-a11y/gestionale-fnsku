import { api } from "@/lib/api";
import { createTimedRequestCache } from "@/lib/timedRequestCache";

const cache = createTimedRequestCache(15_000);

function normalizedClientId(clientId) {
  return clientId && clientId !== "all" ? clientId : "all";
}

function cacheKey(mode, clientId) {
  return `${mode}:${normalizedClientId(clientId)}`;
}

function queuePath(mode, clientId) {
  const query = new URLSearchParams();
  if (clientId && clientId !== "all") query.set("cliente_id", clientId);
  const suffix = query.toString();
  return `/wms/picking-${mode}${suffix ? `?${suffix}` : ""}`;
}

export function peekWmsPickingQueue(mode, clientId) {
  return cache.peek(cacheKey(mode, clientId));
}

export function loadWmsPickingQueue(mode, clientId, { force = false } = {}) {
  const key = cacheKey(mode, clientId);
  return cache.load(key, () => api.get(queuePath(mode, clientId)), { force });
}

export function prefetchWmsPickingQueue(mode, clientId) {
  return loadWmsPickingQueue(mode, clientId).catch(() => null);
}

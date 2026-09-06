const controlRoutes = [
  () => import("@/pages/control/ControlOverview"),
  () => import("@/pages/control/ControlStock"),
  () => import("@/pages/control/ControlOrders"),
  () => import("@/pages/control/ControlExceptions"),
  () => import("@/pages/control/ControlShipments"),
  () => import("@/pages/control/ControlReturns"),
  () => import("@/pages/control/ControlBilling"),
  () => import("@/pages/control/ControlTickets"),
];

const adminRoutes = [
  () => import("@/pages/admin/Dashboard"),
  () => import("@/pages/admin/Entrate"),
  () => import("@/pages/admin/Referenze"),
  () => import("@/pages/admin/Magazzino"),
  () => import("@/pages/admin/Preparazioni"),
  () => import("@/pages/admin/ComposizioneBox"),
  () => import("@/pages/admin/Fatturazione"),
  () => import("@/pages/admin/Integrazioni"),
];

const clientRoutes = [
  () => import("@/pages/client/Dashboard"),
  () => import("@/pages/client/Referenze"),
  () => import("@/pages/client/Magazzino"),
  () => import("@/pages/client/Entrate"),
  () => import("@/pages/client/Preparazioni"),
  () => import("@/pages/client/Box"),
  () => import("@/pages/client/Spedizioni"),
  () => import("@/pages/client/Integrazioni"),
];

const promises = new Map();

function prefetchGroup(key, loaders) {
  if (!promises.has(key)) promises.set(key, Promise.allSettled(loaders.map((load) => load())));
  return promises.get(key);
}

export function prefetchControlRoutes() {
  return prefetchGroup("control", controlRoutes);
}

export function prefetchAdminRoutes() {
  return prefetchGroup("admin", adminRoutes);
}

export function prefetchClientRoutes() {
  return prefetchGroup("client", clientRoutes);
}

export function scheduleRoutePrefetch(prefetch, delay = 800) {
  if (navigator.connection?.saveData) return () => {};
  const run = () => prefetch();
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: delay });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, delay);
  return () => window.clearTimeout(id);
}

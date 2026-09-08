const routeLoaders = {
  dashboard: () => import("@/pages/wms/WmsAppDashboard"),
  home: () => import("@/pages/wms/WmsAppHome"),
  orders: () => import("@/pages/wms/WmsAppOrders"),
  stock: () => import("@/pages/wms/WmsAppLocations"),
  packing: () => import("@/layouts/WmsPackingStationLayout"),
  inbound: () => import("@/pages/wms/WmsAppInbound"),
  picking: () => import("@/pages/wms/WmsAppPicking"),
  massPicking: () => import("@/pages/wms/WmsAppMassPicking"),
  galluse: () => import("@/pages/wms/WmsAppGalluse"),
  refill: () => import("@/pages/wms/WmsAppRefill"),
  stockMovement: () => import("@/pages/wms/WmsAppStockMovement"),
  productSearch: () => import("@/pages/wms/WmsAppProductSearch"),
  inventory: () => import("@/pages/wms/WmsAppInventory"),
  inventoryCount: () => import("@/pages/wms/WmsAppInventoryCount"),
  bagHistory: () => import("@/pages/wms/WmsAppBagHistory"),
  tools: () => import("@/pages/wms/WmsAppTools"),
  settings: () => import("@/pages/wms/WmsAppSettings"),
  cartBags: () => import("@/pages/wms/WmsAppCartBags"),
  packagingLabels: () => import("@/pages/wms/WmsAppPackagingLabels"),
  packingRemote: () => import("@/pages/wms/WmsAppPackingRemote"),
};

const primaryRoutes = ["dashboard", "home", "orders", "stock", "packingRemote"];
const operationalRoutes = ["inbound", "picking", "massPicking", "galluse", "refill", "stockMovement", "productSearch", "inventory"];
const secondaryRoutes = ["inventoryCount", "bagHistory", "tools", "settings", "cartBags", "packagingLabels", "packing"];
const routePromises = new Map();

export function prefetchWmsRoute(name) {
  const loader = routeLoaders[name];
  if (!loader) return Promise.resolve(null);
  if (routePromises.has(name)) return routePromises.get(name);
  const promise = loader().catch(() => {
    routePromises.delete(name);
    return null;
  });
  routePromises.set(name, promise);
  return promise;
}

function prefetchRoutes(names) {
  return Promise.allSettled(names.map(prefetchWmsRoute));
}

export function prefetchPrimaryWmsRoutes() {
  return prefetchRoutes(primaryRoutes);
}

export function prefetchOperationalWmsRoutes() {
  return prefetchRoutes(operationalRoutes);
}

export function prefetchSecondaryWmsRoutes() {
  return prefetchRoutes(secondaryRoutes);
}

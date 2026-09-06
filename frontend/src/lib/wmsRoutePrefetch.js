const primaryRoutes = [
  () => import("@/pages/wms/WmsAppDashboard"),
  () => import("@/pages/wms/WmsAppHome"),
  () => import("@/pages/wms/WmsAppOrders"),
  () => import("@/pages/wms/WmsAppLocations"),
  () => import("@/layouts/WmsPackingStationLayout"),
];

const operationalRoutes = [
  () => import("@/pages/wms/WmsAppInbound"),
  () => import("@/pages/wms/WmsAppPicking"),
  () => import("@/pages/wms/WmsAppMassPicking"),
  () => import("@/pages/wms/WmsAppGalluse"),
  () => import("@/pages/wms/WmsAppRefill"),
  () => import("@/pages/wms/WmsAppStockMovement"),
  () => import("@/pages/wms/WmsAppProductSearch"),
  () => import("@/pages/wms/WmsAppInventory"),
];

const secondaryRoutes = [
  () => import("@/pages/wms/WmsAppInventoryCount"),
  () => import("@/pages/wms/WmsAppBagHistory"),
  () => import("@/pages/wms/WmsAppTools"),
  () => import("@/pages/wms/WmsAppSettings"),
  () => import("@/pages/wms/WmsAppCartBags"),
  () => import("@/pages/wms/WmsAppPackagingLabels"),
  () => import("@/pages/wms/WmsAppPackingRemote"),
];

let primaryPromise;
let operationalPromise;
let secondaryPromise;

export function prefetchPrimaryWmsRoutes() {
  primaryPromise ||= Promise.allSettled(primaryRoutes.map((load) => load()));
  return primaryPromise;
}

export function prefetchOperationalWmsRoutes() {
  operationalPromise ||= Promise.allSettled(operationalRoutes.map((load) => load()));
  return operationalPromise;
}

export function prefetchSecondaryWmsRoutes() {
  secondaryPromise ||= Promise.allSettled(secondaryRoutes.map((load) => load()));
  return secondaryPromise;
}

const WMS_DATA_CHANGED = "aimago:wms-data-changed";

export function announceWmsDataChange(scopes = []) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(WMS_DATA_CHANGED, {
    detail: { scopes: [...new Set(scopes)] },
  }));
}

export function subscribeWmsDataChange(scope, listener) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const handleChange = (event) => {
    const scopes = event.detail?.scopes || [];
    if (scopes.includes("all") || scopes.includes(scope)) listener();
  };
  window.addEventListener(WMS_DATA_CHANGED, handleChange);
  return () => window.removeEventListener(WMS_DATA_CHANGED, handleChange);
}

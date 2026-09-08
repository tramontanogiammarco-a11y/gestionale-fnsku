const SOURCE_PREFIXES = {
  "csv-import": "CSV",
  "manual-entry": "MAN",
};

export function formatEcommerceOrderReference(order = {}) {
  const rawOrderName = String(order.order_name || order.ecommerce_order_number || "").trim();
  if (!rawOrderName) return "ORDINE";

  const shopDomain = String(order.shop_domain || order.order_source || "").trim().toLowerCase();
  const prefix = SOURCE_PREFIXES[shopDomain]
    || (shopDomain.endsWith(".myshopify.com") ? "SHP" : shopDomain.endsWith(".aimago.local") ? "WMS" : shopDomain ? "SHP" : "ORD");
  const cleanOrderName = rawOrderName.replace(/^#/, "").trim();
  const alreadyPrefixed = new RegExp(`^${prefix}(?:[\\s:_-]+|$)`, "i").test(cleanOrderName);
  const reference = alreadyPrefixed ? cleanOrderName : `${prefix} ${cleanOrderName}`;
  return reference.slice(0, 42).trim();
}

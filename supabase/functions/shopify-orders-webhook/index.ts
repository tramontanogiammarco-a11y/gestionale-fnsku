import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ShopifyWebhookOrder = {
  id: number | string;
  name?: string;
  email?: string;
  phone?: string;
  financial_status?: string;
  fulfillment_status?: string;
  processed_at?: string;
  created_at?: string;
  cancelled_at?: string | null;
  tags?: string;
  note?: string | null;
  total_price?: string;
  currency?: string;
  shipping_address?: Record<string, string | null> | null;
  line_items?: Array<Record<string, unknown>>;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, detail: "Metodo non consentito" }, 405);
  const rawBody = await req.text();
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";
  const signature = req.headers.get("x-shopify-hmac-sha256") || "";
  if (!secret || !(await verifyWebhook(rawBody, signature, secret))) {
    return json({ ok: false, detail: "Firma Shopify non valida" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Configurazione Supabase mancante");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const shopDomain = normalizeShop(req.headers.get("x-shopify-shop-domain") || "");
    const payload = JSON.parse(rawBody) as ShopifyWebhookOrder;
    const { data: connection, error: connectionError } = await admin
      .from("shopify_connections")
      .select("cliente_id,access_token")
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.cliente_id) return json({ ok: true, ignored: "shop_not_connected" });

    const shopifyOrderId = `gid://shopify/Order/${payload.id}`;
    const { data: existing, error: existingError } = await admin
      .from("shopify_orders")
      .select("id,wms_status")
      .eq("cliente_id", connection.cliente_id)
      .eq("shop_domain", shopDomain)
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();
    if (existingError) throw existingError;

    const shipping = payload.shipping_address || {};
    const orderRow = {
      cliente_id: connection.cliente_id,
      shop_domain: shopDomain,
      shopify_order_id: shopifyOrderId,
      order_name: payload.name || String(payload.id),
      financial_status: payload.financial_status || null,
      fulfillment_status: payload.fulfillment_status || null,
      customer_email: payload.email || null,
      customer_phone: payload.phone || shipping.phone || null,
      ship_name: shipping.name || null,
      ship_company: shipping.company || null,
      ship_address1: shipping.address1 || null,
      ship_address2: shipping.address2 || null,
      ship_zip: shipping.zip || null,
      ship_city: shipping.city || null,
      ship_province: shipping.province || null,
      ship_country: shipping.country || null,
      ship_country_code: shipping.country_code || null,
      total_price: payload.total_price ? Number(payload.total_price) : null,
      currency: payload.currency || null,
      processed_at: payload.processed_at || payload.created_at || null,
      tags: String(payload.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      note: payload.note || null,
      raw: payload,
      updated_at: new Date().toISOString(),
      ...(!existing ? { wms_status: "in_verifica", gate_status: "da_verificare" } : {}),
    };
    const { data: savedOrder, error: orderError } = await admin
      .from("shopify_orders")
      .upsert(orderRow, { onConflict: "cliente_id,shop_domain,shopify_order_id" })
      .select("id,wms_status")
      .single();
    if (orderError || !savedOrder) throw orderError || new Error("Ordine non salvato");

    // Dopo l'avvio del picking le righe restano congelate per non cambiare una missione in corso.
    if (!existing || ["in_verifica", "eccezione", "da_preparare"].includes(existing.wms_status)) {
      const referenceMap = await buildReferenceMap(admin, connection.cliente_id);
      const itemIds: string[] = [];
      for (const item of payload.line_items || []) {
        const itemId = `gid://shopify/LineItem/${item.id}`;
        const sku = clean(item.sku);
        const ean = clean(item.barcode) || await fetchVariantBarcode(shopDomain, clean(connection.access_token), item.variant_id);
        itemIds.push(itemId);
        const { error: itemError } = await admin.from("shopify_order_items").upsert({
          order_id: savedOrder.id,
          shopify_line_item_id: itemId,
          referenza_id: (ean && referenceMap.byEan.get(ean)) || (sku && referenceMap.bySku.get(sku)) || null,
          sku: sku || null,
          ean: ean || null,
          titolo: clean(item.title) || sku || ean || "Riga Shopify",
          quantita: Math.max(1, Number(item.quantity || 0)),
          fulfillable_quantity: Math.max(0, Number(item.fulfillable_quantity ?? item.quantity ?? 0)),
          fulfillment_status: clean(item.fulfillment_status) || null,
          raw: item,
          updated_at: new Date().toISOString(),
        }, { onConflict: "order_id,shopify_line_item_id" });
        if (itemError) throw itemError;
      }
      const { data: savedItems, error: savedItemsError } = await admin.from("shopify_order_items").select("id,shopify_line_item_id").eq("order_id", savedOrder.id);
      if (savedItemsError) throw savedItemsError;
      const staleIds = (savedItems || []).filter((item) => !itemIds.includes(item.shopify_line_item_id)).map((item) => item.id);
      if (staleIds.length) {
        const { error: deleteError } = await admin.from("shopify_order_items").delete().in("id", staleIds);
        if (deleteError) throw deleteError;
      }
    }

    if (payload.cancelled_at && (!existing || ["in_verifica", "eccezione", "da_preparare"].includes(existing.wms_status))) {
      await admin.from("shopify_orders").update({ wms_status: "annullato", gate_status: "ignorato", updated_at: new Date().toISOString() }).eq("id", savedOrder.id);
    }
    return json({ ok: true, order_id: savedOrder.id });
  } catch (error) {
    console.error("shopify-orders-webhook", error);
    return json({ ok: false, detail: error instanceof Error ? error.message : "Errore webhook Shopify" }, 500);
  }
});

async function buildReferenceMap(admin: ReturnType<typeof createClient>, clienteId: string) {
  const { data, error } = await admin.from("referenze").select("id,ean,sku").eq("cliente_id", clienteId);
  if (error) throw error;
  const byEan = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const row of data || []) {
    if (clean(row.ean)) byEan.set(clean(row.ean), row.id);
    if (clean(row.sku)) bySku.set(clean(row.sku), row.id);
  }
  return { byEan, bySku };
}

async function fetchVariantBarcode(shopDomain: string, token: string, variantId: unknown) {
  const id = clean(variantId);
  if (!id || !token) return "";
  const response = await fetch(`https://${shopDomain}/admin/api/2026-07/variants/${id}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok) return "";
  const body = await response.json().catch(() => ({}));
  return clean(body.variant?.barcode);
}

async function verifyWebhook(body: string, provided: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return timingSafeEqual(expected, provided);
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function normalizeShop(value: string) { return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase(); }
function clean(value: unknown) { return String(value || "").trim(); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

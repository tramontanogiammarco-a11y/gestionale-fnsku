import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  cliente_id: string;
  shop_domain: string;
  dry_run?: boolean;
};

type ShopifyLineItem = {
  id: string;
  title?: string | null;
  quantity?: number | null;
  fulfillableQuantity?: number | null;
  fulfillmentStatus?: string | null;
  sku?: string | null;
  variant?: {
    sku?: string | null;
    barcode?: string | null;
  } | null;
};

type ShopifyOrder = {
  id: string;
  name?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  processedAt?: string | null;
  createdAt?: string | null;
  note?: string | null;
  tags?: string[];
  totalPriceSet?: {
    shopMoney?: {
      amount?: string | null;
      currencyCode?: string | null;
    } | null;
  } | null;
  lineItems?: { nodes?: ShopifyLineItem[] };
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
    if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ detail: "Variabili Supabase mancanti" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ detail: "Non autenticato" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ detail: "Sessione non valida" }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !["admin", "staff"].includes(profile?.role)) {
      return json({ detail: "Accesso riservato allo staff" }, 403);
    }

    const payload: Payload = await req.json().catch(() => ({ cliente_id: "", shop_domain: "" }));
    const clienteId = String(payload.cliente_id || "").trim();
    const shopDomain = normalizeShopDomain(payload.shop_domain);
    if (!clienteId || !shopDomain) return json({ detail: "Cliente e dominio Shopify sono obbligatori" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: cliente, error: clienteError } = await adminClient
      .from("clienti")
      .select("id,ragione_sociale")
      .eq("id", clienteId)
      .single();
    if (clienteError || !cliente) return json({ detail: "Cliente non trovato" }, 404);

    const { data: connection, error: connectionError } = await adminClient
      .from("shopify_connections")
      .select("access_token,scopes")
      .eq("cliente_id", clienteId)
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (connectionError) return json({ detail: connectionError.message }, 400);

    const token = String(connection?.access_token || "");
    if (!token) return json({ detail: "Collega Shopify prima di importare gli ordini" }, 400);
    if (!Array.isArray(connection?.scopes) || !connection.scopes.includes("read_orders")) {
      return json({ detail: "Aggiungi lo scope read_orders su Shopify e ricollega l'app" }, 400);
    }

    const shopifyOrders = await fetchShopifyOrders(shopDomain, token);
    const referenceMap = await buildReferenceMap(adminClient, clienteId);
    const mapped = shopifyOrders.map((order) => mapOrder(order, clienteId, shopDomain, referenceMap));

    if (payload.dry_run) {
      return json({
        ok: true,
        dry_run: true,
        shop_domain: shopDomain,
        cliente: cliente.ragione_sociale,
        ordini: mapped.length,
        righe: mapped.reduce((sum, order) => sum + order.items.length, 0),
        righe_collegate: mapped.reduce((sum, order) => sum + order.items.filter((item) => item.referenza_id).length, 0),
        anteprima: mapped.slice(0, 8).map(({ items, ...order }) => ({ ...order, righe: items.length })),
      });
    }

    let create = 0;
    let update = 0;
    let itemCount = 0;
    const errors: string[] = [];

    for (const order of mapped) {
      const { items, ...orderRow } = order;
      const { data: savedOrder, error: orderError } = await adminClient
        .from("shopify_orders")
        .upsert(orderRow, { onConflict: "cliente_id,shop_domain,shopify_order_id" })
        .select("id,created_at,updated_at")
        .single();
      if (orderError || !savedOrder) {
        errors.push(`${order.order_name}: ${orderError?.message || "ordine non salvato"}`);
        continue;
      }

      const wasCreated = savedOrder.created_at === savedOrder.updated_at;
      if (wasCreated) create += 1;
      else update += 1;

      for (const item of items) {
        const { error: itemError } = await adminClient
          .from("shopify_order_items")
          .upsert({ ...item, order_id: savedOrder.id }, { onConflict: "order_id,shopify_line_item_id" });
        if (itemError) errors.push(`${order.order_name} / ${item.titolo}: ${itemError.message}`);
        else itemCount += 1;
      }
    }

    return json({
      ok: errors.length === 0,
      shop_domain: shopDomain,
      cliente: cliente.ragione_sociale,
      create,
      update,
      righe: itemCount,
      errori: errors.slice(0, 20),
    });
  } catch (error) {
    console.error("shopify-import-orders", error);
    return json({ detail: error instanceof Error ? error.message : "Errore import ordini Shopify" }, 500);
  }
});

function normalizeShopDomain(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

async function fetchShopifyOrders(shopDomain: string, token: string) {
  const endpoint = `https://${shopDomain}/admin/api/2026-07/graphql.json`;
  const query = `
    query OrdersForWms($cursor: String) {
      orders(first: 50, after: $cursor, sortKey: PROCESSED_AT, reverse: true, query: "status:any") {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          displayFinancialStatus
          displayFulfillmentStatus
          processedAt
          createdAt
          note
          tags
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 100) {
            nodes {
              id
              title
              quantity
              fulfillableQuantity
              fulfillmentStatus
              sku
              variant { sku barcode }
            }
          }
        }
      }
    }
  `;
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.errors?.length) {
      const msg = body.errors?.[0]?.message || body.errors?.[0]?.extensions?.code || `Shopify HTTP ${response.status}`;
      throw new Error(`Shopify ordini: ${msg}`);
    }

    orders.push(...(body.data?.orders?.nodes || []));
    cursor = body.data?.orders?.pageInfo?.hasNextPage ? body.data.orders.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < 8);

  return orders;
}

async function buildReferenceMap(adminClient: ReturnType<typeof createClient>, clienteId: string) {
  const { data, error } = await adminClient
    .from("referenze")
    .select("id,ean,sku")
    .eq("cliente_id", clienteId);
  if (error) throw new Error(error.message);

  const byEan = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const row of data || []) {
    if (row.ean) byEan.set(String(row.ean).trim(), row.id);
    if (row.sku) bySku.set(String(row.sku).trim(), row.id);
  }
  return { byEan, bySku };
}

function mapOrder(
  order: ShopifyOrder,
  clienteId: string,
  shopDomain: string,
  referenceMap: { byEan: Map<string, string>; bySku: Map<string, string> },
) {
  const items = (order.lineItems?.nodes || []).map((item) => {
    const sku = String(item.variant?.sku || item.sku || "").trim();
    const ean = String(item.variant?.barcode || "").trim();
    return {
      shopify_line_item_id: item.id,
      referenza_id: (ean && referenceMap.byEan.get(ean)) || (sku && referenceMap.bySku.get(sku)) || null,
      sku: sku || null,
      ean: ean || null,
      titolo: String(item.title || sku || ean || "Riga Shopify"),
      quantita: Math.max(1, Number(item.quantity || 0)),
      fulfillable_quantity: Math.max(0, Number(item.fulfillableQuantity || 0)),
      fulfillment_status: item.fulfillmentStatus || null,
      raw: item,
      updated_at: new Date().toISOString(),
    };
  });

  return {
    cliente_id: clienteId,
    shop_domain: shopDomain,
    shopify_order_id: order.id,
    order_name: order.name || order.id,
    financial_status: order.displayFinancialStatus || null,
    fulfillment_status: order.displayFulfillmentStatus || null,
    total_price: order.totalPriceSet?.shopMoney?.amount ? Number(order.totalPriceSet.shopMoney.amount) : null,
    currency: order.totalPriceSet?.shopMoney?.currencyCode || null,
    processed_at: order.processedAt || order.createdAt || null,
    tags: order.tags || [],
    note: order.note || null,
    raw: order,
    updated_at: new Date().toISOString(),
    items,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function corsHeadersFor(req: Request) {
  return {
    ...corsHeaders,
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") || corsHeaders["Access-Control-Allow-Headers"],
  };
}

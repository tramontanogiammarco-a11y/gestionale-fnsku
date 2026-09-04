import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  cliente_id: string;
  shop_domain: string;
  access_token?: string;
  dry_run?: boolean;
};

type ShopifyVariant = {
  id?: string | null;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | null;
  inventoryQuantity?: number | null;
  image?: { url?: string | null } | null;
};

type ShopifyProduct = {
  title?: string | null;
  vendor?: string | null;
  status?: string | null;
  featuredImage?: { url?: string | null } | null;
  media?: { nodes?: Array<{ preview?: { image?: { url?: string | null } | null } | null }> };
  variants?: { nodes?: ShopifyVariant[] };
};

Deno.serve(async (req) => {
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
    .select("role,cliente_id,is_operator,operator_active")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !["admin", "staff", "cliente"].includes(profile?.role)) {
    return json({ detail: "Profilo non autorizzato" }, 403);
  }
  if (profile.is_operator && profile.operator_active === false) return json({ detail: "Account operatore disattivato" }, 403);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch (_) {
    return json({ detail: "JSON non valido" }, 400);
  }

  const requestedClienteId = String(payload.cliente_id || "").trim();
  const clienteId = profile.role === "cliente" ? String(profile.cliente_id || "") : requestedClienteId;
  const shopDomain = normalizeShopDomain(payload.shop_domain);
  let token = String(payload.access_token || "").trim();
  if (!clienteId || !shopDomain) {
    return json({ detail: "Cliente e shop domain sono obbligatori" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: cliente, error: clienteError } = await adminClient
    .from("clienti")
    .select("id,ragione_sociale")
    .eq("id", clienteId)
    .single();
  if (clienteError || !cliente) return json({ detail: "Cliente non trovato" }, 404);

  if (!token) {
    const { data: connection, error: connectionError } = await adminClient
      .from("shopify_connections")
      .select("access_token")
      .eq("cliente_id", clienteId)
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (connectionError) return json({ detail: connectionError.message }, 400);
    token = String(connection?.access_token || "");
  }

  if (!token) {
    return json({ detail: "Collega Shopify prima di importare le referenze" }, 400);
  }

  let imported: Awaited<ReturnType<typeof fetchShopifyVariants>>;
  try {
    imported = await fetchShopifyVariants(shopDomain, token);
  } catch (error) {
    return json({ detail: error instanceof Error ? error.message : "Errore Shopify" }, 400);
  }
  const rows = imported.rows.map((row) => ({ ...row, cliente_id: clienteId }));
  const withoutBarcode = imported.withoutBarcode;

  if (payload.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      shop_domain: shopDomain,
      cliente: cliente.ragione_sociale,
      trovate: rows.length,
      senza_barcode: withoutBarcode.length,
      anteprima: rows.slice(0, 10),
    });
  }

  const { data: existing, error: existingError } = await adminClient
    .from("referenze")
    .select("id,ean,sku,foto_url")
    .eq("cliente_id", clienteId);
  if (existingError) return json({ detail: existingError.message }, 400);

  const byEan = new Map((existing || []).map((r) => [String(r.ean || "").trim(), r]));
  const bySku = new Map((existing || []).filter((r) => r.sku).map((r) => [String(r.sku || "").trim(), r]));
  let create = 0;
  let update = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const existingRow = byEan.get(row.ean) || (row.sku ? bySku.get(row.sku) : null);
    if (existingRow) {
      const { error } = await adminClient
        .from("referenze")
        .update({
          ean: row.ean,
          sku: row.sku,
          titolo: row.titolo,
          // Shopify is the default source, but a manually uploaded photo must never be erased
          // when the connected product has no media yet.
          foto_url: row.foto_url || existingRow.foto_url || null,
          origine: "shopify",
        })
        .eq("id", existingRow.id);
      if (error) errors.push(`${row.ean}: ${error.message}`);
      else update += 1;
    } else {
      const { error } = await adminClient.from("referenze").insert(row);
      if (error) errors.push(`${row.ean}: ${error.message}`);
      else create += 1;
    }
  }

  return json({
    ok: errors.length === 0,
    shop_domain: shopDomain,
    cliente: cliente.ragione_sociale,
    create,
    update,
    senza_barcode: withoutBarcode.length,
    errori: errors.slice(0, 20),
  });
});

function normalizeShopDomain(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

async function fetchShopifyVariants(shopDomain: string, token: string) {
  const endpoint = `https://${shopDomain}/admin/api/2026-07/graphql.json`;
  const query = `
    query ProductsForWms($cursor: String) {
      products(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          title
          vendor
          status
          featuredImage { url }
          media(first: 1) {
            nodes {
              preview { image { url } }
            }
          }
          variants(first: 100) {
            nodes {
              id
              title
              sku
              barcode
              price
              inventoryQuantity
              image { url }
            }
          }
        }
      }
    }
  `;
  const rows: Array<Record<string, unknown>> = [];
  const withoutBarcode: Array<Record<string, unknown>> = [];
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
      throw new Error(`Shopify: ${msg}`);
    }

    const products: ShopifyProduct[] = body.data?.products?.nodes || [];
    for (const product of products) {
      const galleryImage = product.media?.nodes
        ?.map((media) => media.preview?.image?.url || null)
        .find(Boolean) || null;
      for (const variant of product.variants?.nodes || []) {
        const barcode = String(variant.barcode || "").trim();
        const sku = String(variant.sku || "").trim();
        const title = [product.title, variant.title && variant.title !== "Default Title" ? variant.title : ""]
          .filter(Boolean)
          .join(" · ");
        const variantId = String(variant.id || "").trim().split("/").pop();
        const catalogCode = barcode || sku || (variantId ? `SHOPIFY-${variantId}` : "");
        if (!catalogCode) continue;
        if (!barcode) withoutBarcode.push({ titolo: title, sku, codice: catalogCode });
        rows.push({
          // The ean field is the WMS product key. Shopify variants without a
          // barcode use their SKU or a stable Shopify fallback instead.
          ean: catalogCode,
          sku: sku || null,
          asin: null,
          titolo: title || catalogCode,
          foto_url: variant.image?.url || product.featuredImage?.url || galleryImage,
          fnsku: null,
          is_bundle: false,
          componenti: [],
          origine: "shopify",
        });
      }
    }

    cursor = body.data?.products?.pageInfo?.hasNextPage ? body.data.products.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < 40);

  return { rows, withoutBarcode };
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

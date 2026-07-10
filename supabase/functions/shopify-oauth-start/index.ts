import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCOPES = ["read_products", "read_inventory", "read_locations"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  const redirectUri = Deno.env.get("SHOPIFY_REDIRECT_URI") || `${supabaseUrl}/functions/v1/shopify-oauth-callback`;

  if (!supabaseUrl || !anonKey || !clientId || !clientSecret) {
    return json({ detail: "Config Shopify/Supabase mancante nelle variabili Supabase" }, 500);
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

  const payload = await req.json().catch(() => ({}));
  const clienteId = String(payload.cliente_id || "").trim();
  const shopDomain = normalizeShopDomain(payload.shop_domain);
  if (!clienteId || !shopDomain) return json({ detail: "Cliente e dominio Shopify sono obbligatori" }, 400);
  if (!shopDomain.endsWith(".myshopify.com")) {
    return json({ detail: "Usa il dominio myshopify.com del negozio" }, 400);
  }

  const state = await signState(
    {
      cliente_id: clienteId,
      shop_domain: shopDomain,
      user_id: authData.user.id,
      exp: Date.now() + 10 * 60 * 1000,
      nonce: crypto.randomUUID(),
    },
    clientSecret,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });
  const authorize_url = `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;

  return json({ ok: true, authorize_url, redirect_uri, scopes: SCOPES, shop_domain: shopDomain });
});

function normalizeShopDomain(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

async function signState(payload: Record<string, unknown>, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacHex(body, secret);
  return `${body}.${signature}`;
}

async function hmacHex(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

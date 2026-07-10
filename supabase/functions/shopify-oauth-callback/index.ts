import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return html("Metodo non consentito", false, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://gestionale-fnsku-web.vercel.app";

  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return html("Config Shopify/Supabase mancante nelle variabili Supabase", false, 500);
  }

  const url = new URL(req.url);
  const shopDomain = normalizeShopDomain(url.searchParams.get("shop") || "");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const hmac = url.searchParams.get("hmac") || "";
  const error = url.searchParams.get("error");

  if (error) return html(`Shopify ha negato il collegamento: ${error}`, false, 400);
  if (!shopDomain || !code || !state || !hmac) return html("Parametri Shopify incompleti", false, 400);

  const hmacOk = await verifyShopifyHmac(url.searchParams, clientSecret);
  if (!hmacOk) return html("Firma Shopify non valida", false, 403);

  const statePayload = await verifyState(state, clientSecret).catch(() => null);
  if (!statePayload) return html("Sessione Shopify scaduta o non valida", false, 403);
  if (Date.now() > Number(statePayload.exp || 0)) return html("Sessione Shopify scaduta", false, 403);
  if (normalizeShopDomain(String(statePayload.shop_domain || "")) !== shopDomain) {
    return html("Dominio Shopify non coerente", false, 403);
  }

  const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.access_token) {
    const message = tokenBody.error_description || tokenBody.error || `HTTP ${tokenResponse.status}`;
    return html(`Shopify non ha restituito il token: ${message}`, false, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const clienteId = String(statePayload.cliente_id || "");
  const connectedBy = String(statePayload.user_id || "");
  const scopes = String(tokenBody.scope || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const { error: upsertError } = await supabase.from("shopify_connections").upsert(
    {
      cliente_id: clienteId,
      shop_domain: shopDomain,
      access_token: tokenBody.access_token,
      scopes,
      connected_by: connectedBy || null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cliente_id,shop_domain" },
  );
  if (upsertError) return html(`Token ricevuto, ma salvataggio fallito: ${upsertError.message}`, false, 400);

  const redirect = new URL("/admin/integrazioni", frontendUrl);
  redirect.searchParams.set("shopify", "connected");
  redirect.searchParams.set("shop", shopDomain);
  return Response.redirect(redirect.toString(), 302);
});

function normalizeShopDomain(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

async function verifyShopifyHmac(params: URLSearchParams, secret: string) {
  const provided = params.get("hmac") || "";
  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  const digest = await hmacHex(entries.join("&"), secret);
  return timingSafeEqual(digest, provided);
}

async function verifyState(state: string, secret: string) {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("state non valido");
  const expected = await hmacHex(body, secret);
  if (!timingSafeEqual(expected, signature)) throw new Error("firma state non valida");
  return JSON.parse(base64UrlDecode(body));
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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function html(message: string, ok = true, status = 200) {
  const color = ok ? "#0f766e" : "#dc2626";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Shopify</title></head><body style="font-family:system-ui;margin:48px"><h1 style="color:${color}">${escapeHtml(message)}</h1><p>Puoi tornare al gestionale.</p></body></html>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char] || char));
}

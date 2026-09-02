import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateWmsOrderGate } from "../_shared/wmsOrderGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const editableStatuses = new Set(["in_verifica", "eccezione", "in_attesa_refill", "da_preparare"]);
const holdableStatuses = new Set(["in_verifica", "eccezione", "in_attesa_refill", "da_preparare"]);
const resumableStatuses = new Set(["in_verifica", "eccezione", "in_attesa_refill", "da_preparare"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return json({ detail: "Configurazione Supabase mancante" }, 500);
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) return json({ detail: "Sessione non valida" }, 401);
  const { data: profile, error: profileError } = await userClient.from("profiles").select("role,cliente_id").eq("id", authData.user.id).single();
  if (profileError || !["admin", "staff", "cliente"].includes(profile?.role)) return json({ detail: "Profilo non autorizzato" }, 403);

  const payload = await req.json().catch(() => ({}));
  const orderId = String(payload.order_id || "").trim();
  const action = String(payload.action || "").trim().toLowerCase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!orderId) return json({ detail: "Ordine non indicato" }, 400);
  const admin = createClient(url, service);
  const { data: order, error: orderError } = await admin.from("shopify_orders").select("id,cliente_id,wms_status,gate_status,order_name,hold_previous_status,hold_previous_gate_status").eq("id", orderId).single();
  if (orderError || !order) return json({ detail: "Ordine non trovato" }, 404);
  if (profile.role === "cliente" && order.cliente_id !== profile.cliente_id) return json({ detail: "Ordine non appartenente al cliente" }, 403);

  if (action === "hold") {
    if (!holdableStatuses.has(order.wms_status)) return json({ detail: "Puoi mettere in HOLD l'ordine soltanto prima dell'inizio del picking" }, 409);
    const now = new Date().toISOString();
    const { error: holdError } = await admin.from("shopify_orders").update({
      wms_status: "hold",
      gate_status: "hold_cliente",
      hold_previous_status: order.wms_status,
      hold_previous_gate_status: order.gate_status,
      held_at: now,
      held_by: authData.user.id,
      updated_at: now,
    }).eq("id", order.id);
    if (holdError) return json({ detail: holdError.message }, 400);
    return json({ ok: true, order_id: order.id, order_name: order.order_name, wms_status: "hold" });
  }

  if (action === "release_hold") {
    if (order.wms_status !== "hold") return json({ detail: "Questo ordine non è in HOLD" }, 409);
    const previousStatus = resumableStatuses.has(order.hold_previous_status) ? order.hold_previous_status : "in_verifica";
    const previousGateStatus = order.hold_previous_gate_status || (previousStatus === "da_preparare" ? "sbloccato" : "da_verificare");
    const now = new Date().toISOString();
    const { error: releaseError } = await admin.from("shopify_orders").update({
      wms_status: previousStatus,
      gate_status: previousGateStatus,
      hold_previous_status: null,
      hold_previous_gate_status: null,
      held_at: null,
      held_by: null,
      updated_at: now,
    }).eq("id", order.id);
    if (releaseError) return json({ detail: releaseError.message }, 400);
    return json({ ok: true, order_id: order.id, order_name: order.order_name, wms_status: previousStatus });
  }

  if (action === "cancel") {
    if (![...editableStatuses, "hold"].includes(order.wms_status)) return json({ detail: "Puoi annullare l'ordine soltanto prima dell'inizio del picking" }, 409);
    const now = new Date().toISOString();
    const { error: cancelError } = await admin.from("shopify_orders").update({
      wms_status: "annullato",
      gate_status: "ignorato",
      exception_type: null,
      exception_reasons: [],
      stock_shortages: [],
      refill_requirements: [],
      updated_at: now,
    }).eq("id", order.id);
    if (cancelError) return json({ detail: cancelError.message }, 400);
    return json({ ok: true, order_id: order.id, order_name: order.order_name, wms_status: "annullato" });
  }

  if (!items.length) return json({ detail: "Inserisci almeno un prodotto" }, 400);
  if (!editableStatuses.has(order.wms_status)) return json({ detail: "Il picking è già iniziato: apri un ticket per richiedere la modifica" }, 409);

  const referenceIds = [...new Set(items.map((item: any) => String(item.referenza_id || "")).filter(Boolean))];
  if (referenceIds.length !== items.length) return json({ detail: "Seleziona una referenza per ogni riga" }, 400);
  const invalidQuantity = items.find((item: any) => !Number.isInteger(Number(item.quantita)) || Number(item.quantita) <= 0);
  if (invalidQuantity) return json({ detail: "Le quantità devono essere numeri interi maggiori di zero" }, 400);
  const { data: references, error: referencesError } = await admin.from("referenze").select("id,titolo,ean,sku,fnsku").eq("cliente_id", order.cliente_id).in("id", referenceIds);
  if (referencesError) return json({ detail: referencesError.message }, 400);
  if ((references || []).length !== referenceIds.length) return json({ detail: "Una o più referenze non appartengono al cliente" }, 403);
  const referenceMap = new Map((references || []).map((reference) => [reference.id, reference]));
  const now = new Date().toISOString();
  const updates = {
    ship_name: text(payload.ship_name), ship_company: text(payload.ship_company), ship_address1: text(payload.ship_address1),
    ship_address2: text(payload.ship_address2), ship_zip: text(payload.ship_zip), ship_city: text(payload.ship_city),
    ship_province: text(payload.ship_province), ship_country: text(payload.ship_country), ship_country_code: text(payload.ship_country_code) || "IT",
    customer_phone: text(payload.customer_phone), customer_email: text(payload.customer_email), note: text(payload.note),
    wms_status: "in_verifica", gate_status: "da_verificare", exception_type: null, exception_reasons: [], address_validation: {}, stock_shortages: [], gate_checked_at: null, updated_at: now,
  };
  const { error: updateError } = await admin.from("shopify_orders").update(updates).eq("id", order.id);
  if (updateError) return json({ detail: updateError.message }, 400);
  const { error: deleteError } = await admin.from("shopify_order_items").delete().eq("order_id", order.id);
  if (deleteError) return json({ detail: deleteError.message }, 400);
  const rows = items.map((item: any, index: number) => {
    const reference: any = referenceMap.get(String(item.referenza_id));
    const quantity = Number(item.quantita);
    return { order_id: order.id, shopify_line_item_id: `manual-edit:${index + 1}:${reference.id}`, referenza_id: reference.id, sku: reference.sku, ean: reference.ean, titolo: reference.titolo, quantita: quantity, fulfillable_quantity: quantity, fulfillment_status: null, raw: { source: "client_edit", edited_by: authData.user.id, fnsku: reference.fnsku || null }, updated_at: now };
  });
  const { error: insertError } = await admin.from("shopify_order_items").insert(rows);
  if (insertError) return json({ detail: insertError.message }, 400);
  try {
    const checked = await evaluateWmsOrderGate(admin, order.id, authData.user.id);
    return json({ ok: true, order_id: order.id, order_name: order.order_name, items: rows.length, wms_status: checked.wms_status, gate_status: checked.gate_status });
  } catch (error) {
    return json({ detail: `Ordine aggiornato ma controllo automatico non riuscito: ${error instanceof Error ? error.message : "errore sconosciuto"}` }, 500);
  }
});

function text(value: unknown) { const normalized = String(value || "").trim(); return normalized || null; }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateWmsOrderGate } from "../_shared/wmsOrderGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const aliases: Record<string, string[]> = {
  order_number: ["numero_ordine", "ordine", "order", "order_number", "numeroordine"],
  quantity: ["quantita", "qta", "qty", "quantity", "pezzi"],
  ean: ["ean", "barcode", "codice_barre", "codicebarre"],
  sku: ["sku", "codice_sku", "codicesku"],
  fnsku: ["fnsku", "codice_fnsku", "codicefnsku"],
  title: ["titolo", "prodotto", "nome_prodotto", "product", "title"],
  processed_at: ["data_ordine", "data", "order_date", "processed_at"],
  recipient: ["destinatario", "nome_destinatario", "cliente_finale", "recipient"],
  company: ["azienda", "ragione_sociale", "company"],
  address1: ["indirizzo", "indirizzo_1", "address", "address1"],
  address2: ["indirizzo_2", "address2"], zip: ["cap", "zip", "postal_code"], city: ["citta", "city"],
  province: ["provincia", "province"], country: ["paese", "country"], country_code: ["codice_paese", "country_code"],
  phone: ["telefono", "phone"], email: ["email", "e_mail"], note: ["note", "nota"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return response({ ok: true });
  if (req.method !== "POST") return response({ detail: "Metodo non consentito" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return response({ detail: "Configurazione Supabase mancante" }, 500);
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) return response({ detail: "Sessione non valida" }, 401);
  const { data: profile, error: profileError } = await userClient.from("profiles").select("role,cliente_id,is_operator,operator_active").eq("id", authData.user.id).single();
  if (profileError || !["admin", "staff", "cliente"].includes(profile?.role)) return response({ detail: "Profilo non autorizzato" }, 403);
  if (profile.is_operator && profile.operator_active === false) return response({ detail: "Account operatore disattivato" }, 403);

  const payload = await req.json().catch(() => ({}));
  const source = String(payload.source || "csv").trim().toLowerCase() === "manual" ? "manual" : "csv";
  const shopDomain = source === "manual" ? "manual-entry" : "csv-import";
  const clienteId = profile.role === "cliente" ? String(profile.cliente_id || "") : String(payload.cliente_id || "").trim();
  if (!clienteId) return response({ detail: "Cliente degli ordini non disponibile" }, 400);
  if (!Array.isArray(payload.rows) || !payload.rows.length) return response({ detail: "Il file CSV non contiene righe" }, 400);
  const normalized = normalizeOrders(payload.rows);
  const admin = createClient(url, service);
  const { data: references, error: referencesError } = await admin.from("referenze").select("id,titolo,ean,sku,fnsku").eq("cliente_id", clienteId);
  if (referencesError) return response({ detail: referencesError.message }, 400);
  const maps = {
    ean: new Map((references || []).filter((r) => norm(r.ean)).map((r) => [norm(r.ean), r])),
    sku: new Map((references || []).filter((r) => norm(r.sku)).map((r) => [norm(r.sku), r])),
    fnsku: new Map((references || []).filter((r) => norm(r.fnsku)).map((r) => [norm(r.fnsku), r])),
  };
  const orders = normalized.orders.map((order: any) => {
    const items = order.items.map((item: any) => {
      const reference: any = maps.ean.get(norm(item.ean)) || maps.sku.get(norm(item.sku)) || maps.fnsku.get(norm(item.fnsku)) || null;
      return { ...item, reference, title: item.title || reference?.titolo || item.ean || item.sku || item.fnsku };
    });
    return {
      ...order,
      zip: normalizeCsvZip(order.zip, order.country_code),
      items,
      pieces: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
      unmatched: items.filter((item: any) => !item.reference).length,
    };
  });
  const preview = {
    valid: normalized.errors.length === 0 && orders.length > 0,
    errors: normalized.errors,
    orders: orders.map((order: any) => ({ order_number: order.order_number, rows: order.items.length, pieces: order.pieces, unmatched: order.unmatched, destination: [order.zip, order.city].filter(Boolean).join(" ") })),
    totals: { orders: orders.length, rows: orders.reduce((s: number, o: any) => s + o.items.length, 0), pieces: orders.reduce((s: number, o: any) => s + o.pieces, 0), unmatched: orders.reduce((s: number, o: any) => s + o.unmatched, 0) },
  };
  if (payload.dry_run !== false) return response(preview);
  if (!preview.valid) return response({ detail: "Correggi gli errori del CSV prima di importare" }, 400);

  const identifiers = orders.map((order: any) => identifier(order.order_number, source));
  const { data: existingOrders, error: existingError } = await admin.from("shopify_orders").select("id,shopify_order_id,wms_status,order_name").eq("cliente_id", clienteId).eq("shop_domain", shopDomain).in("shopify_order_id", identifiers);
  if (existingError) return response({ detail: existingError.message }, 400);
  const existingMap = new Map((existingOrders || []).map((order) => [order.shopify_order_id, order]));
  const locked = (existingOrders || []).filter((order) => !["da_preparare", "in_attesa_refill", "in_verifica", "eccezione"].includes(order.wms_status));
  if (locked.length) return response({ detail: `Picking gia avviato per: ${locked.map((o) => o.order_name).join(", ")}` }, 409);

  let imported = 0;
  const gateResults: any[] = [];
  for (const order of orders as any[]) {
    const existing: any = existingMap.get(identifier(order.order_number, source));
    const now = new Date().toISOString();
    const gate = initialGateForImportedOrder(order);
    const row = { cliente_id: clienteId, shop_domain: shopDomain, shopify_order_id: identifier(order.order_number, source), order_name: order.order_number, financial_status: source, fulfillment_status: "unfulfilled", wms_status: gate.wms_status, gate_status: gate.gate_status, exception_type: gate.exception_type, exception_reasons: gate.exception_reasons, address_validation: gate.addressValidation || gate.address_validation, stock_shortages: gate.stock_shortages, refill_requirements: gate.refill_requirements || [], gate_checked_at: now, unblocked_at: gate.gate_status === "sbloccato" ? now : null, processed_at: dateOrNow(order.processed_at), note: order.note || null, customer_email: order.email || null, customer_phone: order.phone || null, ship_name: order.recipient || null, ship_company: order.company || null, ship_address1: order.address1 || null, ship_address2: order.address2 || null, ship_zip: order.zip || null, ship_city: order.city || null, ship_province: order.province || null, ship_country: order.country || null, ship_country_code: order.country_code || null, raw: { source, imported_at: now }, updated_at: now };
    const savedResult = existing ? await admin.from("shopify_orders").update(row).eq("id", existing.id).select().single() : await admin.from("shopify_orders").insert(row).select().single();
    if (savedResult.error) return response({ detail: savedResult.error.message }, 400);
    if (existing) { const deleted = await admin.from("shopify_order_items").delete().eq("order_id", existing.id); if (deleted.error) return response({ detail: deleted.error.message }, 400); }
    const itemRows = order.items.map((item: any, index: number) => ({ order_id: savedResult.data.id, shopify_line_item_id: itemIdentifier(item, index, source), referenza_id: item.reference?.id || null, sku: item.sku || item.reference?.sku || null, ean: item.ean || item.reference?.ean || null, titolo: item.title, quantita: item.quantity, fulfillable_quantity: item.quantity, fulfillment_status: null, raw: { source, source_row: item.source_row, fnsku: item.fnsku || null }, updated_at: now }));
    const inserted = await admin.from("shopify_order_items").insert(itemRows);
    if (inserted.error) return response({ detail: inserted.error.message }, 400);
    try {
      const checked = await evaluateWmsOrderGate(admin, savedResult.data.id, authData.user.id);
      gateResults.push({ id: checked.id, order_number: checked.order_name, wms_status: checked.wms_status, gate_status: checked.gate_status });
    } catch (error) {
      return response({ detail: `Ordine ${order.order_number} importato ma controllo automatico non riuscito: ${error instanceof Error ? error.message : "errore sconosciuto"}` }, 500);
    }
    imported += 1;
  }
  return response({ ...preview, imported, gate_results: gateResults });
});

function key(value: unknown) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function field(row: Record<string, unknown>, name: string) { const normalized = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [key(k), v])); for (const alias of aliases[name] || []) { if (String(normalized[alias] ?? "").trim()) return String(normalized[alias]).trim(); } return ""; }
function norm(value: unknown) { return String(value || "").trim().toLowerCase(); }
function normalizeCsvZip(value: unknown, countryCode: unknown) {
  const zip = String(value || "").trim();
  const country = String(countryCode || "IT").trim().toUpperCase();
  return country === "IT" && /^\d{1,4}$/.test(zip) ? zip.padStart(5, "0") : zip;
}
function identifier(value: unknown, source = "csv") { return `${source}:${norm(value)}`; }
function itemIdentifier(item: any, index: number, source = "csv") { return `${source}:${index + 1}:${norm(item.ean || item.sku || item.fnsku || item.title).replace(/[^a-z0-9]+/g, "-").slice(0, 80) || "riga"}`; }
function dateOrNow(value: unknown) { const parsed = value ? new Date(String(value)) : new Date(); return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(); }
function normalizeOrders(rows: Record<string, unknown>[]) {
  const errors: string[] = []; const grouped = new Map<string, any>();
  rows.forEach((source, index) => { const line = index + 2; const orderNumber = field(source, "order_number"); const ean = field(source, "ean"); const sku = field(source, "sku"); const fnsku = field(source, "fnsku"); const quantity = Number(field(source, "quantity").replace(",", "."));
    if (!orderNumber) errors.push(`Riga ${line}: numero ordine mancante.`); if (!ean && !sku && !fnsku) errors.push(`Riga ${line}: inserisci almeno EAN, SKU o FNSKU.`); if (!Number.isInteger(quantity) || quantity <= 0) errors.push(`Riga ${line}: quantita non valida.`); if (!orderNumber || (!ean && !sku && !fnsku) || !Number.isInteger(quantity) || quantity <= 0) return;
    if (!grouped.has(orderNumber)) grouped.set(orderNumber, { order_number: orderNumber, processed_at: field(source, "processed_at"), recipient: field(source, "recipient"), company: field(source, "company"), address1: field(source, "address1"), address2: field(source, "address2"), zip: field(source, "zip"), city: field(source, "city"), province: field(source, "province"), country: field(source, "country"), country_code: field(source, "country_code"), phone: field(source, "phone"), email: field(source, "email"), note: field(source, "note"), items: new Map() });
    const order = grouped.get(orderNumber); const itemKey = `${norm(ean)}|${norm(sku)}|${norm(fnsku)}`; const existing = order.items.get(itemKey); if (existing) existing.quantity += quantity; else order.items.set(itemKey, { ean, sku, fnsku, title: field(source, "title"), quantity, source_row: line });
  });
  return { errors, orders: [...grouped.values()].map((order) => ({ ...order, items: [...order.items.values()] })) };
}

function initialGateForImportedOrder(order: any) {
  const address = String(order.address1 || "").trim();
  const zip = String(order.zip || "").trim();
  const city = String(order.city || "").trim();
  const province = String(order.province || "").trim();
  const countryCode = String(order.country_code || "IT").trim().toUpperCase();
  const recipient = String(order.recipient || order.company || "").trim();
  const addressReasons = [
    ...(!recipient ? ["Destinatario mancante"] : []),
    ...(!address ? ["Indirizzo mancante"] : []),
    ...(address && !/\d/.test(address) ? ["Numero civico non riconosciuto"] : []),
    ...(!zip ? ["CAP mancante"] : []),
    ...(!city ? ["Citta mancante"] : []),
    ...(!countryCode ? ["Paese mancante"] : []),
    ...(countryCode === "IT" && !/^\d{5}$/.test(zip) ? ["CAP italiano non valido"] : []),
    ...(countryCode === "IT" && !province ? ["Provincia mancante"] : []),
  ];
  const addressValidation = { valid: addressReasons.length === 0, confidence: addressReasons.length ? 0 : 0.92, source: "controllo_locale", reasons: addressReasons, normalized: { recipient, address, zip, city, province, country_code: countryCode }, verified_at: new Date().toISOString() };
  if (addressReasons.length) return { wms_status: "eccezione", gate_status: "eccezione_indirizzo", exception_type: "indirizzo", exception_reasons: addressReasons, address_validation: addressValidation, stock_shortages: [] };
  return {
    wms_status: "in_verifica",
    gate_status: "verifica_stock",
    exception_type: null,
    exception_reasons: [],
    address_validation: addressValidation,
    stock_shortages: [],
    refill_requirements: [],
  };
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { requireSupabase, supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { calculateWarehouseRoute, normalizeAisles } from "@/lib/wmsRouting";

const BUCKET = "gestionale-files";
const PROFILE_CACHE_MS = 30_000;
let cachedProfile = null;
let cachedProfileAt = 0;

function ok(data) {
  return Promise.resolve({ data });
}

function fail(detail, status = 400) {
  const error = new Error(typeof detail === "string" ? detail : "Errore");
  error.response = { status, data: { detail } };
  throw error;
}

async function edgeErrorMessage(error, fallback) {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = await response.clone().json();
      if (body?.detail) return body.detail;
      if (body?.error) return body.error;
    } catch (_) {
      // Fallback to text below.
    }
    try {
      const text = await response.clone().text();
      if (text) return text;
    } catch (_) {
      // Keep generic fallback.
    }
  }
  return error?.message || fallback;
}

function pathAndQuery(url) {
  const parsed = new URL(url, "https://local.supabase");
  return { path: parsed.pathname, params: parsed.searchParams };
}

function nowIso() {
  return new Date().toISOString();
}

async function currentProfile() {
  if (cachedProfile && Date.now() - cachedProfileAt < PROFILE_CACHE_MS) return cachedProfile;
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) fail("Non autenticato", 401);

  const { data, error } = await sb
    .from("profiles")
    .select("id,email,name,role,cliente_id,is_operator,operator_active")
    .eq("id", user.id)
    .single();
  if (error || !data) fail("Profilo utente non trovato", 401);
  if (data.is_operator && data.operator_active === false) {
    await sb.auth.signOut();
    fail("Account operatore disattivato", 403);
  }
  cachedProfile = data;
  cachedProfileAt = Date.now();
  return data;
}

function isStaff(profile) {
  return profile?.role === "admin" || profile?.role === "staff";
}

async function resolveClienteId(provided) {
  const profile = await currentProfile();
  if (isStaff(profile)) {
    if (!provided) fail("cliente_id richiesto");
    return provided;
  }
  if (!profile.cliente_id) fail("Utente cliente senza cliente_id", 403);
  return profile.cliente_id;
}

function cleanRow(row) {
  if (!row) return row;
  const out = { ...row };
  delete out.created_by;
  return out;
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedScanCode(value) {
  return normalizeScannerCode(value);
}

export function normalizeScannerCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/['’‘`´ʼ]/g, "-")
    .replace(/\s+/g, "");
}

function groupBy(rows, key) {
  return (rows || []).reduce((acc, row) => {
    const value = row?.[key];
    if (!value) return acc;
    acc[value] = acc[value] || [];
    acc[value].push(row);
    return acc;
  }, {});
}

const SERVICE_LABELS = {
  fnsku: "Applicazione etichette FNSKU",
  busta: "Busta trasparente",
  nastratura: "Nastratura",
  pluriball: "Pluriball",
};

function boxScatolaCodice(box = {}) {
  if (box.scatola_tipo === "60x40x40") return "scatola_60";
  if (box.scatola_tipo === "40x30x30") return "scatola_40";

  const dims = [box.lunghezza_cm, box.larghezza_cm, box.altezza_cm].map((value) => Number(value || 0));
  if (dims.every((value) => value <= 0)) return null;
  return dims.some((value) => value >= 55) ? "scatola_60" : "scatola_40";
}

function contenutoTotals(contenuto = []) {
  return (contenuto || []).reduce((acc, item) => {
    if (!item?.ean) return acc;
    acc[item.ean] = (acc[item.ean] || 0) + Number(item.quantita || 0);
    return acc;
  }, {});
}

const PREP_RESERVING_STATUSES = ["richiesta", "in_lavorazione", "pronto"];
const ENTRATA_STOCK_STATUSES = ["ricevuto", "in_lavorazione", "pronto", "spedito"];
const PREP_RIGA_STATI = ["richiesta", "in_lavorazione", "pronto", "spedito"];

function entrataRowReceivedQuantity(row = {}, entrata = null) {
  if (row.quantita_ricevuta !== null && row.quantita_ricevuta !== undefined) {
    return Math.max(0, Number(row.quantita_ricevuta || 0));
  }
  return entrata && ENTRATA_STOCK_STATUSES.includes(entrata.stato)
    ? Math.max(0, Number(row.quantita || 0))
    : 0;
}

function normalizePrepRigaStato(stato) {
  const value = optionalText(stato);
  if (!PREP_RIGA_STATI.includes(value)) fail("Stato riga preparazione non valido");
  return value;
}

async function syncPreparazioneFromRighe(preparazioneId) {
  const [{ data: prep, error: prepError }, { data: righe, error: righeError }] = await Promise.all([
    requireSupabase().from("preparazioni").select("*").eq("id", preparazioneId).single(),
    supabase.from("preparazioni_righe").select("id,stato").eq("preparazione_id", preparazioneId),
  ]);
  const firstError = prepError || righeError;
  if (firstError) fail(firstError.message);
  if (!prep || prep.stato === "spedito") return prep;

  const rows = righe || [];
  let stato = "richiesta";
  if (rows.length && rows.every((row) => ["pronto", "spedito"].includes(row.stato || "richiesta"))) {
    stato = "pronto";
  } else if (rows.some((row) => (row.stato || "richiesta") !== "richiesta")) {
    stato = "in_lavorazione";
  }

  const updates = { stato };
  if (stato === "pronto" && !prep.data_pronto) updates.data_pronto = nowIso();
  const { data, error } = await requireSupabase()
    .from("preparazioni")
    .update(updates)
    .eq("id", preparazioneId)
    .select()
    .single();
  if (error) fail(error.message);
  return data;
}

function addUsage(target, ean, quantity, bundleMap = {}, bundleTarget = null) {
  if (!ean) return;
  const qty = Number(quantity || 0);
  if (qty <= 0) return;
  if (bundleMap[ean]) {
    if (bundleTarget) bundleTarget[ean] = (bundleTarget[ean] || 0) + qty;
    for (const component of bundleMap[ean] || []) {
      addUsage(target, component.ean, qty * Number(component.quantita || 1), bundleMap, null);
    }
    return;
  }
  target[ean] = (target[ean] || 0) + qty;
}

function expandedTotalsForInventory(totals = {}, bundleMap = {}) {
  const out = {};
  for (const [ean, qty] of Object.entries(totals || {})) addUsage(out, ean, qty, bundleMap);
  return out;
}

function canFitTotals(current, addition, target) {
  return Object.entries(addition).every(([ean, qty]) => (
    Object.prototype.hasOwnProperty.call(target, ean)
    && Number(current[ean] || 0) + Number(qty || 0) <= Number(target[ean] || 0)
  ));
}

function addTotals(current, addition) {
  for (const [ean, qty] of Object.entries(addition)) current[ean] = Number(current[ean] || 0) + Number(qty || 0);
}

function boxesByPreparazioneWithFallback(preps, prepRighe, boxes) {
  const prepIds = (preps || []).map((p) => p.id);
  const boxesByPrep = groupBy((boxes || []).filter((b) => prepIds.includes(b.preparazione_id)), "preparazione_id");
  const righeByPrep = groupBy(prepRighe || [], "preparazione_id");
  const targets = {};
  const allocated = {};

  for (const prep of preps || []) {
    targets[prep.id] = contenutoTotals(righeByPrep[prep.id] || []);
    allocated[prep.id] = contenutoTotals((boxesByPrep[prep.id] || []).flatMap((box) => box.contenuto || []));
  }

  const unlinkedBoxes = (boxes || [])
    .filter((box) => !box.preparazione_id && (box.contenuto || []).length > 0)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  for (const box of unlinkedBoxes) {
    const boxTotals = contenutoTotals(box.contenuto || []);
    const prep = (preps || []).find((candidate) => canFitTotals(allocated[candidate.id], boxTotals, targets[candidate.id]));
    if (!prep) continue;
    boxesByPrep[prep.id] = boxesByPrep[prep.id] || [];
    boxesByPrep[prep.id].push({ ...box, abbinata_da_contenuto: true });
    addTotals(allocated[prep.id], boxTotals);
  }

  return boxesByPrep;
}

function isRealEan(ean, titolo) {
  const cleanEan = optionalText(ean);
  if (!cleanEan) return false;
  return normalizedText(cleanEan) !== normalizedText(titolo);
}

function isPseudoTitleEan(row = {}) {
  return Boolean(optionalText(row.ean) && normalizedText(row.ean) === normalizedText(row.titolo));
}

function exposeReferenza(row) {
  if (!isPseudoTitleEan(row)) return row;
  return { ...row, ean: null, _pseudo_ean: row.ean };
}

function normalizeReferenzaPayload(payload = {}) {
  const out = { ...payload };
  delete out._pseudo_ean;
  for (const key of ["ean", "sku", "asin", "fnsku", "foto_url"]) {
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = optionalText(out[key]);
  }
  if (Object.prototype.hasOwnProperty.call(out, "titolo")) {
    out.titolo = String(out.titolo || "").trim();
  }
  for (const key of ["peso_kg", "lunghezza_cm", "larghezza_cm", "altezza_cm"]) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
    const value = Number(String(out[key]).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) fail(`${key.replaceAll("_", " ")} deve essere maggiore di zero`);
    out[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(out, "misure_confermate")) {
    out.misure_confermate = Boolean(out.misure_confermate);
  }
  return out;
}

async function findLooseReferenza(clienteId, referenza = {}) {
  const titleKey = normalizedText(referenza.titolo);
  const ean = optionalText(referenza.ean);
  const eanIsReal = isRealEan(ean, referenza.titolo);
  const { data, error } = await supabase
    .from("referenze")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("is_bundle", Boolean(referenza.is_bundle || false));
  if (error) fail(error.message);

  if (eanIsReal) {
    const byEan = (data || []).find((row) => optionalText(row.ean) === ean);
    if (byEan) return byEan;
  }
  if (!titleKey || referenza.is_bundle) return null;
  return (data || []).find((row) => (
    normalizedText(row.titolo) === titleKey && !isRealEan(row.ean, row.titolo)
  )) || null;
}

async function upsertLooseReferenza(clienteId, referenza = {}) {
  const existing = await findLooseReferenza(clienteId, referenza);
  if (!existing) return null;

  const patch = {};
  for (const key of ["titolo", "ean", "sku", "asin", "fnsku", "foto_url"]) {
    if (!Object.prototype.hasOwnProperty.call(referenza, key)) continue;
    const value = key === "titolo" ? String(referenza[key] || "").trim() : optionalText(referenza[key]);
    if (value && !existing[key]) patch[key] = value;
    if (key === "ean" && value && !isRealEan(existing.ean, existing.titolo) && isRealEan(value, referenza.titolo || existing.titolo)) {
      patch[key] = value;
    }
    if (key === "ean" && value && !isRealEan(existing.ean, existing.titolo) && isPseudoTitleEan({ ean: value, titolo: referenza.titolo || existing.titolo })) {
      patch[key] = value;
    }
  }
  if (!Object.keys(patch).length) return existing;

  const { data, error } = await supabase
    .from("referenze")
    .update(patch)
    .eq("id", existing.id)
    .select()
    .single();
  if (error) fail(error.message);
  return data;
}

async function clientiMap(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await supabase.from("clienti").select("*").in("id", unique);
  if (error) fail(error.message);
  return Object.fromEntries((data || []).map((c) => [c.id, c]));
}

async function listClienti() {
  const { data, error } = await requireSupabase()
    .from("clienti")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return ok(data || []);
}

async function assertWmsAdmin() {
  const profile = await currentProfile();
  if (profile.role !== "admin") fail("Operazione riservata agli amministratori", 403);
  return profile;
}

async function manageWmsOperator(payload = {}) {
  await assertWmsAdmin();
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);
  const { data, error } = await sb.functions.invoke("manage-operator", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Operazione sull'operatore non riuscita"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

function operatorEvent({ id, operatorId, type, title, detail, timestamp, status = null, metadata = {} }) {
  return { id: `${type}:${id}`, operator_id: operatorId, type, title, detail, timestamp, status, metadata };
}

async function listWmsOperators(params = new URLSearchParams()) {
  await assertWmsAdmin();
  const requestedOperator = optionalText(params.get("operator_id"));
  const limit = Math.min(1000, Math.max(50, Number(params.get("limit") || 400)));
  const sb = requireSupabase();

  let profilesQuery = sb.from("profiles")
    .select("id,email,name,role,is_operator,operator_active,created_at")
    .eq("is_operator", true)
    .order("name", { ascending: true });
  if (requestedOperator) profilesQuery = profilesQuery.eq("id", requestedOperator);
  const { data: profiles, error: profilesError } = await profilesQuery;
  if (profilesError) fail(profilesError.message);
  const operatorIds = (profiles || []).map((row) => row.id);
  if (!operatorIds.length) return ok({ operators: [], events: [], summary: { active: 0, total: 0, today: 0 } });

  const byOperators = (query, field = "operatore_id") => query.in(field, operatorIds).limit(limit);
  const results = await Promise.all([
    byOperators(sb.from("wms_pick_tasks").select("id,order_id,operatore_id,stato,started_at,completed_at,created_at").order("created_at", { ascending: false })),
    byOperators(sb.from("wms_mass_pick_batches").select("id,bag_code,operatore_id,stato,started_at,completed_at,created_at").order("created_at", { ascending: false })),
    byOperators(sb.from("wms_galluse_batches").select("id,operatore_id,stato,numero_bag,started_at,completed_at,created_at").order("created_at", { ascending: false })),
    byOperators(sb.from("wms_packing_sessions").select("id,order_id,bag_code,station_code,operatore_id,stato,started_at,completed_at,created_at").order("created_at", { ascending: false })),
    byOperators(sb.from("wms_stock_transfers").select("id,product_key,source_location_id,target_location_id,quantita,operatore_id,created_at").order("created_at", { ascending: false })),
    byOperators(sb.from("wms_inventory_sessions").select("id,location_id,operatore_id,stato,note,started_at,completed_at").order("started_at", { ascending: false })),
    byOperators(sb.from("wms_inbound_sessions").select("id,entrata_id,operatore_id,stato,started_at,completed_at").order("started_at", { ascending: false })),
    byOperators(sb.from("wms_inventory_counts").select("id,location_id,created_by,titolo,quantita_attesa,quantita_contata,verificata,created_at").order("created_at", { ascending: false }), "created_by"),
    byOperators(sb.from("wms_inbound_movements").select("id,location_id,created_by,quantita,disposizione,created_at").order("created_at", { ascending: false }), "created_by"),
  ]);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) fail(firstError.message);
  const [picks, massPicks, gallusePicks, packing, transfers, inventories, inbound, inventoryCounts, inboundMovements] = results.map((result) => result.data || []);

  const orderIds = [...new Set([...picks, ...packing].map((row) => row.order_id).filter(Boolean))];
  const locationIds = [...new Set([
    ...transfers.flatMap((row) => [row.source_location_id, row.target_location_id]),
    ...inventories.map((row) => row.location_id),
    ...inventoryCounts.map((row) => row.location_id),
    ...inboundMovements.map((row) => row.location_id),
  ].filter(Boolean))];
  const [ordersResult, locationsResult] = await Promise.all([
    orderIds.length ? sb.from("shopify_orders").select("id,order_name").in("id", orderIds) : Promise.resolve({ data: [], error: null }),
    locationIds.length ? sb.from("wms_locations").select("id,codice").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ordersResult.error) fail(ordersResult.error.message);
  if (locationsResult.error) fail(locationsResult.error.message);
  const orderMap = new Map((ordersResult.data || []).map((row) => [row.id, row.order_name]));
  const locationMap = new Map((locationsResult.data || []).map((row) => [row.id, row.codice]));

  const events = [
    ...picks.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "picking", title: "Picking ordine", detail: orderMap.get(row.order_id) || "Ordine WMS", timestamp: row.completed_at || row.started_at || row.created_at, status: row.stato, metadata: { order_id: row.order_id } })),
    ...massPicks.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "picking_massivo", title: "Picking massivo", detail: row.bag_code ? `Bag ${row.bag_code}` : "Lotto massivo", timestamp: row.completed_at || row.started_at || row.created_at, status: row.stato })),
    ...gallusePicks.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "picking_galluse", title: "Picking Galluse", detail: `${row.numero_bag || 0} bag associate`, timestamp: row.completed_at || row.started_at || row.created_at, status: row.stato })),
    ...packing.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "packing", title: "Packing ordine", detail: [orderMap.get(row.order_id), row.bag_code && `Bag ${row.bag_code}`].filter(Boolean).join(" · ") || "Sessione packing", timestamp: row.completed_at || row.started_at || row.created_at, status: row.stato, metadata: { order_id: row.order_id } })),
    ...transfers.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "movimento_stock", title: "Movimento stock", detail: `${row.quantita} pz · ${locationMap.get(row.source_location_id) || "Origine"} → ${locationMap.get(row.target_location_id) || "Destinazione"}`, timestamp: row.created_at, status: "completato", metadata: { product_key: row.product_key } })),
    ...inventories.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "inventario", title: "Conteggio inventario", detail: locationMap.get(row.location_id) || "Ubicazione", timestamp: row.completed_at || row.started_at, status: row.stato })),
    ...inbound.map((row) => operatorEvent({ id: row.id, operatorId: row.operatore_id, type: "ricezione", title: "Ricezione merce", detail: "Sessione di ingresso merce", timestamp: row.completed_at || row.started_at, status: row.stato })),
    ...inventoryCounts.map((row) => operatorEvent({ id: row.id, operatorId: row.created_by, type: "inventario", title: "Quantità conteggiata", detail: `${row.titolo || "Prodotto"} · ${row.quantita_contata} pz in ${locationMap.get(row.location_id) || "ubicazione"} (attesi ${row.quantita_attesa})`, timestamp: row.created_at, status: row.verificata ? "verificata" : "da_verificare" })),
    ...inboundMovements.map((row) => operatorEvent({ id: row.id, operatorId: row.created_by, type: "ricezione", title: "Merce ricevuta", detail: `${row.quantita} pz in ${locationMap.get(row.location_id) || "ubicazione"} · ${row.disposizione}`, timestamp: row.created_at, status: "registrata" })),
  ].filter((event) => event.timestamp).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const operators = (profiles || []).map((profile) => {
    const operatorEvents = events.filter((event) => event.operator_id === profile.id);
    return {
      ...profile,
      last_activity_at: operatorEvents[0]?.timestamp || null,
      activity_count: operatorEvents.length,
      picking_count: operatorEvents.filter((event) => event.type.startsWith("picking")).length,
      packing_count: operatorEvents.filter((event) => event.type === "packing").length,
      stock_count: operatorEvents.filter((event) => ["movimento_stock", "inventario", "ricezione"].includes(event.type)).length,
    };
  });
  return ok({
    operators,
    events,
    summary: {
      total: operators.length,
      active: operators.filter((row) => row.operator_active).length,
      today: events.filter((event) => new Date(event.timestamp) >= today).length,
      picking: events.filter((event) => event.type.startsWith("picking")).length,
      packing: events.filter((event) => event.type === "packing").length,
    },
  });
}

async function getWmsControlRoom(params = new URLSearchParams()) {
  await assertWmsStaff();
  const requestedClient = optionalText(params.get("cliente_id"));
  const eventLimit = Math.min(500, Math.max(50, Number(params.get("limit") || 180)));
  const sb = requireSupabase();

  let eventsQuery = sb.from("wms_operational_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(eventLimit);
  let ordersQuery = sb.from("shopify_orders")
    .select("id,cliente_id,order_name,wms_status,gate_status,exception_type,exception_reasons,stock_shortages,updated_at,created_at")
    .not("wms_status", "in", "(spedito,annullato)")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (requestedClient) {
    eventsQuery = eventsQuery.eq("cliente_id", requestedClient);
    ordersQuery = ordersQuery.eq("cliente_id", requestedClient);
  }

  const results = await Promise.all([
    eventsQuery,
    ordersQuery,
    sb.from("wms_pick_tasks").select("id,order_id,operatore_id,stato,started_at,created_at").in("stato", ["da_prelevare", "in_corso"]).order("created_at", { ascending: false }),
    sb.from("wms_mass_pick_batches").select("id,cliente_id,bag_code,operatore_id,stato,started_at,created_at").in("stato", ["in_corso", "in_packing"]).order("created_at", { ascending: false }),
    sb.from("wms_galluse_batches").select("id,cliente_id,numero_bag,operatore_id,stato,started_at,created_at").in("stato", ["da_associare_bag", "in_corso"]).order("created_at", { ascending: false }),
    sb.from("wms_packing_sessions").select("id,order_id,bag_code,station_code,operatore_id,stato,started_at,created_at").in("stato", ["da_imballare", "in_attesa_packing", "in_verifica_bag", "in_attesa_imballaggio", "in_attesa_etichetta", "in_corso"]).order("created_at", { ascending: false }),
    sb.from("wms_inbound_sessions").select("id,entrata_id,operatore_id,stato,started_at").eq("stato", "in_corso").order("started_at", { ascending: false }),
    sb.from("wms_inventory_sessions").select("id,location_id,operatore_id,stato,started_at").eq("stato", "in_corso").order("started_at", { ascending: false }),
  ]);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) fail(firstError.message);
  const [events, orders, picks, massPicks, gallusePicks, packing, inbound, inventories] = results.map((result) => result.data || []);

  const orderIds = [...new Set([
    ...orders.map((row) => row.id),
    ...picks.map((row) => row.order_id),
    ...packing.map((row) => row.order_id),
  ].filter(Boolean))];
  const operatorIds = [...new Set([
    ...events.map((row) => row.operator_id),
    ...picks.map((row) => row.operatore_id),
    ...massPicks.map((row) => row.operatore_id),
    ...gallusePicks.map((row) => row.operatore_id),
    ...packing.map((row) => row.operatore_id),
    ...inbound.map((row) => row.operatore_id),
    ...inventories.map((row) => row.operatore_id),
  ].filter(Boolean))];
  const locationIds = [...new Set(events.flatMap((row) => [row.location_from_id, row.location_to_id]).concat(inventories.map((row) => row.location_id)).filter(Boolean))];
  const clientIds = [...new Set([...events.map((row) => row.cliente_id), ...orders.map((row) => row.cliente_id), ...massPicks.map((row) => row.cliente_id), ...gallusePicks.map((row) => row.cliente_id)].filter(Boolean))];
  const [ordersLookup, profilesLookup, locationsLookup, clientsLookup] = await Promise.all([
    orderIds.length ? sb.from("shopify_orders").select("id,cliente_id,order_name,wms_status").in("id", orderIds) : Promise.resolve({ data: [], error: null }),
    operatorIds.length ? sb.from("profiles").select("id,email,name,is_operator,operator_active").in("id", operatorIds) : Promise.resolve({ data: [], error: null }),
    locationIds.length ? sb.from("wms_locations").select("id,codice").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
    clientIds.length ? sb.from("clienti").select("id,ragione_sociale").in("id", clientIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const lookupError = [ordersLookup, profilesLookup, locationsLookup, clientsLookup].find((result) => result.error)?.error;
  if (lookupError) fail(lookupError.message);
  const orderMap = new Map((ordersLookup.data || []).map((row) => [row.id, row]));
  const profileMap = new Map((profilesLookup.data || []).map((row) => [row.id, row]));
  const locationMap = new Map((locationsLookup.data || []).map((row) => [row.id, row.codice]));
  const clientMap = new Map((clientsLookup.data || []).map((row) => [row.id, row.ragione_sociale]));

  const work = [
    ...picks.map((row) => ({ ...row, kind: "picking", label: "Picking ordine", cliente_id: orderMap.get(row.order_id)?.cliente_id, detail: orderMap.get(row.order_id)?.order_name || "Ordine" })),
    ...massPicks.map((row) => ({ ...row, kind: "picking_massivo", label: "Picking massivo", detail: row.bag_code ? `Bag ${row.bag_code}` : "Lotto massivo" })),
    ...gallusePicks.map((row) => ({ ...row, kind: "picking_galluse", label: "Picking Galluse", detail: `${row.numero_bag || 0} bag` })),
    ...packing.map((row) => ({ ...row, kind: "packing", label: "Packing", cliente_id: orderMap.get(row.order_id)?.cliente_id, detail: [orderMap.get(row.order_id)?.order_name, row.bag_code && `Bag ${row.bag_code}`].filter(Boolean).join(" · ") })),
    ...inbound.map((row) => ({ ...row, kind: "inbound", label: "Ricezione", detail: `Entrata ${String(row.entrata_id || "").slice(0, 8)}` })),
    ...inventories.map((row) => ({ ...row, kind: "inventory", label: "Inventario", detail: locationMap.get(row.location_id) || "Ubicazione" })),
  ].filter((row) => !requestedClient || row.cliente_id === requestedClient)
    .map((row) => {
      const startedAt = row.started_at || row.created_at;
      const ageMinutes = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000) : 0;
      return {
        ...row,
        operator: profileMap.get(row.operatore_id) || null,
        client_name: clientMap.get(row.cliente_id) || null,
        age_minutes: ageMinutes,
        stalled: row.stato === "in_corso" && ageMinutes >= 45,
      };
    }).sort((left, right) => Number(right.stalled) - Number(left.stalled) || new Date(left.started_at || left.created_at) - new Date(right.started_at || right.created_at));

  const enrichedEvents = events.map((row) => ({
    ...row,
    operator: profileMap.get(row.operator_id) || null,
    order_name: orderMap.get(row.order_id)?.order_name || row.metadata?.order_name || null,
    client_name: clientMap.get(row.cliente_id) || null,
    location_from: locationMap.get(row.location_from_id) || null,
    location_to: locationMap.get(row.location_to_id) || null,
  }));
  const exceptions = orders.filter((row) => row.wms_status === "eccezione" || row.exception_type);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return ok({
    summary: {
      exceptions: exceptions.length,
      active_work: work.length,
      stalled: work.filter((row) => row.stalled).length,
      active_operators: new Set(work.map((row) => row.operatore_id).filter(Boolean)).size,
      events_today: enrichedEvents.filter((row) => new Date(row.created_at) >= today).length,
    },
    exceptions,
    work,
    events: enrichedEvents,
  });
}

async function createCliente(payload) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("create-client", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    return createClienteFallback(payload, error.message);
  }
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function resetClientePassword(clienteId, payload = {}) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("reset-client-password", {
    body: { cliente_id: clienteId, password: payload.password },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile reimpostare la password"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function importShopify(payload) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("shopify-import", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile chiamare Shopify Import"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function importShopifyOrders(payload) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("shopify-import-orders", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile importare gli ordini Shopify"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function startShopifyOAuth(payload) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("shopify-oauth-start", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile avviare il collegamento Shopify"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function listShopifyConnections() {
  const { data, error } = await requireSupabase()
    .from("shopify_connections")
    .select("id,cliente_id,shop_domain,scopes,connected_at,updated_at")
    .order("connected_at", { ascending: false });
  if (error) fail(error.message);
  return ok(data || []);
}

async function createShippyProLabel(payload) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("shippypro-create-label", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile generare l'etichetta ShippyPro"));
  if (data?.detail && !data?.ok) fail(data.detail);
  return ok(data);
}

async function listShippyProCarriers(payload = {}) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);

  const { data, error } = await sb.functions.invoke("shippypro-carriers", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile leggere i corrieri ShippyPro"));
  if (data?.detail && !data?.ok) fail(data.detail);
  return ok(data);
}

async function createClienteFallback(payload, functionError) {
  const sb = requireSupabase();
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);
  if (!supabaseUrl || !supabaseAnonKey) fail("Supabase non configurato", 500);

  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const ragioneSociale = String(payload.ragione_sociale || "").trim();

  if (!email || !password || !ragioneSociale) {
    fail("Compila ragione sociale, email e password");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `cliente-create-${Date.now()}`,
    },
  });

  const { data: signUpData, error: signUpError } = await authClient.auth.signUp({
    email,
    password,
    options: {
      data: { name: ragioneSociale, role: "cliente" },
    },
  });

  if (signUpError || !signUpData.user) {
    fail(signUpError?.message || functionError || "Impossibile creare l'utente cliente");
  }

  const userId = signUpData.user.id;
  const { data: cliente, error: clienteError } = await sb
    .from("clienti")
    .insert({
      ragione_sociale: ragioneSociale,
      email,
      user_id: userId,
      note: payload.note ?? null,
      listino: payload.listino ?? undefined,
    })
    .select()
    .single();

  if (clienteError || !cliente) {
    fail(clienteError?.message || "Utente creato, ma cliente non salvato");
  }

  const { error: profileError } = await sb.from("profiles").insert({
    id: userId,
    email,
    name: ragioneSociale,
    role: "cliente",
    cliente_id: cliente.id,
  });

  if (profileError) {
    await sb.from("clienti").delete().eq("id", cliente.id);
    fail(
      "Cliente non completato: manca la policy profiles_staff_insert su Supabase. Esegui il mini-SQL che ti ho dato e riprova."
    );
  }

  return ok(cliente);
}

async function updateCliente(id, payload) {
  const { data, error } = await requireSupabase()
    .from("clienti")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function listClientCarrierRates(clienteId) {
  const profile = await currentProfile();
  if (!isStaff(profile) && profile.cliente_id !== clienteId) fail("Tariffario non accessibile", 403);
  const { data, error } = await requireSupabase()
    .from("client_carrier_rates")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("carrier")
    .order("weight_from_kg")
    .order("priority", { ascending: false });
  if (error) fail(error.message);
  return ok(data || []);
}

function splitCarrierCsvList(value, { postal = false } = {}) {
  return String(value || "")
    .split(/[|;,]+/)
    .map((entry) => entry.trim().toUpperCase().replace(/\s+/g, ""))
    .filter(Boolean)
    .map((entry) => postal ? entry.replace(/[^0-9*]/g, "") : entry.replace(/[^A-Z]/g, ""));
}

async function importClientCarrierRates(clienteId, formData) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);
  const file = formData?.get?.("file");
  if (!file) fail("Seleziona il CSV del tariffario");
  const parsed = Papa.parse(await file.text(), { header: true, skipEmptyLines: "greedy" });
  if (parsed.errors?.length && !parsed.data?.length) fail(parsed.errors[0].message || "CSV non leggibile");
  const key = (value) => String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    carrier: ["corriere", "carrier"], service: ["servizio", "service"], zone_name: ["zona", "nomezona", "zone"],
    weight_from_kg: ["pesodakg", "pesoda", "weightfromkg", "weightfrom"],
    weight_to_kg: ["pesoakg", "pesoa", "weighttokg", "weightto"],
    price: ["prezzo", "tariffa", "price"], surcharge: ["supplemento", "sovrapprezzo", "surcharge"],
    postal_codes: ["cap", "caps", "capdisagiati", "postalcodes"], provinces: ["province", "provincia", "provinces"],
    priority: ["priorita", "priority"],
  };
  const fields = parsed.meta.fields || [];
  const column = (name) => fields.find((field) => aliases[name].includes(key(field)));
  const columns = Object.fromEntries(Object.keys(aliases).map((name) => [name, column(name)]));
  for (const required of ["carrier", "weight_from_kg", "weight_to_kg", "price"]) {
    if (!columns[required]) fail("Il CSV richiede le colonne: corriere, peso_da_kg, peso_a_kg e prezzo");
  }
  const decimal = (value, fallback = null) => {
    const parsedValue = Number(String(value ?? "").trim().replace(",", "."));
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  };
  const errors = [];
  const rules = parsed.data.map((row, index) => {
    const value = (name) => columns[name] ? row[columns[name]] : "";
    const carrier = String(value("carrier") || "").trim().toLowerCase();
    const weightFrom = decimal(value("weight_from_kg"));
    const weightTo = decimal(value("weight_to_kg"));
    const price = decimal(value("price"));
    const surcharge = decimal(value("surcharge"), 0);
    const postalCodes = splitCarrierCsvList(value("postal_codes"), { postal: true });
    const provinces = splitCarrierCsvList(value("provinces"));
    const line = index + 2;
    if (!["gls", "brt"].includes(carrier)) errors.push(`Riga ${line}: corriere deve essere GLS o BRT.`);
    if (weightFrom == null || weightFrom < 0 || weightTo == null || weightTo <= 0 || weightTo < weightFrom) errors.push(`Riga ${line}: fascia peso non valida.`);
    if (price == null || price < 0 || surcharge == null || surcharge < 0) errors.push(`Riga ${line}: prezzo o supplemento non valido.`);
    if (postalCodes.some((cap) => !/^\d{5}$/.test(cap) && !/^\d{1,4}\*$/.test(cap))) errors.push(`Riga ${line}: usa CAP a 5 cifre oppure prefissi come 90*.`);
    if (provinces.some((province) => province.length !== 2)) errors.push(`Riga ${line}: le province devono avere 2 lettere.`);
    return {
      carrier, service: String(value("service") || "Standard 24/48h").trim(),
      zone_name: String(value("zone_name") || (postalCodes.length || provinces.length ? "Zona disagiata" : "Nazionale")).trim(),
      weight_from_kg: weightFrom, weight_to_kg: weightTo, price, surcharge,
      postal_codes: postalCodes, provinces, priority: Math.trunc(decimal(value("priority"), 0)),
    };
  });
  if (errors.length) fail(errors.slice(0, 8).join("\n"));
  if (!rules.length) fail("Il CSV non contiene tariffe");
  const { data, error } = await requireSupabase().rpc("replace_client_carrier_rates", { p_cliente_id: clienteId, p_rules: rules });
  if (error) fail(error.message);
  return ok({ imported: Number(data || rules.length), rules });
}

async function replaceClientCarrierRates(clienteId, payload = {}) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);
  const rules = Array.isArray(payload.rules) ? payload.rules : [];
  if (!rules.length) fail("Inserisci almeno una tariffa");
  for (const rule of rules) {
    if (!["gls", "brt"].includes(rule.carrier)) fail("Corriere tariffa non valido");
    if (!Number.isFinite(Number(rule.price)) || Number(rule.price) < 0) fail("Completa tutti i prezzi con valori validi");
    if (!Number.isFinite(Number(rule.weight_from_kg)) || !Number.isFinite(Number(rule.weight_to_kg))) fail("Fascia peso non valida");
  }
  const { data, error } = await requireSupabase().rpc("replace_client_carrier_rates", {
    p_cliente_id: clienteId,
    p_rules: rules,
  });
  if (error) fail(error.message);
  return ok({ saved: Number(data || rules.length) });
}

async function listReferenze(params) {
  const profile = await currentProfile();
  const requestedClienteId = params.get("cliente_id");
  const scopedClienteId = isStaff(profile) ? requestedClienteId : profile.cliente_id;
  if (scopedClienteId) {
    try {
      await ensureReferenzeFromOperational(scopedClienteId);
    } catch (error) {
      console.warn("Sincronizzazione referenze operative saltata", error);
    }
  }

  let query = requireSupabase().from("referenze").select("*").order("created_at", { ascending: false });
  if (scopedClienteId) query = query.eq("cliente_id", scopedClienteId);
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok((data || []).map(exposeReferenza));
}

async function createReferenza(payload) {
  const cliente_id = await resolveClienteId(payload.cliente_id);
  const referenza = normalizeReferenzaPayload(payload);
  const existing = await upsertLooseReferenza(cliente_id, referenza);
  if (existing) return ok(exposeReferenza(existing));

  const { data, error } = await requireSupabase()
    .from("referenze")
    .insert({ ...referenza, cliente_id, origine: payload.origine || "manuale" })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(exposeReferenza(data));
}

async function cascadeReferenzaEan(clienteId, oldEan, newEan) {
  if (!clienteId || !oldEan || !newEan || oldEan === newEan) return;

  const { data: entrate, error: entrateError } = await supabase
    .from("entrate")
    .select("id")
    .eq("cliente_id", clienteId);
  if (entrateError) fail(entrateError.message);
  const entrataIds = (entrate || []).map((row) => row.id);
  if (entrataIds.length) {
    const { error } = await supabase
      .from("entrate_righe")
      .update({ ean: newEan })
      .in("entrata_id", entrataIds)
      .eq("ean", oldEan);
    if (error) fail(error.message);
  }

  const { data: preparazioni, error: prepError } = await supabase
    .from("preparazioni")
    .select("id")
    .eq("cliente_id", clienteId);
  if (prepError) fail(prepError.message);
  const prepIds = (preparazioni || []).map((row) => row.id);
  if (prepIds.length) {
    const { error } = await supabase
      .from("preparazioni_righe")
      .update({ ean: newEan })
      .in("preparazione_id", prepIds)
      .eq("ean", oldEan);
    if (error) fail(error.message);
  }

  const { data: boxes, error: boxError } = await supabase
    .from("box")
    .select("id,contenuto")
    .eq("cliente_id", clienteId);
  if (boxError) fail(boxError.message);
  for (const box of boxes || []) {
    const contenuto = (box.contenuto || []).map((item) => (
      item.ean === oldEan ? { ...item, ean: newEan } : item
    ));
    if (JSON.stringify(contenuto) !== JSON.stringify(box.contenuto || [])) {
      const { error } = await supabase.from("box").update({ contenuto }).eq("id", box.id);
      if (error) fail(error.message);
    }
  }

  const oldProductKey = `ean:${normalizedText(oldEan)}`;
  const newProductKey = `ean:${normalizedText(newEan)}`;
  const { error: keyError } = await supabase.rpc("cascade_wms_product_key", {
    p_cliente_id: clienteId,
    p_old_key: oldProductKey,
    p_new_key: newProductKey,
  });
  if (keyError) fail(keyError.message);
}

async function assertReferenzaNonUsata(ref) {
  if (!ref?.ean) return;

  const { data: entrate, error: entrateError } = await supabase
    .from("entrate")
    .select("id")
    .eq("cliente_id", ref.cliente_id);
  if (entrateError) fail(entrateError.message);
  const entrataIds = (entrate || []).map((row) => row.id);
  if (entrataIds.length) {
    const { count, error } = await supabase
      .from("entrate_righe")
      .select("id", { count: "exact", head: true })
      .in("entrata_id", entrataIds)
      .eq("ean", ref.ean);
    if (error) fail(error.message);
    if (count > 0) fail("Non puoi eliminare una referenza gia usata in entrate.");
  }

  const { data: preparazioni, error: prepError } = await supabase
    .from("preparazioni")
    .select("id")
    .eq("cliente_id", ref.cliente_id);
  if (prepError) fail(prepError.message);
  const prepIds = (preparazioni || []).map((row) => row.id);
  if (prepIds.length) {
    const { count, error } = await supabase
      .from("preparazioni_righe")
      .select("id", { count: "exact", head: true })
      .in("preparazione_id", prepIds)
      .eq("ean", ref.ean);
    if (error) fail(error.message);
    if (count > 0) fail("Non puoi eliminare una referenza gia usata in preparazioni.");
  }

  const { data: boxes, error: boxError } = await supabase
    .from("box")
    .select("contenuto")
    .eq("cliente_id", ref.cliente_id);
  if (boxError) fail(boxError.message);
  if ((boxes || []).some((box) => (box.contenuto || []).some((item) => item.ean === ref.ean))) {
    fail("Non puoi eliminare una referenza gia usata in box.");
  }

  const { data: refs, error: refsError } = await supabase
    .from("referenze")
    .select("componenti")
    .eq("cliente_id", ref.cliente_id)
    .neq("id", ref.id);
  if (refsError) fail(refsError.message);
  if ((refs || []).some((row) => (row.componenti || []).some((item) => item.ean === ref.ean))) {
    fail("Non puoi eliminare una referenza usata come componente di un bundle.");
  }
}

async function updateReferenza(id, payload) {
  const { data: current, error: readError } = await requireSupabase()
    .from("referenze")
    .select("*")
    .eq("id", id)
    .single();
  if (readError) fail(readError.message);

  const updates = normalizeReferenzaPayload(payload);
  if (!updates.ean && payload._pseudo_ean && isPseudoTitleEan({ ean: payload._pseudo_ean, titolo: updates.titolo || current.titolo })) {
    updates.ean = payload._pseudo_ean;
  }
  const { data, error } = await requireSupabase()
    .from("referenze")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  if (updates.ean && current.ean && updates.ean !== current.ean) {
    await cascadeReferenzaEan(current.cliente_id, current.ean, updates.ean);
  }
  return ok(exposeReferenza(data));
}

async function deleteReferenza(id) {
  const { data: ref, error: readError } = await requireSupabase()
    .from("referenze")
    .select("*")
    .eq("id", id)
    .single();
  if (readError || !ref) fail(readError?.message || "Referenza non trovata", 404);
  await assertReferenzaNonUsata(ref);

  const { error } = await requireSupabase().from("referenze").delete().eq("id", id);
  if (error) fail(error.message);
  return ok({ ok: true });
}

async function ensureReferenzeForEntrata(clienteId, righe = []) {
  const rows = righe
    .map((r) => ({
      ean: optionalText(r.ean),
      titolo: optionalText(r.titolo),
      sku: optionalText(r.sku),
      fnsku: optionalText(r.fnsku),
    }))
    .filter((r) => r.ean || r.titolo);
  if (!rows.length) return;

  const { data: existing, error: readError } = await supabase
    .from("referenze")
    .select("*")
    .eq("cliente_id", clienteId);
  if (readError) fail(readError.message);

  const byRealEan = new Map((existing || [])
    .filter((ref) => isRealEan(ref.ean, ref.titolo))
    .map((ref) => [optionalText(ref.ean), ref]));
  const byLooseTitle = new Map((existing || [])
    .filter((ref) => !ref.is_bundle && !isRealEan(ref.ean, ref.titolo))
    .map((ref) => [normalizedText(ref.titolo), ref]));
  const byFnsku = new Map((existing || [])
    .filter((ref) => optionalText(ref.fnsku))
    .map((ref) => [optionalText(ref.fnsku), ref]));
  const toInsert = [];
  const updates = [];

  for (const row of rows) {
    const rowTitle = row.titolo || row.ean;
    const foundByRealEan = isRealEan(row.ean, rowTitle) ? byRealEan.get(row.ean) : null;
    const foundByFnsku = row.fnsku ? byFnsku.get(row.fnsku) : null;
    const found = foundByRealEan || foundByFnsku || byLooseTitle.get(normalizedText(rowTitle));
    if (!found) {
      const created = {
        cliente_id: clienteId,
        ean: row.ean,
        titolo: rowTitle,
        sku: row.sku,
        fnsku: row.fnsku,
        origine: "entrata",
      };
      toInsert.push(created);
      if (isRealEan(row.ean, rowTitle)) byRealEan.set(row.ean, created);
      else byLooseTitle.set(normalizedText(rowTitle), created);
      if (row.fnsku) byFnsku.set(row.fnsku, created);
      continue;
    }

    const patch = {};
    if (row.titolo && row.titolo !== found.titolo) patch.titolo = row.titolo;
    if (row.ean && row.ean !== found.ean && (!found.ean || !isRealEan(found.ean, found.titolo) || found === foundByFnsku)) patch.ean = row.ean;
    if (row.sku && row.sku !== found.sku) patch.sku = row.sku;
    if (row.fnsku && row.fnsku !== found.fnsku) patch.fnsku = row.fnsku;
    if (Object.keys(patch).length) {
      if (found.id) updates.push({ id: found.id, patch });
      Object.assign(found, patch);
      if (found.ean && isRealEan(found.ean, found.titolo)) byRealEan.set(found.ean, found);
      if (found.fnsku) byFnsku.set(found.fnsku, found);
      if (found.titolo && !isRealEan(found.ean, found.titolo)) byLooseTitle.set(normalizedText(found.titolo), found);
    }
  }

  if (toInsert.length) {
    const { error } = await supabase.from("referenze").insert(toInsert);
    if (error) fail(error.message);
  }
  for (const { id, patch } of updates) {
    const { error } = await supabase.from("referenze").update(patch).eq("id", id);
    if (error) fail(error.message);
  }
}

async function ensureReferenzeFromOperational(clienteId) {
  if (!clienteId) return;

  const [{ data: refs, error: refsError }, { data: entrate, error: entrateError }, { data: preps, error: prepsError }, { data: boxes, error: boxesError }] = await Promise.all([
    supabase.from("referenze").select("*").eq("cliente_id", clienteId),
    supabase.from("entrate").select("id").eq("cliente_id", clienteId),
    supabase.from("preparazioni").select("id").eq("cliente_id", clienteId),
    supabase.from("box").select("contenuto").eq("cliente_id", clienteId),
  ]);
  const firstError = refsError || entrateError || prepsError || boxesError;
  if (firstError) fail(firstError.message);

  const existingRealEan = new Set((refs || []).filter((ref) => isRealEan(ref.ean, ref.titolo)).map((ref) => optionalText(ref.ean)));
  const existingLooseTitle = new Set((refs || []).filter((ref) => !ref.is_bundle && !isRealEan(ref.ean, ref.titolo)).map((ref) => normalizedText(ref.titolo)));
  const byKey = new Map();
  const add = (item = {}) => {
    const ean = optionalText(item.ean);
    if (!ean) return;
    const titolo = optionalText(item.titolo) || ean;
    const real = isRealEan(ean, titolo);
    const key = real ? `ean:${ean}` : `title:${normalizedText(titolo)}`;
    if ((real && existingRealEan.has(ean)) || (!real && existingLooseTitle.has(normalizedText(titolo)))) return;
    if (byKey.has(key)) {
      const found = byKey.get(key);
      found.titolo = found.titolo || optionalText(item.titolo) || ean;
      found.sku = found.sku || optionalText(item.sku);
      found.fnsku = found.fnsku || optionalText(item.fnsku);
      return;
    }
    byKey.set(key, {
      cliente_id: clienteId,
      ean,
      titolo,
      sku: optionalText(item.sku),
      fnsku: optionalText(item.fnsku),
      origine: "entrata",
    });
  };

  const entrataIds = (entrate || []).map((row) => row.id);
  if (entrataIds.length) {
    const { data, error } = await supabase.from("entrate_righe").select("ean,fnsku").in("entrata_id", entrataIds);
    if (error) fail(error.message);
    for (const row of data || []) add(row);
  }

  const prepIds = (preps || []).map((row) => row.id);
  if (prepIds.length) {
    const { data, error } = await supabase.from("preparazioni_righe").select("ean,sku,fnsku").in("preparazione_id", prepIds);
    if (error) fail(error.message);
    for (const row of data || []) add(row);
  }

  for (const box of boxes || []) {
    for (const item of box.contenuto || []) add(item);
  }

  const missing = [...byKey.values()];
  if (missing.length) {
    const { error } = await supabase.from("referenze").insert(missing);
    if (error) fail(error.message);
  }
}

async function uploadReferenzaFoto(id, formData) {
  const file = formData.get("file");
  if (!file) fail("File mancante");
  const { data: ref, error: refError } = await requireSupabase()
    .from("referenze")
    .select("cliente_id")
    .eq("id", id)
    .single();
  if (refError) fail(refError.message);

  const path = `${ref.cliente_id}/referenze/${id}-${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) fail(uploadError.message);

  const publicUrl = fileUrl(path);
  const { data, error } = await supabase
    .from("referenze")
    .update({ foto_url: publicUrl })
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok({ url: publicUrl, referenza: data });
}

async function importReferenze(formData) {
  const file = formData.get("file");
  const clienteId = formData.get("cliente_id");
  if (!file) fail("File mancante");
  if (!file.name.toLowerCase().endsWith(".csv")) {
    fail("Import Excel in migrazione: per ora carica un CSV con colonne EAN, SKU, ASIN, Titolo.");
  }
  const text = await file.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy" });
  if (parsed.errors?.length && !parsed.data?.length) fail(parsed.errors[0].message || "CSV non leggibile");

  const headerAliases = {
    ean: ["ean", "barcode", "codiceean", "codiceabarre", "gtin", "upc", "productid"],
    sku: ["sku", "sellersku", "merchantsku", "codicesku"],
    asin: ["asin", "amazonasin"],
    titolo: ["titolo", "title", "nomeprodotto", "productname", "itemname", "descrizione"],
    fnsku: ["fnsku", "codicefnsku", "fulfillmentnetworksku", "amazonfnsku"],
    peso_kg: ["pesokg", "peso", "weightkg", "weight"],
    lunghezza_cm: ["lunghezzacm", "lunghezza", "lengthcm", "length"],
    larghezza_cm: ["larghezzacm", "larghezza", "widthcm", "width"],
    altezza_cm: ["altezzacm", "altezza", "heightcm", "height"],
  };
  const headerKey = (value) => String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const headers = parsed.meta.fields || [];
  const columnFor = (field) => headers.find((header) => headerAliases[field].includes(headerKey(header)));
  const columns = {
    ean: columnFor("ean"),
    sku: columnFor("sku"),
    asin: columnFor("asin"),
    titolo: columnFor("titolo"),
    fnsku: columnFor("fnsku"),
    peso_kg: columnFor("peso_kg"),
    lunghezza_cm: columnFor("lunghezza_cm"),
    larghezza_cm: columnFor("larghezza_cm"),
    altezza_cm: columnFor("altezza_cm"),
  };
  if (!columns.ean && !columns.titolo) fail("Serve almeno una colonna Titolo o EAN.");

  const cid = await resolveClienteId(clienteId || undefined);
  const rows = parsed.data.map((source) => {
    const value = (field) => columns[field] ? optionalText(source[columns[field]]) : null;
    const measure = (field, fallback) => {
      const parsedValue = Number(String(value(field) || "").replace(",", "."));
      return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
    };
    const ean = value("ean");
    const titolo = value("titolo");
    return {
      cliente_id: cid,
      ean,
      sku: value("sku"),
      asin: value("asin"),
      titolo: titolo || ean,
      fnsku: value("fnsku"),
      peso_kg: measure("peso_kg", 0.5),
      lunghezza_cm: measure("lunghezza_cm", 20),
      larghezza_cm: measure("larghezza_cm", 15),
      altezza_cm: measure("altezza_cm", 10),
      misure_confermate: Boolean(columns.peso_kg && columns.lunghezza_cm && columns.larghezza_cm && columns.altezza_cm),
      origine: "import",
    };
  }).filter((r) => r.titolo);

  const { data: existingRows, error: existingError } = await requireSupabase()
    .from("referenze")
    .select("id,ean,sku,asin,titolo,fnsku,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,misure_confermate")
    .eq("cliente_id", cid);
  if (existingError) fail(existingError.message);

  const byEan = new Map();
  const byFnsku = new Map();
  const byTitleWithoutEan = new Map();
  const indexReference = (reference) => {
    if (normalizedText(reference.ean)) byEan.set(normalizedText(reference.ean), reference);
    if (normalizedText(reference.fnsku)) byFnsku.set(normalizedText(reference.fnsku), reference);
    if (!reference.ean && normalizedText(reference.titolo)) byTitleWithoutEan.set(normalizedText(reference.titolo), reference);
  };
  (existingRows || []).forEach(indexReference);

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = (row.ean && byEan.get(normalizedText(row.ean)))
      || (row.fnsku && byFnsku.get(normalizedText(row.fnsku)))
      || (!row.ean && byTitleWithoutEan.get(normalizedText(row.titolo)));
    if (existing) {
      const patch = {
        titolo: row.titolo || existing.titolo,
        ean: existing.ean || row.ean,
        sku: row.sku || existing.sku,
        asin: row.asin || existing.asin,
        fnsku: row.fnsku || existing.fnsku,
        ...(row.misure_confermate ? {
          peso_kg: row.peso_kg,
          lunghezza_cm: row.lunghezza_cm,
          larghezza_cm: row.larghezza_cm,
          altezza_cm: row.altezza_cm,
          misure_confermate: true,
        } : {}),
      };
      const changed = Object.entries(patch).some(([key, value]) => optionalText(value) !== optionalText(existing[key]));
      if (changed) {
        const { data: saved, error } = await requireSupabase()
          .from("referenze")
          .update(patch)
          .eq("id", existing.id)
          .select("id,ean,sku,asin,titolo,fnsku,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,misure_confermate")
          .single();
        if (error) fail(error.message);
        Object.assign(existing, saved);
        updated += 1;
        indexReference(existing);
      }
      continue;
    }

    const { data: created, error } = await requireSupabase()
      .from("referenze")
      .insert(row)
      .select("id,ean,sku,asin,titolo,fnsku,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,misure_confermate")
      .single();
    if (error) fail(error.message);
    inserted += 1;
    indexReference(created);
  }
  return ok({
    inseriti: inserted,
    aggiornati: updated,
    elaborati: rows.length,
    fnsku_letti: rows.filter((row) => row.fnsku).length,
    errori: [],
    totale_righe: parsed.data.length,
  });
}

async function listEntrate(params) {
  let query = requireSupabase().from("entrate").select("*").order("data_annuncio", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  if (params.get("stato")) query = query.eq("stato", params.get("stato"));
  const { data: entrate, error } = await query;
  if (error) fail(error.message);
  return ok(await enrichEntrate(entrate || []));
}

async function enrichEntrate(entrate) {
  const ids = entrate.map((e) => e.id);
  const { data: righe, error: righeError } = ids.length
    ? await supabase.from("entrate_righe").select("*").in("entrata_id", ids)
    : { data: [], error: null };
  if (righeError) fail(righeError.message);
  const cmap = await clientiMap(entrate.map((e) => e.cliente_id));
  const refs = await refsFor(entrate.map((e) => e.cliente_id));
  const entrataCliente = new Map(entrate.map((e) => [e.id, e.cliente_id]));
  const refByEan = new Map();
  const refByFnsku = new Map();
  for (const ref of refs) {
    if (ref.ean) refByEan.set(`${ref.cliente_id}:${ref.ean}`, ref);
    if (ref.fnsku) refByFnsku.set(`${ref.cliente_id}:${ref.fnsku}`, ref);
  }
  const byEntrata = {};
  for (const r of righe || []) {
    const clienteId = entrataCliente.get(r.entrata_id);
    const ref = refByEan.get(`${clienteId}:${r.ean}`) || refByFnsku.get(`${clienteId}:${r.fnsku}`);
    byEntrata[r.entrata_id] = byEntrata[r.entrata_id] || [];
    byEntrata[r.entrata_id].push({
      ...r,
      titolo: ref?.titolo || null,
      fnsku: r.fnsku || ref?.fnsku || null,
      referenza_id: ref?.id || null,
    });
  }
  return entrate.map((e) => ({
    ...cleanRow(e),
    righe: byEntrata[e.id] || [],
    cliente_ragione_sociale: cmap[e.cliente_id]?.ragione_sociale || null,
  }));
}

async function getEntrata(id) {
  const { data, error } = await requireSupabase().from("entrate").select("*").eq("id", id).single();
  if (error) fail(error.message, 404);
  const [full] = await enrichEntrate([data]);
  return ok(full);
}

async function assertEntrataEditableForProfile(entrataId) {
  const profile = await currentProfile();
  const { data: entrata, error } = await requireSupabase()
    .from("entrate")
    .select("id,cliente_id,stato")
    .eq("id", entrataId)
    .single();
  if (error || !entrata) fail(error?.message || "Entrata non trovata", 404);
  if (isStaff(profile)) return { profile, entrata };
  if (entrata.cliente_id !== profile.cliente_id) fail("Entrata non disponibile per questo cliente", 403);
  if (entrata.stato !== "in_attesa") {
    fail("L'entrata e gia stata ricevuta: per correggere quantita o righe contatta il prep center.", 409);
  }
  return { profile, entrata };
}

async function createEntrata(payload) {
  const cliente_id = await resolveClienteId(payload.cliente_id);
  const { righe = [], ...entrataPayload } = payload;
  await ensureReferenzeForEntrata(cliente_id, righe);
  const { data: entrata, error } = await requireSupabase()
    .from("entrate")
    .insert({ ...entrataPayload, cliente_id })
    .select()
    .single();
  if (error) fail(error.message);
  if (righe.length) {
    const { error: righeError } = await supabase.from("entrate_righe").insert(
      righe.map((r) => ({ entrata_id: entrata.id, ean: r.ean, quantita: r.quantita, fnsku: r.fnsku || null }))
    );
    if (righeError) fail(righeError.message);
  }
  return getEntrata(entrata.id);
}

async function createEntrataRiga(payload) {
  await assertEntrataEditableForProfile(payload.entrata_id);
  const clienteId = await clienteIdForEntrata(payload.entrata_id);
  await ensureReferenzeForEntrata(clienteId, [payload]);

  const { data, error } = await requireSupabase()
    .from("entrate_righe")
    .insert({
      entrata_id: payload.entrata_id,
      ean: payload.ean,
      quantita: Number(payload.quantita || 0),
      fnsku: optionalText(payload.fnsku),
    })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateEntrataRiga(id, payload) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, "ean")) updates.ean = optionalText(payload.ean);
  if (Object.prototype.hasOwnProperty.call(payload, "quantita")) updates.quantita = Number(payload.quantita || 0);
  if (Object.prototype.hasOwnProperty.call(payload, "quantita_ricevuta")) updates.quantita_ricevuta = Math.max(0, Number(payload.quantita_ricevuta || 0));
  if (Object.prototype.hasOwnProperty.call(payload, "fnsku")) updates.fnsku = optionalText(payload.fnsku);
  const hasReferenzaUpdate = Object.prototype.hasOwnProperty.call(payload, "titolo")
    || Object.prototype.hasOwnProperty.call(payload, "ean")
    || Object.prototype.hasOwnProperty.call(payload, "fnsku");
  if (!Object.keys(updates).length && !hasReferenzaUpdate) fail("Nessun campo da aggiornare");

  const { data: current, error: readError } = await requireSupabase()
    .from("entrate_righe")
    .select("entrata_id,ean,fnsku")
    .eq("id", id)
    .single();
  if (readError) fail(readError.message);
  await assertEntrataEditableForProfile(current.entrata_id);
  const clienteId = await clienteIdForEntrata(current.entrata_id);

  if (hasReferenzaUpdate) {
    await ensureReferenzeForEntrata(clienteId, [{
      ...payload,
      ean: updates.ean || current.ean,
      fnsku: Object.prototype.hasOwnProperty.call(payload, "fnsku") ? updates.fnsku : current.fnsku,
    }]);
  }

  let data = current;
  if (Object.keys(updates).length) {
    const { data: updated, error } = await requireSupabase()
      .from("entrate_righe")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) fail(error.message);
    data = updated;
  }
  if (updates.ean && current.ean && updates.ean !== current.ean) {
    await cascadeReferenzaEan(clienteId, current.ean, updates.ean);
  }
  return ok(data);
}

async function deleteEntrataRiga(id) {
  const { data: current, error: readError } = await requireSupabase()
    .from("entrate_righe")
    .select("entrata_id")
    .eq("id", id)
    .single();
  if (readError) fail(readError.message);
  await assertEntrataEditableForProfile(current.entrata_id);

  const { error } = await requireSupabase().from("entrate_righe").delete().eq("id", id);
  if (error) fail(error.message);
  return ok({ ok: true });
}

async function clienteIdForEntrata(entrataId) {
  const { data, error } = await requireSupabase()
    .from("entrate")
    .select("cliente_id")
    .eq("id", entrataId)
    .single();
  if (error) fail(error.message);
  return data.cliente_id;
}

async function updateEntrata(id, payload) {
  await assertEntrataEditableForProfile(id);
  const { data, error } = await requireSupabase()
    .from("entrate")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return getEntrata(data.id);
}

async function deleteEntrata(id) {
  const profile = await currentProfile();
  if (isStaff(profile)) {
    const { data: deleted, error } = await requireSupabase()
      .rpc("admin_delete_entrata", { entrata_id: id });
    if (error) fail(error.message);
    if (!deleted) fail("Entrata non trovata", 404);
    return ok({ ok: true });
  }

  await assertEntrataEditableForProfile(id);
  const { error } = await requireSupabase().from("entrate").delete().eq("id", id);
  if (error) fail(error.message);
  return ok({ ok: true });
}

async function riceviEntrata(id, payload = {}) {
  const { data: righe, error: righeError } = await requireSupabase()
    .from("entrate_righe")
    .select("*")
    .eq("entrata_id", id);
  if (righeError) fail(righeError.message);
  const receivedById = new Map((payload.righe || []).map((row) => [row.id, Math.max(0, Number(row.quantita_ricevuta || 0))]));
  const updates = (righe || []).map((row) => {
    const nextQty = receivedById.has(row.id)
      ? receivedById.get(row.id)
      : entrataRowReceivedQuantity(row, { stato: "ricevuto" });
    return requireSupabase()
      .from("entrate_righe")
      .update({ quantita_ricevuta: nextQty })
      .eq("id", row.id);
  });
  const results = await Promise.all(updates);
  const updateError = results.find((result) => result.error)?.error;
  if (updateError) fail(updateError.message);
  const totalReceived = (righe || []).reduce((sum, row) => {
    const qty = receivedById.has(row.id)
      ? receivedById.get(row.id)
      : entrataRowReceivedQuantity(row, { stato: "ricevuto" });
    return sum + Number(qty || 0);
  }, 0);
  if (totalReceived <= 0) fail("Indica almeno una quantita arrivata prima di segnare l'entrata come ricevuta.");

  const { data, error } = await requireSupabase()
    .from("entrate")
    .update({ stato: "ricevuto", data_ricezione: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return getEntrata(data.id);
}

const WMS_INBOUND_DISPOSITIONS = ["disponibile", "danneggiato", "quarantena"];
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const HOME_STOCK_REFERENCE_NAMES = [
  "Cucchiaini acciaio inox",
  "Cucchiai tavola inox",
  "Forchette tavola inox",
  "Coltelli tavola inox",
  "Bottiglie vetro acqua",
  "Bottiglia termica inox",
  "Bicchieri acqua vetro",
  "Calici vino vetro",
  "Piatti piani ceramica",
  "Piatti fondi ceramica",
  "Piattini dessert ceramica",
  "Tazze caffe espresso",
  "Tazze colazione",
  "Ciotole cereali",
  "Pentola acciaio",
  "Padella antiaderente",
  "Coperchio vetro",
  "Tagliere bambu",
  "Mestolo silicone",
  "Spatola cucina",
  "Barattoli vetro",
  "Contenitori ermetici",
  "Portaposate cassetto",
  "Strofinacci cotone",
  "Spugne cucina",
  "Detersivo piatti",
  "Carta forno",
  "Pellicola alimentare",
  "Sacchetti freezer",
  "Rotolo alluminio",
  "Asciugamani viso",
  "Tappeto bagno",
  "Dispenser sapone",
  "Portasapone",
  "Scopino bagno",
  "Portarotolo carta",
  "Organizer doccia",
  "Cesto bucato",
  "Grucce appendiabiti",
  "Scatole armadio",
  "Panni microfibra",
  "Mop pavimenti",
  "Secchio pulizia",
  "Spruzzino vuoto",
  "Guanti pulizia",
  "Lampadine LED",
  "Multipresa elettrica",
  "Prolunga elettrica",
  "Batterie AA",
  "Nastro adesivo imballo",
];

async function assertWmsStaff() {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato agli operatori di magazzino", 403);
  return profile;
}

function stableHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function shuffledLocations(locations = [], seed = "", count = 0) {
  return [...locations]
    .sort((left, right) => (
      stableHash(`${left?.codice}:${seed}`) - stableHash(`${right?.codice}:${seed}`)
      || naturalLocationSort(left, right)
    ))
    .slice(0, count);
}

function isLocationCodeInAisleRange(location, prefix) {
  const match = String(location?.codice || "").match(/^([SP]1)\+A(\d+)$/);
  const number = Number(match?.[2] || 0);
  return match?.[1] === prefix && Number.isInteger(number) && number >= 1 && number <= 100;
}

async function deleteAllFromTable(tableName) {
  const { error } = await requireSupabase()
    .from(tableName)
    .delete()
    .neq("id", EMPTY_UUID);
  if (error) fail(error.message);
}

async function wmsInboundRecords(entrataId) {
  const [{ data: sessions, error: sessionsError }, { data: locations, error: locationsError }] = await Promise.all([
    requireSupabase()
      .from("wms_inbound_sessions")
      .select("*")
      .eq("entrata_id", entrataId)
      .order("started_at", { ascending: false }),
    requireSupabase()
      .from("wms_locations")
      .select("*")
      .order("codice", { ascending: true }),
  ]);
  const firstError = sessionsError || locationsError;
  if (firstError) fail(firstError.message);

  const sessionIds = (sessions || []).map((session) => session.id);
  const { data: movements, error: movementsError } = sessionIds.length
    ? await requireSupabase()
      .from("wms_inbound_movements")
      .select("*")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (movementsError) fail(movementsError.message);

  return { sessions: sessions || [], locations: locations || [], movements: movements || [] };
}

async function getWmsInbound(entrataId) {
  await assertWmsStaff();
  const [{ data: entrata }, records] = await Promise.all([
    getEntrata(entrataId),
    wmsInboundRecords(entrataId),
  ]);
  const locationMap = Object.fromEntries(records.locations.map((location) => [location.id, location]));
  const rowMap = Object.fromEntries((entrata.righe || []).map((row) => [row.id, row]));
  const totals = {};

  for (const movement of records.movements) {
    totals[movement.entrata_riga_id] = totals[movement.entrata_riga_id] || {
      disponibile: 0,
      danneggiato: 0,
      quarantena: 0,
    };
    totals[movement.entrata_riga_id][movement.disposizione] += Number(movement.quantita || 0);
  }

  const rows = (entrata.righe || []).map((row) => {
    const rowTotals = totals[row.id] || { disponibile: 0, danneggiato: 0, quarantena: 0 };
    if (records.sessions.length === 0 && entrata.stato === "ricevuto") {
      rowTotals.disponibile = entrataRowReceivedQuantity(row, entrata);
    }
    const registrato = rowTotals.disponibile + rowTotals.danneggiato + rowTotals.quarantena;
    const atteso = Number(row.quantita || 0);
    return {
      ...row,
      atteso,
      ricevuto_disponibile: rowTotals.disponibile,
      danneggiato: rowTotals.danneggiato,
      quarantena: rowTotals.quarantena,
      registrato,
      mancante: Math.max(0, atteso - registrato),
      eccedenza: Math.max(0, registrato - atteso),
    };
  });

  return ok({
    entrata: { ...entrata, righe: rows },
    locations: records.locations,
    sessions: records.sessions,
    active_session: records.sessions.find((session) => session.stato === "in_corso") || null,
    movements: records.movements.map((movement) => ({
      ...movement,
      riga: rowMap[movement.entrata_riga_id] || null,
      location: locationMap[movement.location_id] || null,
    })),
  });
}

async function startWmsInbound(entrataId, payload = {}) {
  const profile = await assertWmsStaff();
  const { data: entrata, error: entrataError } = await requireSupabase()
    .from("entrate")
    .select("id,stato")
    .eq("id", entrataId)
    .single();
  if (entrataError || !entrata) fail(entrataError?.message || "Entrata non trovata", 404);
  if (!["in_attesa", "in_lavorazione"].includes(entrata.stato)) {
    fail("Questa entrata e gia stata chiusa e non puo essere ricevuta di nuovo", 409);
  }

  const { data: active, error: activeError } = await requireSupabase()
    .from("wms_inbound_sessions")
    .select("*")
    .eq("entrata_id", entrataId)
    .eq("stato", "in_corso")
    .maybeSingle();
  if (activeError) fail(activeError.message);

  if (!active) {
    const { error: insertError } = await requireSupabase()
      .from("wms_inbound_sessions")
      .insert({
        entrata_id: entrataId,
        operatore_id: profile.id,
        note: optionalText(payload.note),
      });
    if (insertError) fail(insertError.message);
  }

  const { error: updateError } = await requireSupabase()
    .from("entrate")
    .update({ stato: "in_lavorazione" })
    .eq("id", entrataId);
  if (updateError) fail(updateError.message);
  return getWmsInbound(entrataId);
}

async function recomputeWmsInboundAvailable(entrataRigaId) {
  const { data: movements, error } = await requireSupabase()
    .from("wms_inbound_movements")
    .select("quantita")
    .eq("entrata_riga_id", entrataRigaId)
    .eq("disposizione", "disponibile");
  if (error) fail(error.message);
  const quantity = (movements || []).reduce((sum, movement) => sum + Number(movement.quantita || 0), 0);
  const { error: updateError } = await requireSupabase()
    .from("entrate_righe")
    .update({ quantita_ricevuta: quantity })
    .eq("id", entrataRigaId);
  if (updateError) fail(updateError.message);
  return quantity;
}

async function addWmsInboundMovement(entrataId, payload = {}) {
  const profile = await assertWmsStaff();
  const snapshotResponse = await getWmsInbound(entrataId);
  let snapshot = snapshotResponse.data;
  if (!snapshot.active_session) {
    const started = await startWmsInbound(entrataId);
    snapshot = started.data;
  }

  const code = String(payload.codice || payload.code || "").trim();
  const rowId = optionalText(payload.entrata_riga_id);
  const disposition = optionalText(payload.disposizione) || "disponibile";
  const quantity = Math.floor(Number(payload.quantita || 0));
  if (!WMS_INBOUND_DISPOSITIONS.includes(disposition)) fail("Esito ricezione non valido");
  if (!Number.isFinite(quantity) || quantity <= 0) fail("La quantita deve essere maggiore di zero");
  if (!rowId && !code) fail("Scansiona un EAN o un FNSKU");

  const normalizedCode = normalizedText(code);
  const row = (snapshot.entrata.righe || []).find((candidate) => (
    (rowId && candidate.id === rowId)
    || (normalizedCode && [candidate.ean, candidate.fnsku].some((value) => normalizedText(value) === normalizedCode))
  ));
  if (!row) fail(`Codice ${code || rowId} non presente in questa entrata`, 404);
  if (row.registrato + quantity > row.atteso) {
    fail(`Quantita oltre l'atteso per ${row.titolo || row.ean}: restano ${row.mancante} pezzi da registrare.`);
  }

  let locationId = optionalText(payload.location_id);
  if (!locationId && disposition === "quarantena") {
    locationId = snapshot.locations.find((location) => location.codice === "QUARANTENA-01")?.id || null;
  }
  const location = snapshot.locations.find((candidate) => candidate.id === locationId);
  if (!location || location.stato !== "attiva") fail("Seleziona un'ubicazione attiva");
  if (disposition === "quarantena" && location.tipo !== "quarantena") {
    fail("La merce in quarantena deve essere assegnata a un'ubicazione di quarantena");
  }

  const { error: insertError } = await requireSupabase()
    .from("wms_inbound_movements")
    .insert({
      session_id: snapshot.active_session.id,
      entrata_riga_id: row.id,
      location_id: location.id,
      disposizione: disposition,
      quantita: quantity,
      codice_scansionato: code || row.ean || row.fnsku,
      created_by: profile.id,
    });
  if (insertError) fail(insertError.message);

  await recomputeWmsInboundAvailable(row.id);
  return getWmsInbound(entrataId);
}

async function deleteWmsInboundMovement(id) {
  await assertWmsStaff();
  const { data: movement, error: readError } = await requireSupabase()
    .from("wms_inbound_movements")
    .select("id,entrata_riga_id,session_id")
    .eq("id", id)
    .single();
  if (readError || !movement) fail(readError?.message || "Movimento non trovato", 404);
  const { data: session, error: sessionError } = await requireSupabase()
    .from("wms_inbound_sessions")
    .select("entrata_id,stato")
    .eq("id", movement.session_id)
    .single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione inbound non trovata", 404);
  if (session.stato !== "in_corso") fail("Non puoi eliminare movimenti di un inbound gia chiuso", 409);

  const { error: deleteError } = await requireSupabase()
    .from("wms_inbound_movements")
    .delete()
    .eq("id", id);
  if (deleteError) fail(deleteError.message);
  await recomputeWmsInboundAvailable(movement.entrata_riga_id);
  return getWmsInbound(session.entrata_id);
}

async function completeWmsInbound(entrataId, payload = {}) {
  await assertWmsStaff();
  const { data: snapshot } = await getWmsInbound(entrataId);
  if (!snapshot.active_session) fail("Nessuna sessione inbound aperta", 409);
  const missing = (snapshot.entrata.righe || []).reduce((sum, row) => sum + Number(row.mancante || 0), 0);
  if (missing > 0 && !payload.chiudi_con_differenze) {
    fail(`Mancano ancora ${missing} pezzi. Sospendi la sessione oppure conferma la chiusura con differenze.`);
  }

  const completedAt = nowIso();
  const [{ error: sessionError }, { error: entrataError }] = await Promise.all([
    requireSupabase()
      .from("wms_inbound_sessions")
      .update({ stato: "completata", completed_at: completedAt, note: optionalText(payload.note) })
      .eq("id", snapshot.active_session.id),
    requireSupabase()
      .from("entrate")
      .update({ stato: "ricevuto", data_ricezione: completedAt })
      .eq("id", entrataId),
  ]);
  const firstError = sessionError || entrataError;
  if (firstError) fail(firstError.message);
  try {
    await recheckWmsOrderExceptions({ cliente_id: snapshot.entrata.cliente_id, exception_type: "stock", limit: 100 });
  } catch (error) {
    console.warn("Ricontrollo automatico ordini non disponibile", error);
  }
  return getWmsInbound(entrataId);
}

async function createWmsLocation(payload = {}) {
  await assertWmsStaff();
  const codice = String(payload.codice || "").trim().toUpperCase();
  const tipo = optionalText(payload.tipo) || "scaffale";
  if (!codice) fail("Codice ubicazione obbligatorio");
  if (!["scaffale", "slot", "pallet", "terra", "quarantena", "outbound", "packing"].includes(tipo)) fail("Tipo ubicazione non valido");
  const { data, error } = await requireSupabase()
    .from("wms_locations")
    .insert({ codice, zona: optionalText(payload.zona), tipo, note: optionalText(payload.note) })
    .select()
    .single();
  if (error) fail(error.code === "23505" ? "Questa ubicazione esiste gia" : error.message);
  return ok(data);
}

async function generateWmsLocations(payload = {}) {
  const profile = await assertWmsStaff();
  const tipo = String(payload.tipo || "").trim().toLowerCase();
  const blocco = String(payload.blocco || "").trim();
  const bloccoFine = String(payload.blocco_fine ?? payload.blocco ?? "").trim();
  const numeroLivelli = Number(payload.livelli);
  const ubicazioniPerLivello = Number(payload.ubicazioni_per_livello);
  if (!['slot', 'pallet'].includes(tipo)) fail("Scegli slot oppure pallet");
  if (!/^[0-9]{1,5}$/.test(blocco)) fail("Il blocco deve essere un numero, per esempio 101");
  if (!/^[0-9]{1,5}$/.test(bloccoFine)) fail("Il blocco finale deve essere un numero, per esempio 110");
  const blockStart = Number(blocco);
  const blockEnd = Number(bloccoFine);
  if (blockEnd < blockStart) fail("Il blocco finale non puo essere precedente a quello iniziale");
  if (blockEnd - blockStart > 99) fail("Puoi generare al massimo 100 blocchi alla volta");
  const availableLevels = tipo === "pallet" ? ["Z", "Y", "X"] : ["A", "B", "C", "D", "E"];
  if (!Number.isInteger(numeroLivelli) || numeroLivelli < 1 || numeroLivelli > availableLevels.length) {
    fail(`Puoi creare da 1 a ${availableLevels.length} livelli per questo tipo`);
  }
  if (!Number.isInteger(ubicazioniPerLivello) || ubicazioniPerLivello < 1 || ubicazioniPerLivello > 20) {
    fail("Le ubicazioni per livello devono essere comprese tra 1 e 20");
  }
  const prefix = tipo === "pallet" ? "P" : "S";
  const mapWidth = tipo === "pallet" ? 2.7 : 1.6;
  const mapDepth = tipo === "pallet" ? 1.2 : 0.5;
  const levels = availableLevels.slice(0, numeroLivelli);
  const blocks = Array.from({ length: blockEnd - blockStart + 1 }, (_, index) => String(blockStart + index));
  const rows = blocks.flatMap((block) => levels.flatMap((livello) => Array.from({ length: ubicazioniPerLivello }, (_, index) => ({
    codice: `${prefix}${block}+${livello}${index + 1}`,
    zona: `Blocco ${block}`,
    tipo,
    note: `Blocco ${block} · Livello ${livello} · Ubicazione ${index + 1}`,
    map_width: mapWidth,
    map_depth: mapDepth,
  }))));
  if (rows.length > 1000) fail("Puoi generare al massimo 1.000 ubicazioni alla volta");

  const codes = rows.map((row) => row.codice);
  const batches = (items, size = 100) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
  const existing = [];
  for (const codeBatch of batches(codes)) {
    const { data, error } = await requireSupabase()
      .from("wms_locations")
      .select("id,codice,zona,tipo,note,stato")
      .in("codice", codeBatch);
    if (error) fail(error.message);
    existing.push(...(data || []));
  }
  const existingCodes = new Set(existing.map((row) => row.codice));
  const missingRows = rows.filter((row) => !existingCodes.has(row.codice));
  for (const rowBatch of batches(missingRows)) {
    const { error } = await requireSupabase().from("wms_locations").insert(rowBatch);
    if (error) fail(error.message);
  }
  const requestedLocations = [];
  for (const codeBatch of batches(codes)) {
    const { data, error } = await requireSupabase()
      .from("wms_locations")
      .select("*")
      .in("codice", codeBatch);
    if (error) fail(error.message);
    requestedLocations.push(...(data || []));
  }
  const locationByCode = new Map(requestedLocations.map((location) => [location.codice, location]));
  const requestedIds = new Set(requestedLocations.map((location) => location.id));
  const { data: mapSettings, error: mapSettingsError } = await requireSupabase()
    .from("wms_warehouse_map")
    .select("hidden_location_ids")
    .eq("id", true)
    .single();
  if (mapSettingsError) fail(mapSettingsError.message);
  const hiddenLocationIds = (Array.isArray(mapSettings.hidden_location_ids) ? mapSettings.hidden_location_ids : [])
    .filter((id) => !requestedIds.has(id));
  const { error: restoreError } = await requireSupabase()
    .from("wms_warehouse_map")
    .update({ hidden_location_ids: hiddenLocationIds, updated_by: profile.id, updated_at: nowIso() })
    .eq("id", true);
  if (restoreError) fail(restoreError.message);
  return ok({
    tipo,
    blocco,
    blocco_fine: bloccoFine,
    livelli: levels,
    ubicazioni_per_livello: ubicazioniPerLivello,
    create: missingRows.length,
    esistenti: rows.length - missingRows.length,
    locations: codes.map((code) => locationByCode.get(code)).filter(Boolean),
  });
}

async function getWmsWarehouseMap(params = new URLSearchParams()) {
  await assertWmsStaff();
  const [stockResponse, { data: settings, error: settingsError }] = await Promise.all([
    wmsStock(params),
    requireSupabase().from("wms_warehouse_map").select("*").eq("id", true).single(),
  ]);
  if (settingsError) fail(settingsError.message);
  return ok({
    ...stockResponse.data,
    map: settings,
  });
}

function finiteMapNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${label} non valido`);
  return number;
}

async function updateWmsWarehouseMap(payload = {}) {
  const profile = await assertWmsStaff();
  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  if (locations.length > 50000) fail("Puoi aggiornare al massimo 50.000 ubicazioni alla volta");

  const { error: snapshotError } = await requireSupabase().rpc("snapshot_wms_warehouse_map", {
    p_label: "Backup automatico prima del salvataggio",
  });
  if (snapshotError && !String(snapshotError.message || "").includes("Could not find the function")) {
    console.warn("Backup mappa non creato:", snapshotError.message);
  }

  const updates = locations.map((location) => {
    const id = optionalText(location.id);
    if (!id) fail("Ubicazione senza identificativo");
    const mapX = finiteMapNumber(location.map_x, "Coordinata X");
    const mapZ = finiteMapNumber(location.map_z, "Coordinata Z");
    const mapRotation = finiteMapNumber(location.map_rotation || 0, "Rotazione");
    const mapWidth = finiteMapNumber(location.map_width || 1, "Larghezza ubicazione");
    const mapDepth = finiteMapNumber(location.map_depth || 1, "Profondita ubicazione");
    const accessSide = optionalText(location.access_side) || "front";
    if (!["front", "back", "left", "right"].includes(accessSide)) fail("Lato di prelievo non valido");
    if (Math.abs(mapX) > 50 || Math.abs(mapZ) > 50) fail("Le ubicazioni devono restare entro 50 metri dal centro");
    if (mapWidth < 0.1 || mapWidth > 10 || mapDepth < 0.1 || mapDepth > 10) fail("Dimensioni ubicazione non valide");
    return requireSupabase()
      .from("wms_locations")
      .update({ map_x: mapX, map_z: mapZ, map_rotation: mapRotation, map_width: mapWidth, map_depth: mapDepth, access_side: accessSide, map_updated_at: nowIso() })
      .eq("id", id);
  });

  for (let index = 0; index < updates.length; index += 100) {
    const results = await Promise.all(updates.slice(index, index + 100));
    const locationError = results.find((result) => result.error)?.error;
    if (locationError) fail(locationError.message);
  }

  if (payload.map) {
    const width = finiteMapNumber(payload.map.width, "Larghezza mappa");
    const depth = finiteMapNumber(payload.map.depth, "Profondita mappa");
    const entranceX = finiteMapNumber(payload.map.entrance_x, "Ingresso X");
    const entranceZ = finiteMapNumber(payload.map.entrance_z, "Ingresso Z");
    if (width < 10 || width > 100 || depth < 10 || depth > 100) {
      fail("La mappa deve misurare tra 10 e 100 metri");
    }
    const aisles = normalizeAisles(payload.map.aisles);
    const hiddenLocationIds = [...new Set((Array.isArray(payload.map.hidden_location_ids) ? payload.map.hidden_location_ids : [])
      .map((id) => optionalText(id))
      .filter(Boolean))];
    if (hiddenLocationIds.length > 50000) fail("La mappa contiene troppe posizioni nascoste");
    if (aisles.length > 50 || aisles.reduce((sum, aisle) => sum + aisle.points.length, 0) > 300) {
      fail("La mappa contiene troppi corridoi o punti");
    }
    const outsideMap = aisles.some((aisle) => aisle.points.some((point) => Math.abs(point.x) > width / 2 || Math.abs(point.z) > depth / 2));
    if (outsideMap) fail("I corridoi devono restare dentro il perimetro del magazzino");
    const { error } = await requireSupabase()
      .from("wms_warehouse_map")
      .update({
        width,
        depth,
        entrance_x: entranceX,
        entrance_z: entranceZ,
        aisles,
        hidden_location_ids: hiddenLocationIds,
        updated_by: profile.id,
        updated_at: nowIso(),
      })
      .eq("id", true);
    if (error) fail(error.message);
  }

  return getWmsWarehouseMap();
}

function parseDocumentiNote(note = "") {
  const match = String(note || "").match(/\[DOCUMENTI\]([\s\S]*?)\[\/DOCUMENTI\]/);
  if (!match) return { notePulita: note || "", documenti: [] };
  let documenti = [];
  try {
    const parsed = JSON.parse((match[1] || "").trim());
    if (Array.isArray(parsed)) documenti = parsed;
  } catch (_) {
    documenti = [];
  }
  return {
    documenti,
    notePulita: String(note || "").replace(match[0], "").trim(),
  };
}

function buildDocumentiNote(note, documenti) {
  const clean = parseDocumentiNote(note).notePulita;
  const block = `[DOCUMENTI]\n${JSON.stringify(documenti)}\n[/DOCUMENTI]`;
  return clean ? `${clean}\n\n${block}` : block;
}

async function uploadEntrataDocumento(id, formData) {
  const file = formData.get("file");
  const tipo = String(formData.get("tipo") || "documento");
  if (!file) fail("File mancante");
  const { data: entrata, error: readError } = await requireSupabase()
    .from("entrate")
    .select("id,cliente_id,note")
    .eq("id", id)
    .single();
  if (readError || !entrata) fail(readError?.message || "Entrata non trovata");

  const path = `${entrata.cliente_id}/entrate/${id}/documenti/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) fail(uploadError.message);

  const parsed = parseDocumentiNote(entrata.note);
  const nextDocs = [
    ...parsed.documenti,
    { tipo, nome: file.name, url: fileUrl(path), path, created_at: nowIso() },
  ];
  return updateEntrata(id, { note: buildDocumentiNote(entrata.note, nextDocs) });
}

async function listBox(params) {
  let query = requireSupabase().from("box").select("*").order("created_at", { ascending: false });
  for (const key of ["cliente_id", "entrata_id", "preparazione_id", "stato"]) {
    if (params.get(key)) query = query.eq(key, params.get(key));
  }
  const { data, error } = await query;
  if (error) fail(error.message);
  const boxes = data || [];
  const cmap = await clientiMap(boxes.map((b) => b.cliente_id));
  const clienteIds = [...new Set(boxes.map((box) => box.cliente_id).filter(Boolean))];
  const refs = await refsFor(clienteIds);
  const refByEan = new Map();
  const refByFnsku = new Map();
  for (const ref of refs) {
    if (ref.ean) refByEan.set(`${ref.cliente_id}:${ref.ean}`, ref);
    if (ref.fnsku) refByFnsku.set(`${ref.cliente_id}:${ref.fnsku}`, ref);
  }
  const { data: preparazioni, error: prepError } = clienteIds.length
    ? await supabase
      .from("preparazioni")
      .select("id,cliente_id,created_at,data_pronto,stato")
      .in("cliente_id", clienteIds)
    : { data: [], error: null };
  if (prepError) fail(prepError.message);
  const prepIds = (preparazioni || []).map((prep) => prep.id);
  const { data: righePrep, error: righePrepError } = prepIds.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
    : { data: [], error: null };
  if (righePrepError) fail(righePrepError.message);

  const prepsByClient = groupBy(preparazioni || [], "cliente_id");
  const boxesByClient = groupBy(boxes, "cliente_id");
  const righeByClient = (righePrep || []).reduce((acc, row) => {
    const prep = (preparazioni || []).find((p) => p.id === row.preparazione_id);
    if (!prep?.cliente_id) return acc;
    acc[prep.cliente_id] = acc[prep.cliente_id] || [];
    acc[prep.cliente_id].push(row);
    return acc;
  }, {});
  const prepMeta = new Map();
  const fallbackPrepByBoxId = new Map();
  for (const [clientId, rows] of Object.entries(prepsByClient)) {
    const orderedPreps = [...rows].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    orderedPreps.forEach((prep, index) => {
      prepMeta.set(prep.id, {
        preparazione_numero: index + 1,
        preparazione_data: prep.data_pronto || prep.created_at,
        preparazione_stato: prep.stato,
        cliente_id: clientId,
      });
    });

    const groupedBoxes = boxesByPreparazioneWithFallback(
      orderedPreps,
      righeByClient[clientId] || [],
      boxesByClient[clientId] || []
    );
    Object.entries(groupedBoxes).forEach(([prepId, groupBoxes]) => {
      groupBoxes.forEach((box) => {
        if (box.preparazione_id) return;
        fallbackPrepByBoxId.set(box.id, prepId);
      });
    });
  }

  return ok(boxes.map((b) => {
    const effectivePrepId = b.preparazione_id || fallbackPrepByBoxId.get(b.id) || null;
    return {
      ...b,
      contenuto: (b.contenuto || []).map((item) => {
        const ref = refByEan.get(`${b.cliente_id}:${item.ean}`) || (item.fnsku ? refByFnsku.get(`${b.cliente_id}:${item.fnsku}`) : null);
        return {
          ...item,
          titolo: item.titolo || ref?.titolo || null,
          fnsku: item.fnsku || ref?.fnsku || null,
          sku: item.sku || ref?.sku || null,
        };
      }),
      preparazione_id_effettiva: effectivePrepId,
      abbinata_da_contenuto: Boolean(!b.preparazione_id && effectivePrepId),
      ...(prepMeta.get(effectivePrepId) || {}),
      cliente_ragione_sociale: cmap[b.cliente_id]?.ragione_sociale || null,
    };
  }));
}

function applyBoxNumberScope(query, clienteId, preparazioneId) {
  query = query.eq("cliente_id", clienteId);
  return preparazioneId ? query.eq("preparazione_id", preparazioneId) : query.is("preparazione_id", null);
}

async function createBox(payload) {
  let cliente_id = payload.cliente_id;
  if (!cliente_id && payload.entrata_id) {
    const { data } = await supabase.from("entrate").select("cliente_id").eq("id", payload.entrata_id).single();
    cliente_id = data?.cliente_id;
  }
  if (!cliente_id && payload.preparazione_id) {
    const { data } = await supabase.from("preparazioni").select("cliente_id").eq("id", payload.preparazione_id).single();
    cliente_id = data?.cliente_id;
  }
  cliente_id = await resolveClienteId(cliente_id);
  const numeroBox = optionalText(payload.numero_box);
  if (!numeroBox) fail("Il numero box e obbligatorio");
  const duplicateQuery = applyBoxNumberScope(
    requireSupabase().from("box").select("id"),
    cliente_id,
    payload.preparazione_id || null
  );
  const { data: duplicateNumber, error: duplicateError } = await duplicateQuery
    .ilike("numero_box", numeroBox)
    .limit(1)
    .maybeSingle();
  if (duplicateError) fail(duplicateError.message);
  if (duplicateNumber) fail(`Esiste gia un box con numero ${numeroBox}`);

  if (["pronto", "spedito"].includes(payload.stato)) validateBoxOperational(payload);
  const { data, error } = await requireSupabase()
    .from("box")
    .insert({ ...payload, numero_box: numeroBox, cliente_id, contenuto: payload.contenuto || [] })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateBox(id, payload) {
  const { data: current, error: currentError } = await requireSupabase()
    .from("box")
    .select("*")
    .eq("id", id)
    .single();
  if (currentError || !current) fail(currentError?.message || "Box non trovato", 404);
  const next = { ...current, ...payload };

  if (Object.prototype.hasOwnProperty.call(payload, "numero_box")) {
    const numeroBox = optionalText(payload.numero_box);
    if (!numeroBox) fail("Il numero box e obbligatorio");
    const duplicateQuery = applyBoxNumberScope(
      requireSupabase().from("box").select("id"),
      current.cliente_id,
      Object.prototype.hasOwnProperty.call(payload, "preparazione_id") ? payload.preparazione_id : current.preparazione_id
    );
    const { data: duplicateNumber, error: duplicateError } = await duplicateQuery
      .ilike("numero_box", numeroBox)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (duplicateError) fail(duplicateError.message);
    if (duplicateNumber) fail(`Esiste gia un box con numero ${numeroBox}`);
    payload = { ...payload, numero_box: numeroBox };
  }

  const affectsReadiness = ["stato", "contenuto", "peso_kg", "lunghezza_cm", "larghezza_cm", "altezza_cm"]
    .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (current.stato !== "spedito" && affectsReadiness && ["pronto", "spedito"].includes(next.stato)) validateBoxOperational(next);
  const { data, error } = await requireSupabase().from("box").update(payload).eq("id", id).select().single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateBoxStato(id, stato) {
  const { data: current, error } = await requireSupabase().from("box").select("*").eq("id", id).single();
  if (error || !current) fail(error?.message || "Box non trovato", 404);
  if (stato === "spedito" && (!current.etichetta_amazon_pdf_url || !current.etichetta_ups_pdf_url)) {
    fail("Carica prima le etichette Amazon e UPS del box");
  }
  const response = await updateBox(id, { stato, data_spedito: stato === "spedito" ? nowIso() : null });
  if (response.data?.preparazione_id) await syncPreparazioneFromBoxes(response.data.preparazione_id);
  return response;
}

async function deleteBox(id) {
  const { data: current, error: readError } = await requireSupabase()
    .from("box")
    .select("id,stato,preparazione_id")
    .eq("id", id)
    .single();
  if (readError || !current) fail(readError?.message || "Box non trovato", 404);
  if (current.stato === "spedito") fail("Non puoi eliminare un box gia spedito");

  const { error } = await requireSupabase().from("box").delete().eq("id", id);
  if (error) fail(error.message);
  if (current.preparazione_id) await syncPreparazioneFromBoxes(current.preparazione_id);
  return ok({ ok: true });
}

function validateBoxOperational(box = {}) {
  const contenuto = (box.contenuto || []).filter((item) => item?.ean && Number(item.quantita || 0) > 0);
  if (!contenuto.length) fail("Aggiungi almeno un prodotto al box");
  if (!contenuto.every((item) => optionalText(item.fnsku))) {
    fail("Completa l'FNSKU di tutti i prodotti prima di chiudere il box");
  }
  const misure = [box.peso_kg, box.lunghezza_cm, box.larghezza_cm, box.altezza_cm].map(Number);
  if (misure.some((value) => !Number.isFinite(value) || value <= 0)) {
    fail("Inserisci peso e tutte le dimensioni del box");
  }
}

async function syncPreparazioneFromBoxes(preparazioneId) {
  if (!preparazioneId) return null;
  const { data: boxes, error: boxesError } = await requireSupabase()
    .from("box")
    .select("stato,data_spedito")
    .eq("preparazione_id", preparazioneId);
  if (boxesError) fail(boxesError.message);
  if (!boxes?.length) return null;

  let stato = "in_lavorazione";
  if (boxes.every((box) => box.stato === "spedito")) stato = "spedito";
  else if (boxes.every((box) => ["pronto", "spedito"].includes(box.stato))) stato = "pronto";

  const updates = { stato };
  if (stato === "pronto" || stato === "spedito") {
    const { data: prep } = await supabase
      .from("preparazioni")
      .select("data_pronto")
      .eq("id", preparazioneId)
      .single();
    if (!prep?.data_pronto) updates.data_pronto = nowIso();
  }

  const { error } = await requireSupabase()
    .from("preparazioni")
    .update(updates)
    .eq("id", preparazioneId);
  if (error) fail(error.message);
  return updates;
}

async function uploadBoxLabel(id, tipo, formData) {
  const file = formData.get("file");
  if (!file) fail("File mancante");
  const { data: box, error: boxError } = await supabase.from("box").select("cliente_id").eq("id", id).single();
  if (boxError) fail(boxError.message);
  const path = `${box.cliente_id}/box/${id}-${tipo}-${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) fail(uploadError.message);
  const url = fileUrl(path);
  if (tipo === "combined") {
    return updateBox(id, { etichetta_amazon_pdf_url: url, etichetta_ups_pdf_url: url });
  }
  const field = tipo === "amazon" ? "etichetta_amazon_pdf_url" : "etichetta_ups_pdf_url";
  return updateBox(id, { [field]: url });
}

async function uploadBoxLabelsGroup(formData) {
  const file = formData.get("file");
  if (!file) fail("File mancante");
  let boxIds = [];
  try {
    boxIds = JSON.parse(String(formData.get("box_ids") || "[]"));
  } catch {
    fail("Selezione box non valida");
  }
  boxIds = [...new Set((boxIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!boxIds.length) fail("Seleziona almeno una box");

  const { data: boxes, error: boxError } = await requireSupabase()
    .from("box")
    .select("id,cliente_id,preparazione_id,numero_box,stato,etichetta_amazon_pdf_url,etichetta_ups_pdf_url")
    .in("id", boxIds);
  if (boxError) fail(boxError.message);
  if ((boxes || []).length !== boxIds.length) fail("Una o piu box non sono disponibili", 404);

  const clienteIds = [...new Set((boxes || []).map((box) => box.cliente_id))];
  if (clienteIds.length !== 1) fail("Le box selezionate devono appartenere allo stesso cliente");
  const prepIds = [...new Set((boxes || []).map((box) => box.preparazione_id || "__senza_preparazione__"))];
  if (prepIds.length !== 1) fail("Seleziona box della stessa preparazione per caricare un PDF gruppo");
  const nonPronte = (boxes || []).filter((box) => box.stato !== "pronto");
  if (nonPronte.length) fail("Puoi caricare etichette di gruppo solo su box pronte");
  const giaEtichettate = (boxes || []).filter((box) => box.etichetta_amazon_pdf_url || box.etichetta_ups_pdf_url);
  if (giaEtichettate.length) fail("Seleziona solo box senza PDF etichette");

  const sortedBoxes = [...boxes].sort((a, b) => String(a.numero_box || "").localeCompare(String(b.numero_box || ""), "it", { numeric: true }));
  const safeName = String(file.name || "etichette.pdf").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${clienteIds[0]}/box/gruppo-${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) fail(uploadError.message);
  const url = fileUrl(path);

  const { data, error } = await requireSupabase()
    .from("box")
    .update({ etichetta_amazon_pdf_url: url, etichetta_ups_pdf_url: url })
    .in("id", boxIds)
    .select();
  if (error) fail(error.message);
  return ok({
    ok: true,
    url,
    box_ids: boxIds,
    box_numeri: sortedBoxes.map((box) => box.numero_box),
    aggiornate: data?.length || 0,
  });
}

async function listPreparazioni(params) {
  let query = requireSupabase().from("preparazioni").select("*").order("created_at", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  if (params.get("stato")) query = query.eq("stato", params.get("stato"));
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(await enrichPreparazioni(data || []));
}

async function enrichPreparazioni(preps) {
  const ids = preps.map((p) => p.id);
  const [{ data: righe, error: righeError }, { data: boxes, error: boxesError }] = ids.length
    ? await Promise.all([
      supabase.from("preparazioni_righe").select("*").in("preparazione_id", ids),
      supabase.from("box").select("id,preparazione_id,numero_box,stato,data_spedito").in("preparazione_id", ids),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const enrichError = righeError || boxesError;
  if (enrichError) fail(enrichError.message);
  const refs = await refsFor(preps.map((p) => p.cliente_id));
  const cmap = await clientiMap(preps.map((p) => p.cliente_id));
  const prepCliente = new Map(preps.map((p) => [p.id, p.cliente_id]));
  const refByEan = new Map();
  const refByFnsku = new Map();
  for (const ref of refs) {
    if (ref.ean) refByEan.set(`${ref.cliente_id}:${ref.ean}`, ref);
    if (ref.fnsku) refByFnsku.set(`${ref.cliente_id}:${ref.fnsku}`, ref);
  }
  const byPrep = {};
  for (const r of righe || []) {
    const clienteId = prepCliente.get(r.preparazione_id);
    const ref = refByEan.get(`${clienteId}:${r.ean}`) || refByFnsku.get(`${clienteId}:${r.fnsku}`);
    byPrep[r.preparazione_id] = byPrep[r.preparazione_id] || [];
    byPrep[r.preparazione_id].push({ ...r, stato: r.stato || "richiesta", titolo: ref?.titolo, fnsku: r.fnsku || ref?.fnsku || null, referenza_id: ref?.id });
  }
  const boxesByPrep = groupBy(boxes || [], "preparazione_id");
  return preps.map((p) => ({
    ...p,
    ...effectivePreparazioneStatus(p, boxesByPrep[p.id] || []),
    righe: byPrep[p.id] || [],
    box_stati: boxesByPrep[p.id] || [],
    cliente_ragione_sociale: cmap[p.cliente_id]?.ragione_sociale || null,
  }));
}

function effectivePreparazioneStatus(prep, boxes) {
  if (!boxes.length || prep.stato === "spedito") return { stato: prep.stato };
  if (boxes.every((box) => box.stato === "spedito")) {
    const shippedDates = boxes.map((box) => box.data_spedito).filter(Boolean).sort();
    return {
      stato: "spedito",
      stato_db: prep.stato,
      data_spedito: shippedDates[shippedDates.length - 1] || null,
    };
  }
  return { stato: prep.stato };
}

async function refsFor(clienteIds) {
  const ids = [...new Set(clienteIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("referenze").select("*").in("cliente_id", ids);
  if (error) fail(error.message);
  return data || [];
}

async function stockSnapshotForCliente(clienteId, options = {}) {
  const excludedPrepId = options.excludePreparazioneId || null;
  const [
    { data: entrate, error: entrateError },
    { data: righeEntrata, error: righeEntrataError },
    { data: boxes, error: boxesError },
    { data: refs, error: refsError },
    { data: preps, error: prepsError },
  ] = await Promise.all([
    supabase.from("entrate").select("id,stato").eq("cliente_id", clienteId).in("stato", ENTRATA_STOCK_STATUSES),
    supabase.from("entrate_righe").select("*"),
    supabase.from("box").select("id,preparazione_id,stato,contenuto").eq("cliente_id", clienteId),
    supabase.from("referenze").select("*").eq("cliente_id", clienteId),
    supabase.from("preparazioni").select("id,stato").eq("cliente_id", clienteId),
  ]);
  const firstError = entrateError || righeEntrataError || boxesError || refsError || prepsError;
  if (firstError) fail(firstError.message);

  const refsList = refs || [];
  const bundleMap = {};
  const bundleRefs = [];
  const titoloMap = {};
  const fnskuMap = {};
  const skuMap = {};
  const refByEan = {};
  const refByFnsku = {};

  const addSku = (ean, sku) => {
    if (!ean || !sku) return;
    skuMap[ean] ||= new Set();
    skuMap[ean].add(sku);
  };

  const applyReferenceMeta = (ean, ref = {}, fallback = {}) => {
    if (!ean) return;
    const titolo = optionalText(fallback.titolo) || optionalText(ref.titolo);
    const fnsku = optionalText(fallback.fnsku) || optionalText(ref.fnsku);
    const sku = optionalText(fallback.sku) || optionalText(ref.sku);
    if (titolo) titoloMap[ean] ??= titolo;
    if (fnsku) fnskuMap[ean] ??= fnsku;
    addSku(ean, sku);
  };

  for (const ref of refsList) {
    if (ref.ean) {
      refByEan[ref.ean] ??= ref;
      applyReferenceMeta(ref.ean, ref);
    }
    if (ref.fnsku) refByFnsku[ref.fnsku] ??= ref;
    if (ref.ean && ref.is_bundle && ref.componenti?.length) {
      bundleMap[ref.ean] = ref.componenti;
      bundleRefs.push(ref);
    }
  }

  const applyOperationalMeta = (row = {}) => {
    if (!row.ean) return;
    const ref = refByEan[row.ean] || (row.fnsku ? refByFnsku[row.fnsku] : null) || {};
    applyReferenceMeta(row.ean, ref, row);
  };

  const applyBoxItemMeta = (item = {}) => {
    if (!item.ean) return;
    const ref = refByEan[item.ean] || (item.fnsku ? refByFnsku[item.fnsku] : null) || {};
    applyReferenceMeta(item.ean, ref, item);
  };

  const activeOperationalEans = new Set();
  const trackUsageEan = (ean, quantity) => {
    if (!ean || Number(quantity || 0) <= 0) return;
    activeOperationalEans.add(ean);
  };

  const entrataById = new Map((entrate || []).map((entry) => [entry.id, entry]));
  for (const row of righeEntrata || []) {
    const entrata = entrataById.get(row.entrata_id);
    if (!entrata) continue;
    const receivedQty = entrataRowReceivedQuantity(row, entrata);
    applyOperationalMeta(row);
    trackUsageEan(row.ean, receivedQty);
  }

  for (const box of boxes || []) {
    for (const item of box.contenuto || []) {
      applyBoxItemMeta(item);
      trackUsageEan(item.ean, item.quantita);
    }
  }

  const ricevuto = {};
  for (const row of righeEntrata || []) {
    const entrata = entrataById.get(row.entrata_id);
    if (entrata) addUsage(ricevuto, row.ean, entrataRowReceivedQuantity(row, entrata), bundleMap);
  }

  const activePrepIds = new Set((preps || [])
    .filter((prep) => PREP_RESERVING_STATUSES.includes(prep.stato) && prep.id !== excludedPrepId)
    .map((prep) => prep.id));

  const { data: righePrep, error: righePrepError } = activePrepIds.size
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", [...activePrepIds])
    : { data: [], error: null };
  if (righePrepError) fail(righePrepError.message);

  const inPreparazione = {};
  const bundleInPreparazione = {};
  for (const row of righePrep || []) {
    applyOperationalMeta(row);
    trackUsageEan(row.ean, row.quantita);
    addUsage(inPreparazione, row.ean, row.quantita, bundleMap, bundleInPreparazione);
  }

  const spedito = {};
  const bundleSpedito = {};
  for (const box of boxes || []) {
    if (box.stato !== "spedito") continue;
    for (const item of box.contenuto || []) {
      applyBoxItemMeta(item);
      trackUsageEan(item.ean, item.quantita);
      addUsage(spedito, item.ean, item.quantita, bundleMap, bundleSpedito);
    }
  }

  for (const box of boxes || []) {
    if (box.stato === "spedito" || activePrepIds.has(box.preparazione_id)) continue;
    for (const item of box.contenuto || []) {
      applyBoxItemMeta(item);
      trackUsageEan(item.ean, item.quantita);
      addUsage(inPreparazione, item.ean, item.quantita, bundleMap, bundleInPreparazione);
    }
  }

  return {
    refs: refsList,
    activeOperationalEans,
    bundleMap,
    bundleRefs,
    titoloMap,
    fnskuMap,
    skuMap,
    ricevuto,
    inPreparazione,
    bundleInPreparazione,
    spedito,
    bundleSpedito,
  };
}

async function assertPreparazioneDisponibile(clienteId, righe = [], options = {}) {
  const richiesto = contenutoTotals(righe);
  if (!Object.keys(richiesto).length) return;

  const snapshot = await stockSnapshotForCliente(clienteId, options);
  const richiestoInventory = expandedTotalsForInventory(richiesto, snapshot.bundleMap);

  for (const [ean, qty] of Object.entries(richiestoInventory)) {
    const disponibile = Math.max(
      0,
      Number(snapshot.ricevuto[ean] || 0)
      - Number(snapshot.spedito[ean] || 0)
      - Number(snapshot.inPreparazione[ean] || 0)
    );
    if (Number(qty || 0) > disponibile) {
      const titolo = snapshot.titoloMap[ean] || ean;
      fail(`Disponibilita insufficiente per ${titolo}: richiesti ${qty}, disponibili ${disponibile}.`);
    }
  }
}

async function listShopifyOrders(params) {
  const profile = await currentProfile();
  const scopedClienteId = isStaff(profile) ? params.get("cliente_id") : profile.cliente_id;
  let query = requireSupabase()
    .from("shopify_orders")
    .select("*")
    .order("processed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("order_name", { ascending: false });
  if (scopedClienteId) query = query.eq("cliente_id", scopedClienteId);
  if (params.get("wms_status")) query = query.eq("wms_status", params.get("wms_status"));
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(await enrichShopifyOrders(data || []));
}

const FAKE_CARRIER_RATES = {
  gls: { nazionale: 5.90, speciale: 8.90, extra: 0.65 },
  brt: { nazionale: 6.20, speciale: 8.40, extra: 0.55 },
};

const SPECIAL_PROVINCES = new Set([
  "CS", "CZ", "KR", "RC", "VV",
  "AG", "CL", "CT", "EN", "ME", "PA", "RG", "SR", "TP",
  "CA", "NU", "OR", "SS", "SU", "CI", "OT", "OG",
]);

function numberFromListino(listino, key, fallback) {
  const value = Number(listino?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function shippingZoneForOrder(order = {}) {
  const country = optionalText(order.ship_country_code || "IT")?.toUpperCase();
  if (country !== "IT") fail("Il listino demo GLS/BRT copre per ora solo spedizioni nazionali italiane");
  const province = optionalText(order.ship_province)?.toUpperCase();
  const cap = String(order.ship_zip || "").replace(/\D/g, "").padStart(5, "0");
  const specialPrefix = ["07", "08", "09", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98"];
  const special = SPECIAL_PROVINCES.has(province) || specialPrefix.some((prefix) => cap.startsWith(prefix));
  return special
    ? { code: "speciale", label: "Calabria, Sicilia e Sardegna" }
    : { code: "nazionale", label: "Italia nazionale" };
}

function carrierRuleSpecificity(rule, cap, province) {
  if ((rule.postal_codes || []).includes(cap)) return 3;
  if ((rule.postal_codes || []).some((pattern) => pattern.endsWith("*") && cap.startsWith(pattern.slice(0, -1)))) return 2;
  if ((rule.provinces || []).includes(province)) return 1;
  return !(rule.postal_codes || []).length && !(rule.provinces || []).length ? 0 : -1;
}

function matchingCarrierRule(rules, carrier, billableWeight, cap, province) {
  return (rules || [])
    .filter((rule) => rule.carrier === carrier
      && billableWeight >= Number(rule.weight_from_kg)
      && billableWeight <= Number(rule.weight_to_kg))
    .map((rule) => ({ ...rule, specificity: carrierRuleSpecificity(rule, cap, province) }))
    .filter((rule) => rule.specificity >= 0)
    .sort((a, b) => b.specificity - a.specificity
      || Number(b.priority || 0) - Number(a.priority || 0)
      || (Number(a.weight_to_kg) - Number(a.weight_from_kg)) - (Number(b.weight_to_kg) - Number(b.weight_from_kg)))[0] || null;
}

function carrierRate(listino, carrier, zone, billableWeight, rules = [], destination = {}) {
  const defaults = FAKE_CARRIER_RATES[carrier];
  const matchedRule = matchingCarrierRule(rules, carrier, billableWeight, destination.cap, destination.province);
  if (matchedRule) {
    const net = Math.round((Number(matchedRule.price) + Number(matchedRule.surcharge || 0)) * 100) / 100;
    const vatRate = numberFromListino(listino, "iva", 22);
    return {
      carrier, name: carrier.toUpperCase(), service: matchedRule.service || "Standard 24/48h",
      net, gross: Math.round(net * (1 + vatRate / 100) * 100) / 100, vat_rate: vatRate,
      base: Number(matchedRule.price), surcharge: Number(matchedRule.surcharge || 0),
      zone: { code: matchedRule.id, label: matchedRule.zone_name || "Tariffario CSV" },
      rate_source: "csv", rate_id: matchedRule.id,
    };
  }
  const effectiveZone = destination.difficultCarriers?.has(carrier) ? "speciale" : zone;
  const base = numberFromListino(listino, `sped_${carrier}_${effectiveZone}_base`, defaults[effectiveZone]);
  const extra = numberFromListino(listino, `sped_${carrier}_kg_extra`, defaults.extra);
  const net = Math.round((base + Math.max(0, billableWeight - 1) * extra) * 100) / 100;
  const vatRate = numberFromListino(listino, "iva", 22);
  const gross = Math.round(net * (1 + vatRate / 100) * 100) / 100;
  return { carrier, name: carrier.toUpperCase(), service: "Standard 24/48h", net, gross, vat_rate: vatRate, base, extra_per_kg: extra, zone: destination.difficultCarriers?.has(carrier) ? { code: "disagiata", label: "CAP disagiato GLS" } : shippingZoneForOrder(destination.order), rate_source: "fallback" };
}

async function computeWmsShippingQuote(orderId) {
  const profile = await currentProfile();
  const sb = requireSupabase();
  const { data: order, error: orderError } = await sb.from("shopify_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);
  if (!isStaff(profile) && order.cliente_id !== profile.cliente_id) fail("Ordine non accessibile", 403);
  if (!optionalText(order.ship_zip)) fail("Inserisci il CAP di destinazione prima di calcolare la spedizione");

  const normalizedPostalCode = String(order.ship_zip || "").replace(/\D/g, "").padStart(5, "0");
  const [{ data: items, error: itemsError }, { data: client, error: clientError }, { data: packing, error: packingError }, { data: carrierRules, error: carrierRulesError }, { data: postalRows, error: postalError }, { data: carrierZones, error: carrierZonesError }] = await Promise.all([
    sb.from("shopify_order_items").select("id,referenza_id,titolo,quantita").eq("order_id", order.id),
    sb.from("clienti").select("id,listino").eq("id", order.cliente_id).single(),
    sb.from("wms_packing_sessions").select("id,stato,started_at").eq("order_id", order.id).maybeSingle(),
    sb.from("client_carrier_rates").select("*").eq("cliente_id", order.cliente_id),
    sb.from("italian_postal_codes").select("postal_code,municipality_name,province_code,province_name,region_name").eq("postal_code", normalizedPostalCode).limit(1),
    sb.from("carrier_postal_zones").select("carrier,zone_code,zone_name,is_current_postal_code").eq("postal_code", normalizedPostalCode).eq("active", true),
  ]);
  if (itemsError || clientError || packingError || carrierRulesError || postalError || carrierZonesError) fail((itemsError || clientError || packingError || carrierRulesError || postalError || carrierZonesError).message);
  if (!(postalRows || []).length && !(carrierZones || []).length) fail(`CAP ${normalizedPostalCode} non presente nell'anagrafica italiana o nei listini corriere`);
  const postalDestination = postalRows?.[0] || { postal_code: normalizedPostalCode, municipality_name: "CAP corriere legacy", province_code: "", province_name: "", region_name: "" };
  if (!(items || []).length) fail("L'ordine non contiene prodotti");
  const referenceIds = [...new Set((items || []).map((item) => item.referenza_id).filter(Boolean))];
  const { data: references, error: referencesError } = referenceIds.length
    ? await sb.from("referenze").select("id,titolo,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,misure_confermate").in("id", referenceIds)
    : { data: [], error: null };
  if (referencesError) fail(referencesError.message);
  const referenceMap = new Map((references || []).map((reference) => [reference.id, reference]));
  const missing = (items || []).filter((item) => !item.referenza_id || !referenceMap.has(item.referenza_id));
  if (missing.length) fail(`Collega ${missing.length} ${missing.length === 1 ? "prodotto" : "prodotti"} dell'ordine al catalogo prima del preventivo`);

  let actualWeight = 0;
  let volumeCm3 = 0;
  let estimatedReferences = 0;
  const lines = (items || []).map((item) => {
    const reference = referenceMap.get(item.referenza_id);
    const quantity = Math.max(1, Number(item.quantita || 1));
    const weight = Number(reference.peso_kg) * quantity;
    const volume = Number(reference.lunghezza_cm) * Number(reference.larghezza_cm) * Number(reference.altezza_cm) * quantity;
    actualWeight += weight;
    volumeCm3 += volume;
    if (!reference.misure_confermate) estimatedReferences += 1;
    return { title: reference.titolo || item.titolo, quantity, weight_kg: Math.round(weight * 1000) / 1000, volume_cm3: Math.round(volume) };
  });
  const divisor = Math.max(1, numberFromListino(client.listino, "sped_peso_volumetrico_divisore", 5000));
  const volumetricWeight = volumeCm3 / divisor;
  const billableWeight = Math.max(1, Math.ceil(Math.max(actualWeight, volumetricWeight) * 2) / 2);
  const destinationOrder = {
    ...order,
    ship_province: optionalText(order.ship_province)?.toUpperCase() || postalDestination.province_code || "",
  };
  const zone = shippingZoneForOrder(destinationOrder);
  const destination = {
    cap: normalizedPostalCode,
    province: destinationOrder.ship_province,
    order: destinationOrder,
    difficultCarriers: new Set((carrierZones || []).filter((item) => item.zone_code === "disagiata").map((item) => item.carrier)),
  };
  const carriers = ["gls", "brt"].map((carrier) => carrierRate(client.listino, carrier, zone.code, billableWeight, carrierRules || [], destination));
  const recommended = [...carriers].sort((a, b) => a.net - b.net || a.name.localeCompare(b.name))[0].carrier;
  const locked = ["in_packing", "imballato", "spedito", "annullato"].includes(order.wms_status)
    || Boolean(packing?.started_at)
    || ["in_corso", "completata"].includes(packing?.stato);

  return {
    order_id: order.id,
    order_name: order.order_name,
    selected_carrier: order.selected_carrier,
    confirmed_price: order.shipping_price == null ? null : Number(order.shipping_price),
    confirmed_at: order.shipping_confirmed_at,
    locked,
    lock_reason: locked ? "Il packing è già iniziato: corriere e prezzo sono bloccati." : null,
    zone,
    destination: postalDestination,
    carrier_zones: carrierZones || [],
    actual_weight_kg: Math.round(actualWeight * 1000) / 1000,
    volumetric_weight_kg: Math.round(volumetricWeight * 1000) / 1000,
    billable_weight_kg: billableWeight,
    volumetric_divisor: divisor,
    estimated_references: estimatedReferences,
    lines,
    carriers,
    csv_tariff_rows: (carrierRules || []).length,
    recommended,
    simulated: true,
  };
}

async function getWmsShippingQuote(orderId) {
  let quote = await computeWmsShippingQuote(orderId);
  if (!quote.selected_carrier && !quote.locked && quote.recommended) {
    const { data, error } = await requireSupabase().rpc("confirm_wms_shipping_choice", {
      p_order_id: orderId,
      p_carrier: quote.recommended,
    });
    if (!error) {
      const saved = Array.isArray(data) ? data[0] : data;
      quote = {
        ...quote,
        selected_carrier: quote.recommended,
        confirmed_price: Number(saved.shipping_price),
        confirmed_at: saved.shipping_confirmed_at,
        automatic_choice: true,
      };
    }
  }
  return ok(quote);
}

const WMS_PACKAGING_NAMES = {
  small_box: "Scatola piccola",
  medium_box: "Scatola media",
  large_box: "Scatola grande",
  courier_bag: "Busta corriere",
};

async function getWmsOrderCostDetail(orderId) {
  const profile = await currentProfile();
  const sb = requireSupabase();
  const { data: order, error: orderError } = await sb.from("shopify_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);
  if (!isStaff(profile) && order.cliente_id !== profile.cliente_id) fail("Ordine non accessibile", 403);

  const [{ data: items, error: itemsError }, { data: client, error: clientError }, { data: usage, error: usageError }] = await Promise.all([
    sb.from("shopify_order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true }),
    sb.from("clienti").select("id,ragione_sociale,listino").eq("id", order.cliente_id).single(),
    sb.from("wms_order_packaging_usage").select("packaging_code,quantity,unit_price_snapshot,scanned_at").eq("order_id", orderId).maybeSingle(),
  ]);
  if (itemsError || clientError || usageError) fail((itemsError || clientError || usageError).message);

  let quote = null;
  let quoteError = null;
  try {
    quote = (await getWmsShippingQuote(orderId)).data;
  } catch (error) {
    quoteError = error?.message || "Preventivo spedizione non disponibile";
  }
  const pieces = (items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
  const listino = client?.listino || {};
  const baseFee = pieces > 0 ? numberFromListino(listino, "wms_order_base_fee", 0) : 0;
  const extraPieces = Math.max(0, pieces - 1);
  const extraUnitFee = numberFromListino(listino, "wms_extra_item_fee", 0);
  const packagingTotal = Number(usage?.unit_price_snapshot || 0) * Number(usage?.quantity || 0);
  const selectedQuote = quote?.carriers?.find((carrier) => carrier.carrier === quote.selected_carrier)
    || quote?.carriers?.find((carrier) => carrier.carrier === quote.recommended)
    || null;
  const shippingTotal = quote?.confirmed_price ?? selectedQuote?.net ?? (order.shipping_price == null ? null : Number(order.shipping_price));
  const fulfillmentTotal = baseFee + (extraPieces * extraUnitFee);
  return ok({
    order: { ...order, items: items || [], cliente_ragione_sociale: client?.ragione_sociale || null },
    quote,
    quote_error: quoteError,
    packaging: usage ? { ...usage, name: WMS_PACKAGING_NAMES[usage.packaging_code] || usage.packaging_code, total: packagingTotal } : null,
    costs: {
      shipping: shippingTotal,
      base_fee: baseFee,
      extra_pieces: extraPieces,
      extra_unit_fee: extraUnitFee,
      extra_total: extraPieces * extraUnitFee,
      fulfillment: fulfillmentTotal,
      packaging: packagingTotal,
      total: shippingTotal == null ? null : shippingTotal + fulfillmentTotal + packagingTotal,
    },
  });
}

async function getItalianPostalCodeStats() {
  const { data, error } = await requireSupabase().rpc("italian_postal_code_stats");
  if (error) fail(error.message);
  return ok(data || {});
}

async function confirmWmsShippingChoice(orderId, payload = {}) {
  const carrier = optionalText(payload.carrier)?.toLowerCase();
  if (!["gls", "brt"].includes(carrier)) fail("Scegli GLS oppure BRT");
  const quote = await computeWmsShippingQuote(orderId);
  if (quote.locked) fail(quote.lock_reason, 409);
  const { data, error } = await requireSupabase().rpc("confirm_wms_shipping_choice", {
    p_order_id: orderId,
    p_carrier: carrier,
  });
  if (error) fail(error.message);
  const saved = Array.isArray(data) ? data[0] : data;
  return ok({ order: saved, quote: { ...quote, selected_carrier: carrier, confirmed_price: Number(saved.shipping_price), confirmed_at: saved.shipping_confirmed_at } });
}

const CSV_ORDER_FIELD_ALIASES = {
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
  address2: ["indirizzo_2", "address2"],
  zip: ["cap", "zip", "postal_code"],
  city: ["citta", "city"],
  province: ["provincia", "province"],
  country: ["paese", "country"],
  country_code: ["codice_paese", "country_code"],
  phone: ["telefono", "phone"],
  email: ["email", "e_mail"],
  note: ["note", "nota"],
};

function csvHeaderKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvField(row, field) {
  const normalized = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [csvHeaderKey(key), value]));
  for (const alias of CSV_ORDER_FIELD_ALIASES[field] || []) {
    const value = normalized[alias];
    if (String(value ?? "").trim()) return String(value).trim();
  }
  return "";
}

function csvOrderIdentifier(orderNumber) {
  return `csv:${String(orderNumber).trim().toLowerCase()}`;
}

function csvItemIdentifier(item, index) {
  const key = normalizedText(item.ean || item.sku || item.fnsku || item.title).replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  return `csv:${index + 1}:${key || "riga"}`;
}

function normalizeCsvOrders(rows = []) {
  const errors = [];
  const grouped = new Map();

  rows.forEach((sourceRow, index) => {
    const rowNumber = index + 2;
    const orderNumber = csvField(sourceRow, "order_number");
    const ean = csvField(sourceRow, "ean");
    const sku = csvField(sourceRow, "sku");
    const fnsku = csvField(sourceRow, "fnsku");
    const rawQuantity = csvField(sourceRow, "quantity").replace(",", ".");
    const quantity = Number(rawQuantity);

    if (!orderNumber) errors.push(`Riga ${rowNumber}: numero ordine mancante.`);
    if (!ean && !sku && !fnsku) errors.push(`Riga ${rowNumber}: inserisci almeno EAN, SKU o FNSKU.`);
    if (!Number.isInteger(quantity) || quantity <= 0) errors.push(`Riga ${rowNumber}: quantita non valida.`);
    if (!orderNumber || (!ean && !sku && !fnsku) || !Number.isInteger(quantity) || quantity <= 0) return;

    if (!grouped.has(orderNumber)) {
      grouped.set(orderNumber, {
        order_number: orderNumber,
        processed_at: csvField(sourceRow, "processed_at"),
        recipient: csvField(sourceRow, "recipient"),
        company: csvField(sourceRow, "company"),
        address1: csvField(sourceRow, "address1"),
        address2: csvField(sourceRow, "address2"),
        zip: csvField(sourceRow, "zip"),
        city: csvField(sourceRow, "city"),
        province: csvField(sourceRow, "province"),
        country: csvField(sourceRow, "country"),
        country_code: csvField(sourceRow, "country_code"),
        phone: csvField(sourceRow, "phone"),
        email: csvField(sourceRow, "email"),
        note: csvField(sourceRow, "note"),
        items: new Map(),
      });
    }

    const order = grouped.get(orderNumber);
    const itemKey = `${normalizedText(ean)}|${normalizedText(sku)}|${normalizedText(fnsku)}`;
    const existing = order.items.get(itemKey);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    order.items.set(itemKey, {
      ean,
      sku,
      fnsku,
      title: csvField(sourceRow, "title"),
      quantity,
      source_row: rowNumber,
    });
  });

  return {
    errors,
    orders: [...grouped.values()].map((order) => ({ ...order, items: [...order.items.values()] })),
  };
}

function csvDateOrNow(value) {
  if (!value) return nowIso();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

async function importCsvWmsOrders(payload = {}) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);
  const { data, error } = await sb.functions.invoke("wms-import-csv-orders", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile importare il CSV"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function enrichShopifyOrders(orders) {
  const ids = orders.map((order) => order.id);
  const [{ data: items, error: itemsError }, { data: packagingUsage, error: packagingError }] = ids.length
    ? await Promise.all([
      supabase.from("shopify_order_items").select("*").in("order_id", ids),
      supabase.from("wms_order_packaging_usage").select("order_id,packaging_code,quantity,unit_price_snapshot,scanned_at").in("order_id", ids),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (itemsError || packagingError) fail((itemsError || packagingError).message);
  const cmap = await clientiMap(orders.map((order) => order.cliente_id));
  const byOrder = {};
  for (const item of items || []) {
    byOrder[item.order_id] = byOrder[item.order_id] || [];
    byOrder[item.order_id].push(item);
  }
  const packagingByOrder = Object.fromEntries((packagingUsage || []).map((usage) => [usage.order_id, usage]));
  return orders.map((order) => {
    const orderItems = byOrder[order.id] || [];
    const pieces = orderItems.reduce((sum, item) => sum + Number(item.quantita || 0), 0);
    const listino = cmap[order.cliente_id]?.listino || {};
    const baseFee = pieces > 0 ? numberFromListino(listino, "wms_order_base_fee", 0) : 0;
    const extraPieces = Math.max(0, pieces - 1);
    const extraUnitFee = numberFromListino(listino, "wms_extra_item_fee", 0);
    const packaging = packagingByOrder[order.id] || null;
    const packagingTotal = Number(packaging?.unit_price_snapshot || 0) * Number(packaging?.quantity || 0);
    const shippingTotal = order.shipping_price == null ? null : Number(order.shipping_price);
    const fulfillmentTotal = baseFee + (extraPieces * extraUnitFee);
    return {
      ...order,
      items: orderItems,
      packaging_usage: packaging,
      cost_summary: {
        shipping: shippingTotal,
        base_fee: baseFee,
        extra_pieces: extraPieces,
        extra_unit_fee: extraUnitFee,
        extra_total: extraPieces * extraUnitFee,
        fulfillment: fulfillmentTotal,
        packaging: packagingTotal,
        total: shippingTotal == null ? null : shippingTotal + fulfillmentTotal + packagingTotal,
      },
      cliente_ragione_sociale: cmap[order.cliente_id]?.ragione_sociale || null,
    };
  });
}

async function updateShopifyOrderStatus(id, payload = {}) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);

  const allowed = ["in_verifica", "eccezione", "in_attesa_refill", "da_preparare", "hold", "in_preparazione", "in_attesa_packing", "in_packing", "imballato", "spedito", "annullato"];
  const stato = optionalText(payload.wms_status || payload.stato);
  if (!allowed.includes(stato)) fail("Stato ordine WMS non valido");

  const { data: order, error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .select("id,wms_status")
    .eq("id", id)
    .single();
  if (orderError || !order) fail(orderError?.message || "Ordine WMS non trovato", 404);

  if (["in_preparazione", "in_attesa_packing"].includes(stato)) {
    const { data: items, error: itemsError } = await requireSupabase()
      .from("shopify_order_items")
      .select("id,referenza_id,titolo")
      .eq("order_id", id);
    if (itemsError) fail(itemsError.message);
    const missing = (items || []).filter((item) => !item.referenza_id);
    if (missing.length) {
      fail(`Collega prima ${missing.length} ${missing.length === 1 ? "riga" : "righe"} alle referenze di magazzino.`);
    }
  }

  const { data, error } = await requireSupabase()
    .from("shopify_orders")
    .update({ wms_status: stato, updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateClientOrder(id, payload = {}) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);
  const { data, error } = await sb.functions.invoke("wms-update-client-order", {
    body: { ...payload, order_id: id },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Impossibile modificare l'ordine"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function listWmsShipments(params) {
  const profile = await currentProfile();
  const scopedClienteId = isStaff(profile) ? params.get("cliente_id") : profile.cliente_id;
  let query = requireSupabase().from("wms_shipments").select("*").order("created_at", { ascending: false });
  if (scopedClienteId) query = query.eq("cliente_id", scopedClienteId);
  if (params.get("order_id")) query = query.eq("order_id", params.get("order_id"));
  if (params.get("stato")) query = query.eq("stato", params.get("stato"));
  const { data, error } = await query;
  if (error) fail(error.message);

  const orderIds = [...new Set((data || []).map((shipment) => shipment.order_id).filter(Boolean))];
  const { data: orders, error: ordersError } = orderIds.length
    ? await supabase.from("shopify_orders").select("id,order_name,shop_domain,wms_status").in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) fail(ordersError.message);
  const orderMap = Object.fromEntries((orders || []).map((order) => [order.id, order]));

  return ok((data || []).map((shipment) => ({
    ...shipment,
    order: shipment.order_id ? orderMap[shipment.order_id] || null : null,
  })));
}

async function listSupportTickets(params) {
  const profile = await currentProfile();
  const scopedClienteId = isStaff(profile) ? params.get("cliente_id") : profile.cliente_id;
  let query = requireSupabase().from("support_tickets").select("*").order("updated_at", { ascending: false });
  if (scopedClienteId) query = query.eq("cliente_id", scopedClienteId);
  if (params.get("status")) query = query.eq("status", params.get("status"));
  const { data, error } = await query;
  if (error) fail(error.message);

  const orderIds = [...new Set((data || []).map((row) => row.order_id).filter(Boolean))];
  const clientIds = [...new Set((data || []).map((row) => row.cliente_id).filter(Boolean))];
  const [ordersRes, clientsRes] = await Promise.all([
    orderIds.length ? supabase.from("shopify_orders").select("id,order_name,wms_status").in("id", orderIds) : { data: [], error: null },
    clientIds.length ? supabase.from("clienti").select("id,ragione_sociale").in("id", clientIds) : { data: [], error: null },
  ]);
  const firstError = ordersRes.error || clientsRes.error;
  if (firstError) fail(firstError.message);
  const orderMap = Object.fromEntries((ordersRes.data || []).map((row) => [row.id, row]));
  const clientMap = Object.fromEntries((clientsRes.data || []).map((row) => [row.id, row]));
  return ok((data || []).map((row) => ({ ...row, order: orderMap[row.order_id] || null, cliente: clientMap[row.cliente_id] || null })));
}

async function listSupportMessages(ticketId) {
  const { data, error } = await requireSupabase()
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) fail(error.message);
  const authorIds = [...new Set((data || []).map((row) => row.author_id).filter(Boolean))];
  const { data: authors, error: authorError } = authorIds.length
    ? await supabase.from("profiles").select("id,name,role").in("id", authorIds)
    : { data: [], error: null };
  if (authorError) fail(authorError.message);
  const authorMap = Object.fromEntries((authors || []).map((row) => [row.id, row]));
  return ok((data || []).map((row) => ({ ...row, author: authorMap[row.author_id] || null })));
}

async function createSupportTicket(payload = {}) {
  const profile = await currentProfile();
  const clienteId = isStaff(profile) ? payload.cliente_id : profile.cliente_id;
  if (!clienteId) fail("Cliente obbligatorio");
  if (!String(payload.subject || "").trim()) fail("Oggetto obbligatorio");
  const { data, error } = await requireSupabase().from("support_tickets").insert({
    cliente_id: clienteId,
    order_id: payload.order_id || null,
    subject: String(payload.subject).trim(),
    category: payload.category || "ordine",
    priority: payload.priority || "normale",
    created_by: profile.id,
  }).select().single();
  if (error) fail(error.message);
  if (String(payload.message || "").trim()) {
    await createSupportMessage(data.id, { body: payload.message, internal: false });
  }
  return ok(data);
}

async function createSupportMessage(ticketId, payload = {}) {
  const profile = await currentProfile();
  const body = String(payload.body || "").trim();
  if (!body) fail("Messaggio obbligatorio");
  const { data, error } = await requireSupabase().from("support_ticket_messages").insert({
    ticket_id: ticketId,
    author_id: profile.id,
    body,
    internal: isStaff(profile) ? Boolean(payload.internal) : false,
  }).select().single();
  if (error) fail(error.message);
  await supabase.from("support_tickets").update({ updated_at: nowIso() }).eq("id", ticketId);
  return ok(data);
}

async function updateSupportTicket(ticketId, payload = {}) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Solo Aimago puo aggiornare lo stato del ticket", 403);
  const allowed = ["status", "priority", "assigned_to"];
  const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
  updates.updated_at = nowIso();
  const { data, error } = await requireSupabase().from("support_tickets").update(updates).eq("id", ticketId).select().single();
  if (error) fail(error.message);
  return ok(data);
}

async function listWmsReturns(params) {
  const profile = await currentProfile();
  const scopedClienteId = isStaff(profile) ? params.get("cliente_id") : profile.cliente_id;
  let query = requireSupabase().from("wms_returns").select("*").order("updated_at", { ascending: false });
  if (scopedClienteId) query = query.eq("cliente_id", scopedClienteId);
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(data || []);
}

async function createWmsShipment(payload) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);

  const orderId = String(payload.order_id || "").trim();
  if (!orderId) fail("Ordine WMS obbligatorio");

  const { data: order, error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);

  const destinatario = {
    nome: order.ship_name,
    azienda: order.ship_company,
    indirizzo1: order.ship_address1,
    indirizzo2: order.ship_address2,
    cap: order.ship_zip,
    citta: order.ship_city,
    provincia: order.ship_province,
    paese: order.ship_country,
    paese_codice: order.ship_country_code,
    telefono: order.customer_phone,
    email: order.customer_email,
  };

  const missing = [];
  if (!destinatario.nome) missing.push("nome destinatario");
  if (!destinatario.indirizzo1) missing.push("indirizzo");
  if (!destinatario.cap) missing.push("CAP");
  if (!destinatario.citta) missing.push("citta");
  if (missing.length) {
    fail(`Mancano dati per creare la spedizione: ${missing.join(", ")}. Reimporta gli ordini Shopify o completa l'indirizzo.`);
  }

  const row = {
    cliente_id: order.cliente_id,
    order_id: order.id,
    corriere: payload.corriere || order.selected_carrier || "manuale",
    servizio: payload.servizio || null,
    stato: "bozza",
    colli: Math.max(1, Number(payload.colli || 1)),
    peso_kg: payload.peso_kg ? Number(payload.peso_kg) : (order.shipping_billable_weight ? Number(order.shipping_billable_weight) : null),
    destinatario,
    payload: {
      origine: "ordine_wms",
      order_name: order.order_name,
      shop_domain: order.shop_domain,
      shipping_price: order.shipping_price == null ? null : Number(order.shipping_price),
      shipping_zone: order.shipping_zone || null,
      simulated_carrier_quote: Boolean(order.selected_carrier),
    },
  };

  const { data, error } = await requireSupabase()
    .from("wms_shipments")
    .insert(row)
    .select()
    .single();
  if (error) fail(error.message);

  return ok(data);
}

async function updateWmsShipment(id, payload) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);

  const { data: existing, error: existingError } = await requireSupabase()
    .from("wms_shipments")
    .select("id,stato,label_url,destinatario")
    .eq("id", id)
    .single();
  if (existingError || !existing) fail(existingError?.message || "Spedizione non trovata", 404);
  if (existing.label_url || existing.stato === "creata") {
    fail("Etichetta gia generata: non puoi modificare questa spedizione");
  }

  const updates = {};
  if (payload.corriere) updates.corriere = String(payload.corriere).toLowerCase();
  if (payload.servizio !== undefined) updates.servizio = payload.servizio || null;
  if (payload.colli !== undefined) updates.colli = Math.max(1, Number(payload.colli || 1));
  if (payload.peso_kg !== undefined) updates.peso_kg = payload.peso_kg ? Number(payload.peso_kg) : null;
  if (payload.destinatario && typeof payload.destinatario === "object") {
    updates.destinatario = {
      ...(existing.destinatario || {}),
      ...Object.fromEntries(
        Object.entries(payload.destinatario).map(([key, value]) => [
          key,
          typeof value === "string" ? value.trim() : value,
        ])
      ),
    };
  }

  if (!Object.keys(updates).length) fail("Nessuna modifica da salvare");
  if (existing.stato === "errore") {
    updates.stato = "bozza";
    updates.errore = null;
    updates.response = null;
    updates.carrier_reference = null;
  }

  const { data, error } = await requireSupabase()
    .from("wms_shipments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function getPreparazione(id) {
  const { data, error } = await requireSupabase().from("preparazioni").select("*").eq("id", id).single();
  if (error) fail(error.message, 404);
  const [full] = await enrichPreparazioni([data]);
  return ok(full);
}

async function createPreparazione(payload) {
  const cliente_id = await resolveClienteId(payload.cliente_id);
  const { righe = [], ...prepPayload } = payload;
  await assertPreparazioneDisponibile(cliente_id, righe);
  const { data: prep, error } = await requireSupabase()
    .from("preparazioni")
    .insert({ ...prepPayload, cliente_id })
    .select()
    .single();
  if (error) fail(error.message);
  if (righe.length) {
    const { error: righeError } = await supabase.from("preparazioni_righe").insert(
      righe.map((r) => ({
        preparazione_id: prep.id,
        ean: r.ean,
        sku: r.sku || null,
        fnsku: r.fnsku || null,
        quantita: r.quantita,
        servizi: r.servizi || [],
        stato: "richiesta",
      }))
    );
    if (righeError) fail(righeError.message);
  }
  return getPreparazione(prep.id);
}

async function updatePreparazioneStato(id, stato) {
  const { data: current, error: readError } = await requireSupabase()
    .from("preparazioni")
    .select("data_pronto")
    .eq("id", id)
    .single();
  if (readError) fail(readError.message);

  const updates = { stato };
  if (stato === "pronto" && !current?.data_pronto) updates.data_pronto = nowIso();

  const { data, error } = await requireSupabase()
    .from("preparazioni")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  const rowUpdates = { stato };
  if (stato === "in_lavorazione") rowUpdates.data_in_lavorazione = nowIso();
  if (stato === "pronto") {
    rowUpdates.data_in_lavorazione = nowIso();
    rowUpdates.data_pronto = updates.data_pronto || current?.data_pronto || nowIso();
  }
  const { error: rowStatusError } = await requireSupabase()
    .from("preparazioni_righe")
    .update(rowUpdates)
    .eq("preparazione_id", id);
  if (rowStatusError) fail(rowStatusError.message);
  return getPreparazione(data.id);
}

async function updatePreparazione(id, payload) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, "note")) updates.note = payload.note || "";
  if (!Object.keys(updates).length) fail("Nessun campo da aggiornare");

  const { data, error } = await requireSupabase()
    .from("preparazioni")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return getPreparazione(data.id);
}

async function createPreparazioneRiga(payload) {
  const clienteId = await clienteIdForPreparazione(payload.preparazione_id);
  const { data: prep, error: prepError } = await requireSupabase()
    .from("preparazioni")
    .select("id,stato")
    .eq("id", payload.preparazione_id)
    .single();
  if (prepError) fail(prepError.message);
  if (PREP_RESERVING_STATUSES.includes(prep.stato)) {
    const { data: currentRows, error: currentRowsError } = await supabase
      .from("preparazioni_righe")
      .select("*")
      .eq("preparazione_id", payload.preparazione_id);
    if (currentRowsError) fail(currentRowsError.message);
    await assertPreparazioneDisponibile(clienteId, [...(currentRows || []), payload], { excludePreparazioneId: payload.preparazione_id });
  }
  await ensureReferenzeForEntrata(clienteId, [payload]);

  const { data, error } = await requireSupabase()
    .from("preparazioni_righe")
    .insert({
      preparazione_id: payload.preparazione_id,
      ean: payload.ean,
      sku: optionalText(payload.sku),
      fnsku: optionalText(payload.fnsku),
      quantita: Number(payload.quantita || 0),
      servizi: payload.servizi || [],
      stato: normalizePrepRigaStato(payload.stato || "richiesta"),
    })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updatePreparazioneRiga(id, payload) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, "ean")) updates.ean = optionalText(payload.ean);
  if (Object.prototype.hasOwnProperty.call(payload, "sku")) updates.sku = optionalText(payload.sku);
  if (Object.prototype.hasOwnProperty.call(payload, "fnsku")) {
    updates.fnsku = optionalText(payload.fnsku);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "quantita")) updates.quantita = Number(payload.quantita || 0);
  if (Object.prototype.hasOwnProperty.call(payload, "servizi")) updates.servizi = payload.servizi || [];
  if (Object.prototype.hasOwnProperty.call(payload, "stato")) {
    updates.stato = normalizePrepRigaStato(payload.stato);
    if (updates.stato === "in_lavorazione") updates.data_in_lavorazione = nowIso();
    if (updates.stato === "pronto") {
      updates.data_in_lavorazione = nowIso();
      updates.data_pronto = nowIso();
    }
  }
  if (!Object.keys(updates).length) fail("Nessun campo da aggiornare");

  const { data: current, error: readError } = await requireSupabase()
    .from("preparazioni_righe")
    .select("*")
    .eq("id", id)
    .single();
  if (readError) fail(readError.message);
  const clienteId = await clienteIdForPreparazione(current.preparazione_id);

  const { data: prep, error: prepError } = await requireSupabase()
    .from("preparazioni")
    .select("id,stato")
    .eq("id", current.preparazione_id)
    .single();
  if (prepError) fail(prepError.message);

  if (PREP_RESERVING_STATUSES.includes(prep.stato)) {
    const { data: currentRows, error: currentRowsError } = await supabase
      .from("preparazioni_righe")
      .select("*")
      .eq("preparazione_id", current.preparazione_id);
    if (currentRowsError) fail(currentRowsError.message);
    const nextRows = (currentRows || []).map((row) => (
      row.id === id ? { ...row, ...updates } : row
    ));
    await assertPreparazioneDisponibile(clienteId, nextRows, { excludePreparazioneId: current.preparazione_id });
  }

  if (Object.prototype.hasOwnProperty.call(payload, "ean") || Object.prototype.hasOwnProperty.call(payload, "sku") || Object.prototype.hasOwnProperty.call(payload, "fnsku")) {
    await ensureReferenzeForEntrata(clienteId, [{ ...payload, ean: updates.ean || current.ean }]);
  }

  const { data, error } = await requireSupabase()
    .from("preparazioni_righe")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  if (Object.prototype.hasOwnProperty.call(payload, "stato")) await syncPreparazioneFromRighe(current.preparazione_id);
  return ok(data);
}

async function declarePreparazioneShortage(id, payload = {}) {
  await assertWmsStaff();
  const effectiveQuantity = Math.floor(Number(payload.quantita_effettiva));
  if (!Number.isFinite(effectiveQuantity) || effectiveQuantity < 1) {
    fail("La quantita effettiva deve essere almeno 1");
  }
  const { data, error } = await requireSupabase().rpc("declare_preparazione_shortage", {
    p_riga_id: id,
    p_quantita_effettiva: effectiveQuantity,
    p_motivo: optionalText(payload.motivo) || "Quantita fisica inferiore durante la preparazione",
  });
  if (error) fail(error.message);
  return ok(data || { ok: true });
}

async function updatePreparazioneRigheStato(preparazioneId, payload) {
  const stato = normalizePrepRigaStato(payload.stato);
  const ids = Array.isArray(payload.righe_ids) ? payload.righe_ids.filter(Boolean) : [];
  if (!ids.length) fail("Seleziona almeno una riga");
  const { data: rows, error: rowsError } = await requireSupabase()
    .from("preparazioni_righe")
    .select("id,preparazione_id")
    .in("id", ids);
  if (rowsError) fail(rowsError.message);
  if ((rows || []).length !== ids.length || (rows || []).some((row) => row.preparazione_id !== preparazioneId)) {
    fail("Alcune righe non appartengono a questa preparazione");
  }

  const updates = { stato };
  if (stato === "in_lavorazione") updates.data_in_lavorazione = nowIso();
  if (stato === "pronto") {
    updates.data_in_lavorazione = nowIso();
    updates.data_pronto = nowIso();
  }

  const { data, error } = await requireSupabase()
    .from("preparazioni_righe")
    .update(updates)
    .in("id", ids)
    .select();
  if (error) fail(error.message);
  await syncPreparazioneFromRighe(preparazioneId);
  return ok({ aggiornate: data?.length || 0 });
}

async function deletePreparazioneRiga(id) {
  const { error } = await requireSupabase().from("preparazioni_righe").delete().eq("id", id);
  if (error) fail(error.message);
  return ok({ ok: true });
}

async function clienteIdForPreparazione(preparazioneId) {
  const { data, error } = await requireSupabase()
    .from("preparazioni")
    .select("cliente_id")
    .eq("id", preparazioneId)
    .single();
  if (error) fail(error.message);
  return data.cliente_id;
}

async function deletePreparazione(id) {
  const profile = await currentProfile();
  if (isStaff(profile)) {
    const { data: deleted, error } = await requireSupabase()
      .rpc("admin_delete_preparazione", { prep_id: id });
    if (error) fail(error.message);
    if (!deleted) fail("Preparazione non trovata", 404);
    return ok({ ok: true });
  }

  const { data: deleted, error } = await requireSupabase()
    .from("preparazioni")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) fail(error.message);
  if (!deleted?.length) {
    fail("Preparazione non trovata", 404);
  }
  return ok({ ok: true });
}

async function magazzino(params) {
  const cid = await resolveClienteId(params.get("cliente_id") || undefined);
  const {
    bundleMap,
    bundleRefs,
    titoloMap,
    fnskuMap,
    skuMap,
    ricevuto,
    inPreparazione,
    bundleInPreparazione,
    spedito,
    bundleSpedito,
  } = await stockSnapshotForCliente(cid);
  const bundleEans = new Set(Object.keys(bundleMap));
  const usageEans = new Set([...Object.keys(ricevuto), ...Object.keys(spedito), ...Object.keys(inPreparazione)]);
  const componentDisponibile = {};
  const eans = [...new Set([...Object.keys(titoloMap), ...Object.keys(ricevuto), ...Object.keys(spedito), ...Object.keys(inPreparazione)])]
    .filter((ean) => !bundleEans.has(ean))
    .sort();

  const rows = eans.map((ean) => {
    const ric = ricevuto[ean] || 0;
    const prep = inPreparazione[ean] || 0;
    const spe = spedito[ean] || 0;
    const disponibile = Math.max(0, ric - prep - spe);
    componentDisponibile[ean] = disponibile;
    return {
      ean,
      titolo: titoloMap[ean],
      fnsku: fnskuMap[ean],
      is_bundle: false,
      componenti: [],
      skus: [...(skuMap[ean] || [])].sort(),
      ricevuto: ric,
      in_preparazione: prep,
      spedito: spe,
      disponibile,
    };
  });

  for (const ref of bundleRefs) {
    let realizzabile = null;
    const componenti = (bundleMap[ref.ean] || []).map((comp) => {
      const quantita = Number(comp.quantita || 1);
      const disponibile = componentDisponibile[comp.ean] ?? Math.max(0, (ricevuto[comp.ean] || 0) - (spedito[comp.ean] || 0));
      const possibile = quantita > 0 ? Math.floor(disponibile / quantita) : 0;
      realizzabile = realizzabile === null ? possibile : Math.min(realizzabile, possibile);
      return {
        ean: comp.ean,
        quantita,
        titolo: titoloMap[comp.ean],
        disponibile,
      };
    });

    rows.push({
      ean: ref.ean,
      titolo: ref.titolo,
      fnsku: ref.fnsku,
      is_bundle: true,
      componenti,
      skus: [...(skuMap[ref.ean] || [])].sort(),
      ricevuto: 0,
      in_preparazione: bundleInPreparazione[ref.ean] || 0,
      spedito: bundleSpedito[ref.ean] || 0,
      disponibile: Math.max(0, realizzabile ?? 0),
    });
  }

  return ok(rows);
}

function wmsInventoryKey(row = {}) {
  const fnsku = normalizedText(row.fnsku);
  const ean = normalizedText(row.ean);
  return fnsku ? `fnsku:${fnsku}` : ean ? `ean:${ean}` : null;
}

function naturalLocationSort(left, right) {
  return String(left?.codice || "").localeCompare(String(right?.codice || ""), "it", { numeric: true });
}

function spreadLocations(locations = [], count = 0) {
  if (locations.length <= count) return [...locations];
  if (count <= 0) return [];
  const selected = [];
  const usedIndexes = new Set();
  for (let i = 0; i < count; i += 1) {
    const idealIndex = count === 1 ? 0 : Math.round(i * (locations.length - 1) / (count - 1));
    let chosenIndex = idealIndex;
    for (let radius = 0; radius < locations.length && usedIndexes.has(chosenIndex); radius += 1) {
      const before = idealIndex - radius;
      const after = idealIndex + radius;
      if (before >= 0 && !usedIndexes.has(before)) {
        chosenIndex = before;
        break;
      }
      if (after < locations.length && !usedIndexes.has(after)) {
        chosenIndex = after;
        break;
      }
    }
    usedIndexes.add(chosenIndex);
    selected.push(locations[chosenIndex]);
  }
  return selected.sort(naturalLocationSort);
}

async function fetchAllWmsLocations() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const { data, error } = await requireSupabase()
      .from("wms_locations")
      .select("*")
      .order("codice", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return { data: rows, error: null };
}

async function wmsStock(params) {
  const profile = await currentProfile();
  const requestedClientId = isStaff(profile)
    ? optionalText(params.get("cliente_id"))
    : optionalText(profile.cliente_id);
  if (!isStaff(profile) && !requestedClientId) fail("Profilo cliente non associato", 403);
  let clientsQuery = requireSupabase()
    .from("clienti")
    .select("id,ragione_sociale")
    .order("ragione_sociale", { ascending: true });
  if (requestedClientId) clientsQuery = clientsQuery.eq("id", requestedClientId);
  const { data: allClients, error: clientsError } = await clientsQuery;
  if (clientsError) fail(clientsError.message);

  const clients = requestedClientId
    ? (allClients || []).filter((client) => client.id === requestedClientId)
    : (allClients || []);
  if (requestedClientId && !clients.length) fail("Cliente non trovato", 404);

  const clientIds = clients.map((client) => client.id);
  const clientMap = Object.fromEntries(clients.map((client) => [client.id, client]));
  const stockResponses = await Promise.all(clients.map((client) => {
    const query = new URLSearchParams({ cliente_id: client.id });
    return magazzino(query);
  }));

  const [
    { data: locations, error: locationsError },
    { data: movements, error: movementsError },
    { data: entryRows, error: rowsError },
    { data: entries, error: entriesError },
    { data: references, error: referencesError },
    { data: inventorySessions, error: inventorySessionsError },
    { data: outboundMovements, error: outboundMovementsError },
    { data: stockTransfers, error: stockTransfersError },
    { data: stockPlacements, error: stockPlacementsError },
  ] = await Promise.all([
    fetchAllWmsLocations(),
    requireSupabase().from("wms_inbound_movements").select("*").order("created_at", { ascending: false }),
    requireSupabase().from("entrate_righe").select("id,entrata_id,ean,fnsku"),
    clientIds.length
      ? requireSupabase().from("entrate").select("id,cliente_id").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? requireSupabase().from("referenze").select("id,cliente_id,ean,sku,fnsku,titolo,foto_url,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,misure_confermate").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    requireSupabase().from("wms_inventory_sessions").select("id").eq("stato", "completata"),
    clientIds.length
      ? requireSupabase().from("wms_outbound_movements").select("*").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? requireSupabase().from("wms_stock_transfers").select("*").in("cliente_id", clientIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? requireSupabase().from("wms_stock_placements").select("*").in("cliente_id", clientIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = locationsError || movementsError || rowsError || entriesError || referencesError || inventorySessionsError || outboundMovementsError || stockTransfersError || stockPlacementsError;
  if (firstError) fail(firstError.message);

  const completedInventoryIds = (inventorySessions || []).map((session) => session.id);
  const { data: inventoryCounts, error: inventoryCountsError } = completedInventoryIds.length
    ? await requireSupabase()
      .from("wms_inventory_counts")
      .select("*")
      .in("session_id", completedInventoryIds)
    : { data: [], error: null };
  if (inventoryCountsError) fail(inventoryCountsError.message);

  const entryMap = new Map((entries || []).map((entry) => [entry.id, entry]));
  const rowMap = new Map((entryRows || []).map((row) => [row.id, row]));
  const referenceByEan = new Map();
  const referenceByFnsku = new Map();
  for (const reference of references || []) {
    if (reference.ean) referenceByEan.set(`${reference.cliente_id}:${normalizedText(reference.ean)}`, reference);
    if (reference.fnsku) referenceByFnsku.set(`${reference.cliente_id}:${normalizedText(reference.fnsku)}`, reference);
  }

  const products = [];
  const productIndexes = new Map();
  clients.forEach((client, clientIndex) => {
    for (const row of stockResponses[clientIndex]?.data || []) {
      if (row.is_bundle) continue;
      const reference = (row.fnsku && referenceByFnsku.get(`${client.id}:${normalizedText(row.fnsku)}`))
        || (row.ean && referenceByEan.get(`${client.id}:${normalizedText(row.ean)}`));
      const product = {
        referenza_id: reference?.id || null,
        cliente_id: client.id,
        cliente: client.ragione_sociale,
        ean: optionalText(row.ean),
        skus: [...new Set([...(row.skus || []), reference?.sku].map(optionalText).filter(Boolean))],
        fnsku: optionalText(row.fnsku),
        titolo: optionalText(row.titolo) || "Titolo non disponibile",
        foto_url: optionalText(reference?.foto_url),
        peso_kg: Number(reference?.peso_kg || 0) || null,
        lunghezza_cm: Number(reference?.lunghezza_cm || 0) || null,
        larghezza_cm: Number(reference?.larghezza_cm || 0) || null,
        altezza_cm: Number(reference?.altezza_cm || 0) || null,
        misure_confermate: Boolean(reference?.misure_confermate),
        ricevuto: Number(row.ricevuto || 0),
        in_preparazione: Number(row.in_preparazione || 0),
        spedito: Number(row.spedito || 0),
        disponibile: Number(row.disponibile || 0),
        base_disponibile: Number(row.disponibile || 0),
        rettifica_inventario: 0,
        ubicazioni: [],
        non_ubicato: Number(row.disponibile || 0),
      };
      products.push(product);
      if (product.ean) productIndexes.set(`${client.id}:ean:${normalizedText(product.ean)}`, product);
      if (product.fnsku) productIndexes.set(`${client.id}:fnsku:${normalizedText(product.fnsku)}`, product);
      product.skus.forEach((sku) => productIndexes.set(`${client.id}:sku:${normalizedText(sku)}`, product));
    }
  });

  const movementsByProduct = new Map();
  const inboundHistoryByProduct = new Map();
  for (const movement of movements || []) {
    const row = rowMap.get(movement.entrata_riga_id);
    const entry = row ? entryMap.get(row.entrata_id) : null;
    if (!row || !entry || !clientMap[entry.cliente_id]) continue;
    const reference = (row.fnsku && referenceByFnsku.get(`${entry.cliente_id}:${normalizedText(row.fnsku)}`))
      || (row.ean && referenceByEan.get(`${entry.cliente_id}:${normalizedText(row.ean)}`));
    const product = (row.fnsku && productIndexes.get(`${entry.cliente_id}:fnsku:${normalizedText(row.fnsku)}`))
      || (row.ean && productIndexes.get(`${entry.cliente_id}:ean:${normalizedText(row.ean)}`));
    if (!product) continue;
    const key = `${entry.cliente_id}:${wmsInventoryKey(product)}`;
    const enrichedMovement = {
      ...movement,
      ean: row.ean || product.ean,
      fnsku: row.fnsku || product.fnsku,
      titolo: reference?.titolo || product.titolo,
    };
    if (!inboundHistoryByProduct.has(key)) inboundHistoryByProduct.set(key, []);
    inboundHistoryByProduct.get(key).push(enrichedMovement);
    if (movement.disposizione === "disponibile") {
      if (!movementsByProduct.has(key)) movementsByProduct.set(key, []);
      movementsByProduct.get(key).push(enrichedMovement);
    }
  }

  const locationContents = new Map();
  const locationById = new Map((locations || []).map((location) => [location.id, location]));
  const inventoryDeltas = new Map();
  const outboundByProduct = new Map();
  const transfersByProduct = new Map();
  const placementsByProduct = new Map();
  for (const placement of stockPlacements || []) {
    const key = `${placement.cliente_id}:${placement.product_key}`;
    if (!placementsByProduct.has(key)) placementsByProduct.set(key, []);
    placementsByProduct.get(key).push(placement);
  }
  for (const transfer of stockTransfers || []) {
    const key = `${transfer.cliente_id}:${transfer.product_key}`;
    if (!transfersByProduct.has(key)) transfersByProduct.set(key, []);
    transfersByProduct.get(key).push(transfer);
  }
  for (const movement of outboundMovements || []) {
    const key = `${movement.cliente_id}:${movement.product_key}`;
    if (!outboundByProduct.has(key)) outboundByProduct.set(key, new Map());
    const locationTotals = outboundByProduct.get(key);
    locationTotals.set(movement.location_id, Number(locationTotals.get(movement.location_id) || 0) + Number(movement.quantita || 0));
  }
  for (const count of inventoryCounts || []) {
    if (!clientMap[count.cliente_id]) continue;
    const key = `${count.cliente_id}:${count.product_key}`;
    if (!inventoryDeltas.has(key)) inventoryDeltas.set(key, new Map());
    const locationDeltas = inventoryDeltas.get(key);
    const delta = Number(count.quantita_contata || 0) - Number(count.quantita_attesa || 0);
    locationDeltas.set(count.location_id, Number(locationDeltas.get(count.location_id) || 0) + delta);
  }

  for (const product of products) {
    let remaining = product.base_disponibile;
    const key = `${product.cliente_id}:${wmsInventoryKey(product)}`;
    const batches = (movementsByProduct.get(key) || [])
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    const totalsByLocation = new Map();
    for (const batch of batches) {
      if (remaining <= 0) break;
      const assigned = Math.min(remaining, Number(batch.quantita || 0));
      if (assigned <= 0 || !batch.location_id) continue;
      remaining -= assigned;
      totalsByLocation.set(batch.location_id, Number(totalsByLocation.get(batch.location_id) || 0) + assigned);
    }

    for (const placement of placementsByProduct.get(key) || []) {
      if (remaining <= 0) break;
      const assigned = Math.min(remaining, Number(placement.quantita || 0));
      if (assigned <= 0 || !placement.location_id) continue;
      remaining -= assigned;
      totalsByLocation.set(placement.location_id, Number(totalsByLocation.get(placement.location_id) || 0) + assigned);
    }

    for (const [locationId, delta] of inventoryDeltas.get(key) || []) {
      const current = Number(totalsByLocation.get(locationId) || 0);
      const next = Math.max(0, current + Number(delta || 0));
      product.rettifica_inventario += next - current;
      if (next > 0) totalsByLocation.set(locationId, next);
      else totalsByLocation.delete(locationId);
    }

    for (const transfer of transfersByProduct.get(key) || []) {
      const sourceQuantity = Number(totalsByLocation.get(transfer.source_location_id) || 0);
      const moved = Math.min(sourceQuantity, Number(transfer.quantita || 0));
      if (moved <= 0) continue;
      const sourceRemaining = sourceQuantity - moved;
      if (sourceRemaining > 0) totalsByLocation.set(transfer.source_location_id, sourceRemaining);
      else totalsByLocation.delete(transfer.source_location_id);
      totalsByLocation.set(transfer.target_location_id, Number(totalsByLocation.get(transfer.target_location_id) || 0) + moved);
    }

    for (const [locationId, quantity] of outboundByProduct.get(key) || []) {
      const current = Number(totalsByLocation.get(locationId) || 0);
      const next = Math.max(0, current - Number(quantity || 0));
      if (next > 0) totalsByLocation.set(locationId, next);
      else totalsByLocation.delete(locationId);
    }

    product.non_ubicato = remaining;
    product.disponibile = remaining + [...totalsByLocation.values()].reduce((sum, quantity) => sum + Number(quantity || 0), 0);
    product.ubicazioni = [...totalsByLocation.entries()].map(([locationId, quantita]) => {
      const location = locationById.get(locationId);
      return { id: locationId, codice: location?.codice || "Ubicazione rimossa", tipo: location?.tipo || null, quantita };
    }).sort(naturalLocationSort);

    const locationCode = (id) => locationById.get(id)?.codice || (id ? "Ubicazione rimossa" : null);
    product.movimenti = [
      ...(inboundHistoryByProduct.get(key) || []).map((movement) => ({
        id: movement.id,
        tipo: "ricezione",
        created_at: movement.created_at,
        quantita: Number(movement.quantita || 0),
        da: null,
        a: locationCode(movement.location_id),
        operatore_id: movement.created_by || null,
        descrizione: movement.disposizione === "disponibile" ? "Ricezione merce" : `Ricezione ${movement.disposizione || "non disponibile"}`,
      })),
      ...(transfersByProduct.get(key) || []).map((transfer) => ({
        id: transfer.id,
        tipo: "trasferimento",
        created_at: transfer.created_at,
        quantita: Number(transfer.quantita || 0),
        da: locationCode(transfer.source_location_id),
        a: locationCode(transfer.target_location_id),
        operatore_id: transfer.operatore_id || null,
        descrizione: "Spostamento stock",
      })),
      ...(inventoryCounts || []).filter((count) => `${count.cliente_id}:${count.product_key}` === key).map((count) => ({
        id: count.id,
        tipo: "inventario",
        created_at: count.created_at,
        quantita: Number(count.quantita_contata || 0) - Number(count.quantita_attesa || 0),
        da: null,
        a: locationCode(count.location_id),
        operatore_id: count.created_by || null,
        descrizione: `Inventario ${Number(count.quantita_attesa || 0)} -> ${Number(count.quantita_contata || 0)}`,
      })),
      ...(outboundMovements || []).filter((movement) => `${movement.cliente_id}:${movement.product_key}` === key).map((movement) => ({
        id: movement.id,
        tipo: "prelievo",
        created_at: movement.created_at,
        quantita: -Number(movement.quantita || 0),
        da: locationCode(movement.location_id),
        a: "Ordine",
        operatore_id: movement.operatore_id || null,
        descrizione: "Prelievo ordine",
      })),
    ].sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));

    for (const item of product.ubicazioni) {
      if (!locationContents.has(item.id)) locationContents.set(item.id, []);
      locationContents.get(item.id).push({
        cliente_id: product.cliente_id,
        cliente: product.cliente,
        ean: product.ean,
        skus: product.skus,
        fnsku: product.fnsku,
        titolo: product.titolo,
        quantita: item.quantita,
      });
    }
  }

  const locationRows = (locations || []).map((location) => {
    const contents = locationContents.get(location.id) || [];
    return {
      ...location,
      occupata: contents.length > 0,
      quantita: contents.reduce((sum, item) => sum + Number(item.quantita || 0), 0),
      contenuto: contents.sort((left, right) => String(left.titolo).localeCompare(String(right.titolo))),
    };
  }).sort(naturalLocationSort);
  products.sort((left, right) => String(left.titolo).localeCompare(String(right.titolo), "it"));

  const operationalLocations = locationRows.filter((location) => ["pallet", "slot"].includes(location.tipo));
  return ok({
    generated_at: nowIso(),
    clienti: clients,
    summary: {
      unita_disponibili: products.reduce((sum, product) => sum + product.disponibile, 0),
      referenze_disponibili: products.filter((product) => product.disponibile > 0).length,
      ubicazioni_totali: operationalLocations.length,
      ubicazioni_occupate: operationalLocations.filter((location) => location.occupata).length,
      ubicazioni_bloccate: operationalLocations.filter((location) => location.stato === "bloccata").length,
      non_ubicato: products.reduce((sum, product) => sum + product.non_ubicato, 0),
    },
    locations: locationRows,
    products,
  });
}

const DEFAULT_WMS_CUTOFF = "12:00";
const DEFAULT_WMS_TIMEZONE = "Europe/Rome";

function cutoffMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return 12 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

function zonedDateParts(value, timezone = DEFAULT_WMS_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function dateKeyFromParts(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function orderOperationalDate(order, cutoff, timezone) {
  const parts = zonedDateParts(order.processed_at || order.created_at, timezone);
  const day = dateKeyFromParts(parts);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes <= cutoffMinutes(cutoff) ? day : addDaysToDateKey(day, 1);
}

async function wmsSettingsRecord() {
  await assertWmsStaff();
  const { data, error } = await requireSupabase()
    .from("wms_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) fail(error.message);
  return data || {
    id: 1,
    cutoff_time: `${DEFAULT_WMS_CUTOFF}:00`,
    timezone: DEFAULT_WMS_TIMEZONE,
    updated_at: null,
  };
}

async function wmsOperationalOrdersData(params = new URLSearchParams()) {
  const settings = await wmsSettingsRecord();
  let query = requireSupabase()
    .from("shopify_orders")
    .select("*")
    .neq("wms_status", "annullato")
    .order("processed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("order_name", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  const { data, error } = await query;
  if (error) fail(error.message);

  const timezone = settings.timezone || DEFAULT_WMS_TIMEZONE;
  const cutoff = String(settings.cutoff_time || DEFAULT_WMS_CUTOFF).slice(0, 5);
  const nowParts = zonedDateParts(new Date(), timezone);
  const today = dateKeyFromParts(nowParts);
  const tomorrow = addDaysToDateKey(today, 1);
  const enriched = await enrichShopifyOrders(data || []);
  const active = enriched.filter((order) => !["spedito", "annullato", "hold"].includes(order.wms_status));
  const orders = active.map((order) => {
    const operationalDate = orderOperationalDate(order, cutoff, timezone);
    const wave = operationalDate < today ? "arretrati" : operationalDate === today ? "oggi" : "prossima";
    return { ...order, operational_date: operationalDate, wave };
  });
  const nowMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute);

  return {
    settings: {
      ...settings,
      cutoff_time: cutoff,
      cutoff_passed: nowMinutes > cutoffMinutes(cutoff),
      today,
      tomorrow,
    },
    orders,
    summary: {
      arretrati: orders.filter((order) => order.wave === "arretrati").length,
      oggi: orders.filter((order) => order.wave === "oggi").length,
      prossima: orders.filter((order) => order.wave === "prossima").length,
      pezzi_oggi: orders.filter((order) => order.wave !== "prossima").reduce((sum, order) => sum + (order.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0),
    },
  };
}

async function getWmsSettings() {
  const data = await wmsOperationalOrdersData();
  return ok({ settings: data.settings, summary: data.summary });
}

async function updateWmsSettings(payload = {}) {
  const profile = await assertWmsStaff();
  const cutoff = String(payload.cutoff_time || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) fail("Inserisci un orario valido nel formato HH:MM");
  const { error } = await requireSupabase()
    .from("wms_settings")
    .upsert({
      id: 1,
      cutoff_time: `${cutoff}:00`,
      timezone: DEFAULT_WMS_TIMEZONE,
      updated_by: profile.id,
      updated_at: nowIso(),
    });
  if (error) fail(error.message);
  return getWmsSettings();
}

async function listWmsOperationalOrders(params) {
  return ok(await wmsOperationalOrdersData(params));
}

function pickingProductKey(row = {}) {
  const fnsku = normalizedText(row.fnsku);
  const ean = normalizedText(row.ean);
  const sku = normalizedText(row.sku);
  return fnsku ? `fnsku:${fnsku}` : ean ? `ean:${ean}` : sku ? `sku:${sku}` : null;
}

async function queuedSlotReservationsBefore(order) {
  const { data: queuedOrders, error: ordersError } = await requireSupabase()
    .from("shopify_orders")
    .select("id,processed_at,created_at")
    .eq("cliente_id", order.cliente_id)
    .eq("wms_status", "da_preparare");
  if (ordersError) fail(ordersError.message);

  const ordered = [...(queuedOrders || []).filter((row) => row.id !== order.id), order]
    .sort((left, right) => {
      const leftDate = String(left.processed_at || left.created_at || "");
      const rightDate = String(right.processed_at || right.created_at || "");
      return leftDate.localeCompare(rightDate) || String(left.id).localeCompare(String(right.id));
    });
  const currentIndex = ordered.findIndex((row) => row.id === order.id);
  const priorIds = ordered.slice(0, Math.max(0, currentIndex)).map((row) => row.id);
  if (!priorIds.length) return new Map();

  const { data: priorItems, error: itemsError } = await requireSupabase()
    .from("shopify_order_items")
    .select("referenza_id,quantita")
    .in("order_id", priorIds)
    .not("referenza_id", "is", null);
  if (itemsError) fail(itemsError.message);
  const referenceIds = [...new Set((priorItems || []).map((item) => item.referenza_id))];
  if (!referenceIds.length) return new Map();
  const { data: references, error: referencesError } = await requireSupabase()
    .from("referenze")
    .select("id,ean,fnsku,sku")
    .in("id", referenceIds);
  if (referencesError) fail(referencesError.message);
  const referenceMap = Object.fromEntries((references || []).map((reference) => [reference.id, reference]));
  const reserved = new Map();
  for (const item of priorItems || []) {
    const productKey = pickingProductKey(referenceMap[item.referenza_id]);
    if (!productKey) continue;
    reserved.set(productKey, Number(reserved.get(productKey) || 0) + Number(item.quantita || 0));
  }
  return reserved;
}

async function wmsPickingPlan(order, items, options = {}) {
  const missingReferences = (items || []).filter((item) => !item.referenza_id);
  if (missingReferences.length) {
    return { ready: false, allocations: [], replenishment: [], errors: [`Collega prima ${missingReferences.length} ${missingReferences.length === 1 ? "riga" : "righe"} alle referenze.`] };
  }

  const referenceIds = [...new Set((items || []).map((item) => item.referenza_id))];
  const [
    { data: references, error: referencesError },
    stockResponse,
    { data: activeTasks, error: activeTasksError },
    { data: mapSettings, error: mapError },
  ] = await Promise.all([
    requireSupabase().from("referenze").select("id,cliente_id,titolo,ean,fnsku,sku").in("id", referenceIds),
    wmsStock(new URLSearchParams({ cliente_id: order.cliente_id })),
    requireSupabase().from("wms_pick_tasks").select("id").in("stato", ["da_prelevare", "in_corso"]),
    requireSupabase().from("wms_warehouse_map").select("*").eq("id", true).single(),
  ]);
  const firstError = referencesError || activeTasksError || mapError;
  if (firstError) fail(firstError.message);

  const referenceMap = Object.fromEntries((references || []).map((reference) => [reference.id, reference]));
  const activeTaskIds = (activeTasks || []).map((task) => task.id);
  const { data: reservedLines, error: reservedError } = activeTaskIds.length
    ? await requireSupabase().from("wms_pick_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("task_id", activeTaskIds)
    : { data: [], error: null };
  if (reservedError) fail(reservedError.message);

  const { data: activeMassBatches, error: massBatchesError } = await requireSupabase()
    .from("wms_mass_pick_batches")
    .select("id")
    .eq("cliente_id", order.cliente_id)
    .eq("stato", "in_corso");
  if (massBatchesError) fail(massBatchesError.message);
  const activeMassIds = (activeMassBatches || []).map((batch) => batch.id);
  const { data: reservedMassLines, error: reservedMassError } = activeMassIds.length
    ? await requireSupabase().from("wms_mass_pick_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("batch_id", activeMassIds)
    : { data: [], error: null };
  if (reservedMassError) fail(reservedMassError.message);

  const { data: activeGalluseBatches, error: galluseBatchesError } = await requireSupabase()
    .from("wms_galluse_batches")
    .select("id")
    .eq("cliente_id", order.cliente_id)
    .in("stato", ["da_associare_bag", "in_corso"]);
  if (galluseBatchesError) fail(galluseBatchesError.message);
  const activeGalluseIds = (activeGalluseBatches || []).map((batch) => batch.id);
  const { data: reservedGalluseLines, error: reservedGalluseError } = activeGalluseIds.length
    ? await requireSupabase().from("wms_galluse_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("batch_id", activeGalluseIds)
    : { data: [], error: null };
  if (reservedGalluseError) fail(reservedGalluseError.message);

  const reserved = new Map();
  for (const line of reservedLines || []) {
    const key = `${line.location_id}:${line.product_key}`;
    reserved.set(key, Number(reserved.get(key) || 0) + Math.max(0, Number(line.quantita_attesa || 0) - Number(line.quantita_prelevata || 0)));
  }
  for (const line of reservedMassLines || []) {
    const key = `${line.location_id}:${line.product_key}`;
    reserved.set(key, Number(reserved.get(key) || 0) + Math.max(0, Number(line.quantita_attesa || 0) - Number(line.quantita_prelevata || 0)));
  }
  for (const line of reservedGalluseLines || []) {
    const key = `${line.location_id}:${line.product_key}`;
    reserved.set(key, Number(reserved.get(key) || 0) + Math.max(0, Number(line.quantita_attesa || 0) - Number(line.quantita_prelevata || 0)));
  }

  const allLocations = stockResponse.data.locations || [];
  const hiddenLocationIds = new Set(Array.isArray(mapSettings.hidden_location_ids) ? mapSettings.hidden_location_ids : []);
  const locationMap = Object.fromEntries(allLocations.map((location) => [location.id, location]));
  const availableEmptySlots = allLocations
    .filter((location) => location.tipo === "slot" && location.stato === "attiva" && !location.occupata)
    .sort(naturalLocationSort);
  const usedSuggestedSlots = new Set();
  const queuedSlotReserved = new Map(options.queuedSlotReserved || []);
  const allocations = [];
  const replenishment = [];
  const errors = [];

  for (const item of items || []) {
    const reference = referenceMap[item.referenza_id];
    if (!reference) {
      errors.push(`Referenza non trovata per ${item.titolo}`);
      continue;
    }
    const productKey = pickingProductKey(reference);
    const product = (stockResponse.data.products || []).find((candidate) => (
      candidate.cliente_id === order.cliente_id
      && ((reference.fnsku && normalizedText(candidate.fnsku) === normalizedText(reference.fnsku))
        || (reference.ean && normalizedText(candidate.ean) === normalizedText(reference.ean)))
    ));
    if (!product || !productKey) {
      errors.push(`Nessuno stock disponibile per ${reference.titolo || item.titolo}`);
      continue;
    }

    let remaining = Number(item.quantita || 0);
    let queuedRemaining = Number(queuedSlotReserved.get(productKey) || 0);
    const slotLocations = (product.ubicazioni || []).filter((location) => location.tipo === "slot").map((location) => {
      const key = `${location.id}:${productKey}`;
      const rawAvailable = Math.max(0, Number(location.quantita || 0) - Number(reserved.get(key) || 0));
      const queueShare = Math.min(rawAvailable, queuedRemaining);
      queuedRemaining -= queueShare;
      return { ...location, available: rawAvailable - queueShare };
    }).filter((location) => location.available > 0);
    for (const location of slotLocations) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, location.available);
      allocations.push({
        order_item_id: item.id,
        location_id: location.id,
        product_key: productKey,
        titolo: reference.titolo || item.titolo,
        ean: reference.ean || item.ean,
        fnsku: reference.fnsku,
        sku: reference.sku || item.sku,
        quantita_attesa: quantity,
      });
      const key = `${location.id}:${productKey}`;
      reserved.set(key, Number(reserved.get(key) || 0) + quantity);
      remaining -= quantity;
    }

    if (remaining > 0) {
      const palletSources = (product.ubicazioni || [])
        .filter((location) => location.tipo === "pallet" && Number(location.quantita || 0) > 0)
        .sort(naturalLocationSort)
        .map((location) => {
          const key = `${location.id}:${productKey}`;
          const rawAvailable = Math.max(0, Number(location.quantita || 0) - Number(reserved.get(key) || 0));
          const queueShare = Math.min(rawAvailable, queuedRemaining);
          queuedRemaining -= queueShare;
          return { id: location.id, codice: location.codice, quantita: rawAvailable - queueShare };
        })
        .filter((location) => location.quantita > 0);
      const palletAvailable = palletSources.reduce((sum, location) => sum + location.quantita, 0);
      const existingSlot = (product.ubicazioni || [])
        .filter((location) => location.tipo === "slot")
        .map((location) => locationMap[location.id])
        .find((location) => location?.stato === "attiva") || null;
      const suggestedSlot = existingSlot || availableEmptySlots.find((location) => !usedSuggestedSlots.has(location.id)) || null;
      if (suggestedSlot) usedSuggestedSlots.add(suggestedSlot.id);
      replenishment.push({
        order_id: order.id,
        cliente_id: order.cliente_id,
        referenza_id: reference.id,
        product_key: productKey,
        titolo: reference.titolo || item.titolo,
        ean: reference.ean || item.ean,
        fnsku: reference.fnsku,
        quantita: remaining,
        pallet_available: palletAvailable,
        pallet_sources: palletSources,
        target_slot: suggestedSlot ? { id: suggestedSlot.id, codice: suggestedSlot.codice } : null,
        can_replenish: palletAvailable >= remaining && Boolean(suggestedSlot),
      });
    }
  }

  return {
    ready: errors.length === 0 && replenishment.length === 0,
    allocations,
    replenishment,
    errors,
    locationMap,
    mapSettings: {
      ...mapSettings,
      hidden_location_ids: [...hiddenLocationIds],
      obstacles: allLocations.filter((location) => (
        !hiddenLocationIds.has(location.id)
        && !["INBOUND-01", "OUTBOUND-01", "PACK-01"].includes(location.codice)
      )),
    },
  };
}

function visibleWmsRouteLocations(locations = [], mapSettings = {}) {
  const hidden = new Set(Array.isArray(mapSettings.hidden_location_ids) ? mapSettings.hidden_location_ids : []);
  return locations.filter((location) => location && !hidden.has(location.id));
}

function validateWmsOrderAddressLocally(order = {}) {
  const reasons = [];
  const countryCode = normalizedText(order.ship_country_code || order.ship_country);
  const address = optionalText(order.ship_address1);
  const zip = optionalText(order.ship_zip);
  const city = optionalText(order.ship_city);
  const province = optionalText(order.ship_province);
  const recipient = optionalText(order.ship_name || order.ship_company);

  if (!recipient) reasons.push("Destinatario mancante");
  if (!address) reasons.push("Indirizzo mancante");
  if (address && !/\d/.test(address)) reasons.push("Numero civico non riconosciuto");
  if (!zip) reasons.push("CAP mancante");
  if (!city) reasons.push("Citta mancante");
  if (!countryCode) reasons.push("Paese mancante");
  if (["it", "ita", "italia", "italy"].includes(countryCode)) {
    if (zip && !/^\d{5}$/.test(zip)) reasons.push("CAP italiano non valido");
    if (!province) reasons.push("Provincia mancante");
  }

  return {
    valid: reasons.length === 0,
    confidence: reasons.length ? 0 : 0.92,
    source: "controllo_intelligente_regole",
    reasons,
    normalized: { recipient, address, zip, city, province, country_code: countryCode },
  };
}

async function validateWmsOrderAddress(order = {}) {
  const localValidation = validateWmsOrderAddressLocally(order);
  if (!localValidation.valid) return localValidation;

  try {
    const { data, error } = await requireSupabase().functions.invoke("wms-validate-address", {
      body: {
        recipient: localValidation.normalized.recipient,
        address: localValidation.normalized.address,
        zip: localValidation.normalized.zip,
        city: localValidation.normalized.city,
        province: localValidation.normalized.province,
        country_code: localValidation.normalized.country_code,
      },
    });
    if (error || data?.detail || typeof data?.valid !== "boolean") {
      return { ...localValidation, map_check: "non_disponibile" };
    }
    return {
      valid: data.valid,
      confidence: Number(data.confidence || (data.valid ? 0.98 : 0)),
      source: data.source || "google_maps",
      reasons: Array.isArray(data.reasons) ? data.reasons : [],
      normalized: { ...localValidation.normalized, ...(data.normalized || {}) },
      map_check: data.map_check || "verificato",
      verified_at: data.verified_at || nowIso(),
    };
  } catch {
    // Il controllo sintattico mantiene il flusso operativo disponibile se il provider esterno non risponde.
    return { ...localValidation, map_check: "non_disponibile" };
  }
}

async function evaluateWmsOrderGate(orderId, options = {}) {
  const profile = await assertWmsStaff();
  const { data: order, error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);

  const lockedStatuses = ["in_preparazione", "in_attesa_packing", "in_packing", "imballato", "spedito", "annullato"];
  if (lockedStatuses.includes(order.wms_status) && !options.force) {
    return { ...order, skipped: true };
  }

  const { data: items, error: itemsError } = await requireSupabase()
    .from("shopify_order_items")
    .select("*")
    .eq("order_id", order.id);
  if (itemsError) fail(itemsError.message);

  const checkedAt = nowIso();
  const addressValidation = await validateWmsOrderAddress(order);
  let update;
  let eventReason;

  if (!addressValidation.valid) {
    update = {
      wms_status: "eccezione",
      gate_status: "eccezione_indirizzo",
      exception_type: "indirizzo",
      exception_reasons: addressValidation.reasons,
      address_validation: addressValidation,
      stock_shortages: [],
      refill_requirements: [],
      gate_checked_at: checkedAt,
      unblocked_at: null,
      updated_at: checkedAt,
    };
    eventReason = addressValidation.reasons.join("; ");
  } else {
    const queuedSlotReserved = await queuedSlotReservationsBefore(order);
    const plan = await wmsPickingPlan(order, items || [], { queuedSlotReserved });
    const stockShortages = [
      ...(plan.errors || []).map((reason) => ({ titolo: reason, required: null, available: null })),
      ...(plan.replenishment || [])
        .filter((row) => Number(row.pallet_available || 0) < Number(row.quantita || 0) || !row.target_slot)
        .map((row) => ({
          referenza_id: row.referenza_id,
          titolo: row.titolo,
          required: Number(row.quantita || 0),
          available: Number(row.pallet_available || 0),
          missing: Math.max(0, Number(row.quantita || 0) - Number(row.pallet_available || 0)),
          reason: !row.target_slot ? "Nessuno slot attivo disponibile" : "Stock pallet insufficiente",
        })),
    ];
    const refillRequirements = (plan.replenishment || []).filter((row) => (
      Number(row.pallet_available || 0) >= Number(row.quantita || 0) && row.target_slot
    ));
    const requiresReplenishment = refillRequirements.length > 0;
    if (stockShortages.length) {
      update = {
        wms_status: "eccezione",
        gate_status: "eccezione_stock",
        exception_type: "stock",
        exception_reasons: stockShortages.map((row) => row.titolo),
        address_validation: addressValidation,
        stock_shortages: stockShortages,
        refill_requirements: [],
        gate_checked_at: checkedAt,
        unblocked_at: null,
        updated_at: checkedAt,
      };
      eventReason = "Stock insufficiente";
    } else if (requiresReplenishment) {
      update = {
        wms_status: "in_attesa_refill",
        gate_status: "attesa_refill",
        exception_type: null,
        exception_reasons: [],
        address_validation: { ...addressValidation, requires_replenishment: true },
        stock_shortages: [],
        refill_requirements: refillRequirements,
        gate_checked_at: checkedAt,
        unblocked_at: null,
        updated_at: checkedAt,
      };
      eventReason = "Stock disponibile a pallet: rifornimento slot richiesto";
    } else {
      update = {
        wms_status: "da_preparare",
        gate_status: "sbloccato",
        exception_type: null,
        exception_reasons: [],
        address_validation: { ...addressValidation, requires_replenishment: requiresReplenishment },
        stock_shortages: [],
        refill_requirements: [],
        gate_checked_at: checkedAt,
        unblocked_at: checkedAt,
        updated_at: checkedAt,
      };
      eventReason = "Controlli superati";
    }
  }

  const { data: saved, error: updateError } = await requireSupabase()
    .from("shopify_orders")
    .update(update)
    .eq("id", order.id)
    .select()
    .single();
  if (updateError) fail(updateError.message);

  const { error: eventError } = await requireSupabase().from("wms_order_gate_events").insert({
    order_id: order.id,
    cliente_id: order.cliente_id,
    from_status: order.gate_status || "da_verificare",
    to_status: update.gate_status,
    reason: eventReason,
    details: { address_validation: update.address_validation, stock_shortages: update.stock_shortages },
    created_by: profile.id,
  });
  if (eventError) fail(eventError.message);
  if (["da_preparare", "in_attesa_refill"].includes(saved.wms_status) && !saved.selected_carrier) {
    try {
      await getWmsShippingQuote(saved.id);
      const { data: quotedOrder } = await requireSupabase().from("shopify_orders").select("*").eq("id", saved.id).single();
      return quotedOrder || saved;
    } catch {
      // Address/weight gaps remain visible in the order detail without blocking warehouse release.
    }
  }
  return saved;
}

async function recheckWmsOrderExceptions(payload = {}) {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) fail("Non autenticato", 401);
  const { data, error } = await sb.functions.invoke("wms-recheck-order-gate", {
    body: payload,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) fail(await edgeErrorMessage(error, "Ricontrollo non riuscito"));
  if (data?.detail) fail(data.detail);
  return ok(data);
}

async function listWmsRefillQueue(params = new URLSearchParams()) {
  await assertWmsStaff();
  let query = requireSupabase()
    .from("shopify_orders")
    .select("*")
    .eq("wms_status", "in_attesa_refill")
    .order("processed_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (optionalText(params.get("cliente_id"))) query = query.eq("cliente_id", params.get("cliente_id"));
  const { data: rows, error } = await query;
  if (error) fail(error.message);
  const orders = await enrichShopifyOrders(rows || []);
  const queue = [];
  for (const order of orders) {
    const queuedSlotReserved = await queuedSlotReservationsBefore(order);
    const plan = await wmsPickingPlan(order, order.items || [], { queuedSlotReserved });
    const refill = (plan.replenishment || []).find((item) => item.can_replenish);
    if (!refill) continue;
    const source = (refill.pallet_sources || []).find((item) => Number(item.quantita || 0) > 0);
    if (!source || !refill.target_slot) continue;
    queue.push({
      order: {
        id: order.id,
        order_name: order.order_name,
        cliente_id: order.cliente_id,
        cliente_ragione_sociale: order.cliente_ragione_sociale,
        processed_at: order.processed_at,
      },
      product: {
        product_key: refill.product_key,
        titolo: refill.titolo,
        ean: refill.ean,
        fnsku: refill.fnsku,
      },
      source,
      target: refill.target_slot,
      quantita: Math.min(Number(refill.quantita || 0), Number(source.quantita || 0)),
      total_required: Number(refill.quantita || 0),
    });
  }
  return ok({ queue, orders_waiting: orders.length, tasks: queue.length });
}

async function replenishWmsSlot(payload = {}) {
  const profile = await assertWmsStaff();
  const clienteId = optionalText(payload.cliente_id);
  const productKey = optionalText(payload.product_key);
  const targetLocationId = optionalText(payload.target_location_id);
  const quantity = Math.floor(Number(payload.quantita || 0));
  const requestedSourceId = optionalText(payload.source_location_id);
  if (!clienteId || !productKey || !targetLocationId || quantity <= 0) fail("Rifornimento non valido");

  const stockResponse = await wmsStock(new URLSearchParams({ cliente_id: clienteId }));
  const product = (stockResponse.data.products || []).find((item) => wmsInventoryKey(item) === productKey);
  if (!product) fail("Prodotto non trovato nello stock", 404);
  const target = (stockResponse.data.locations || []).find((location) => location.id === targetLocationId);
  if (!target || target.tipo !== "slot" || target.stato !== "attiva") fail("La destinazione deve essere uno slot attivo");
  const foreignContents = (target.contenuto || []).filter((item) => item.cliente_id !== clienteId || wmsInventoryKey(item) !== productKey);
  if (foreignContents.length) fail(`${target.codice} contiene gia un altro prodotto.`);

  const sources = (product.ubicazioni || [])
    .filter((location) => location.tipo === "pallet" && Number(location.quantita || 0) > 0)
    .filter((location) => !requestedSourceId || location.id === requestedSourceId)
    .sort(naturalLocationSort);
  const palletAvailable = sources.reduce((sum, location) => sum + Number(location.quantita || 0), 0);
  if (palletAvailable < quantity) fail(`Nei pallet ci sono ${palletAvailable} pezzi, ne servono ${quantity}.`);

  let remaining = quantity;
  const transfers = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const moved = Math.min(remaining, Number(source.quantita || 0));
    transfers.push({
      cliente_id: clienteId,
      product_key: productKey,
      source_location_id: source.id,
      target_location_id: targetLocationId,
      quantita: moved,
      order_id: optionalText(payload.order_id),
      operatore_id: profile.id,
    });
    remaining -= moved;
  }
  const { error } = await requireSupabase().from("wms_stock_transfers").insert(transfers);
  if (error) fail(error.message);
  const orderId = optionalText(payload.order_id);
  const order = orderId ? await evaluateWmsOrderGate(orderId, { force: true }) : null;
  return ok({ moved: quantity, target: target.codice, sources: transfers.length, order });
}

function sameWmsCode(left, right) {
  return normalizedText(left).replace(/\s+/g, "") === normalizedText(right).replace(/\s+/g, "");
}

function findWmsLocation(stock, payload = {}, fieldPrefix = "") {
  const locationId = optionalText(payload[`${fieldPrefix}location_id`]);
  const locationCode = optionalText(payload[`${fieldPrefix}location_code`] || payload[`${fieldPrefix}codice`]);
  const location = (stock.locations || []).find((item) => (
    (locationId && item.id === locationId)
    || (locationCode && sameWmsCode(item.codice, locationCode))
  ));
  if (!location) fail("Ubicazione non trovata", 404);
  if (location.stato !== "attiva") fail(`${location.codice} non e attiva`);
  return location;
}

function findWmsLocationContent(location, payload = {}) {
  const requestedClientId = optionalText(payload.cliente_id);
  const requestedProductKey = optionalText(payload.product_key);
  const rows = (location.contenuto || []).filter((item) => {
    const productKey = wmsInventoryKey(item);
    return (!requestedClientId || item.cliente_id === requestedClientId)
      && (!requestedProductKey || productKey === requestedProductKey);
  });
  if (!rows.length) fail(`${location.codice} non contiene questo prodotto`);
  if (rows.length > 1 && (!requestedClientId || !requestedProductKey)) {
    fail(`${location.codice} contiene piu referenze: apri il dettaglio e scegli la riga.`);
  }
  const item = rows[0];
  const productKey = wmsInventoryKey(item);
  if (!productKey) fail("Prodotto senza chiave inventario");
  return { ...item, product_key: productKey };
}

function assertCompatibleTarget(target, item) {
  const foreignContents = (target.contenuto || []).filter((row) => (
    row.cliente_id !== item.cliente_id || wmsInventoryKey(row) !== item.product_key
  ));
  if (foreignContents.length) fail(`${target.codice} contiene gia un altro prodotto.`);
}

async function reservedWmsPickingQuantity(locationId, productKey) {
  const [
    { data: tasks, error: tasksError },
    { data: massBatches, error: massBatchesError },
    { data: galluseBatches, error: galluseBatchesError },
  ] = await Promise.all([
    requireSupabase().from("wms_pick_tasks").select("id").in("stato", ["da_prelevare", "in_corso"]),
    requireSupabase().from("wms_mass_pick_batches").select("id").eq("stato", "in_corso"),
    requireSupabase().from("wms_galluse_batches").select("id").in("stato", ["da_associare_bag", "in_corso"]),
  ]);
  const firstError = tasksError || massBatchesError || galluseBatchesError;
  if (firstError) fail(firstError.message);

  const taskIds = (tasks || []).map((row) => row.id);
  const massIds = (massBatches || []).map((row) => row.id);
  const galluseIds = (galluseBatches || []).map((row) => row.id);
  const [pickResult, massResult, galluseResult] = await Promise.all([
    taskIds.length
      ? requireSupabase().from("wms_pick_lines").select("quantita_attesa,quantita_prelevata").in("task_id", taskIds).eq("location_id", locationId).eq("product_key", productKey)
      : Promise.resolve({ data: [], error: null }),
    massIds.length
      ? requireSupabase().from("wms_mass_pick_lines").select("quantita_attesa,quantita_prelevata").in("batch_id", massIds).eq("location_id", locationId).eq("product_key", productKey)
      : Promise.resolve({ data: [], error: null }),
    galluseIds.length
      ? requireSupabase().from("wms_galluse_lines").select("quantita_attesa,quantita_prelevata").in("batch_id", galluseIds).eq("location_id", locationId).eq("product_key", productKey)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const lineError = pickResult.error || massResult.error || galluseResult.error;
  if (lineError) fail(lineError.message);
  return [...(pickResult.data || []), ...(massResult.data || []), ...(galluseResult.data || [])]
    .reduce((total, line) => total + Math.max(0, Number(line.quantita_attesa || 0) - Number(line.quantita_prelevata || 0)), 0);
}

async function adjustWmsLocationQuantity(payload = {}) {
  const profile = await assertWmsStaff();
  const quantity = Math.floor(Number(payload.quantita));
  if (!Number.isFinite(quantity) || quantity < 0) fail("Inserisci una quantita valida");

  const stockResponse = await wmsStock(new URLSearchParams(optionalText(payload.cliente_id) ? { cliente_id: payload.cliente_id } : undefined));
  const location = findWmsLocation(stockResponse.data, payload);
  const item = findWmsLocationContent(location, payload);
  const now = nowIso();

  const { data: session, error: sessionError } = await requireSupabase()
    .from("wms_inventory_sessions")
    .insert({
      location_id: location.id,
      stato: "completata",
      operatore_id: profile.id,
      note: "Rettifica da scanner universale",
      started_at: now,
      completed_at: now,
    })
    .select()
    .single();
  if (sessionError) fail(sessionError.message);

  const { error: countError } = await requireSupabase()
    .from("wms_inventory_counts")
    .insert({
      session_id: session.id,
      location_id: location.id,
      cliente_id: item.cliente_id,
      product_key: item.product_key,
      ean: item.ean,
      fnsku: item.fnsku,
      titolo: item.titolo,
      quantita_attesa: Number(item.quantita || 0),
      quantita_contata: quantity,
      verificata: true,
      created_by: profile.id,
      updated_at: now,
    });
  if (countError) fail(countError.message);
  try {
    await recheckWmsOrderExceptions({ cliente_id: item.cliente_id, exception_type: "stock", limit: 100 });
  } catch (error) {
    console.warn("Ricontrollo automatico ordini non disponibile", error);
  }
  return ok({ ok: true, location: location.codice, quantita: quantity });
}

async function moveWmsStockQuantity(payload = {}) {
  const profile = await assertWmsStaff();
  const quantity = Math.floor(Number(payload.quantita));
  if (!Number.isFinite(quantity) || quantity <= 0) fail("Inserisci una quantita maggiore di zero");

  const stockResponse = await wmsStock(new URLSearchParams(optionalText(payload.cliente_id) ? { cliente_id: payload.cliente_id } : undefined));
  const source = findWmsLocation(stockResponse.data, payload, "source_");
  const target = findWmsLocation(stockResponse.data, payload, "target_");
  if (source.id === target.id) fail("Origine e destinazione devono essere diverse");

  const item = findWmsLocationContent(source, payload);
  if (quantity > Number(item.quantita || 0)) fail(`In ${source.codice} ci sono solo ${item.quantita} pezzi`);
  const reserved = await reservedWmsPickingQuantity(source.id, item.product_key);
  const movable = Math.max(0, Number(item.quantita || 0) - reserved);
  if (quantity > movable) {
    fail(`${reserved} pezzi in ${source.codice} sono gia impegnati nel picking. Puoi spostarne al massimo ${movable}.`, 409);
  }
  assertCompatibleTarget(target, item);

  const { error } = await requireSupabase()
    .from("wms_stock_transfers")
    .insert({
      cliente_id: item.cliente_id,
      product_key: item.product_key,
      source_location_id: source.id,
      target_location_id: target.id,
      quantita: quantity,
      operatore_id: profile.id,
    });
  if (error) fail(error.message);
  return ok({ ok: true, source: source.codice, target: target.codice, quantita: quantity });
}

async function moveWmsPalletToSlot(payload = {}) {
  const stockResponse = await wmsStock(new URLSearchParams(optionalText(payload.cliente_id) ? { cliente_id: payload.cliente_id } : undefined));
  const source = findWmsLocation(stockResponse.data, payload, "source_");
  const target = findWmsLocation(stockResponse.data, payload, "target_");
  if (source.tipo !== "pallet") fail("Scansiona un pallet come origine");
  if (target.tipo !== "slot") fail("La destinazione deve essere uno slot");
  const targetItem = (target.contenuto || [])[0];
  return moveWmsStockQuantity({
    ...payload,
    source_location_id: source.id,
    target_location_id: target.id,
    cliente_id: targetItem?.cliente_id || payload.cliente_id,
    product_key: targetItem ? wmsInventoryKey(targetItem) : payload.product_key,
  });
}

async function swapWmsLocations(payload = {}) {
  const profile = await assertWmsStaff();
  const stockResponse = await wmsStock(new URLSearchParams(optionalText(payload.cliente_id) ? { cliente_id: payload.cliente_id } : undefined));
  const source = findWmsLocation(stockResponse.data, payload, "source_");
  const target = findWmsLocation(stockResponse.data, payload, "target_");
  if (source.id === target.id) fail("Scansiona uno slot diverso");
  if (source.tipo !== "slot" || target.tipo !== "slot") fail("Puoi scambiare solo due slot");

  const transfers = [
    ...(source.contenuto || []).map((item) => ({
      cliente_id: item.cliente_id,
      product_key: wmsInventoryKey(item),
      source_location_id: source.id,
      target_location_id: target.id,
      quantita: Number(item.quantita || 0),
      operatore_id: profile.id,
    })),
    ...(target.contenuto || []).map((item) => ({
      cliente_id: item.cliente_id,
      product_key: wmsInventoryKey(item),
      source_location_id: target.id,
      target_location_id: source.id,
      quantita: Number(item.quantita || 0),
      operatore_id: profile.id,
    })),
  ].filter((item) => item.product_key && item.quantita > 0);
  if (!transfers.length) fail("Entrambi gli slot sono vuoti");

  const { error } = await requireSupabase().from("wms_stock_transfers").insert(transfers);
  if (error) fail(error.message);
  return ok({ ok: true, source: source.codice, target: target.codice, transfers: transfers.length });
}

async function withWmsReferencePhotos(lines = [], clienteId = null) {
  const lookups = ["fnsku", "ean", "sku"].map((field) => ({
    field,
    values: [...new Set((lines || []).map((line) => optionalText(line?.[field])).filter(Boolean))],
  })).filter((lookup) => lookup.values.length);
  if (!lookups.length) return lines || [];
  const results = await Promise.all(lookups.map(async ({ field, values }) => {
    let query = requireSupabase().from("referenze").select("id,fnsku,ean,sku,foto_url").in(field, values);
    if (clienteId) query = query.eq("cliente_id", clienteId);
    const { data, error } = await query;
    if (error) fail(error.message);
    return data || [];
  }));
  const photosByCode = new Map();
  results.flat().forEach((reference) => {
    for (const field of ["fnsku", "ean", "sku"]) {
      const value = optionalText(reference?.[field]);
      if (value && reference.foto_url) photosByCode.set(`${field}:${value}`, reference.foto_url);
    }
  });
  return (lines || []).map((line) => ({
    ...line,
    foto_url: line.foto_url
      || photosByCode.get(`fnsku:${optionalText(line.fnsku)}`)
      || photosByCode.get(`ean:${optionalText(line.ean)}`)
      || photosByCode.get(`sku:${optionalText(line.sku)}`)
      || null,
  }));
}

async function wmsPickSnapshot(orderId) {
  await assertWmsStaff();
  const [{ data: order, error: orderError }, { data: task, error: taskError }] = await Promise.all([
    requireSupabase().from("shopify_orders").select("*").eq("id", orderId).single(),
    requireSupabase().from("wms_pick_tasks").select("*").eq("order_id", orderId).maybeSingle(),
  ]);
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);
  if (taskError) fail(taskError.message);
  if (!task) {
    const [enrichedOrder] = await enrichShopifyOrders([order]);
    const plan = await wmsPickingPlan(order, enrichedOrder.items || []);
    return ok({ order: enrichedOrder, task: null, lines: [], current_line: null, replenishment: plan.replenishment, errors: plan.errors, can_start: plan.ready, summary: { expected: 0, picked: 0, progress: 0 } });
  }

  const clientMap = await clientiMap([order.cliente_id]);
  const activeOrder = { ...order, items: [], cliente_ragione_sociale: clientMap[order.cliente_id]?.ragione_sociale || null };

  const { data: lines, error: linesError } = await requireSupabase()
    .from("wms_pick_lines")
    .select("*")
    .eq("task_id", task.id)
    .order("sequenza", { ascending: true });
  if (linesError) fail(linesError.message);
  const locationIds = [...new Set((lines || []).map((line) => line.location_id))];
  const { data: locations, error: locationsError } = locationIds.length
    ? await requireSupabase().from("wms_locations").select("*").in("id", locationIds)
    : { data: [], error: null };
  if (locationsError) fail(locationsError.message);
  const locationMap = Object.fromEntries((locations || []).map((location) => [location.id, location]));
  const linesWithPhotos = await withWmsReferencePhotos(lines || [], order.cliente_id);
  const rows = linesWithPhotos.map((line) => ({ ...line, location: locationMap[line.location_id] || null }));
  const expected = rows.reduce((sum, line) => sum + Number(line.quantita_attesa || 0), 0);
  const picked = rows.reduce((sum, line) => sum + Number(line.quantita_prelevata || 0), 0);
  return ok({
    order: activeOrder,
    task,
    lines: rows,
    current_line: rows.find((line) => Number(line.quantita_prelevata || 0) < Number(line.quantita_attesa || 0)) || null,
    summary: { expected, picked, progress: expected ? Math.round((picked / expected) * 100) : 0, stops: new Set(rows.map((line) => line.location_id)).size },
  });
}

function massOrderSignature(order = {}) {
  return (order.items || [])
    .map((item) => `${item.referenza_id || "missing"}:${Number(item.quantita || 0)}`)
    .sort()
    .join("|");
}

function massGroupsFromOrders(orders = []) {
  const groups = new Map();
  for (const order of orders) {
    if (order.wms_status !== "da_preparare" || !(order.items || []).length) continue;
    if (order.raw?.preparation_method === "galluse") continue;
    if ((order.items || []).some((item) => !item.referenza_id || Number(item.quantita || 0) <= 0)) continue;
    const signature = massOrderSignature(order);
    const key = `${order.cliente_id}:${signature}`;
    if (!groups.has(key)) groups.set(key, { key, signature, cliente_id: order.cliente_id, cliente: order.cliente_ragione_sociale, orders: [], products: [] });
    groups.get(key).orders.push(order);
  }
  return [...groups.values()].map((group) => {
    const first = group.orders[0];
    group.products = (first.items || []).map((item) => ({
      referenza_id: item.referenza_id,
      titolo: item.titolo,
      ean: item.ean,
      sku: item.sku,
      quantita_per_ordine: Number(item.quantita || 0),
      quantita_totale: Number(item.quantita || 0) * group.orders.length,
    }));
    group.numero_ordini = group.orders.length;
    group.pezzi_totali = group.products.reduce((sum, item) => sum + item.quantita_totale, 0);
    return group;
  }).filter((group) => group.numero_ordini > 1).sort((left, right) => right.numero_ordini - left.numero_ordini);
}

async function listWmsMassPicking(params = new URLSearchParams()) {
  await assertWmsStaff();
  const operational = await wmsOperationalOrdersData(params);
  const groups = massGroupsFromOrders(operational.orders);
  const { data: batches, error: batchesError } = await requireSupabase()
    .from("wms_mass_pick_batches")
    .select("*")
    .neq("stato", "annullata")
    .order("created_at", { ascending: false });
  if (batchesError) fail(batchesError.message);
  const batchIds = (batches || []).map((batch) => batch.id);
  const [{ data: batchOrders, error: ordersError }, { data: batchLines, error: linesError }] = await Promise.all([
    batchIds.length ? requireSupabase().from("wms_mass_pick_orders").select("*").in("batch_id", batchIds) : Promise.resolve({ data: [], error: null }),
    batchIds.length ? requireSupabase().from("wms_mass_pick_lines").select("*").in("batch_id", batchIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ordersError || linesError) fail((ordersError || linesError).message);
  const orderIds = (batchOrders || []).map((item) => item.order_id);
  const { data: orders, error: linkedOrdersError } = orderIds.length
    ? await requireSupabase().from("shopify_orders").select("id,order_name,cliente_id").in("id", orderIds)
    : { data: [], error: null };
  if (linkedOrdersError) fail(linkedOrdersError.message);
  const orderMap = Object.fromEntries((orders || []).map((order) => [order.id, order]));
  return ok({
    groups,
    batches: (batches || []).map((batch) => ({
      ...batch,
      orders: (batchOrders || []).filter((item) => item.batch_id === batch.id).sort((a, b) => a.packing_sequence - b.packing_sequence).map((item) => ({ ...item, order: orderMap[item.order_id] })),
      lines: (batchLines || []).filter((line) => line.batch_id === batch.id),
    })),
    separate_orders: operational.orders.filter((order) => order.wms_status === "da_preparare" && !groups.some((group) => group.orders.some((candidate) => candidate.id === order.id))).length,
  });
}

async function claimWmsBag(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!/^B-[A-Z0-9]{5}$/.test(code)) fail("Scansiona una bag nel formato B-7K2Q9.");
  const { data: bag, error } = await requireSupabase().from("wms_bags").select("*").eq("codice", code).maybeSingle();
  if (error || !bag) fail(error?.message || "Bag non censita.", 404);
  if (bag.stato !== "disponibile") fail(`La bag ${code} e gia in uso.`, 409);
  const { data: claimed, error: claimError } = await requireSupabase().from("wms_bags").update({ stato: "in_packing", updated_at: nowIso() }).eq("id", bag.id).eq("stato", "disponibile").select().maybeSingle();
  if (claimError || !claimed) fail(claimError?.message || "La bag e stata appena usata da un altro operatore.", 409);
  return claimed;
}

async function releaseWmsBag(bagId) {
  if (!bagId) return;
  const { error } = await requireSupabase().from("wms_bags").update({ stato: "disponibile", updated_at: nowIso() }).eq("id", bagId);
  if (error) fail(error.message);
}

async function listWmsBags() {
  await assertWmsStaff();
  const { data, error } = await requireSupabase().from("wms_bags").select("*").order("codice");
  if (error) fail(error.message);
  return ok(data || []);
}

function randomWmsBagCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `B-${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")}`;
}

async function generateWmsBags(payload = {}) {
  await assertWmsStaff();
  const quantity = Math.floor(Number(payload.quantity ?? payload.quantita));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) fail("Puoi generare da 1 a 500 bag alla volta.");

  const sb = requireSupabase();
  const candidates = new Set();
  while (candidates.size < Math.min(2000, quantity * 4)) candidates.add(randomWmsBagCode());
  const candidateCodes = [...candidates];
  const { data: existing, error: existingError } = await sb.from("wms_bags").select("codice").in("codice", candidateCodes);
  if (existingError) fail(existingError.message);
  const existingCodes = new Set((existing || []).map((bag) => bag.codice));
  const codes = candidateCodes.filter((code) => !existingCodes.has(code)).slice(0, quantity);
  if (codes.length !== quantity) fail("Non sono riuscito a trovare abbastanza codici bag univoci. Riprova.");
  const { error: insertError } = await sb.from("wms_bags").insert(codes.map((codice) => ({
      codice,
      stato: "disponibile",
      updated_at: nowIso(),
    })));
  if (insertError) fail(insertError.message);
  const { data, error } = await sb.from("wms_bags").select("id,codice,stato,label_printed_at,updated_at").in("codice", codes).order("codice");
  if (error) fail(error.message);
  return ok({
    bags: data || [],
    create: codes.length,
    esistenti: 0,
  });
}

async function markWmsBagLabelsPrinted(payload = {}) {
  await assertWmsStaff();
  const codes = [...new Set((payload.codes || []).map((value) => normalizedScanCode(value)).filter((value) => /^B-[A-Z0-9]{5}$/.test(value)))];
  if (!codes.length || codes.length > 500) fail("Elenco bag non valido.");
  const sb = requireSupabase();
  const { data: bags, error: readError } = await sb.from("wms_bags").select("codice,label_printed_at").in("codice", codes);
  if (readError) fail(readError.message);
  if ((bags || []).length !== codes.length) fail("Una o più bag non esistono.", 404);
  const alreadyPrinted = (bags || []).filter((bag) => bag.label_printed_at).map((bag) => bag.codice);
  if (alreadyPrinted.length) fail(`Etichetta già stampata e non ristampabile: ${alreadyPrinted.join(", ")}`, 409);
  const printedAt = nowIso();
  const { data, error } = await sb.from("wms_bags").update({ label_printed_at: printedAt, updated_at: printedAt }).in("codice", codes).is("label_printed_at", null).select("codice,label_printed_at");
  if (error) fail(error.message);
  if ((data || []).length !== codes.length) fail("Una bag è stata già stampata da un altro dispositivo.", 409);
  return ok({ printed: data || [] });
}

function normalizedWmsCartCode(value) {
  const code = normalizedScanCode(value);
  if (!/^[A-Z][A-Z0-9_-]{2,39}$/.test(code)) {
    fail("Scansiona un codice carrello valido.");
  }
  return code;
}

async function assertWmsCartUnlocked(cartCode) {
  const { data: cart, error: cartError } = await requireSupabase()
    .from("wms_carts")
    .select("id")
    .eq("codice", cartCode)
    .maybeSingle();
  if (cartError) fail(cartError.message);
  if (!cart) return;
  const { data, error } = await requireSupabase()
    .from("wms_galluse_batches")
    .select("id")
    .eq("cart_id", cart.id)
    .in("stato", ["da_associare_bag", "in_corso"])
    .limit(1);
  if (error) fail(error.message);
  if ((data || []).length) fail("Il carrello Galluse e in uso: completa o annulla il picking prima di modificare le bag.", 409);
}

async function findOrCreateWmsCart(rawCode) {
  const codice = normalizedWmsCartCode(rawCode);
  const sb = requireSupabase();
  const { data: existing, error: existingError } = await sb.from("wms_carts").select("*").eq("codice", codice).maybeSingle();
  if (existingError) fail(existingError.message);
  if (existing) return existing;
  const { data: created, error: createError } = await sb.from("wms_carts")
    .insert({ codice, righe: 2, colonne: 5, updated_at: nowIso() })
    .select()
    .single();
  if (createError || !created) fail(createError?.message || "Carrello non creato");
  return created;
}

async function wmsCartSnapshotFromCart(cart) {
  const sb = requireSupabase();
  const { data: positions, error: positionsError } = await sb
    .from("wms_cart_bag_positions")
    .select("*")
    .eq("cart_id", cart.id)
    .order("posizione");
  if (positionsError) fail(positionsError.message);
  const bagIds = (positions || []).map((position) => position.bag_id);
  const { data: bags, error: bagsError } = bagIds.length
    ? await sb.from("wms_bags").select("id,codice,stato").in("id", bagIds)
    : { data: [], error: null };
  if (bagsError) fail(bagsError.message);
  const bagMap = Object.fromEntries((bags || []).map((bag) => [bag.id, bag]));
  return ok({
    cart,
    positions: (positions || []).map((position) => ({ ...position, bag: bagMap[position.bag_id] || null })),
    capacity: Number(cart.righe || 1) * Number(cart.colonne || 1),
  });
}

async function wmsCartSnapshot(rawCode, { create = false } = {}) {
  await assertWmsStaff();
  const codice = normalizedWmsCartCode(rawCode);
  const sb = requireSupabase();
  let { data: cart, error } = await sb.from("wms_carts").select("*").eq("codice", codice).maybeSingle();
  if (error) fail(error.message);
  if (!cart && create) cart = await findOrCreateWmsCart(codice);
  if (!cart) fail("Carrello non configurato. Scansionalo per crearlo.", 404);
  return wmsCartSnapshotFromCart(cart);
}

async function syncGalluseLegacyCart(cart) {
  if (cart.codice !== "CARRELLO-01") return;
  const sb = requireSupabase();
  const { data: positions, error: positionsError } = await sb
    .from("wms_cart_bag_positions")
    .select("posizione,bag_id,bag_code")
    .eq("cart_id", cart.id)
    .lte("posizione", 10)
    .order("posizione");
  if (positionsError) fail(positionsError.message);
  const { error: clearError } = await sb.from("wms_galluse_cart_positions").delete().gte("posizione", 1);
  if (clearError) fail(clearError.message);
  if (!(positions || []).length) return;
  const { error: insertError } = await sb.from("wms_galluse_cart_positions").insert((positions || []).map((position) => ({
    posizione: position.posizione,
    bag_id: position.bag_id,
    bag_code: position.bag_code,
    updated_at: nowIso(),
  })));
  if (insertError) fail(insertError.message);
}

async function scanWmsCart(payload = {}) {
  await assertWmsStaff();
  const cart = await findOrCreateWmsCart(payload.codice || payload.code);
  return wmsCartSnapshotFromCart(cart);
}

async function updateWmsCart(rawCode, payload = {}) {
  await assertWmsStaff();
  const cart = await findOrCreateWmsCart(rawCode);
  await assertWmsCartUnlocked(cart.codice);
  const righe = Math.floor(Number(payload.righe || cart.righe));
  const colonne = Math.floor(Number(payload.colonne || cart.colonne));
  if (righe < 1 || righe > 6 || colonne < 1 || colonne > 10) fail("La griglia puo avere da 1 a 6 righe e da 1 a 10 colonne.");
  const capacity = righe * colonne;
  const { count, error: countError } = await requireSupabase()
    .from("wms_cart_bag_positions")
    .select("posizione", { count: "exact", head: true })
    .eq("cart_id", cart.id)
    .gt("posizione", capacity);
  if (countError) fail(countError.message);
  if (count) fail("Prima libera le bag che resterebbero fuori dalla nuova griglia.", 409);
  const { data: updated, error } = await requireSupabase().from("wms_carts")
    .update({ righe, colonne, updated_at: nowIso() })
    .eq("id", cart.id)
    .select()
    .single();
  if (error || !updated) fail(error?.message || "Griglia non aggiornata");
  await syncGalluseLegacyCart(updated);
  return wmsCartSnapshotFromCart(updated);
}

async function assignWmsCartBag(rawCode, payload = {}) {
  await assertWmsStaff();
  const cart = await findOrCreateWmsCart(rawCode);
  await assertWmsCartUnlocked(cart.codice);
  const posizione = Math.floor(Number(payload.posizione || 0));
  const capacity = Number(cart.righe || 1) * Number(cart.colonne || 1);
  if (posizione < 1 || posizione > capacity) fail("Posizione della griglia non valida.");
  const bagCode = normalizedScanCode(payload.bag_code || payload.codice || payload.code);
  if (!/^B-[A-Z0-9]{5}$/.test(bagCode)) fail("Scansiona una bag nel formato B-7K2Q9.");
  const sb = requireSupabase();
  let { data: bag, error: bagError } = await sb.from("wms_bags").select("*").eq("codice", bagCode).maybeSingle();
  if (bagError) fail(bagError.message);
  if (!bag) {
    const { data: created, error: createError } = await sb.from("wms_bags").insert({ codice: bagCode, stato: "disponibile", updated_at: nowIso() }).select().single();
    if (createError || !created) fail(createError?.message || "Bag non creata");
    bag = created;
  }
  if (bag.stato !== "disponibile") fail(`La bag ${bagCode} e in uso e non puo essere configurata.`, 409);
  const { data: currentPlacement, error: placementError } = await sb
    .from("wms_cart_bag_positions")
    .select("cart_id,posizione")
    .eq("bag_id", bag.id)
    .maybeSingle();
  if (placementError) fail(placementError.message);
  if (currentPlacement && (currentPlacement.cart_id !== cart.id || Number(currentPlacement.posizione) !== posizione)) {
    fail(`La bag ${bagCode} e gia assegnata a un'altra casella. Rimuovila prima da li.`, 409);
  }
  const { error } = await sb.from("wms_cart_bag_positions").upsert({
    cart_id: cart.id,
    posizione,
    bag_id: bag.id,
    bag_code: bagCode,
    updated_at: nowIso(),
  }, { onConflict: "cart_id,posizione" });
  if (error) fail(error.message);
  await syncGalluseLegacyCart(cart);
  return wmsCartSnapshotFromCart(cart);
}

async function removeWmsCartBag(rawCode, payload = {}) {
  await assertWmsStaff();
  const cart = await findOrCreateWmsCart(rawCode);
  await assertWmsCartUnlocked(cart.codice);
  const posizione = Math.floor(Number(payload.posizione || 0));
  if (posizione < 1) fail("Posizione della griglia non valida.");
  const { error } = await requireSupabase().from("wms_cart_bag_positions")
    .delete()
    .eq("cart_id", cart.id)
    .eq("posizione", posizione);
  if (error) fail(error.message);
  await syncGalluseLegacyCart(cart);
  return wmsCartSnapshotFromCart(cart);
}

async function emptyAllWmsBags() {
  await assertWmsStaff();
  const sb = requireSupabase();
  const resetAt = nowIso();
  const [
    { data: packingSessions, error: packingError },
    { data: pickTasks, error: pickError },
    { data: massBatches, error: massError },
    { data: galluseOrders, error: galluseError },
  ] = await Promise.all([
    sb.from("wms_packing_sessions").select("id,order_id,bag_id,bag_code,pick_task_id,mass_batch_id").or("bag_code.not.is.null,bag_id.not.is.null"),
    sb.from("wms_pick_tasks").select("id,order_id,bag_id,bag_code").or("bag_code.not.is.null,bag_id.not.is.null"),
    sb.from("wms_mass_pick_batches").select("id,bag_id,bag_code").or("bag_code.not.is.null,bag_id.not.is.null"),
    sb.from("wms_galluse_orders").select("id,batch_id,order_id,bag_id,bag_code").or("bag_code.not.is.null,bag_id.not.is.null"),
  ]);
  if (packingError || pickError || massError || galluseError) {
    fail((packingError || pickError || massError || galluseError).message);
  }

  const packingSessionIds = [...new Set((packingSessions || []).map((session) => session.id).filter(Boolean))];
  const pickTaskIds = [...new Set([
    ...(pickTasks || []).map((task) => task.id),
    ...(packingSessions || []).map((session) => session.pick_task_id),
  ].filter(Boolean))];
  const massBatchIds = [...new Set([
    ...(massBatches || []).map((batch) => batch.id),
    ...(packingSessions || []).map((session) => session.mass_batch_id),
  ].filter(Boolean))];
  const galluseBatchIds = [...new Set((galluseOrders || []).map((link) => link.batch_id).filter(Boolean))];

  const { data: massOrders, error: massOrdersError } = massBatchIds.length
    ? await sb.from("wms_mass_pick_orders").select("order_id").in("batch_id", massBatchIds)
    : { data: [], error: null };
  if (massOrdersError) fail(massOrdersError.message);

  const linkedOrderIds = [...new Set([
    ...(packingSessions || []).map((session) => session.order_id),
    ...(pickTasks || []).map((task) => task.order_id),
    ...(massOrders || []).map((link) => link.order_id),
    ...(galluseOrders || []).map((link) => link.order_id),
  ].filter(Boolean))];
  const { data: linkedOrders, error: linkedOrdersError } = linkedOrderIds.length
    ? await sb.from("shopify_orders").select("id,wms_status").in("id", linkedOrderIds)
    : { data: [], error: null };
  if (linkedOrdersError) fail(linkedOrdersError.message);
  const resettableOrderIds = (linkedOrders || [])
    .filter((order) => !["imballato", "spedito", "annullato"].includes(order.wms_status))
    .map((order) => order.id);

  const steps = [
    packingSessionIds.length
      ? sb.from("wms_packing_sessions").delete().in("id", packingSessionIds)
      : Promise.resolve({ error: null }),
    massBatchIds.length
      ? sb.from("wms_mass_pick_batches").delete().in("id", massBatchIds)
      : Promise.resolve({ error: null }),
    galluseBatchIds.length
      ? sb.from("wms_galluse_batches").delete().in("id", galluseBatchIds)
      : Promise.resolve({ error: null }),
    pickTaskIds.length
      ? sb.from("wms_pick_tasks").delete().in("id", pickTaskIds)
      : Promise.resolve({ error: null }),
    resettableOrderIds.length
      ? sb.from("shopify_orders").update({ wms_status: "da_preparare", updated_at: resetAt }).in("id", resettableOrderIds)
      : Promise.resolve({ error: null }),
    sb.from("wms_bags").update({ stato: "disponibile", updated_at: resetAt }).neq("id", EMPTY_UUID),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) fail(error.message);
  }

  return ok({
    bags_cleared: true,
    packing_sessions: packingSessionIds.length,
    picking_tasks: pickTaskIds.length,
    mass_batches: massBatchIds.length,
    galluse_batches: galluseBatchIds.length,
    orders_reset: resettableOrderIds.length,
  });
}

async function listWmsBagHistory() {
  const profile = await assertWmsStaff();
  const [{ data: tasks, error: tasksError }, { data: batches, error: batchesError }] = await Promise.all([
    requireSupabase().from("wms_pick_tasks").select("id,order_id,bag_code,stato,completed_at,created_at").eq("operatore_id", profile.id).not("bag_code", "is", null).order("completed_at", { ascending: false }),
    requireSupabase().from("wms_mass_pick_batches").select("id,bag_code,stato,completed_at,created_at").eq("operatore_id", profile.id).not("bag_code", "is", null).order("completed_at", { ascending: false }),
  ]);
  if (tasksError || batchesError) fail((tasksError || batchesError).message);

  const taskOrderIds = (tasks || []).map((task) => task.order_id);
  const batchIds = (batches || []).map((batch) => batch.id);
  const [{ data: taskOrders, error: taskOrdersError }, { data: batchOrders, error: batchOrdersError }, { data: sessions, error: sessionsError }] = await Promise.all([
    taskOrderIds.length ? requireSupabase().from("shopify_orders").select("id,order_name").in("id", taskOrderIds) : Promise.resolve({ data: [], error: null }),
    batchIds.length ? requireSupabase().from("wms_mass_pick_orders").select("batch_id,order_id").in("batch_id", batchIds) : Promise.resolve({ data: [], error: null }),
    requireSupabase().from("wms_packing_sessions").select("order_id,mass_batch_id,stato").not("bag_code", "is", null),
  ]);
  if (taskOrdersError || batchOrdersError || sessionsError) fail((taskOrdersError || batchOrdersError || sessionsError).message);

  const orderIds = [...new Set([...(taskOrderIds || []), ...(batchOrders || []).map((item) => item.order_id)])];
  const missingOrderIds = orderIds.filter((id) => !(taskOrders || []).some((order) => order.id === id));
  const { data: batchOrderDetails, error: batchOrderDetailsError } = missingOrderIds.length
    ? await requireSupabase().from("shopify_orders").select("id,order_name").in("id", missingOrderIds)
    : { data: [], error: null };
  if (batchOrderDetailsError) fail(batchOrderDetailsError.message);

  const orderMap = Object.fromEntries([...(taskOrders || []), ...(batchOrderDetails || [])].map((order) => [order.id, order]));
  const sessionByOrder = new Map((sessions || []).filter((session) => !session.mass_batch_id).map((session) => [session.order_id, session]));
  const sessionsByBatch = groupBy((sessions || []).filter((session) => session.mass_batch_id), "mass_batch_id");
  const normalItems = (tasks || []).map((task) => {
    const session = sessionByOrder.get(task.order_id);
    return {
      id: `task-${task.id}`,
      tipo: "1x1",
      codice: task.bag_code,
      created_at: task.completed_at || task.created_at,
      ordini: [orderMap[task.order_id]?.order_name || "Ordine"],
      numero_ordini: 1,
      stato: session?.stato === "completata" ? "packing_completato" : session?.stato === "in_corso" ? "in_packing" : "in_attesa_packing",
    };
  });
  const massItems = (batches || []).map((batch) => {
    const links = (batchOrders || []).filter((item) => item.batch_id === batch.id);
    const batchSessions = sessionsByBatch[batch.id] || [];
    const completed = batchSessions.filter((session) => session.stato === "completata").length;
    return {
      id: `mass-${batch.id}`,
      tipo: "Massivo",
      codice: batch.bag_code,
      created_at: batch.completed_at || batch.created_at,
      ordini: links.map((item) => orderMap[item.order_id]?.order_name || "Ordine"),
      numero_ordini: links.length,
      stato: batchSessions.length && completed === batchSessions.length ? "packing_completato" : completed > 0 || batch.stato === "in_packing" ? "in_packing" : "in_attesa_packing",
    };
  });
  return ok([...normalItems, ...massItems].sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)));
}

async function wmsBagsPdf() {
  const response = await listWmsBags();
  return ok(generateLabelsPdfBlob({
    formato: "50x30",
    mostra_titolo: true,
    items: response.data.map((bag) => ({ fnsku: bag.codice, titolo: "Bag WMS", copie: 1 })),
  }));
}

async function wmsMassPickSnapshot(batchId) {
  await assertWmsStaff();
  const { data: batch, error: batchError } = await requireSupabase().from("wms_mass_pick_batches").select("*").eq("id", batchId).single();
  if (batchError || !batch) fail(batchError?.message || "Missione Massivo non trovata", 404);
  const [{ data: links, error: linksError }, { data: lines, error: linesError }] = await Promise.all([
    requireSupabase().from("wms_mass_pick_orders").select("*").eq("batch_id", batchId).order("packing_sequence"),
    requireSupabase().from("wms_mass_pick_lines").select("*").eq("batch_id", batchId).order("sequenza"),
  ]);
  if (linksError || linesError) fail((linksError || linesError).message);
  const orderIds = (links || []).map((link) => link.order_id);
  const { data: orders, error: ordersError } = orderIds.length
    ? await requireSupabase().from("shopify_orders").select("*").in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) fail(ordersError.message);
  const enriched = await enrichShopifyOrders(orders || []);
  const orderMap = Object.fromEntries(enriched.map((order) => [order.id, order]));
  const locationIds = [...new Set((lines || []).map((line) => line.location_id))];
  const { data: locations, error: locationsError } = locationIds.length
    ? await requireSupabase().from("wms_locations").select("*").in("id", locationIds)
    : { data: [], error: null };
  if (locationsError) fail(locationsError.message);
  const locationMap = Object.fromEntries((locations || []).map((location) => [location.id, location]));
  const linesWithPhotos = await withWmsReferencePhotos(lines || [], batch.cliente_id);
  const rows = linesWithPhotos.map((line) => ({ ...line, location: locationMap[line.location_id] || null }));
  const expected = rows.reduce((sum, line) => sum + Number(line.quantita_attesa || 0), 0);
  const picked = rows.reduce((sum, line) => sum + Number(line.quantita_prelevata || 0), 0);
  return ok({
    batch,
    orders: (links || []).map((link) => ({ ...link, order: orderMap[link.order_id] || null })).sort((a, b) => a.packing_sequence - b.packing_sequence),
    lines: rows,
    current_line: rows.find((line) => Number(line.quantita_prelevata || 0) < Number(line.quantita_attesa || 0)) || null,
    summary: { orders: links?.length || 0, expected, picked, progress: expected ? Math.round((picked / expected) * 100) : 0, stops: new Set(rows.map((line) => line.location_id)).size },
  });
}

async function startWmsMassPicking(payload = {}) {
  const profile = await assertWmsStaff();
  const signature = optionalText(payload.signature);
  const operational = await wmsOperationalOrdersData(new URLSearchParams(payload.cliente_id ? { cliente_id: payload.cliente_id } : {}));
  const group = massGroupsFromOrders(operational.orders).find((candidate) => candidate.signature === signature && (!payload.cliente_id || candidate.cliente_id === payload.cliente_id));
  if (!group) fail("Il gruppo Massivo non e piu disponibile. Aggiorna la lista.", 409);
  const orderIds = group.orders.map((order) => order.id);
  const firstOrder = group.orders[0];
  const combinedItems = (firstOrder.items || []).map((item) => ({ ...item, quantita: Number(item.quantita || 0) * group.numero_ordini }));
  const plan = await wmsPickingPlan(firstOrder, combinedItems);
  if (plan.errors.length) fail(plan.errors.join(" "));
  if (plan.replenishment.length) fail(`Rifornisci prima gli slot per ${plan.replenishment.length} ${plan.replenishment.length === 1 ? "prodotto" : "prodotti"}.`);

  const uniqueLocations = [...new Set(plan.allocations.map((allocation) => allocation.location_id))].map((id) => plan.locationMap[id]).filter(Boolean);
  const route = calculateWarehouseRoute(visibleWmsRouteLocations(uniqueLocations, plan.mapSettings), plan.mapSettings);
  if (route.unreachable?.length) fail(`Mappa bloccata: ${route.unreachable.map((location) => location.codice).join(", ")} non e raggiungibile. Lascia almeno una casella libera di passaggio.`);
  const { data: batch, error: batchError } = await requireSupabase().from("wms_mass_pick_batches").insert({
    cliente_id: group.cliente_id,
    signature,
    stato: "in_corso",
    operatore_id: profile.id,
  }).select().single();
  if (batchError || !batch) fail(batchError?.message || "Missione Massivo non creata");
  const sequenceMap = Object.fromEntries(route.locations.map((location, index) => [location.id, index + 1]));
  const referenceByItem = Object.fromEntries(combinedItems.map((item) => [item.id, item.referenza_id]));
  const perOrderByReference = Object.fromEntries((firstOrder.items || []).map((item) => [item.referenza_id, Number(item.quantita || 0)]));
  const lines = plan.allocations.sort((a, b) => sequenceMap[a.location_id] - sequenceMap[b.location_id]).map((allocation, index) => {
    const referenzaId = referenceByItem[allocation.order_item_id];
    return {
      batch_id: batch.id,
      referenza_id: referenzaId,
      location_id: allocation.location_id,
      product_key: allocation.product_key,
      titolo: allocation.titolo,
      ean: allocation.ean,
      fnsku: allocation.fnsku,
      sku: allocation.sku,
      quantita_per_ordine: perOrderByReference[referenzaId],
      numero_ordini: group.numero_ordini,
      quantita_attesa: allocation.quantita_attesa,
      sequenza: index + 1,
    };
  });
  const [{ error: linksError }, { error: linesError }, { error: statusesError }] = await Promise.all([
    requireSupabase().from("wms_mass_pick_orders").insert(orderIds.map((orderId, index) => ({ batch_id: batch.id, order_id: orderId, packing_sequence: index + 1 }))),
    requireSupabase().from("wms_mass_pick_lines").insert(lines),
    requireSupabase().from("shopify_orders").update({ wms_status: "in_preparazione", updated_at: nowIso() }).in("id", orderIds),
  ]);
  if (linksError || linesError || statusesError) fail((linksError || linesError || statusesError).message);
  return wmsMassPickSnapshot(batch.id);
}

async function scanWmsMassPicking(batchId, payload = {}) {
  const profile = await assertWmsStaff();
  const snapshot = await wmsMassPickSnapshot(batchId);
  const batch = snapshot.data.batch;
  const code = normalizedText(payload.codice || payload.code);
  if (batch.stato === "da_confermare_bag") {
    const bag = await claimWmsBag(code);
    const completedAt = nowIso();
    const orderIds = snapshot.data.orders.map((item) => item.order_id);
    const [{ error: batchUpdateError }, { error: orderUpdateError }] = await Promise.all([
      requireSupabase().from("wms_mass_pick_batches").update({ stato: "completata", bag_id: bag.id, bag_code: bag.codice, completed_at: completedAt, bag_confirmed_at: completedAt, updated_at: completedAt }).eq("id", batchId),
      requireSupabase().from("shopify_orders").update({ wms_status: "in_attesa_packing", updated_at: completedAt }).in("id", orderIds),
    ]);
    if (batchUpdateError || orderUpdateError) fail((batchUpdateError || orderUpdateError).message);
    await Promise.all(snapshot.data.orders.map((item) => (
      ensurePackingSession(item.order_id, null, { massBatchId: batchId, bagId: bag.id, bagCode: bag.codice, packingSequence: item.packing_sequence })
    )));
    return wmsMassPickSnapshot(batchId);
  }
  if (batch.stato !== "in_corso") fail("Questa missione Massivo non e in corso", 409);
  const current = snapshot.data.current_line;
  if (!current) {
    const { error } = await requireSupabase().from("wms_mass_pick_batches").update({ stato: "da_confermare_bag", updated_at: nowIso() }).eq("id", batchId);
    if (error) fail(error.message);
    return wmsMassPickSnapshot(batchId);
  }
  if (!current.location_confirmed_at) {
    if (!code) fail("Scansiona lo slot");
    if (current.location?.tipo !== "slot") fail("Il picking e consentito solo dagli slot.", 409);
    if (normalizedText(current.location?.codice) !== code) fail(`Vai in ${current.location?.codice} e scansiona lo slot corretto.`);
    const { error } = await requireSupabase().from("wms_mass_pick_lines").update({ location_confirmed_at: nowIso() }).eq("id", current.id);
    if (error) fail(error.message);
    return wmsMassPickSnapshot(batchId);
  }
  const remaining = Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0);
  const quantity = Math.floor(Number(payload.quantita || 0));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) fail(`Seleziona da 1 a ${remaining} pezzi.`);
  const next = Number(current.quantita_prelevata || 0) + quantity;
  const { error: lineError } = await requireSupabase().from("wms_mass_pick_lines").update({
    quantita_prelevata: next,
    picked_at: next === Number(current.quantita_attesa) ? nowIso() : null,
  }).eq("id", current.id);
  if (lineError) fail(lineError.message);
  const firstOrderId = snapshot.data.orders[0]?.order_id || null;
  const { error: movementError } = await requireSupabase().from("wms_outbound_movements").upsert({
    mass_pick_line_id: current.id,
    mass_batch_id: batchId,
    order_id: firstOrderId,
    cliente_id: snapshot.data.batch.cliente_id,
    location_id: current.location_id,
    product_key: current.product_key,
    quantita: next,
    operatore_id: profile.id,
    updated_at: nowIso(),
  }, { onConflict: "mass_pick_line_id" });
  if (movementError) fail(movementError.message);

  const updated = await wmsMassPickSnapshot(batchId);
  if (!updated.data.current_line) {
    const { error } = await requireSupabase().from("wms_mass_pick_batches").update({ stato: "da_confermare_bag", updated_at: nowIso() }).eq("id", batchId);
    if (error) fail(error.message);
    return wmsMassPickSnapshot(batchId);
  }
  return updated;
}

function galluseCandidateOrders(orders = []) {
  const massOrderIds = new Set(massGroupsFromOrders(orders).flatMap((group) => group.orders.map((order) => order.id)));
  return (orders || []).filter((order) => (
    order.wms_status === "da_preparare"
    && !massOrderIds.has(order.id)
    && (order.items || []).length > 0
    && !(order.items || []).some((item) => !item.referenza_id || Number(item.quantita || 0) <= 0)
  ));
}

function galluseCartRound(candidates = []) {
  const byClient = new Map();
  for (const order of candidates || []) {
    const current = byClient.get(order.cliente_id) || [];
    current.push(order);
    byClient.set(order.cliente_id, current);
  }
  const [clientId, clientOrders] = [...byClient.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0] || [];
  const firstOrder = clientOrders?.[0];
  if (!clientId || !firstOrder || clientOrders.length < 1) return [];
  return [{
    id: `cart:${firstOrder.cliente_id}`,
    cliente_id: firstOrder.cliente_id,
    cliente: firstOrder.cliente_ragione_sociale || "Cliente",
    numero: 1,
    totale_ordini: clientOrders.length,
    offset: 0,
    orders: clientOrders,
    numero_ordini: clientOrders.length,
    pezzi: clientOrders.reduce((sum, order) => sum + (order.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0),
    referenze: new Set(clientOrders.flatMap((order) => (order.items || []).map((item) => item.referenza_id))).size,
  }];
}

async function listWmsGallusePicking(params = new URLSearchParams()) {
  await assertWmsStaff();
  const operational = await wmsOperationalOrdersData(params);
  const candidates = galluseCandidateOrders(operational.orders);
  const selectedClientId = optionalText(params.get("cliente_id"));
  let batchesQuery = requireSupabase()
    .from("wms_galluse_batches")
    .select("*")
    .neq("stato", "annullata");
  if (selectedClientId) batchesQuery = batchesQuery.eq("cliente_id", selectedClientId);
  const { data: batches, error: batchesError } = await batchesQuery.order("created_at", { ascending: false });
  if (batchesError) fail(batchesError.message);
  const batchIds = (batches || []).map((batch) => batch.id);
  const { data: links, error: linksError } = batchIds.length
    ? await requireSupabase().from("wms_galluse_orders").select("*").in("batch_id", batchIds)
    : { data: [], error: null };
  if (linksError) fail(linksError.message);
  const orderIds = (links || []).map((link) => link.order_id);
  const { data: linkedOrders, error: linkedOrdersError } = orderIds.length
    ? await requireSupabase().from("shopify_orders").select("id,order_name,cliente_id").in("id", orderIds)
    : { data: [], error: null };
  if (linkedOrdersError) fail(linkedOrdersError.message);
  const orderMap = Object.fromEntries((linkedOrders || []).map((order) => [order.id, order]));
  return ok({
    candidates,
    rounds: galluseCartRound(candidates),
    batches: (batches || []).map((batch) => ({
      ...batch,
      orders: (links || []).filter((link) => link.batch_id === batch.id).sort((left, right) => left.posizione_bag - right.posizione_bag).map((link) => ({ ...link, order: orderMap[link.order_id] || null })),
    })),
  });
}

async function wmsGalluseSnapshot(batchId) {
  await assertWmsStaff();
  const { data: batch, error: batchError } = await requireSupabase().from("wms_galluse_batches").select("*").eq("id", batchId).single();
  if (batchError || !batch) fail(batchError?.message || "Missione Metodo Galluse non trovata", 404);
  const [{ data: links, error: linksError }, { data: lines, error: linesError }] = await Promise.all([
    requireSupabase().from("wms_galluse_orders").select("*").eq("batch_id", batchId).order("posizione_bag"),
    requireSupabase().from("wms_galluse_lines").select("*").eq("batch_id", batchId).order("sequenza"),
  ]);
  if (linksError || linesError) fail((linksError || linesError).message);
  const orderIds = (links || []).map((link) => link.order_id);
  const { data: orders, error: ordersError } = orderIds.length
    ? await requireSupabase().from("shopify_orders").select("*").in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) fail(ordersError.message);
  const enriched = await enrichShopifyOrders(orders || []);
  const orderMap = Object.fromEntries(enriched.map((order) => [order.id, order]));
  const linkMap = Object.fromEntries((links || []).map((link) => [link.id, link]));
  const locationIds = [...new Set((lines || []).map((line) => line.location_id))];
  const lineIds = (lines || []).map((line) => line.id);
  const [{ data: locations, error: locationsError }, { data: allocations, error: allocationsError }] = await Promise.all([
    locationIds.length ? requireSupabase().from("wms_locations").select("*").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
    lineIds.length ? requireSupabase().from("wms_galluse_allocations").select("*").in("galluse_line_id", lineIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (locationsError || allocationsError) fail((locationsError || allocationsError).message);
  const locationMap = Object.fromEntries((locations || []).map((location) => [location.id, location]));
  const linkedOrders = (links || []).map((link) => ({ ...link, order: orderMap[link.order_id] || null }));
  const allocationsByLine = groupBy(allocations || [], "galluse_line_id");
  const linesWithPhotos = await withWmsReferencePhotos(lines || [], batch.cliente_id);
  const rows = linesWithPhotos.map((line) => ({
    ...line,
    location: locationMap[line.location_id] || null,
    allocations: (allocationsByLine[line.id] || []).map((allocation) => {
      const link = linkMap[allocation.galluse_order_id];
      return { ...allocation, posizione_bag: link?.posizione_bag, bag_code: link?.bag_code, order: orderMap[link?.order_id] || null };
    }).sort((left, right) => left.posizione_bag - right.posizione_bag),
  }));
  const expected = rows.reduce((sum, line) => sum + Number(line.quantita_attesa || 0), 0);
  const picked = rows.reduce((sum, line) => sum + Number(line.quantita_prelevata || 0), 0);
  return ok({
    batch,
    orders: linkedOrders,
    lines: rows,
    current_line: rows.find((line) => Number(line.quantita_prelevata || 0) < Number(line.quantita_attesa || 0)) || null,
    summary: {
      orders: linkedOrders.length,
      bags_ready: linkedOrders.filter((link) => link.bag_code).length,
      expected,
      picked,
      progress: expected ? Math.round((picked / expected) * 100) : 0,
      stops: new Set(rows.map((line) => line.location_id)).size,
    },
  });
}

async function startWmsGallusePicking(payload = {}) {
  const profile = await assertWmsStaff();
  const requestedClientId = optionalText(payload.cliente_id);
  const cartCode = normalizedWmsCartCode(payload.cart_code || payload.codice);
  const { data: cart, error: cartError } = await requireSupabase()
    .from("wms_carts")
    .select("id,codice,righe,colonne")
    .eq("codice", cartCode)
    .maybeSingle();
  if (cartError) fail(cartError.message);
  if (!cart) fail(`Carrello ${cartCode} non configurato.`, 404);
  const { data: cartPositions, error: cartPositionsError } = await requireSupabase()
    .from("wms_cart_bag_positions")
    .select("posizione,bag_id,bag_code")
    .eq("cart_id", cart.id)
    .order("posizione");
  if (cartPositionsError) fail(cartPositionsError.message);
  const capacity = (cartPositions || []).length;
  if (!capacity) fail(`Il carrello ${cart.codice} non contiene bag configurate.`, 409);
  const positionsAreContiguous = (cartPositions || []).every((position, index) => Number(position.posizione) === index + 1);
  if (!positionsAreContiguous) fail(`Configura le bag del carrello ${cart.codice} in posizioni consecutive a partire da 1.`, 409);
  const operational = await wmsOperationalOrdersData(new URLSearchParams(requestedClientId ? { cliente_id: requestedClientId } : {}));
  const candidates = galluseCandidateOrders(operational.orders);
  const clientId = requestedClientId || candidates[0]?.cliente_id;
  const { data: activeBatches, error: activeBatchesError } = await requireSupabase()
    .from("wms_galluse_batches")
    .select("id")
    .in("stato", ["da_associare_bag", "in_corso"]);
  if (activeBatchesError) fail(activeBatchesError.message);
  if ((activeBatches || []).length) fail("Completa prima il carrello Galluse gia in corso.", 409);
  const orders = candidates.filter((order) => order.cliente_id === clientId).slice(0, capacity);
  if (!clientId || orders.length < 1) fail("Non ci sono ordini disponibili per il carrello Galluse.", 409);
  const combinedItems = orders.flatMap((order) => (order.items || []).map((item) => ({ ...item, galluse_order_id: order.id })));
  const itemOrderMap = Object.fromEntries(combinedItems.map((item) => [item.id, item.galluse_order_id]));
  const plan = await wmsPickingPlan({ cliente_id: clientId }, combinedItems);
  if (plan.errors.length) fail(plan.errors.join(" "));
  if (plan.replenishment.length) fail(`Rifornisci prima gli slot per ${plan.replenishment.length} ${plan.replenishment.length === 1 ? "prodotto" : "prodotti"}.`);
  const uniqueLocations = [...new Set(plan.allocations.map((allocation) => allocation.location_id))].map((id) => plan.locationMap[id]).filter(Boolean);
  const route = calculateWarehouseRoute(visibleWmsRouteLocations(uniqueLocations, plan.mapSettings), plan.mapSettings);
  if (route.unreachable?.length) fail(`Mappa bloccata: ${route.unreachable.map((location) => location.codice).join(", ")} non e raggiungibile.`);
  const { data: batch, error: batchError } = await requireSupabase().from("wms_galluse_batches").insert({
    cliente_id: clientId,
    stato: "da_associare_bag",
    numero_bag: orders.length,
    operatore_id: profile.id,
    cart_id: cart.id,
    cart_code: cart.codice,
  }).select().single();
  if (batchError || !batch) fail(batchError?.message || "Missione Metodo Galluse non creata");
  const { data: links, error: linksError } = await requireSupabase().from("wms_galluse_orders").insert(orders.map((order, index) => ({
    batch_id: batch.id,
    order_id: order.id,
    posizione_bag: index + 1,
  }))).select();
  if (linksError) fail(linksError.message);
  const linkByOrderId = Object.fromEntries((links || []).map((link) => [link.order_id, link]));
  const sequenceMap = Object.fromEntries(route.locations.map((location, index) => [location.id, index + 1]));
  const groupedLines = new Map();
  for (const allocation of plan.allocations) {
    const key = `${allocation.location_id}:${allocation.product_key}`;
    const current = groupedLines.get(key) || { ...allocation, quantita_attesa: 0, sequenza: sequenceMap[allocation.location_id] || 9999 };
    current.quantita_attesa += Number(allocation.quantita_attesa || 0);
    groupedLines.set(key, current);
  }
  const { data: lines, error: linesError } = await requireSupabase().from("wms_galluse_lines").insert([...groupedLines.values()]
    .sort((left, right) => left.sequenza - right.sequenza)
    .map((line, index) => ({
      batch_id: batch.id,
      location_id: line.location_id,
      product_key: line.product_key,
      titolo: line.titolo,
      ean: line.ean,
      fnsku: line.fnsku,
      sku: line.sku,
      quantita_attesa: line.quantita_attesa,
      sequenza: index + 1,
    }))).select();
  if (linesError) fail(linesError.message);
  const lineByKey = Object.fromEntries((lines || []).map((line) => [`${line.location_id}:${line.product_key}`, line]));
  const { error: allocationsError } = await requireSupabase().from("wms_galluse_allocations").insert(plan.allocations.map((allocation) => ({
    galluse_line_id: lineByKey[`${allocation.location_id}:${allocation.product_key}`].id,
    galluse_order_id: linkByOrderId[itemOrderMap[allocation.order_item_id]].id,
    order_item_id: allocation.order_item_id,
    quantita: allocation.quantita_attesa,
  })));
  if (allocationsError) fail(allocationsError.message);
  const { error: claimError } = await requireSupabase().rpc("claim_wms_galluse_cart", {
    p_batch_id: batch.id,
    p_cart_code: cart.codice,
  });
  if (claimError) {
    await requireSupabase().from("wms_galluse_batches").delete().eq("id", batch.id);
    fail(claimError.message);
  }
  const { error: statusError } = await requireSupabase().from("shopify_orders").update({ wms_status: "in_preparazione", updated_at: nowIso() }).in("id", orders.map((order) => order.id));
  if (statusError) fail(statusError.message);
  return wmsGalluseSnapshot(batch.id);
}

async function assignWmsGalluseBag(batchId, payload = {}) {
  await assertWmsStaff();
  const position = Math.floor(Number(payload.posizione_bag || 0));
  const code = String(payload.codice || payload.code || "").trim().toUpperCase();
  if (position < 1 || !/^B-[A-Z0-9]{5}$/.test(code)) fail("Scansiona una bag valida per la posizione indicata.");
  const snapshot = await wmsGalluseSnapshot(batchId);
  if (snapshot.data.batch.stato !== "da_associare_bag") fail("Le bag di questo carrello sono gia state associate.", 409);
  const target = snapshot.data.orders.find((link) => link.posizione_bag === position);
  if (!target) fail("Posizione carrello non valida.", 404);
  if (target.bag_code) fail(`La posizione ${position} ha gia la bag ${target.bag_code}.`, 409);
  const bag = await claimWmsBag(code);
  const { error } = await requireSupabase().from("wms_galluse_orders").update({ bag_id: bag.id, bag_code: bag.codice }).eq("id", target.id);
  if (error) fail(error.message);
  const next = await wmsGalluseSnapshot(batchId);
  if (next.data.summary.bags_ready === next.data.summary.orders) {
    const startedAt = nowIso();
    const { error: batchError } = await requireSupabase().from("wms_galluse_batches").update({ stato: "in_corso", started_at: startedAt, updated_at: startedAt }).eq("id", batchId);
    if (batchError) fail(batchError.message);
    return wmsGalluseSnapshot(batchId);
  }
  return next;
}

async function scanWmsGallusePicking(batchId, payload = {}) {
  const profile = await assertWmsStaff();
  const snapshot = await wmsGalluseSnapshot(batchId);
  const code = normalizedText(payload.codice || payload.code);
  if (snapshot.data.batch.stato === "da_associare_bag") {
    if (!code) fail("Scansiona il codice del carrello disponibile.");
    const { error } = await requireSupabase().rpc("claim_wms_galluse_cart", {
      p_batch_id: batchId,
      p_cart_code: code,
    });
    if (error) fail(error.message);
    return wmsGalluseSnapshot(batchId);
  }
  if (snapshot.data.batch.stato !== "in_corso") fail("Il carrello Galluse non e disponibile per il picking.", 409);
  const current = snapshot.data.current_line;
  if (!current) return snapshot;
  if (!current.location_confirmed_at) {
    if (!code) fail("Scansiona lo slot");
    if (current.location?.tipo !== "slot") fail("Il Metodo Galluse preleva solo dagli slot.", 409);
    if (normalizedText(current.location?.codice) !== code) fail(`Vai in ${current.location?.codice} e scansiona lo slot corretto.`);
    const { error } = await requireSupabase().from("wms_galluse_lines").update({ location_confirmed_at: nowIso() }).eq("id", current.id);
    if (error) fail(error.message);
    return wmsGalluseSnapshot(batchId);
  }
  const remaining = Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0);
  const quantity = Math.floor(Number(payload.quantita || 0));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) fail(`Puoi prelevare da 1 a ${remaining} pezzi.`);
  const nextPicked = Number(current.quantita_prelevata || 0) + quantity;
  const { error: lineError } = await requireSupabase().from("wms_galluse_lines").update({ quantita_prelevata: nextPicked, picked_at: nextPicked === Number(current.quantita_attesa) ? nowIso() : null }).eq("id", current.id);
  if (lineError) fail(lineError.message);
  const { error: movementError } = await requireSupabase().from("wms_outbound_movements").upsert({
    galluse_line_id: current.id,
    galluse_batch_id: batchId,
    cliente_id: snapshot.data.batch.cliente_id,
    location_id: current.location_id,
    product_key: current.product_key,
    quantita: nextPicked,
    operatore_id: profile.id,
    updated_at: nowIso(),
  }, { onConflict: "galluse_line_id" });
  if (movementError) fail(movementError.message);
  const updated = await wmsGalluseSnapshot(batchId);
  if (updated.data.current_line) return updated;
  const completedAt = nowIso();
  const [{ error: batchError }, { error: ordersError }] = await Promise.all([
    requireSupabase().from("wms_galluse_batches").update({ stato: "completata", completed_at: completedAt, updated_at: completedAt }).eq("id", batchId),
    requireSupabase().from("shopify_orders").update({ wms_status: "in_attesa_packing", updated_at: completedAt }).in("id", updated.data.orders.map((link) => link.order_id)),
  ]);
  if (batchError || ordersError) fail((batchError || ordersError).message);
  await Promise.all(updated.data.orders.map((link) => ensurePackingSession(link.order_id, null, { bagId: link.bag_id, bagCode: link.bag_code, packingSequence: link.posizione_bag })));
  return wmsGalluseSnapshot(batchId);
}

async function cancelWmsGallusePicking(batchId) {
  await assertWmsStaff();
  const snapshot = await wmsGalluseSnapshot(batchId);
  if (!["da_associare_bag", "in_corso"].includes(snapshot.data.batch.stato)) {
    fail("Puoi annullare solo un carrello Galluse ancora in corso.", 409);
  }

  const lineIds = (snapshot.data.lines || []).map((line) => line.id);
  if (lineIds.length) {
    const { error: movementsError } = await requireSupabase()
      .from("wms_outbound_movements")
      .delete()
      .in("galluse_line_id", lineIds);
    if (movementsError) fail(movementsError.message);
  }

  const bagIds = [...new Set((snapshot.data.orders || []).map((link) => link.bag_id).filter(Boolean))];
  const orderIds = (snapshot.data.orders || []).map((link) => link.order_id);
  const [{ error: bagsError }, { error: ordersError }, { error: batchError }] = await Promise.all([
    bagIds.length
      ? requireSupabase().from("wms_bags").update({ stato: "disponibile", updated_at: nowIso() }).in("id", bagIds)
      : Promise.resolve({ error: null }),
    orderIds.length
      ? requireSupabase().from("shopify_orders").update({ wms_status: "da_preparare", updated_at: nowIso() }).in("id", orderIds)
      : Promise.resolve({ error: null }),
    requireSupabase().from("wms_galluse_batches").delete().eq("id", batchId),
  ]);
  if (bagsError || ordersError || batchError) fail((bagsError || ordersError || batchError).message);
  return ok({ cancelled: true, orders: orderIds.length });
}

async function resetGalluseAiDemo() {
  await assertWmsStaff();
  let { data: demoClient, error: clientError } = await requireSupabase()
    .from("clienti")
    .select("id,ragione_sociale")
    .eq("ragione_sociale", "WMS Demo Picking")
    .maybeSingle();
  if (clientError) fail(clientError.message);
  if (!demoClient) {
    const { data: createdClient, error: createClientError } = await requireSupabase()
      .from("clienti")
      .insert({
        ragione_sociale: "WMS Demo Picking",
        email: "wms-demo-picking@aimago.local",
        note: "Cliente tecnico isolato per test WMS picking e packing",
      })
      .select("id,ragione_sociale")
      .single();
    if (createClientError || !createdClient) fail(createClientError?.message || "Cliente demo WMS non creato");
    demoClient = createdClient;
  }

  const cartBagCodes = Array.from({ length: 10 }, (_, index) => `B-${String(73846 + index).padStart(5, "0")}`);
  const { data: demoOrders, error: demoOrdersError } = await requireSupabase()
    .from("shopify_orders")
    .select("id")
    .eq("cliente_id", demoClient.id);
  if (demoOrdersError) fail(demoOrdersError.message);
  const demoOrderIds = (demoOrders || []).map((order) => order.id);

  const [
    { data: galluseBatches, error: galluseBatchesError },
    { data: massBatchesByClient, error: massBatchesByClientError },
    { data: massBatchesByBag, error: massBatchesByBagError },
  ] = await Promise.all([
    requireSupabase().from("wms_galluse_batches").select("id").eq("cliente_id", demoClient.id),
    requireSupabase().from("wms_mass_pick_batches").select("id,bag_id").eq("cliente_id", demoClient.id),
    requireSupabase().from("wms_mass_pick_batches").select("id,bag_id").in("bag_code", cartBagCodes),
  ]);
  if (galluseBatchesError || massBatchesByClientError || massBatchesByBagError) {
    fail((galluseBatchesError || massBatchesByClientError || massBatchesByBagError).message);
  }
  const massBatches = [...new Map([...(massBatchesByClient || []), ...(massBatchesByBag || [])].map((batch) => [batch.id, batch])).values()];
  const galluseBatchIds = (galluseBatches || []).map((batch) => batch.id);
  const { data: galluseLinks, error: galluseLinksError } = galluseBatchIds.length
    ? await requireSupabase().from("wms_galluse_orders").select("bag_id").in("batch_id", galluseBatchIds).not("bag_id", "is", null)
    : { data: [], error: null };
  if (galluseLinksError) fail(galluseLinksError.message);
  const bagIds = [...new Set([
    ...(galluseLinks || []).map((link) => link.bag_id),
    ...(massBatches || []).map((batch) => batch.bag_id),
  ].filter(Boolean))];

  const cleanupSteps = [];
  if (bagIds.length) cleanupSteps.push(requireSupabase().from("wms_bags").update({ stato: "disponibile", updated_at: nowIso() }).in("id", bagIds));
  cleanupSteps.push(requireSupabase().from("wms_packing_sessions").delete().in("bag_code", cartBagCodes));
  cleanupSteps.push(requireSupabase().from("wms_outbound_movements").delete().eq("cliente_id", demoClient.id));
  cleanupSteps.push(requireSupabase().from("wms_mass_pick_batches").delete().in("bag_code", cartBagCodes));
  cleanupSteps.push(requireSupabase().from("wms_mass_pick_batches").delete().eq("cliente_id", demoClient.id));
  cleanupSteps.push(requireSupabase().from("wms_galluse_batches").delete().eq("cliente_id", demoClient.id));
  if (demoOrderIds.length) cleanupSteps.push(requireSupabase().from("shopify_orders").delete().in("id", demoOrderIds));
  for (const step of cleanupSteps) {
    const { error } = await step;
    if (error) fail(error.message);
  }

  const { data: existingBags, error: existingBagsError } = await requireSupabase()
    .from("wms_bags")
    .select("id,codice")
    .in("codice", cartBagCodes);
  if (existingBagsError) fail(existingBagsError.message);
  const missingBagCodes = cartBagCodes.filter((code) => !(existingBags || []).some((bag) => bag.codice === code));
  if (missingBagCodes.length) {
    const { error } = await requireSupabase().from("wms_bags").insert(missingBagCodes.map((codice) => ({ codice })));
    if (error) fail(error.message);
  }
  const { data: cartBags, error: cartBagsError } = await requireSupabase()
    .from("wms_bags")
    .update({ stato: "disponibile", updated_at: nowIso() })
    .in("codice", cartBagCodes)
    .select("id,codice");
  if (cartBagsError) fail(cartBagsError.message);
  const bagByCode = Object.fromEntries((cartBags || []).map((bag) => [bag.codice, bag]));
  const { error: cartError } = await requireSupabase()
    .from("wms_galluse_cart_positions")
    .upsert(cartBagCodes.map((bagCode, index) => ({
      posizione: index + 1,
      bag_id: bagByCode[bagCode]?.id,
      bag_code: bagCode,
      updated_at: nowIso(),
    })), { onConflict: "posizione" });
  if (cartError) fail(cartError.message);

  const referenceCatalog = HOME_STOCK_REFERENCE_NAMES.slice(0, 7).map((titolo, index) => ({
    cliente_id: demoClient.id,
    titolo,
    ean: `HOME-EAN-${String(index + 1).padStart(3, "0")}`,
    sku: `HOME-SKU-${String(index + 1).padStart(3, "0")}`,
    fnsku: `HOME-FNSKU-${String(index + 1).padStart(3, "0")}`,
    origine: "wms-home-stock",
  }));
  const referenceCodes = referenceCatalog.map((reference) => reference.fnsku);
  let { data: references, error: referencesError } = await requireSupabase()
    .from("referenze")
    .select("id,titolo,ean,fnsku,sku")
    .eq("cliente_id", demoClient.id)
    .in("fnsku", referenceCodes);
  if (referencesError) fail(referencesError.message);
  const existingByFnsku = new Map((references || []).map((reference) => [reference.fnsku, reference]));
  const referenceUpdates = referenceCatalog
    .filter((reference) => existingByFnsku.has(reference.fnsku))
    .map((reference) => requireSupabase()
      .from("referenze")
      .update({
        titolo: reference.titolo,
        ean: reference.ean,
        sku: reference.sku,
        origine: reference.origine,
      })
      .eq("id", existingByFnsku.get(reference.fnsku).id));
  const referenceInserts = referenceCatalog.filter((reference) => !existingByFnsku.has(reference.fnsku));
  const referenceResults = await Promise.all([
    ...referenceUpdates,
    referenceInserts.length
      ? requireSupabase().from("referenze").insert(referenceInserts)
      : Promise.resolve({ error: null }),
  ]);
  const referenceError = referenceResults.find((result) => result.error)?.error;
  if (referenceError) fail(referenceError.message);
  ({ data: references, error: referencesError } = await requireSupabase()
    .from("referenze")
    .select("id,titolo,ean,fnsku,sku")
    .eq("cliente_id", demoClient.id)
    .in("fnsku", referenceCodes));
  if (referencesError) fail(referencesError.message);
  const referencesByNumber = Object.fromEntries((references || []).map((reference) => [
    Number(String(reference.fnsku || "").match(/(\d+)$/)?.[1] || 0),
    reference,
  ]));
  if (Object.keys(referencesByNumber).length < 7) fail("Non sono disponibili tutte le 7 referenze demo.", 409);

  const orderPlan = [
    [{ ref: 1, qty: 2 }, { ref: 2, qty: 1 }],
    [{ ref: 3, qty: 1 }, { ref: 4, qty: 1 }],
    [{ ref: 5, qty: 1 }, { ref: 6, qty: 1 }],
    [{ ref: 7, qty: 2 }],
    [{ ref: 1, qty: 1 }, { ref: 3, qty: 1 }],
    [{ ref: 2, qty: 2 }],
    [{ ref: 4, qty: 1 }],
    [{ ref: 5, qty: 2 }],
    [{ ref: 6, qty: 1 }, { ref: 7, qty: 1 }],
    [{ ref: 1, qty: 1 }],
  ];
  const createdOrderIds = [];
  const now = Date.now();
  for (const [index, rows] of orderPlan.entries()) {
    const orderNumber = index + 1;
    const { data: order, error: orderInsertError } = await requireSupabase().from("shopify_orders").insert({
      cliente_id: demoClient.id,
      shop_domain: "wms-galluse-demo.aimago.local",
      shopify_order_id: `WMS-GALLUSE-7REF-${String(orderNumber).padStart(3, "0")}`,
      order_name: `#GALLUSE-7R-${String(orderNumber).padStart(3, "0")}`,
      financial_status: "paid",
      fulfillment_status: null,
      wms_status: "da_preparare",
      processed_at: new Date(now - index * 1000).toISOString(),
      raw: { source: "wms_galluse_demo", scenario: "galluse-7ref-19", cart_position: orderNumber, reference_total: 7, units_total: 19 },
    }).select().single();
    if (orderInsertError || !order) fail(orderInsertError?.message || "Ordine demo packing non creato");
    createdOrderIds.push(order.id);

    const { error: itemsError } = await requireSupabase().from("shopify_order_items").insert(rows.map((row) => {
      const reference = referencesByNumber[row.ref];
      return {
        order_id: order.id,
        shopify_line_item_id: `WMS-GALLUSE-7REF-${String(orderNumber).padStart(3, "0")}-R${String(row.ref).padStart(3, "0")}`,
        referenza_id: reference.id,
        sku: reference.sku,
        ean: reference.ean,
        titolo: reference.titolo,
        quantita: row.qty,
        fulfillable_quantity: row.qty,
        fulfillment_status: null,
        raw: { source: "wms_galluse_demo", scenario: "galluse-7ref-19", reference_number: row.ref },
      };
    }));
    if (itemsError) fail(itemsError.message);
  }

  return ok({
    created: createdOrderIds.length,
    cliente: demoClient.ragione_sociale,
    cart: "CARRELLO-01",
    bags: cartBagCodes,
    referenze: 7,
    pezzi: orderPlan.flat().reduce((sum, row) => sum + row.qty, 0),
    scenario: "galluse-7ref-19",
  });
}

async function resetWmsHomeStockCatalog() {
  const profile = await assertWmsStaff();
  let { data: demoClient, error: clientError } = await requireSupabase()
    .from("clienti")
    .select("id,ragione_sociale")
    .eq("ragione_sociale", "WMS Demo Picking")
    .maybeSingle();
  if (clientError) fail(clientError.message);
  if (!demoClient) {
    const { data: createdClient, error: createClientError } = await requireSupabase()
      .from("clienti")
      .insert({
        ragione_sociale: "WMS Demo Picking",
        email: "wms-demo-picking@aimago.local",
        note: "Cliente tecnico per test WMS picking, packing e stock",
      })
      .select("id,ragione_sociale")
      .single();
    if (createClientError || !createdClient) fail(createClientError?.message || "Cliente demo WMS non creato");
    demoClient = createdClient;
  }

  const [{ data: slots, error: slotsError }, { data: pallets, error: palletsError }] = await Promise.all([
    requireSupabase().from("wms_locations").select("id,codice,tipo,stato").eq("tipo", "slot").eq("stato", "attiva"),
    requireSupabase().from("wms_locations").select("id,codice,tipo,stato").eq("tipo", "pallet").eq("stato", "attiva"),
  ]);
  if (slotsError || palletsError) fail((slotsError || palletsError).message);
  const eligibleSlots = (slots || []).filter((location) => isLocationCodeInAisleRange(location, "S1"));
  const eligiblePallets = (pallets || []).filter((location) => isLocationCodeInAisleRange(location, "P1"));
  if (eligibleSlots.length < 50) fail("Servono almeno 50 slot attivi tra S1+A1 e S1+A100.", 409);
  if (eligiblePallets.length < 50) fail("Servono almeno 50 pallet attivi tra P1+A1 e P1+A100.", 409);

  const stockCleanupTables = [
    "wms_outbound_movements",
    "wms_stock_transfers",
    "wms_inventory_counts",
    "wms_inventory_sessions",
    "wms_inbound_movements",
    "wms_inbound_sessions",
  ];
  for (const tableName of stockCleanupTables) {
    await deleteAllFromTable(tableName);
  }

  const { error: rowsResetError } = await requireSupabase()
    .from("entrate_righe")
    .update({ quantita_ricevuta: 0 })
    .neq("id", EMPTY_UUID);
  if (rowsResetError) fail(rowsResetError.message);

  const { error: oldHomeEntriesError } = await requireSupabase()
    .from("entrate")
    .delete()
    .eq("cliente_id", demoClient.id)
    .eq("ddt", "WMS-HOME-STOCK-6500");
  if (oldHomeEntriesError) fail(oldHomeEntriesError.message);

  const referenceCatalog = HOME_STOCK_REFERENCE_NAMES.map((titolo, index) => ({
    cliente_id: demoClient.id,
    titolo,
    ean: `HOME-EAN-${String(index + 1).padStart(3, "0")}`,
    sku: `HOME-SKU-${String(index + 1).padStart(3, "0")}`,
    fnsku: `HOME-FNSKU-${String(index + 1).padStart(3, "0")}`,
    origine: "wms-home-stock",
    is_bundle: false,
    componenti: [],
  }));
  const referenceEans = referenceCatalog.map((reference) => reference.ean);
  const referenceFnskus = referenceCatalog.map((reference) => reference.fnsku);
  const [
    { data: existingByEan, error: existingByEanError },
    { data: existingByFnsku, error: existingByFnskuError },
  ] = await Promise.all([
    requireSupabase()
      .from("referenze")
      .select("id,ean,fnsku")
      .eq("cliente_id", demoClient.id)
      .in("ean", referenceEans),
    requireSupabase()
      .from("referenze")
      .select("id,ean,fnsku")
      .eq("cliente_id", demoClient.id)
      .in("fnsku", referenceFnskus),
  ]);
  if (existingByEanError || existingByFnskuError) fail((existingByEanError || existingByFnskuError).message);
  const existingReferences = [...new Map([...(existingByEan || []), ...(existingByFnsku || [])].map((reference) => [reference.id, reference])).values()];
  const existingByCode = new Map();
  existingReferences.forEach((reference) => {
    if (reference.ean) existingByCode.set(`ean:${reference.ean}`, reference);
    if (reference.fnsku) existingByCode.set(`fnsku:${reference.fnsku}`, reference);
  });
  const referenceUpdates = [];
  const referenceInserts = [];
  referenceCatalog.forEach((reference) => {
    const existing = existingByCode.get(`fnsku:${reference.fnsku}`) || existingByCode.get(`ean:${reference.ean}`);
    if (existing) {
      referenceUpdates.push(requireSupabase()
        .from("referenze")
        .update({
          titolo: reference.titolo,
          ean: reference.ean,
          sku: reference.sku,
          fnsku: reference.fnsku,
          origine: reference.origine,
          is_bundle: false,
          componenti: [],
        })
        .eq("id", existing.id));
    } else {
      referenceInserts.push(reference);
    }
  });
  const referenceResults = await Promise.all([
    ...referenceUpdates,
    referenceInserts.length
      ? requireSupabase().from("referenze").insert(referenceInserts)
      : Promise.resolve({ error: null }),
  ]);
  const referenceError = referenceResults.find((result) => result.error)?.error;
  if (referenceError) fail(referenceError.message);

  const { data: references, error: referencesError } = await requireSupabase()
    .from("referenze")
    .select("id,titolo,ean,fnsku,sku")
    .eq("cliente_id", demoClient.id)
    .in("fnsku", referenceFnskus);
  if (referencesError) fail(referencesError.message);
  const referencesByFnsku = new Map((references || []).map((reference) => [reference.fnsku, reference]));
  if ((references || []).length < 50) fail("Non sono disponibili tutte le 50 referenze casa.", 409);

  const receivedAt = nowIso();
  const { data: entry, error: entryError } = await requireSupabase()
    .from("entrate")
    .insert({
      cliente_id: demoClient.id,
      tipo: "pallet",
      colli: 50,
      ddt: "WMS-HOME-STOCK-6500",
      corriere: "Seed WMS",
      tracking: "WMS-HOME-STOCK-6500",
      stato: "ricevuto",
      data_annuncio: receivedAt,
      data_ricezione: receivedAt,
      note: "Stock iniziale casa: 50 referenze in S1+A1..100 e overstock in P1+A1..100",
    })
    .select()
    .single();
  if (entryError || !entry) fail(entryError?.message || "Entrata stock casa non creata");

  const { data: session, error: sessionError } = await requireSupabase()
    .from("wms_inbound_sessions")
    .insert({
      entrata_id: entry.id,
      stato: "completata",
      operatore_id: profile.id,
      started_at: receivedAt,
      completed_at: receivedAt,
      note: "Seed stock casa: 30 pezzi slot + 100 pezzi overstock pallet",
    })
    .select()
    .single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione stock casa non creata");

  const entryRowsPayload = referenceCatalog.map((catalogItem) => {
    const reference = referencesByFnsku.get(catalogItem.fnsku);
    return {
      entrata_id: entry.id,
      ean: reference.ean,
      fnsku: reference.fnsku,
      quantita: 130,
      quantita_ricevuta: 130,
    };
  });
  const { data: entryRows, error: entryRowsError } = await requireSupabase()
    .from("entrate_righe")
    .insert(entryRowsPayload)
    .select("id,fnsku");
  if (entryRowsError) fail(entryRowsError.message);
  const entryRowsByFnsku = new Map((entryRows || []).map((row) => [row.fnsku, row]));

  const targetSlots = shuffledLocations(eligibleSlots, "home-slot-20260828", 50);
  const targetPallets = shuffledLocations(eligiblePallets, "home-pallet-20260828", 50);
  const movements = referenceCatalog.flatMap((catalogItem, index) => {
    const row = entryRowsByFnsku.get(catalogItem.fnsku);
    if (!row) fail(`Riga entrata mancante per ${catalogItem.fnsku}`, 409);
    return [
      {
        session_id: session.id,
        entrata_riga_id: row.id,
        location_id: targetSlots[index].id,
        disposizione: "disponibile",
        quantita: 30,
        codice_scansionato: targetSlots[index].codice,
        created_by: profile.id,
      },
      {
        session_id: session.id,
        entrata_riga_id: row.id,
        location_id: targetPallets[index].id,
        disposizione: "disponibile",
        quantita: 100,
        codice_scansionato: targetPallets[index].codice,
        created_by: profile.id,
      },
    ];
  });
  const { error: movementsInsertError } = await requireSupabase()
    .from("wms_inbound_movements")
    .insert(movements);
  if (movementsInsertError) fail(movementsInsertError.message);

  return ok({
    ok: true,
    cliente: demoClient.ragione_sociale,
    referenze: referenceCatalog.length,
    slot: targetSlots.length,
    pallet: targetPallets.length,
    pezzi_slot: targetSlots.length * 30,
    pezzi_overstock: targetPallets.length * 100,
    pezzi_totali: targetSlots.length * 30 + targetPallets.length * 100,
    slot_codici: targetSlots.map((slot) => slot.codice),
    pallet_codici: targetPallets.map((pallet) => pallet.codice),
  });
}

async function startWmsPicking(orderId) {
  const profile = await assertWmsStaff();
  const { data: galluseLink, error: galluseLinkError } = await requireSupabase()
    .from("wms_galluse_orders")
    .select("batch_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (galluseLinkError) fail(galluseLinkError.message);
  if (galluseLink) fail("Questo ordine e gia assegnato a un carrello Metodo Galluse.", 409);
  const existing = await requireSupabase().from("wms_pick_tasks").select("id").eq("order_id", orderId).maybeSingle();
  if (existing.error) fail(existing.error.message);
  if (existing.data) return wmsPickSnapshot(orderId);

  const { data: order, error: orderError } = await requireSupabase().from("shopify_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);
  if (order.wms_status !== "da_preparare") fail("Questo ordine non e disponibile per un nuovo picking", 409);
  const { data: items, error: itemsError } = await requireSupabase().from("shopify_order_items").select("*").eq("order_id", orderId);
  if (itemsError) fail(itemsError.message);
  if (!(items || []).length) fail("L'ordine non contiene prodotti");
  const plan = await wmsPickingPlan(order, items || []);
  if (plan.errors.length) fail(plan.errors.join(" "));
  if (plan.replenishment.length) fail(`Rifornisci prima gli slot per ${plan.replenishment.length} ${plan.replenishment.length === 1 ? "prodotto" : "prodotti"}.`);
  const { allocations, locationMap, mapSettings } = plan;

  const uniqueLocations = [...new Set(allocations.map((allocation) => allocation.location_id))].map((id) => locationMap[id]).filter(Boolean);
  const route = calculateWarehouseRoute(visibleWmsRouteLocations(uniqueLocations, mapSettings), mapSettings);
  if (route.unreachable?.length) fail(`Mappa bloccata: ${route.unreachable.map((location) => location.codice).join(", ")} non e raggiungibile. Lascia almeno una casella libera di passaggio.`);
  const sequenceMap = Object.fromEntries(route.locations.map((location, index) => [location.id, index + 1]));
  allocations.sort((left, right) => sequenceMap[left.location_id] - sequenceMap[right.location_id]);

  const { data: task, error: taskError } = await requireSupabase().from("wms_pick_tasks").insert({
    order_id: orderId,
    stato: "in_corso",
    operatore_id: profile.id,
    started_at: nowIso(),
  }).select().single();
  if (taskError || !task) fail(taskError?.message || "Missione picking non creata");
  const { error: linesError } = await requireSupabase().from("wms_pick_lines").insert(allocations.map((allocation, index) => ({
    ...allocation,
    task_id: task.id,
    sequenza: index + 1,
  })));
  if (linesError) {
    await requireSupabase().from("wms_pick_tasks").delete().eq("id", task.id);
    fail(linesError.message);
  }
  const { error: statusError } = await requireSupabase().from("shopify_orders").update({ wms_status: "in_preparazione", updated_at: nowIso() }).eq("id", orderId);
  if (statusError) fail(statusError.message);
  return wmsPickSnapshot(orderId);
}

async function scanWmsPicking(taskId, payload = {}) {
  await assertWmsStaff();
  const { data: task, error: taskError } = await requireSupabase().from("wms_pick_tasks").select("*").eq("id", taskId).single();
  if (taskError || !task) fail(taskError?.message || "Missione non trovata", 404);
  const snapshot = await wmsPickSnapshot(task.order_id);
  const code = normalizedText(payload.codice || payload.code);
  if (task.stato === "da_confermare_bag") {
    const bag = await claimWmsBag(code);
    const completedAt = nowIso();
    const [{ error: taskUpdateError }, { error: orderUpdateError }] = await Promise.all([
      requireSupabase().from("wms_pick_tasks").update({ stato: "completata", bag_id: bag.id, bag_code: bag.codice, bag_confirmed_at: completedAt, completed_at: completedAt, updated_at: completedAt }).eq("id", task.id),
      requireSupabase().from("shopify_orders").update({ wms_status: "in_attesa_packing", updated_at: completedAt }).eq("id", task.order_id),
    ]);
    if (taskUpdateError || orderUpdateError) fail((taskUpdateError || orderUpdateError).message);
    await ensurePackingSession(task.order_id, task.id, { bagId: bag.id, bagCode: bag.codice });
    return wmsPickSnapshot(task.order_id);
  }
  if (task.stato !== "in_corso") fail("Questa missione non e in corso", 409);
  const current = snapshot.data.current_line;
  if (!current) return snapshot;
  if (!current.location_confirmed_at) {
    if (!code) fail("Scansiona una posizione");
    if (current.location?.tipo !== "slot") fail("Il picking e consentito solo da una posizione slot.", 409);
    if (normalizedText(current.location?.codice) !== code) fail(`Vai in ${current.location?.codice} e scansiona la posizione corretta.`);
    const { error } = await requireSupabase().from("wms_pick_lines").update({ location_confirmed_at: nowIso() }).eq("id", current.id);
    if (error) fail(error.message);
    return wmsPickSnapshot(task.order_id);
  }
  const remaining = Number(current.quantita_attesa || 0) - Number(current.quantita_prelevata || 0);
  const quantity = Math.floor(Number(payload.quantita || remaining));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) fail(`Puoi prelevare da 1 a ${remaining} pezzi.`);
  const nextPicked = Number(current.quantita_prelevata || 0) + quantity;
  const { error } = await requireSupabase().from("wms_pick_lines").update({
    quantita_prelevata: nextPicked,
    picked_at: nextPicked === Number(current.quantita_attesa) ? nowIso() : null,
  }).eq("id", current.id);
  if (error) fail(error.message);
  const { error: movementError } = await requireSupabase().from("wms_outbound_movements").upsert({
    pick_line_id: current.id,
    order_id: task.order_id,
    cliente_id: snapshot.data.order.cliente_id,
    location_id: current.location_id,
    product_key: current.product_key,
    quantita: nextPicked,
    operatore_id: (await currentProfile()).id,
    updated_at: nowIso(),
  }, { onConflict: "pick_line_id" });
  if (movementError) fail(movementError.message);

  const updated = await wmsPickSnapshot(task.order_id);
  if (!updated.data.current_line) {
    const { error: completeError } = await requireSupabase().from("wms_pick_tasks").update({ stato: "da_confermare_bag", updated_at: nowIso() }).eq("id", task.id);
    if (completeError) fail(completeError.message);
    return wmsPickSnapshot(task.order_id);
  }
  return updated;
}

async function ensurePackingSession(orderId, pickTaskId, options = {}) {
  const existing = await requireSupabase().from("wms_packing_sessions").select("id").eq("order_id", orderId).maybeSingle();
  if (existing.error) fail(existing.error.message);
  if (existing.data) return existing.data;
  const { data: session, error: sessionError } = await requireSupabase().from("wms_packing_sessions").insert({
    order_id: orderId,
    pick_task_id: pickTaskId,
    mass_batch_id: options.massBatchId || null,
    bag_id: options.bagId || null,
    bag_code: options.bagCode || null,
    packing_sequence: options.packingSequence || null,
    stato: "in_attesa_packing",
  }).select().single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione packing non creata");
  const { data: items, error: itemsError } = await requireSupabase().from("shopify_order_items").select("*").eq("order_id", orderId);
  if (itemsError) fail(itemsError.message);
  const referenceIds = [...new Set((items || []).map((item) => item.referenza_id).filter(Boolean))];
  const { data: references, error: referencesError } = referenceIds.length
    ? await requireSupabase().from("referenze").select("id,titolo,ean,fnsku,sku,foto_url").in("id", referenceIds)
    : { data: [], error: null };
  if (referencesError) fail(referencesError.message);
  const referenceMap = Object.fromEntries((references || []).map((row) => [row.id, row]));
  const { error: linesError } = await requireSupabase().from("wms_packing_lines").insert((items || []).map((item) => {
    const reference = referenceMap[item.referenza_id] || {};
    return {
      session_id: session.id,
      order_item_id: item.id,
      referenza_id: item.referenza_id,
      titolo: reference.titolo || item.titolo,
      ean: reference.ean || item.ean,
      fnsku: reference.fnsku,
      sku: reference.sku || item.sku,
      foto_url: reference.foto_url || null,
      quantita_attesa: Number(item.quantita || 0),
    };
  }));
  if (linesError) fail(linesError.message);
  return session;
}

function packingLabelCode(sessionId) {
  return `PK-${String(sessionId || "").replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

async function packingCartSnapshot(rawCartCode) {
  const cartCode = normalizedWmsCartCode(rawCartCode);
  const sb = requireSupabase();
  const { data: cart, error: cartError } = await sb
    .from("wms_carts")
    .select("id,codice,righe,colonne")
    .eq("codice", cartCode)
    .maybeSingle();
  if (cartError) fail(cartError.message);
  if (!cart) fail("Carrello non configurato", 404);
  const { data: positions, error: positionsError } = await sb
    .from("wms_cart_bag_positions")
    .select("posizione,bag_code")
    .eq("cart_id", cart.id)
    .order("posizione");
  if (positionsError) fail(positionsError.message);
  const bagCodes = (positions || []).map((position) => position.bag_code).filter(Boolean);
  const { data: sessions, error: sessionsError } = bagCodes.length
    ? await requireSupabase()
      .from("wms_packing_sessions")
      .select("bag_code,stato")
      .in("bag_code", bagCodes)
      .neq("stato", "annullata")
    : { data: [], error: null };
  if (sessionsError) fail(sessionsError.message);
  const sessionsByBag = groupBy(sessions || [], "bag_code");
  const righe = Math.max(1, Number(cart.righe || 1));
  const colonne = Math.max(1, Number(cart.colonne || 1));
  return ok({
    phase: "cart_ready",
    cart_code: cart.codice,
    cart_layout: {
      righe,
      colonne,
      capacita: righe * colonne,
    },
    bag_code: null,
    batch: null,
    sessions: [],
    labels: [],
    summary: { orders: (sessions || []).length },
    cart_bags: (positions || []).map((position) => {
      const bagSessions = sessionsByBag[position.bag_code] || [];
      return {
        ...position,
        orders: bagSessions.length,
        completed: bagSessions.length > 0 && bagSessions.every((session) => session.stato === "completata"),
        ready: bagSessions.some((session) => session.stato !== "completata"),
      };
    }),
  });
}

async function packingStationSnapshot(bagCode) {
  const snapshot = await wmsBagPackingSnapshot(bagCode);
  const sessions = snapshot.data.sessions || [];
  if (!sessions.length) fail("La bag non contiene ordini in attesa di packing", 404);
  const { data: packagingOptions, error: packagingError } = await requireSupabase()
    .from("wms_packaging_types")
    .select("code,name,barcode,stock_quantity,active")
    .eq("active", true)
    .order("name");
  if (packagingError) fail(packagingError.message);
  const labels = sessions
    .filter((session) => session.carrier_label_code)
    .map((session) => ({
      session_id: session.id,
      order_name: session.order?.order_name || session.order_id,
      code: session.carrier_label_code,
      carrier: session.order?.selected_carrier || "gls",
      recipient_name: session.order?.ship_name,
      recipient_company: session.order?.ship_company,
      address1: session.order?.ship_address1,
      address2: session.order?.ship_address2,
      zip: session.order?.ship_zip,
      city: session.order?.ship_city,
      province: session.order?.ship_province,
      country: session.order?.ship_country,
      weight: session.order?.shipping_billable_weight,
      scanned: Boolean(session.carrier_label_scanned_at),
    }));
  const hasPendingBagCheck = sessions.some((session) => session.stato === "in_verifica_bag");
  const hasPendingPackaging = sessions.some((session) => session.stato === "in_attesa_imballaggio");
  const pendingLabels = labels.filter((label) => !label.scanned);
  return ok({
    bag_code: bagCode,
    batch: snapshot.data.batch || null,
    sessions,
    summary: snapshot.data.summary,
    labels,
    packaging_options: packagingOptions || [],
    phase: sessions.every((session) => session.stato === "completata")
      ? "completed"
      : hasPendingBagCheck
        ? "double_check"
        : hasPendingPackaging
          ? "scan_packaging"
          : pendingLabels.length
            ? "scan_labels"
            : "scan_bag",
  });
}

async function completePackingLabel(session) {
  const completedAt = nowIso();
  const { error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .update({ wms_status: "imballato", updated_at: completedAt })
    .eq("id", session.order_id);
  if (orderError) fail(orderError.message);

  const { error: sessionError } = await requireSupabase().from("wms_packing_sessions").update({
    stato: "completata",
    carrier_label_scanned_at: completedAt,
    completed_at: completedAt,
    updated_at: completedAt,
  }).eq("id", session.id);
  if (sessionError) fail(sessionError.message);

  if (!session.mass_batch_id) {
    await releaseWmsBag(session.bag_id);
    return;
  }

  const { error: linkError } = await requireSupabase()
    .from("wms_mass_pick_orders")
    .update({ stato: "completato" })
    .eq("batch_id", session.mass_batch_id)
    .eq("order_id", session.order_id);
  if (linkError) fail(linkError.message);

  const { data: pending, error: pendingError } = await requireSupabase()
    .from("wms_packing_sessions")
    .select("id")
    .eq("mass_batch_id", session.mass_batch_id)
    .neq("stato", "completata")
    .limit(1);
  if (pendingError) fail(pendingError.message);

  const allPacked = !(pending || []).length;
  const { error: batchError } = await requireSupabase()
    .from("wms_mass_pick_batches")
    .update({ stato: allPacked ? "completata_packing" : "in_packing", updated_at: completedAt })
    .eq("id", session.mass_batch_id);
  if (batchError) fail(batchError.message);
  if (allPacked) await releaseWmsBag(session.bag_id);
}

async function packingStationSnapshotForLabel(labelCode) {
  const normalizedLabel = normalizedScanCode(labelCode);
  const { data: sessions, error } = await requireSupabase()
    .from("wms_packing_sessions")
    .select("bag_code")
    .ilike("carrier_label_code", normalizedLabel)
    .neq("stato", "annullata")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) fail(error.message);
  const bagCode = sessions?.[0]?.bag_code;
  if (!bagCode) fail("Etichetta corriere non trovata o gia acquisita", 404);
  return packingStationSnapshot(bagCode);
}

async function completePackingStationLabel(snapshot, code) {
  const normalizedCode = normalizedScanCode(code);
  const matchingSession = snapshot.data.sessions.find((session) => (
    ["in_attesa_etichetta", "completata"].includes(session.stato)
    && normalizedScanCode(session.carrier_label_code) === normalizedCode
  ));
  if (!matchingSession) fail("Etichetta non prevista per questa bag oppure gia acquisita");
  await completePackingLabel(matchingSession);
  const sessions = snapshot.data.sessions.map((session) => session.id === matchingSession.id
    ? { ...session, stato: "completata", carrier_label_scanned_at: nowIso() }
    : session);
  if (sessions.every((session) => session.stato === "completata")) {
    return ok({
      ...snapshot.data,
      sessions,
      labels: snapshot.data.labels.map((label) => label.session_id === matchingSession.id ? { ...label, scanned: true } : label),
      summary: { ...snapshot.data.summary, completed: sessions.length },
      phase: "completed",
    });
  }
  return packingStationSnapshot(snapshot.data.bag_code);
}

async function scanWmsPackingStation(payload = {}) {
  await assertWmsStaff();
  const code = normalizedScanCode(payload.codice || payload.code);
  const activeBagCode = normalizedScanCode(payload.bag_code);
  if (!code) fail("Scansiona una bag o un'etichetta");

  if (!activeBagCode) {
    if (/^CARRELLO-[0-9]{2}$/.test(code)) return packingCartSnapshot(code);
    if (code.startsWith("PK-")) fail("Scansiona prima la bag da imballare");
    if (/^(SCATOLA-(PICCOLA|MEDIA|GRANDE)|BUSTA-CORRIERE)$/.test(code)) fail("Scansiona prima la bag da imballare");
    if (!/^B-[A-Z0-9]{5}$/.test(code)) fail("Scansiona prima il barcode della bag");
    const snapshot = await packingStationSnapshot(code);
    if (snapshot.data.phase === "completed") {
      if (/^CARRELLO-[0-9]{2}$/.test(normalizedScanCode(payload.cart_code))) return packingCartSnapshot(payload.cart_code);
      return snapshot;
    }
    const eligible = snapshot.data.sessions.filter((session) => ["in_attesa_packing", "da_imballare", "in_verifica_bag"].includes(session.stato));
    // La stazione puo essere riaperta dopo la stampa: in quel caso la scansione della bag deve riprendere dalle etichette.
    if (!eligible.length && snapshot.data.phase === "scan_labels") return snapshot;
    if (!eligible.length) fail("Questa bag non e disponibile per il packing");
    const scannedAt = nowIso();
    const [sessionResult, orderResult] = await Promise.all([
      requireSupabase().from("wms_packing_sessions").update({
        stato: "in_verifica_bag",
        bag_first_scanned_at: scannedAt,
        updated_at: scannedAt,
      }).in("id", eligible.map((session) => session.id)),
      requireSupabase().from("shopify_orders").update({
        wms_status: "in_packing",
        updated_at: scannedAt,
      }).in("id", eligible.map((session) => session.order_id)),
    ]);
    if (sessionResult.error || orderResult.error) fail((sessionResult.error || orderResult.error).message);
    return packingStationSnapshot(code);
  }

  let snapshot;
  try {
    snapshot = await packingStationSnapshot(activeBagCode);
  } catch (error) {
    if (!code.startsWith("PK-")) throw error;
    snapshot = await packingStationSnapshotForLabel(code);
  }
  if (code === activeBagCode) {
    const awaitingDoubleCheck = snapshot.data.sessions.filter((session) => session.stato === "in_verifica_bag");
    if (!awaitingDoubleCheck.length) fail("Questa bag non richiede una seconda scansione");
    const scannedAt = nowIso();
    const updates = awaitingDoubleCheck.map((session) => requireSupabase().from("wms_packing_sessions").update({
      stato: "in_attesa_imballaggio",
      bag_double_checked_at: scannedAt,
      updated_at: scannedAt,
    }).eq("id", session.id));
    const results = await Promise.all(updates);
    const updateError = results.find((result) => result.error)?.error;
    if (updateError) fail(updateError.message);
    return packingStationSnapshot(activeBagCode);
  }

  if (snapshot.data.phase === "scan_packaging") {
    const waitingSessionIds = snapshot.data.sessions
      .filter((session) => session.stato === "in_attesa_imballaggio")
      .map((session) => session.id);
    const { error } = await requireSupabase().rpc("register_wms_packaging", {
      p_session_ids: waitingSessionIds,
      p_barcode: code,
    });
    if (error) fail(error.message);
    return packingStationSnapshot(activeBagCode);
  }

  return completePackingStationLabel(snapshot, code);
}

async function listWmsPackaging() {
  await assertWmsStaff();
  const { data, error } = await requireSupabase()
    .from("wms_packaging_types")
    .select("code,name,barcode,listino_key,stock_quantity,active,updated_at")
    .order("name");
  if (error) fail(error.message);
  return ok(data || []);
}

async function setWmsPackagingStock(payload = {}) {
  await assertWmsStaff();
  const code = String(payload.code || "").trim();
  const quantity = Math.floor(Number(payload.quantity));
  if (!code || !Number.isFinite(quantity) || quantity < 0) fail("Inserisci una giacenza valida");
  const { data: current, error: currentError } = await requireSupabase()
    .from("wms_packaging_types")
    .select("stock_quantity")
    .eq("code", code)
    .single();
  if (currentError || !current) fail(currentError?.message || "Imballaggio non trovato", 404);
  const { data, error } = await requireSupabase()
    .from("wms_packaging_types")
    .update({ stock_quantity: quantity, updated_at: nowIso() })
    .eq("code", code)
    .select()
    .single();
  if (error) fail(error.message);
  const delta = quantity - Number(current.stock_quantity || 0);
  if (delta) {
    const profile = await currentProfile();
    const { error: movementError } = await requireSupabase().from("wms_packaging_stock_movements").insert({
      packaging_code: code,
      quantity_delta: delta,
      reason: "adjustment",
      operatore_id: profile.id,
    });
    if (movementError) fail(movementError.message);
  }
  return ok(data);
}

function wmsPackagingLabelsPdf() {
  return ok(generateLabelsPdfBlob({
    formato: "100x50",
    mostra_titolo: true,
    items: [
      { fnsku: "SCATOLA-PICCOLA", titolo: "Scatola piccola", copie: 1 },
      { fnsku: "SCATOLA-MEDIA", titolo: "Scatola media", copie: 1 },
      { fnsku: "SCATOLA-GRANDE", titolo: "Scatola grande", copie: 1 },
      { fnsku: "BUSTA-CORRIERE", titolo: "Busta corriere", copie: 1 },
    ],
  }));
}

async function wmsPackingCarrierLabelsPdf(bagCode) {
  const snapshot = await packingStationSnapshot(bagCode);
  const items = snapshot.data.sessions
    .filter((session) => session.carrier_label_code)
    .map((session) => ({
      fnsku: session.carrier_label_code,
      titolo: `Etichetta corriere ${session.order?.order_name || "ordine"}`,
      copie: 1,
    }));
  if (!items.length) fail("Riscansiona prima la bag per generare le etichette");
  return ok(generateLabelsPdfBlob({ formato: "100x150", mostra_titolo: true, items }));
}

async function wmsPackingSnapshot(orderId) {
  await assertWmsStaff();
  const { data: session, error: sessionError } = await requireSupabase().from("wms_packing_sessions").select("*").eq("order_id", orderId).maybeSingle();
  if (sessionError) fail(sessionError.message);
  const { data: order, error: orderError } = await requireSupabase().from("shopify_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) fail(orderError?.message || "Ordine non trovato", 404);
  const [enrichedOrder] = await enrichShopifyOrders([order]);
  if (!session) return ok({ order: enrichedOrder, session: null, lines: [], current_line: null, summary: { expected: 0, verified: 0, progress: 0 } });
  const { data: lines, error: linesError } = await requireSupabase().from("wms_packing_lines").select("*").eq("session_id", session.id).order("created_at", { ascending: true });
  if (linesError) fail(linesError.message);
  const expected = (lines || []).reduce((sum, line) => sum + Number(line.quantita_attesa || 0), 0);
  const verified = (lines || []).reduce((sum, line) => sum + Number(line.quantita_verificata || 0), 0);
  return ok({ order: enrichedOrder, session, lines: lines || [], current_line: (lines || []).find((line) => Number(line.quantita_verificata) < Number(line.quantita_attesa)) || null, summary: { expected, verified, progress: expected ? Math.round((verified / expected) * 100) : 0 } });
}

async function listWmsPacking() {
  await assertWmsStaff();
  const { data: sessions, error } = await requireSupabase().from("wms_packing_sessions").select("*").neq("stato", "annullata").order("created_at", { ascending: false });
  if (error) fail(error.message);
  const orderIds = (sessions || []).map((session) => session.order_id);
  const { data: orders, error: ordersError } = orderIds.length ? await requireSupabase().from("shopify_orders").select("*").in("id", orderIds) : { data: [], error: null };
  if (ordersError) fail(ordersError.message);
  const enriched = await enrichShopifyOrders(orders || []);
  const orderMap = Object.fromEntries(enriched.map((order) => [order.id, order]));
  return ok((sessions || []).map((session) => ({ ...session, order: orderMap[session.order_id] || null })));
}

async function startWmsPacking(orderId, payload = {}) {
  const profile = await assertWmsStaff();
  const { data: existingSession, error: lookupError } = await requireSupabase().from("wms_packing_sessions").select("*").eq("order_id", orderId).maybeSingle();
  if (lookupError) fail(lookupError.message);
  let pickTask = null;
  if (!existingSession?.mass_batch_id) {
    const response = await requireSupabase().from("wms_pick_tasks").select("id,stato").eq("order_id", orderId).single();
    if (response.error || response.data?.stato !== "completata") fail("Completa prima il picking dell'ordine", 409);
    pickTask = response.data;
  } else {
    const { data: massBatch, error: massError } = await requireSupabase().from("wms_mass_pick_batches").select("stato").eq("id", existingSession.mass_batch_id).single();
    if (massError || !["completata", "in_packing", "completata_packing"].includes(massBatch?.stato)) fail("Completa prima il picking Massivo", 409);
  }
  const session = existingSession || await ensurePackingSession(orderId, pickTask?.id || null);
  const startedAt = nowIso();
  const [sessionResult, orderResult] = await Promise.all([
    requireSupabase().from("wms_packing_sessions").update({ stato: "in_corso", station_code: optionalText(payload.station_code) || "PACK-01", operatore_id: profile.id, started_at: startedAt, updated_at: startedAt }).eq("id", session.id),
    requireSupabase().from("shopify_orders").update({ wms_status: "in_packing", updated_at: startedAt }).eq("id", orderId),
  ]);
  if (sessionResult.error || orderResult.error) fail((sessionResult.error || orderResult.error).message);
  return wmsPackingSnapshot(orderId);
}

async function scanWmsPacking(sessionId, payload = {}) {
  await assertWmsStaff();
  const { data: session, error: sessionError } = await requireSupabase().from("wms_packing_sessions").select("*").eq("id", sessionId).single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione packing non trovata", 404);
  if (session.stato !== "in_corso") fail("Avvia prima la packing station", 409);
  const { data: lines, error: linesError } = await requireSupabase().from("wms_packing_lines").select("*").eq("session_id", sessionId);
  if (linesError) fail(linesError.message);
  const code = normalizedText(payload.codice || payload.code);
  const line = (lines || []).find((candidate) => Number(candidate.quantita_verificata) < Number(candidate.quantita_attesa) && [candidate.ean, candidate.fnsku, candidate.sku].some((value) => normalizedText(value) === code));
  if (!line) fail("Prodotto non previsto oppure gia verificato completamente");
  const remaining = Number(line.quantita_attesa) - Number(line.quantita_verificata);
  const quantity = Math.floor(Number(payload.quantita || 1));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) fail(`Puoi verificare da 1 a ${remaining} pezzi.`);
  const next = Number(line.quantita_verificata) + quantity;
  const { error } = await requireSupabase().from("wms_packing_lines").update({ quantita_verificata: next, verified_at: next === Number(line.quantita_attesa) ? nowIso() : null }).eq("id", line.id);
  if (error) fail(error.message);
  return wmsPackingSnapshot(session.order_id);
}

async function completeWmsPacking(sessionId) {
  await assertWmsStaff();
  const { data: session, error: sessionError } = await requireSupabase().from("wms_packing_sessions").select("*").eq("id", sessionId).single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione packing non trovata", 404);
  const snapshot = await wmsPackingSnapshot(session.order_id);
  if (snapshot.data.current_line) fail("Verifica tutti i prodotti prima di chiudere il collo");
  const completedAt = nowIso();
  const [sessionResult, orderResult] = await Promise.all([
    requireSupabase().from("wms_packing_sessions").update({ stato: "completata", completed_at: completedAt, updated_at: completedAt }).eq("id", sessionId),
    requireSupabase().from("shopify_orders").update({ wms_status: "imballato", updated_at: completedAt }).eq("id", session.order_id),
  ]);
  if (sessionResult.error || orderResult.error) fail((sessionResult.error || orderResult.error).message);
  let releaseBag = !session.mass_batch_id;
  if (session.mass_batch_id) {
    const { error: linkError } = await requireSupabase().from("wms_mass_pick_orders").update({ stato: "completato" }).eq("batch_id", session.mass_batch_id).eq("order_id", session.order_id);
    if (linkError) fail(linkError.message);
    const { data: pending, error: pendingError } = await requireSupabase().from("wms_mass_pick_orders").select("id").eq("batch_id", session.mass_batch_id).neq("stato", "completato").limit(1);
    if (pendingError) fail(pendingError.message);
    const { error: batchError } = await requireSupabase().from("wms_mass_pick_batches").update({ stato: (pending || []).length ? "in_packing" : "completata_packing", updated_at: nowIso() }).eq("id", session.mass_batch_id);
    if (batchError) fail(batchError.message);
    releaseBag = !(pending || []).length;
  }
  if (releaseBag) await releaseWmsBag(session.bag_id);
  return wmsPackingSnapshot(session.order_id);
}

async function wmsBagPackingSnapshot(bagCode) {
  await assertWmsStaff();
  const { data: batches, error: batchError } = await requireSupabase()
    .from("wms_mass_pick_batches")
    .select("*")
    .eq("bag_code", bagCode)
    .in("stato", ["completata", "in_packing"])
    .order("completed_at", { ascending: false })
    .limit(1);
  const batch = batches?.[0] || null;
  if (batchError) fail(batchError.message);
  if (!batch) {
    const { data: normalSessions, error: normalError } = await requireSupabase()
      .from("wms_packing_sessions")
      .select("*")
      .eq("bag_code", bagCode)
      .neq("stato", "annullata")
      .order("created_at", { ascending: false })
      .limit(1);
    const normalSession = normalSessions?.[0] || null;
    if (normalError || !normalSession) fail(normalError?.message || "Bag non trovata", 404);
    const normalSnapshot = await wmsPackingSnapshot(normalSession.order_id);
    return ok({ batch: null, sessions: [{ ...normalSession, order: normalSnapshot.data.order, lines: normalSnapshot.data.lines }], summary: { orders: 1, completed: normalSession.stato === "completata" ? 1 : 0 } });
  }
  const { data: sessions, error: sessionsError } = await requireSupabase().from("wms_packing_sessions").select("*").eq("mass_batch_id", batch.id).order("packing_sequence");
  if (sessionsError) fail(sessionsError.message);
  const orderIds = (sessions || []).map((session) => session.order_id);
  const { data: orders, error: ordersError } = orderIds.length ? await requireSupabase().from("shopify_orders").select("*").in("id", orderIds) : { data: [], error: null };
  if (ordersError) fail(ordersError.message);
  const enriched = await enrichShopifyOrders(orders || []);
  const orderMap = Object.fromEntries(enriched.map((order) => [order.id, order]));
  const sessionIds = (sessions || []).map((session) => session.id);
  const { data: lines, error: linesError } = sessionIds.length ? await requireSupabase().from("wms_packing_lines").select("*").in("session_id", sessionIds) : { data: [], error: null };
  if (linesError) fail(linesError.message);
  const rows = (sessions || []).map((session) => ({ ...session, order: orderMap[session.order_id], lines: (lines || []).filter((line) => line.session_id === session.id) }));
  return ok({ batch, sessions: rows, summary: { orders: rows.length, completed: rows.filter((session) => session.stato === "completata").length } });
}

function inventoryProductKey(row = {}) {
  return wmsInventoryKey(row);
}

async function inventorySessionSnapshot(sessionId) {
  await assertWmsStaff();
  const { data: session, error: sessionError } = await requireSupabase()
    .from("wms_inventory_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session) fail(sessionError?.message || "Inventario non trovato", 404);

  const [
    { data: location, error: locationError },
    { data: counts, error: countsError },
    { data: operator, error: operatorError },
  ] = await Promise.all([
    requireSupabase().from("wms_locations").select("*").eq("id", session.location_id).single(),
    requireSupabase().from("wms_inventory_counts").select("*").eq("session_id", session.id).order("created_at", { ascending: true }),
    session.operatore_id
      ? requireSupabase().from("profiles").select("id,name,email").eq("id", session.operatore_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const firstError = locationError || countsError || operatorError;
  if (firstError) fail(firstError.message);

  const rows = (counts || []).map((count) => ({
    ...count,
    differenza: Number(count.quantita_contata || 0) - Number(count.quantita_attesa || 0),
  }));
  return ok({
    session: { ...session, location, operator },
    counts: rows,
    summary: {
      righe: rows.length,
      verificate: rows.filter((row) => row.verificata).length,
      atteso: rows.reduce((sum, row) => sum + Number(row.quantita_attesa || 0), 0),
      contato: rows.reduce((sum, row) => sum + Number(row.quantita_contata || 0), 0),
      differenza: rows.reduce((sum, row) => sum + Number(row.differenza || 0), 0),
      anomalie: rows.filter((row) => row.verificata && row.differenza !== 0).length,
    },
  });
}

async function listWmsInventory() {
  await assertWmsStaff();
  const [
    { data: sessions, error: sessionsError },
    { data: locations, error: locationsError },
    { data: profiles, error: profilesError },
  ] = await Promise.all([
    requireSupabase().from("wms_inventory_sessions").select("*").order("started_at", { ascending: false }).limit(100),
    requireSupabase().from("wms_locations").select("*"),
    requireSupabase().from("profiles").select("id,name,email"),
  ]);
  const firstError = sessionsError || locationsError || profilesError;
  if (firstError) fail(firstError.message);

  const sessionIds = (sessions || []).map((session) => session.id);
  const { data: counts, error: countsError } = sessionIds.length
    ? await requireSupabase().from("wms_inventory_counts").select("*").in("session_id", sessionIds)
    : { data: [], error: null };
  if (countsError) fail(countsError.message);

  const locationMap = new Map((locations || []).map((location) => [location.id, location]));
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const countsBySession = groupBy(counts || [], "session_id");
  const rows = (sessions || []).map((session) => {
    const sessionCounts = countsBySession[session.id] || [];
    const verified = sessionCounts.filter((count) => count.verificata);
    return {
      ...session,
      location: locationMap.get(session.location_id) || null,
      operator: profileMap.get(session.operatore_id) || null,
      righe: sessionCounts.length,
      verificate: verified.length,
      atteso: sessionCounts.reduce((sum, count) => sum + Number(count.quantita_attesa || 0), 0),
      contato: sessionCounts.reduce((sum, count) => sum + Number(count.quantita_contata || 0), 0),
      anomalie: verified.filter((count) => Number(count.quantita_contata || 0) !== Number(count.quantita_attesa || 0)).length,
    };
  });

  return ok({
    sessions: rows,
    summary: {
      in_corso: rows.filter((row) => row.stato === "in_corso").length,
      completate: rows.filter((row) => row.stato === "completata").length,
      con_differenze: rows.filter((row) => row.stato === "completata" && row.anomalie > 0).length,
      posizioni_contate: new Set(rows.filter((row) => row.stato === "completata").map((row) => row.location_id)).size,
    },
  });
}

async function startWmsInventory(payload = {}) {
  const profile = await assertWmsStaff();
  const code = optionalText(payload.codice || payload.code)?.toUpperCase();
  const locationId = optionalText(payload.location_id);
  if (!code && !locationId) fail("Scansiona o seleziona una posizione");

  let locationQuery = requireSupabase().from("wms_locations").select("*");
  locationQuery = locationId ? locationQuery.eq("id", locationId) : locationQuery.ilike("codice", code);
  const { data: location, error: locationError } = await locationQuery.maybeSingle();
  if (locationError || !location) fail(locationError?.message || `Posizione ${code} non trovata`, 404);
  if (location.stato !== "attiva") fail(`La posizione ${location.codice} e bloccata`, 409);

  const { data: active, error: activeError } = await requireSupabase()
    .from("wms_inventory_sessions")
    .select("id")
    .eq("location_id", location.id)
    .eq("stato", "in_corso")
    .maybeSingle();
  if (activeError) fail(activeError.message);
  if (active) return inventorySessionSnapshot(active.id);

  const stockResponse = await wmsStock(new URLSearchParams());
  const stockLocation = stockResponse.data.locations.find((item) => item.id === location.id);
  const { data: session, error: insertError } = await requireSupabase()
    .from("wms_inventory_sessions")
    .insert({ location_id: location.id, operatore_id: profile.id, note: optionalText(payload.note) })
    .select()
    .single();
  if (insertError) fail(insertError.code === "23505" ? "Questa posizione ha gia un inventario in corso" : insertError.message);

  const initialCounts = (stockLocation?.contenuto || []).map((item) => ({
    session_id: session.id,
    location_id: location.id,
    cliente_id: item.cliente_id,
    product_key: inventoryProductKey(item),
    ean: optionalText(item.ean),
    fnsku: optionalText(item.fnsku),
    titolo: optionalText(item.titolo),
    quantita_attesa: Number(item.quantita || 0),
    quantita_contata: 0,
    verificata: false,
    created_by: profile.id,
  })).filter((item) => item.product_key);
  if (initialCounts.length) {
    const { error: countsError } = await requireSupabase().from("wms_inventory_counts").insert(initialCounts);
    if (countsError) {
      await requireSupabase().from("wms_inventory_sessions").delete().eq("id", session.id);
      fail(countsError.message);
    }
  }
  return inventorySessionSnapshot(session.id);
}

async function updateWmsInventoryCount(sessionId, payload = {}) {
  const profile = await assertWmsStaff();
  const snapshotResponse = await inventorySessionSnapshot(sessionId);
  const snapshot = snapshotResponse.data;
  if (snapshot.session.stato !== "in_corso") fail("Questo inventario e gia stato chiuso", 409);

  if (payload.conferma_atteso === true) {
    const updates = snapshot.counts.map((row) => requireSupabase()
      .from("wms_inventory_counts")
      .update({ quantita_contata: row.quantita_attesa, verificata: true, updated_at: nowIso() })
      .eq("id", row.id));
    const results = await Promise.all(updates);
    const firstError = results.find((result) => result.error)?.error;
    if (firstError) fail(firstError.message);
    return inventorySessionSnapshot(sessionId);
  }

  const code = normalizedText(payload.codice || payload.code);
  const countId = optionalText(payload.count_id);
  let count = snapshot.counts.find((row) => row.id === countId || (code && [row.ean, row.fnsku].some((value) => normalizedText(value) === code)));

  if (!count && code) {
    const params = new URLSearchParams();
    if (payload.cliente_id) params.set("cliente_id", payload.cliente_id);
    const stockResponse = await wmsStock(params);
    const matches = stockResponse.data.products.filter((product) => [product.ean, product.fnsku]
      .some((value) => normalizedText(value) === code));
    if (!matches.length) fail(`Prodotto ${payload.codice || payload.code} non riconosciuto`, 404);
    if (matches.length > 1) fail("Codice presente per piu clienti: seleziona prima l'azienda", 409);
    if (snapshot.counts.length) fail(`Prodotto non previsto in ${snapshot.session.location.codice}`, 409);
    const product = matches[0];
    const { data: inserted, error: insertError } = await requireSupabase()
      .from("wms_inventory_counts")
      .insert({
        session_id: sessionId,
        location_id: snapshot.session.location_id,
        cliente_id: product.cliente_id,
        product_key: inventoryProductKey(product),
        ean: optionalText(product.ean),
        fnsku: optionalText(product.fnsku),
        titolo: optionalText(product.titolo),
        quantita_attesa: 0,
        quantita_contata: 0,
        verificata: false,
        created_by: profile.id,
      })
      .select()
      .single();
    if (insertError) fail(insertError.message);
    count = inserted;
  }
  if (!count) fail("Riga inventario non trovata", 404);

  const hasAbsolute = Object.prototype.hasOwnProperty.call(payload, "quantita");
  const nextQuantity = hasAbsolute
    ? Math.floor(Number(payload.quantita))
    : Number(count.quantita_contata || 0) + Math.floor(Number(payload.delta ?? 1));
  if (!Number.isFinite(nextQuantity) || nextQuantity < 0) fail("La quantita contata non puo essere negativa");

  const { error: updateError } = await requireSupabase()
    .from("wms_inventory_counts")
    .update({ quantita_contata: nextQuantity, verificata: true, updated_at: nowIso() })
    .eq("id", count.id);
  if (updateError) fail(updateError.message);
  return inventorySessionSnapshot(sessionId);
}

async function completeWmsInventory(sessionId, payload = {}) {
  await assertWmsStaff();
  const snapshotResponse = await inventorySessionSnapshot(sessionId);
  const snapshot = snapshotResponse.data;
  if (snapshot.session.stato !== "in_corso") fail("Questo inventario e gia stato chiuso", 409);
  const pending = snapshot.counts.filter((count) => !count.verificata);
  if (pending.length) fail(`Restano ${pending.length} referenze da verificare`);
  if (snapshot.summary.anomalie > 0 && !payload.conferma_differenze) {
    fail(`Sono presenti ${snapshot.summary.anomalie} differenze. Conferma le rettifiche per chiudere.`);
  }
  const { error } = await requireSupabase()
    .from("wms_inventory_sessions")
    .update({ stato: "completata", completed_at: nowIso(), note: optionalText(payload.note) })
    .eq("id", sessionId);
  if (error) fail(error.message);
  return inventorySessionSnapshot(sessionId);
}

async function cancelWmsInventory(sessionId) {
  await assertWmsStaff();
  const snapshotResponse = await inventorySessionSnapshot(sessionId);
  if (snapshotResponse.data.session.stato !== "in_corso") fail("Solo un inventario in corso puo essere annullato", 409);
  const { error } = await requireSupabase()
    .from("wms_inventory_sessions")
    .update({ stato: "annullata", completed_at: nowIso() })
    .eq("id", sessionId);
  if (error) fail(error.message);
  return inventorySessionSnapshot(sessionId);
}

async function wmsScan(params) {
  const code = optionalText(params.get("code"));
  if (!code) fail("Codice richiesto");
  const response = await wmsStock(params);
  const stock = response.data;
  const normalizedCode = normalizedText(code).replace(/\s+/g, "");
  const location = stock.locations.find((item) => normalizedText(item.codice).replace(/\s+/g, "") === normalizedCode);
  if (location) return ok({ kind: "location", code, location, generated_at: stock.generated_at });

  const products = stock.products.filter((product) => [product.ean, product.fnsku, ...(product.skus || [])]
    .some((value) => normalizedText(value).replace(/\s+/g, "") === normalizedCode));
  if (products.length) return ok({ kind: "product", code, products, generated_at: stock.generated_at });
  return ok({ kind: "unknown", code, generated_at: stock.generated_at });
}

function shortCode(id) {
  return String(id || "").slice(0, 8).toUpperCase();
}

async function magazzinoMovimenti(params) {
  const cid = await resolveClienteId(params.get("cliente_id") || undefined);
  const ean = optionalText(params.get("ean"));
  if (!ean) fail("EAN richiesto");

  const [
    { data: entrate, error: entrateError },
    { data: righeEntrata, error: righeEntrataError },
    { data: preparazioni, error: prepError },
    { data: righePrep, error: righePrepError },
    { data: refs, error: refsError },
  ] = await Promise.all([
    supabase.from("entrate").select("*").eq("cliente_id", cid),
    supabase.from("entrate_righe").select("*"),
    supabase.from("preparazioni").select("*").eq("cliente_id", cid),
    supabase.from("preparazioni_righe").select("*"),
    supabase.from("referenze").select("*").eq("cliente_id", cid),
  ]);
  const firstError = entrateError || righeEntrataError || prepError || righePrepError || refsError;
  if (firstError) fail(firstError.message);

  const entrateCliente = [...(entrate || [])].sort((a, b) => String(a.data_annuncio || a.created_at || "").localeCompare(String(b.data_annuncio || b.created_at || "")));
  const preparazioniCliente = [...(preparazioni || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const entrataMap = new Map(entrateCliente.map((entry, index) => [entry.id, { ...entry, numero_operativo: index + 1 }]));
  const prepMap = new Map(preparazioniCliente.map((prep, index) => [prep.id, { ...prep, numero_operativo: index + 1 }]));
  const refsByEan = new Map((refs || []).filter((row) => row.ean).map((row) => [row.ean, row]));
  const refsByFnsku = new Map((refs || []).filter((row) => row.fnsku).map((row) => [row.fnsku, row]));
  const selectedRefByEan = refsByEan.get(ean);
  const selectedFnsku = optionalText(selectedRefByEan?.fnsku)
    || optionalText((righeEntrata || []).find((row) => row.ean === ean)?.fnsku)
    || optionalText((righePrep || []).find((row) => row.ean === ean)?.fnsku);
  const ref = selectedRefByEan || (selectedFnsku ? refsByFnsku.get(selectedFnsku) : null) || {};
  const sameProductRow = (row = {}) => optionalText(row.ean) === ean;

  const movimentiEntrata = (righeEntrata || [])
    .filter((row) => sameProductRow(row) && entrataMap.has(row.entrata_id))
    .map((row) => {
      const entrata = entrataMap.get(row.entrata_id);
      const receivedQty = entrataRowReceivedQuantity(row, entrata);
      return {
        id: row.id,
        tipo: "entrata",
        segno: "in",
        documento: `Entrata ${entrata.numero_operativo}`,
        codice: shortCode(entrata.id),
        stato: entrata.stato,
        data: entrata.data_ricezione || entrata.data_annuncio || entrata.created_at,
        quantita: receivedQty,
        quantita_dichiarata: Number(row.quantita || 0),
        ref_id: entrata.id,
      };
    })
    .filter((row) => row.quantita > 0);

  const movimentiPreparazione = (righePrep || [])
    .filter((row) => sameProductRow(row) && prepMap.has(row.preparazione_id))
    .map((row) => {
      const prep = prepMap.get(row.preparazione_id);
      return {
        id: row.id,
        tipo: "preparazione",
        segno: "out",
        documento: `Preparazione ${prep.numero_operativo}`,
        codice: shortCode(prep.id),
        stato: prep.stato,
        data: prep.data_spedito || prep.data_pronto || prep.created_at,
        quantita: Number(row.quantita || 0),
        ref_id: prep.id,
      };
    });

  const movimenti = [...movimentiEntrata, ...movimentiPreparazione]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));

  return ok({
    ean,
    titolo: ref.titolo || ean,
    fnsku: selectedFnsku || ref.fnsku || null,
    movimenti,
    totali: {
      entrate: movimentiEntrata.reduce((sum, row) => sum + Number(row.quantita || 0), 0),
      uscite: movimentiPreparazione.reduce((sum, row) => sum + Number(row.quantita || 0), 0),
    },
  });
}

async function preparato(params) {
  const cid = await resolveClienteId(params.get("cliente_id") || undefined);
  const [{ data: preps, error: prepsError }, { data: boxes, error: boxesError }, { data: refs, error: refsError }] = await Promise.all([
    supabase.from("preparazioni").select("*").eq("cliente_id", cid).in("stato", PREP_RESERVING_STATUSES),
    supabase.from("box").select("*").eq("cliente_id", cid),
    supabase.from("referenze").select("*").eq("cliente_id", cid),
  ]);
  const firstError = prepsError || boxesError || refsError;
  if (firstError) fail(firstError.message);

  const prepIds = (preps || []).map((p) => p.id);
  const { data: righe, error: righeError } = prepIds.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
    : { data: [] };
  if (righeError) fail(righeError.message);

  const orderedPreps = [...(preps || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const righeByPrep = groupBy(righe || [], "preparazione_id");
  const boxesByPrep = groupBy((boxes || []).filter((box) => prepIds.includes(box.preparazione_id)), "preparazione_id");
  const refByEan = {};
  const skusByEan = {};
  for (const ref of refs || []) {
    if (!ref.ean) continue;
    refByEan[ref.ean] ??= ref;
    if (ref.sku) {
      skusByEan[ref.ean] ||= [];
      if (!skusByEan[ref.ean].includes(ref.sku)) skusByEan[ref.ean].push(ref.sku);
    }
  }

  const rows = [];
  orderedPreps.forEach((prep, prepIndex) => {
    const righePrep = righeByPrep[prep.id] || [];
    const statoRiga = (riga) => riga.stato || (prep.stato === "pronto" ? "pronto" : "richiesta");
    const righePronte = righePrep.filter((riga) => statoRiga(riga) === "pronto");
    const richiesto = contenutoTotals(righePronte);
    const inBox = contenutoTotals((boxesByPrep[prep.id] || []).flatMap((box) => box.contenuto || []));
    Object.keys(richiesto).forEach((ean) => {
      const ref = refByEan[ean] || {};
      const prepRow = righePronte.find((riga) => riga.ean === ean);
      rows.push({
        riga_id: prepRow?.id || null,
        preparazione_id: prep.id,
        preparazione_numero: prepIndex + 1,
        preparazione_data: prep.data_pronto || prep.created_at,
        ean,
        titolo: ref.titolo,
        fnsku: prepRow?.fnsku || ref.fnsku,
        sku: ref.sku,
        skus: skusByEan[ean] || (ref.sku ? [ref.sku] : []),
        stato_riga: "pronto",
        stato_preparazione: prep.stato,
        imballabile: true,
        richiesto: richiesto[ean],
        in_box: inBox[ean] || 0,
        disponibile: Math.max(0, richiesto[ean] - (inBox[ean] || 0)),
        quantita_originale: Number(prepRow?.quantita_originale || prepRow?.quantita || richiesto[ean]),
        quantita_mancante: Number(prepRow?.quantita_mancante || 0),
      });
    });

    const nonImballabili = righePrep.filter((riga) => statoRiga(riga) !== "pronto");
    const bloccate = nonImballabili.reduce((acc, riga) => {
      if (!riga.ean) return acc;
      const key = `${riga.ean}:${statoRiga(riga)}`;
      acc[key] ||= { ean: riga.ean, stato: statoRiga(riga), quantita: 0, fnsku: null };
      acc[key].quantita += Number(riga.quantita || 0);
      acc[key].fnsku ||= riga.fnsku;
      return acc;
    }, {});
    Object.values(bloccate).forEach((item) => {
      const ref = refByEan[item.ean] || {};
      rows.push({
        preparazione_id: prep.id,
        preparazione_numero: prepIndex + 1,
        preparazione_data: prep.data_pronto || prep.created_at,
        ean: item.ean,
        titolo: ref.titolo,
        fnsku: item.fnsku || ref.fnsku,
        sku: ref.sku,
        skus: skusByEan[item.ean] || (ref.sku ? [ref.sku] : []),
        stato_riga: item.stato,
        stato_preparazione: prep.stato,
        imballabile: false,
        richiesto: item.quantita,
        in_box: 0,
        disponibile: 0,
      });
    });
  });

  return ok(rows);
}

async function dashboardStats() {
  const [entrateRes, preparazioniRes, prepRigheRes, boxListRes, referenzeRes, clientiRes] = await Promise.all([
    supabase.from("entrate").select("stato,data_annuncio,cliente_id"),
    supabase.from("preparazioni").select("id,stato,created_at,data_pronto,cliente_id"),
    supabase.from("preparazioni_righe").select("preparazione_id,ean,quantita,servizi"),
    supabase.from("box").select("id,cliente_id,preparazione_id,numero_box,stato,created_at,peso_kg,lunghezza_cm,larghezza_cm,altezza_cm,etichetta_amazon_pdf_url,etichetta_ups_pdf_url,contenuto"),
    supabase.from("referenze").select("id,cliente_id,ean,fnsku"),
    supabase.from("clienti").select("id,ragione_sociale,listino"),
  ]);
  const firstError = entrateRes.error || preparazioniRes.error || prepRigheRes.error || boxListRes.error || referenzeRes.error || clientiRes.error;
  if (firstError) fail(firstError.message);

  const countBy = (rows, key) => (rows || []).reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});

  const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
  const lastDays = Array.from({ length: 7 }, (_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - index));
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) };
  });
  const trend_operativo = lastDays.map((day) => ({
    giorno: day.label,
    entrate: (entrateRes.data || []).filter((e) => e.data_annuncio && dayKey(e.data_annuncio) === day.key).length,
    preparazioni: (preparazioniRes.data || []).filter((p) => p.created_at && dayKey(p.created_at) === day.key).length,
    box: (boxListRes.data || []).filter((b) => b.created_at && dayKey(b.created_at) === day.key).length,
  }));

  const pezzi_nei_box = (boxListRes.data || []).reduce((sum, box) => (
    sum + (box.contenuto || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0)
  ), 0);
  const servizio_usage = {};
  for (const riga of prepRigheRes.data || []) {
    for (const servizio of riga.servizi || []) {
      servizio_usage[servizio] = (servizio_usage[servizio] || 0) + Number(riga.quantita || 0);
    }
  }
  const clientiById = Object.fromEntries((clientiRes.data || []).map((c) => [c.id, c]));
  const top_clienti = Object.entries(countBy(preparazioniRes.data || [], "cliente_id"))
    .map(([cliente_id, preparazioni]) => ({
      cliente_id,
      nome: clientiById[cliente_id]?.ragione_sociale || "Cliente",
      preparazioni,
    }))
    .sort((a, b) => b.preparazioni - a.preparazioni)
    .slice(0, 5);

  const allBoxes = boxListRes.data || [];
  const allPreps = preparazioniRes.data || [];
  const boxesByPrep = boxesByPreparazioneWithFallback(allPreps, prepRigheRes.data || [], allBoxes);
  const riferimenti = referenzeRes.data || [];
  const controlli = {
    referenze_senza_ean: riferimenti.filter((ref) => !optionalText(ref.ean)).length,
    referenze_senza_fnsku: riferimenti.filter((ref) => !optionalText(ref.fnsku)).length,
    box_senza_preparazione: allBoxes.filter((box) => box.stato !== "spedito" && !box.preparazione_id).length,
    box_dati_incompleti: allBoxes.filter((box) => box.stato !== "spedito" && [box.peso_kg, box.lunghezza_cm, box.larghezza_cm, box.altezza_cm].some((value) => Number(value || 0) <= 0)).length,
    box_pronti_senza_etichette: allBoxes.filter((box) => box.stato === "pronto" && (!box.etichetta_amazon_pdf_url || !box.etichetta_ups_pdf_url)).length,
    preparazioni_pronte_senza_box: allPreps.filter((prep) => prep.stato === "pronto" && !(boxesByPrep[prep.id] || []).length).length,
  };
  controlli.totale = Object.values(controlli).reduce((sum, value) => sum + Number(value || 0), 0);

  return ok({
    entrate_per_stato: countBy(entrateRes.data || [], "stato"),
    preparazioni_per_stato: countBy(preparazioniRes.data || [], "stato"),
    box_per_stato: countBy(boxListRes.data || [], "stato"),
    trend_operativo,
    totale_entrate: (entrateRes.data || []).length,
    totale_preparazioni: (preparazioniRes.data || []).length,
    totale_referenze: riferimenti.length,
    totale_box: (boxListRes.data || []).length,
    pezzi_nei_box,
    servizio_usage,
    top_clienti,
    totale_clienti: (clientiRes.data || []).length,
    controlli,
  });
}

async function fatturazione(params) {
  const profile = await currentProfile();
  const clienteId = isStaff(profile) ? params.get("cliente_id") : profile.cliente_id;
  const anno = Number(params.get("anno"));
  const mese = Number(params.get("mese"));
  const palletStoccati = Number(params.get("pallet") || 0);
  if (!clienteId || !anno || !mese) fail("Cliente, anno e mese sono obbligatori");

  const start = new Date(Date.UTC(anno, mese - 1, 1)).toISOString();
  const end = new Date(Date.UTC(anno, mese, 1)).toISOString();
  const { data: cliente, error: clienteError } = await requireSupabase()
    .from("clienti")
    .select("*")
    .eq("id", clienteId)
    .single();
  if (clienteError || !cliente) fail(clienteError?.message || "Cliente non trovato");

  const listino = { ...(cliente.listino || {}) };
  const price = (key) => Number(listino[key] || 0);
  const righe = [];
  const addRiga = (codice, descrizione, quantita, prezzo) => {
    const q = Number(quantita || 0);
    const p = Number(prezzo || 0);
    if (q <= 0) return null;
    const riga = { codice, descrizione, quantita: q, prezzo: p, importo: q * p };
    righe.push(riga);
    return riga;
  };
  const addImportoRiga = (codice, descrizione, quantita, importo) => {
    const q = Number(quantita || 0);
    const total = Number(importo || 0);
    if (q <= 0) return null;
    const riga = {
      codice,
      descrizione,
      quantita: q,
      prezzo: q > 0 ? total / q : 0,
      importo: total,
    };
    righe.push(riga);
    return riga;
  };

  const [{ data: entrate, error: entrateError }, { data: preps, error: prepsError }, { data: boxes, error: boxesError }, { data: packagingUsage, error: packagingError }] = await Promise.all([
    supabase.from("entrate").select("*").eq("cliente_id", clienteId).gte("data_ricezione", start).lt("data_ricezione", end),
    supabase.from("preparazioni").select("*").eq("cliente_id", clienteId).in("stato", ["pronto", "spedito"]).gte("data_pronto", start).lt("data_pronto", end),
    supabase.from("box").select("*").eq("cliente_id", clienteId),
    supabase.from("wms_order_packaging_usage").select("order_id,packaging_code,quantity,unit_price_snapshot,scanned_at").eq("cliente_id", clienteId).gte("scanned_at", start).lt("scanned_at", end),
  ]);
  const firstError = entrateError || prepsError || boxesError || packagingError;
  if (firstError) fail(firstError.message);

  const prepIds = (preps || []).map((p) => p.id);
  const entrataIds = (entrate || []).map((e) => e.id);
  const [{ data: prepRighe, error: righeError }, { data: entrateRighe, error: entrateRigheError }, { data: refs, error: refsError }] = await Promise.all([
    prepIds.length
      ? supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
      : Promise.resolve({ data: [], error: null }),
    entrataIds.length
      ? supabase.from("entrate_righe").select("*").in("entrata_id", entrataIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("referenze").select("id,cliente_id,ean,titolo,fnsku").eq("cliente_id", clienteId),
  ]);
  const detailError = righeError || entrateRigheError || refsError;
  if (detailError) fail(detailError.message);

  const refByEan = Object.fromEntries((refs || []).map((r) => [r.ean, r]));
  const righeByPrep = groupBy(prepRighe || [], "preparazione_id");
  const righeByEntrata = groupBy(entrateRighe || [], "entrata_id");
  const boxesByPrep = boxesByPreparazioneWithFallback(preps || [], prepRighe || [], boxes || []);

  const entrataPallet = (entrate || []).filter((e) => e.tipo === "pallet").reduce((sum, e) => sum + Number(e.colli || 1), 0);
  const entrataScatola = (entrate || []).filter((e) => e.tipo === "scatola").reduce((sum, e) => sum + Number(e.colli || 1), 0);
  addRiga("entrata_pallet", "Entrata pallet", entrataPallet, price("entrata_pallet"));
  addRiga("entrata_scatola", "Entrata scatola", entrataScatola, price("entrata_scatola"));

  const servizioQty = {};
  const preparazioniDettaglio = (preps || []).map((prep) => {
    const righePrep = righeByPrep[prep.id] || [];
    const boxesPrep = boxesByPrep[prep.id] || [];
    const servizi = {};
    for (const riga of righePrep) {
      for (const servizio of riga.servizi || []) {
        servizi[servizio] = (servizi[servizio] || 0) + Number(riga.quantita || 0);
        servizioQty[servizio] = (servizioQty[servizio] || 0) + Number(riga.quantita || 0);
      }
    }
    const scatola60 = boxesPrep.filter((b) => boxScatolaCodice(b) === "scatola_60").length;
    const scatola40 = boxesPrep.filter((b) => boxScatolaCodice(b) === "scatola_40").length;
    const costi = [
      ...Object.entries(servizi).map(([codice, quantita]) => ({
        codice,
        descrizione: SERVICE_LABELS[codice] || codice,
        quantita,
        prezzo: price(codice),
        importo: Number(quantita || 0) * price(codice),
      })),
      boxesPrep.length > 0 ? {
        codice: "inscatolamento",
        descrizione: "Inscatolamento box",
        quantita: boxesPrep.length,
        prezzo: price("inscatolamento"),
        importo: boxesPrep.length * price("inscatolamento"),
      } : null,
      scatola60 > 0 ? {
        codice: "scatola_60",
        descrizione: "Scatola 60x40x40",
        quantita: scatola60,
        prezzo: price("scatola_60"),
        importo: scatola60 * price("scatola_60"),
      } : null,
      scatola40 > 0 ? {
        codice: "scatola_40",
        descrizione: "Scatola 40x30x30",
        quantita: scatola40,
        prezzo: price("scatola_40"),
        importo: scatola40 * price("scatola_40"),
      } : null,
    ].filter(Boolean);

    return {
      id: prep.id,
      stato: prep.stato,
      created_at: prep.created_at,
      data_pronto: prep.data_pronto,
      righe: righePrep.map((riga) => ({
        ...riga,
        titolo: refByEan[riga.ean]?.titolo || riga.ean,
        fnsku: riga.fnsku || refByEan[riga.ean]?.fnsku || null,
      })),
      pezzi: righePrep.reduce((sum, riga) => sum + Number(riga.quantita || 0), 0),
      servizi,
      boxes: boxesPrep,
      costi,
      totale: costi.reduce((sum, riga) => sum + Number(riga.importo || 0), 0),
    };
  });

  for (const codice of ["fnsku", "busta", "nastratura", "pluriball"]) {
    addRiga(codice, SERVICE_LABELS[codice], servizioQty[codice], price(codice));
  }

  const boxesFatturabili = Object.values(boxesByPrep).flat();
  addRiga("inscatolamento", "Inscatolamento box", boxesFatturabili.length, price("inscatolamento"));
  const scatola60 = boxesFatturabili.filter((b) => boxScatolaCodice(b) === "scatola_60").length;
  const scatola40 = boxesFatturabili.filter((b) => boxScatolaCodice(b) === "scatola_40").length;
  addRiga("scatola_60", "Scatola 60x40x40", scatola60, price("scatola_60"));
  addRiga("scatola_40", "Scatola 40x30x30", scatola40, price("scatola_40"));
  addRiga("stoccaggio_pallet", "Stoccaggio pallet mese", palletStoccati, price("stoccaggio_pallet"));

  const packedOrderIds = [...new Set((packagingUsage || []).map((usage) => usage.order_id))];
  const [{ data: packedItems, error: packedItemsError }, { data: packedOrders, error: packedOrdersError }] = packedOrderIds.length
    ? await Promise.all([
      supabase.from("shopify_order_items").select("order_id,quantita").in("order_id", packedOrderIds),
      supabase.from("shopify_orders").select("id,order_name,selected_carrier,shipping_price").in("id", packedOrderIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (packedItemsError || packedOrdersError) fail((packedItemsError || packedOrdersError).message);
  const piecesByOrder = (packedItems || []).reduce((accumulator, item) => {
    accumulator[item.order_id] = (accumulator[item.order_id] || 0) + Number(item.quantita || 0);
    return accumulator;
  }, {});
  const extraPieces = packedOrderIds.reduce((total, orderId) => total + Math.max(0, Number(piecesByOrder[orderId] || 0) - 1), 0);
  const orderBaseAmount = packedOrderIds.length * price("wms_order_base_fee");
  const extraItemsAmount = extraPieces * price("wms_extra_item_fee");
  addRiga("wms_order_base_fee", "Gestione ordine", packedOrderIds.length, price("wms_order_base_fee"));
  addRiga("wms_extra_item_fee", "Pezzi extra oltre il primo", extraPieces, price("wms_extra_item_fee"));
  const packagingLabels = {
    small_box: ["wms_pack_scatola_piccola", "Scatola piccola"],
    medium_box: ["wms_pack_scatola_media", "Scatola media"],
    large_box: ["wms_pack_scatola_grande", "Scatola grande"],
    courier_bag: ["wms_pack_busta_corriere", "Busta corriere"],
  };
  const packagingTotals = (packagingUsage || []).reduce((accumulator, usage) => {
    accumulator[usage.packaging_code] ||= { quantity: 0, amount: 0 };
    accumulator[usage.packaging_code].quantity += Number(usage.quantity || 0);
    accumulator[usage.packaging_code].amount += Number(usage.quantity || 0) * Number(usage.unit_price_snapshot || 0);
    return accumulator;
  }, {});
  for (const [packagingCode, totals] of Object.entries(packagingTotals)) {
    const [listinoKey, label] = packagingLabels[packagingCode] || [packagingCode, packagingCode];
    addImportoRiga(listinoKey, label, totals.quantity, totals.amount);
  }

  const shippingByCarrier = (packedOrders || []).reduce((accumulator, order) => {
    const amount = Number(order.shipping_price || 0);
    if (amount <= 0) return accumulator;
    const carrier = optionalText(order.selected_carrier)?.toLowerCase() || "altro";
    accumulator[carrier] ||= { count: 0, amount: 0 };
    accumulator[carrier].count += 1;
    accumulator[carrier].amount += amount;
    return accumulator;
  }, {});
  for (const [carrier, totals] of Object.entries(shippingByCarrier)) {
    addImportoRiga(`wms_shipping_${carrier}`, `Spedizioni ${carrier.toUpperCase()}`, totals.count, totals.amount);
  }
  const shippingAmount = Object.values(shippingByCarrier).reduce((sum, totals) => sum + Number(totals.amount || 0), 0);
  const packagingAmount = Object.values(packagingTotals).reduce((sum, totals) => sum + Number(totals.amount || 0), 0);
  const latestPackedAt = (packagingUsage || []).reduce((latest, usage) => {
    if (!usage.scanned_at) return latest;
    return !latest || new Date(usage.scanned_at) > new Date(latest) ? usage.scanned_at : latest;
  }, null);
  const ordersWithoutShipping = Math.max(0, packedOrderIds.length - Object.values(shippingByCarrier).reduce((sum, totals) => sum + Number(totals.count || 0), 0));

  const entrateDettaglio = (entrate || []).map((entrata) => {
    const colli = Number(entrata.colli || 1);
    const codice = entrata.tipo === "pallet" ? "entrata_pallet" : "entrata_scatola";
    const costo = {
      codice,
      descrizione: entrata.tipo === "pallet" ? "Entrata pallet" : "Entrata scatola",
      quantita: colli,
      prezzo: price(codice),
      importo: colli * price(codice),
    };
    const righeEntrata = righeByEntrata[entrata.id] || [];
    return {
      ...entrata,
      righe: righeEntrata.map((riga) => ({
        ...riga,
        titolo: refByEan[riga.ean]?.titolo || riga.ean,
        fnsku: riga.fnsku || refByEan[riga.ean]?.fnsku || null,
      })),
      pezzi: righeEntrata.reduce((sum, riga) => sum + Number(riga.quantita || 0), 0),
      costo,
    };
  });

  const subtotale = righe.reduce((sum, r) => sum + r.importo, 0);
  const ivaPerc = Number(listino.iva ?? 22);
  const ivaImporto = subtotale * ivaPerc / 100;
  return ok({
    righe,
    subtotale,
    iva_perc: ivaPerc,
    iva_importo: ivaImporto,
    totale: subtotale + ivaImporto,
    cliente_id: clienteId,
    ragione_sociale: cliente.ragione_sociale,
    periodo: `${params.get("anno")}-${String(params.get("mese")).padStart(2, "0")}`,
    metriche: {
      entrata_pallet: entrataPallet,
      entrata_scatola: entrataScatola,
      preparazioni: preparazioniDettaglio.length,
      box: boxesFatturabili.length,
      ordini_wms: packedOrderIds.length,
      pezzi_extra_wms: extraPieces,
      imballaggi_wms: packagingTotals,
      servizi: servizioQty,
    },
    dettaglio: {
      entrate: entrateDettaglio,
      preparazioni: preparazioniDettaglio,
      stoccaggio: {
        pallet: palletStoccati,
        prezzo: price("stoccaggio_pallet"),
        importo: palletStoccati * price("stoccaggio_pallet"),
      },
      ordini_imballati: {
        ultimo_imballato_at: latestPackedAt,
        ordini: packedOrderIds.length,
        spedizioni: {
          quantita: Object.values(shippingByCarrier).reduce((sum, totals) => sum + Number(totals.count || 0), 0),
          importo: shippingAmount,
          per_corriere: shippingByCarrier,
          senza_costo: ordersWithoutShipping,
        },
        gestione_ordini: {
          quantita: packedOrderIds.length,
          prezzo: price("wms_order_base_fee"),
          importo: orderBaseAmount,
        },
        pezzi_extra: {
          quantita: extraPieces,
          prezzo: price("wms_extra_item_fee"),
          importo: extraItemsAmount,
        },
        imballaggi: {
          quantita: (packagingUsage || []).reduce((sum, usage) => sum + Number(usage.quantity || 0), 0),
          importo: packagingAmount,
          per_tipo: packagingTotals,
        },
        totale: shippingAmount + orderBaseAmount + extraItemsAmount + packagingAmount,
      },
    },
  });
}

function simplePdfTextBlob(lines = []) {
  const safeLines = lines.map((line) => pdfEscape(line).slice(0, 110));
  const stream = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    `(${safeLines[0] || "Documento"}) Tj`,
    "/F1 10 Tf",
    ...safeLines.slice(1).flatMap((line) => ["0 -18 Td", `(${line}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function invoicePdfBlob(fattura) {
  const lines = [
    `Riepilogo fatturazione - ${fattura.ragione_sociale || ""}`,
    `Periodo: ${fattura.periodo}`,
    "",
    "Descrizione | Q.ta | Prezzo | Importo",
    ...((fattura.righe || []).length ? fattura.righe.map((r) => (
      `${r.descrizione} | ${r.quantita} | EUR ${Number(r.prezzo).toFixed(2)} | EUR ${Number(r.importo).toFixed(2)}`
    )) : ["Nessun costo nel periodo selezionato."]),
    "",
    `Imponibile: EUR ${Number(fattura.subtotale || 0).toFixed(2)}`,
    `IVA ${Number(fattura.iva_perc || 0).toFixed(2)}%: EUR ${Number(fattura.iva_importo || 0).toFixed(2)}`,
    `Totale: EUR ${Number(fattura.totale || 0).toFixed(2)}`,
  ];
  return simplePdfTextBlob(lines);
}

const MM_TO_PT = 72 / 25.4;
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function pdfEscape(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function parseLabelFormat(format = "50x30") {
  const [w, h] = String(format).split("x").map((v) => Number(v));
  if (!w || !h || w < 20 || h < 10) fail("Formato etichetta non valido");
  return { widthPt: w * MM_TO_PT, heightPt: h * MM_TO_PT };
}

function code128BValues(value) {
  const text = String(value || "").trim();
  if (!text || /[^\x20-\x7E]/.test(text)) fail(`FNSKU non valido per Code128: ${text}`);
  const values = [...text].map((char) => char.charCodeAt(0) - 32);
  let checksum = 104;
  values.forEach((v, index) => {
    checksum += v * (index + 1);
  });
  return [104, ...values, checksum % 103, 106];
}

function barcodeOps(fnsku, x, y, width, height) {
  const patterns = code128BValues(fnsku).map((v) => CODE128_PATTERNS[v]);
  const modules = patterns.reduce((sum, pattern) => sum + [...pattern].reduce((s, n) => s + Number(n), 0), 0);
  const moduleWidth = width / modules;
  let cursor = x;
  const ops = [];

  for (const pattern of patterns) {
    [...pattern].forEach((digit, index) => {
      const barWidth = Number(digit) * moduleWidth;
      if (index % 2 === 0) {
        ops.push(`${cursor.toFixed(2)} ${y.toFixed(2)} ${barWidth.toFixed(2)} ${height.toFixed(2)} re f`);
      }
      cursor += barWidth;
    });
  }
  return ops.join("\n");
}

function labelContent({ fnsku, titolo }, widthPt, heightPt, showTitle) {
  const margin = Math.max(5, Math.min(widthPt, heightPt) * 0.08);
  const title = pdfEscape(titolo || "");
  const code = pdfEscape(fnsku);
  const titleSize = Math.max(5, Math.min(8, heightPt * 0.11));
  const codeSize = Math.max(7, Math.min(11, heightPt * 0.16));
  const barcodeHeight = Math.max(18, heightPt * (showTitle && title ? 0.42 : 0.5));
  const barcodeY = margin + codeSize + 4;
  const barcodeWidth = widthPt - margin * 2;
  const barcodeX = margin;
  const titleY = Math.min(heightPt - margin - titleSize, barcodeY + barcodeHeight + titleSize + 3);

  const ops = [
    "0 0 0 rg",
    "BT",
    `/F2 ${codeSize.toFixed(2)} Tf`,
    `${(widthPt / 2 - (code.length * codeSize * 0.3)).toFixed(2)} ${margin.toFixed(2)} Td`,
    `(${code}) Tj`,
    "ET",
    barcodeOps(fnsku, barcodeX, barcodeY, barcodeWidth, barcodeHeight),
  ];

  if (showTitle && title) {
    const compactTitle = title.length > 48 ? `${title.slice(0, 45)}...` : title;
    ops.push(
      "BT",
      `/F1 ${titleSize.toFixed(2)} Tf`,
      `${margin.toFixed(2)} ${titleY.toFixed(2)} Td`,
      `(${compactTitle}) Tj`,
      "ET"
    );
  }

  return ops.join("\n");
}

const MAX_LABEL_COPIES_PER_ITEM = 10000;
const MAX_LABEL_PAGES_PER_PDF = 20000;

function generateLabelsPdfBlob(payload = {}) {
  const { widthPt, heightPt } = parseLabelFormat(payload.formato);
  let totalCopies = 0;
  const items = (payload.items || []).flatMap((item) => {
    const requestedCopies = Math.max(1, Number(item.copie) || 1);
    if (requestedCopies > MAX_LABEL_COPIES_PER_ITEM) {
      fail(`Massimo ${MAX_LABEL_COPIES_PER_ITEM} etichette per singola riga`);
    }
    totalCopies += requestedCopies;
    if (totalCopies > MAX_LABEL_PAGES_PER_PDF) {
      fail(`Massimo ${MAX_LABEL_PAGES_PER_PDF} etichette per PDF`);
    }
    const copies = requestedCopies;
    return Array.from({ length: copies }, () => item);
  });
  if (!items.length) fail("Inserisci almeno un FNSKU");

  const fontHelveticaObj = 3 + items.length * 2;
  const fontCourierObj = fontHelveticaObj + 1;
  const pageRefs = [];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];

  objects.push("");
  items.forEach((item, index) => {
    const pageObj = 3 + index * 2;
    const contentObj = pageObj + 1;
    pageRefs.push(`${pageObj} 0 R`);
    const stream = labelContent(item, widthPt, heightPt, payload.mostra_titolo !== false);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << /F1 ${fontHelveticaObj} 0 R /F2 ${fontCourierObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${items.length} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function generateTestShippingLabelPdfBlob(carrier = "gls") {
  const { widthPt, heightPt } = parseLabelFormat("100x150");
  const margin = 16;
  const normalizedCarrier = String(carrier || "gls").toLowerCase() === "brt" ? "BRT" : "GLS";
  const tracking = `PK-${normalizedCarrier}-TEST-001`;
  const barcodeX = margin;
  const barcodeY = 48;
  const barcodeWidth = widthPt - margin * 2;
  const barcodeHeight = 72;
  const text = (font, size, x, y, value) => [
    "BT",
    `/${font} ${size} Tf`,
    `${x} ${y} Td`,
    `(${pdfEscape(value)}) Tj`,
    "ET",
  ].join("\n");
  const line = (x1, y1, x2, y2, width = 1) => `${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
  const stream = [
    "0 0 0 RG",
    "0 0 0 rg",
    `${margin / 2} ${margin / 2} ${widthPt - margin} ${heightPt - margin} re S`,
    text("F2", 24, margin, heightPt - 42, normalizedCarrier),
    text("F2", 10, widthPt - 64, heightPt - 35, "TEST"),
    text("F1", 7, widthPt - 92, heightPt - 47, "ETICHETTA NON REALE"),
    line(margin, heightPt - 60, widthPt - margin, heightPt - 60, 1.5),
    text("F2", 8, margin, heightPt - 78, "MITTENTE"),
    text("F2", 11, margin, heightPt - 94, "Aimago Logistics"),
    text("F1", 9, margin, heightPt - 108, "Via Esempio 10 - 00100 Roma RM"),
    line(margin, heightPt - 120, widthPt - margin, heightPt - 120),
    text("F2", 8, margin, heightPt - 140, "DESTINATARIO"),
    text("F2", 16, margin, heightPt - 164, "Mario Rossi"),
    text("F1", 12, margin, heightPt - 184, "Via delle Prove 25"),
    text("F2", 13, margin, heightPt - 205, "20100 MILANO MI"),
    text("F1", 10, margin, heightPt - 222, "ITALIA"),
    line(margin, heightPt - 235, widthPt - margin, heightPt - 235),
    text("F2", 8, margin, heightPt - 253, "SERVIZIO"),
    text("F2", 12, margin, heightPt - 271, "STANDARD 24/48H"),
    text("F2", 8, widthPt - 92, heightPt - 253, "COLLO"),
    text("F2", 12, widthPt - 92, heightPt - 271, "1 / 1"),
    line(margin, 135, widthPt - margin, 135),
    barcodeOps(tracking, barcodeX, barcodeY, barcodeWidth, barcodeHeight),
    text("F3", 11, ((widthPt - tracking.length * 6.6) / 2).toFixed(2), 28, tracking),
    text("F1", 7, margin, 14, `${normalizedCarrier} - etichetta simulata per prova di stampa`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export const api = {
  async get(url, config = {}) {
    const { path, params } = pathAndQuery(url);
    if (path === "/clienti") return listClienti();
    if (path.match(/^\/clienti\/[^/]+\/carrier-rates$/)) return listClientCarrierRates(path.split("/")[2]);
    if (path === "/wms/postal-codes/stats") return getItalianPostalCodeStats();
    if (path === "/wms/operatori") return listWmsOperators(params);
    if (path === "/wms/control-room") return getWmsControlRoom(params);
    if (path === "/referenze") return listReferenze(params);
    if (path === "/entrate") return listEntrate(params);
    if (path.startsWith("/entrate/")) return getEntrata(path.split("/")[2]);
    if (path === "/box") return listBox(params);
    if (path === "/preparazioni") return listPreparazioni(params);
    if (path === "/shopify/connections") return listShopifyConnections();
    if (path === "/shopify/orders") return listShopifyOrders(params);
    if (path.match(/^\/wms\/orders\/[^/]+\/shipping-quote$/)) return getWmsShippingQuote(path.split("/")[3]);
    if (path.match(/^\/wms\/orders\/[^/]+\/cost-detail$/)) return getWmsOrderCostDetail(path.split("/")[3]);
    if (path === "/wms/spedizioni") return listWmsShipments(params);
    if (path === "/wms/tickets") return listSupportTickets(params);
    if (path.match(/^\/wms\/tickets\/[^/]+\/messages$/)) return listSupportMessages(path.split("/")[3]);
    if (path === "/wms/resi") return listWmsReturns(params);
    if (path === "/wms/stock") return wmsStock(params);
    if (path === "/wms/mappa") return getWmsWarehouseMap(params);
    if (path === "/wms/scan") return wmsScan(params);
    if (path === "/wms/configurazione") return getWmsSettings();
    if (path === "/wms/ordini") return listWmsOperationalOrders(params);
    if (path === "/wms/refill") return listWmsRefillQueue(params);
    if (path === "/wms/picking-massivo") return listWmsMassPicking(params);
    if (path.match(/^\/wms\/picking-massivo\/[^/]+$/)) return wmsMassPickSnapshot(path.split("/")[3]);
    if (path === "/wms/picking-galluse") return listWmsGallusePicking(params);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+$/)) return wmsGalluseSnapshot(path.split("/")[3]);
    if (path === "/wms/packing") return listWmsPacking();
    if (path === "/wms/packaging") return listWmsPackaging();
    if (path === "/wms/packaging/etichette" && config.responseType === "blob") return wmsPackagingLabelsPdf();
    if (path === "/wms/bags") return listWmsBags();
    if (path.match(/^\/wms\/carrelli\/[^/]+$/)) return wmsCartSnapshot(decodeURIComponent(path.split("/")[3]));
    if (path === "/wms/bags/storico") return listWmsBagHistory();
    if (path === "/wms/bags/pdf" && config.responseType === "blob") return wmsBagsPdf();
    if (path === "/wms/packing/etichetta-test" && config.responseType === "blob") return ok(generateTestShippingLabelPdfBlob(params.get("carrier") || "gls"));
    if (path.match(/^\/wms\/packing\/bag\/B-[A-Z0-9]{5}\/etichette$/) && config.responseType === "blob") return wmsPackingCarrierLabelsPdf(path.split("/")[4]);
    if (path.match(/^\/wms\/packing\/bag\/B-[A-Z0-9]{5}$/)) return wmsBagPackingSnapshot(path.split("/")[4]);
    if (path.match(/^\/wms\/picking\/[^/]+$/)) return wmsPickSnapshot(path.split("/")[3]);
    if (path.match(/^\/wms\/packing\/[^/]+$/)) return wmsPackingSnapshot(path.split("/")[3]);
    if (path === "/wms/inventario") return listWmsInventory();
    if (path.match(/^\/wms\/inventario\/[^/]+$/)) return inventorySessionSnapshot(path.split("/")[3]);
    if (path.match(/^\/wms\/inbound\/[^/]+$/)) return getWmsInbound(path.split("/")[3]);
    if (path.startsWith("/preparazioni/")) return getPreparazione(path.split("/")[2]);
    if (path === "/magazzino") return magazzino(params);
    if (path === "/magazzino/movimenti") return magazzinoMovimenti(params);
    if (path === "/preparato") return preparato(params);
    if (path === "/dashboard/stats") return dashboardStats();
    if (path === "/etichette/formati") return ok({ formati: ["40x20", "50x30", "60x30", "100x50"] });
    if (path === "/fatturazione") return fatturazione(params);
    if (path === "/fatturazione/pdf" && config.responseType === "blob") {
      const fattura = await fatturazione(params);
      return ok(invoicePdfBlob(fattura.data));
    }
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async post(url, payload, config = {}) {
    const { path } = pathAndQuery(url);
    if (path === "/clienti") return createCliente(payload);
    if (path.match(/^\/clienti\/[^/]+\/carrier-rates\/import$/)) return importClientCarrierRates(path.split("/")[2], payload);
    if (path.match(/^\/clienti\/[^/]+\/carrier-rates\/replace$/)) return replaceClientCarrierRates(path.split("/")[2], payload);
    if (path === "/wms/operatori/manage") return manageWmsOperator(payload);
    if (path.match(/^\/clienti\/[^/]+\/password$/)) return resetClientePassword(path.split("/")[2], payload);
    if (path === "/shopify/import") return importShopify(payload);
    if (path === "/shopify/orders/import") return importShopifyOrders(payload);
    if (path === "/wms/ordini/import-csv") return importCsvWmsOrders(payload);
    if (path.match(/^\/wms\/orders\/[^/]+\/shipping-choice$/)) return confirmWmsShippingChoice(path.split("/")[3], payload);
    if (path === "/wms/rifornimenti") return replenishWmsSlot(payload);
    if (path === "/wms/order-gate/recheck") return recheckWmsOrderExceptions(payload);
    if (path.match(/^\/wms\/order-gate\/[^/]+\/evaluate$/)) return ok(await evaluateWmsOrderGate(path.split("/")[3], { force: Boolean(payload?.force) }));
    if (path === "/wms/stock/quantita") return adjustWmsLocationQuantity(payload);
    if (path === "/wms/stock/sposta") return moveWmsStockQuantity(payload);
    if (path === "/wms/stock/pallet-slot") return moveWmsPalletToSlot(payload);
    if (path === "/wms/stock/scambia") return swapWmsLocations(payload);
    if (path === "/wms/stock/home-catalog-reset") return resetWmsHomeStockCatalog();
    if (path === "/wms/bags/svuota") return emptyAllWmsBags();
    if (path === "/wms/bags/genera") return generateWmsBags(payload);
    if (path === "/wms/bags/segna-stampate") return markWmsBagLabelsPrinted(payload);
    if (path === "/wms/carrelli/scansiona") return scanWmsCart(payload);
    if (path.match(/^\/wms\/carrelli\/[^/]+\/bag$/)) return assignWmsCartBag(decodeURIComponent(path.split("/")[3]), payload);
    if (path.match(/^\/wms\/carrelli\/[^/]+\/rimuovi-bag$/)) return removeWmsCartBag(decodeURIComponent(path.split("/")[3]), payload);
    if (path === "/wms/picking-massivo/avvia") return startWmsMassPicking(payload);
    if (path.match(/^\/wms\/picking-massivo\/[^/]+\/scan$/)) return scanWmsMassPicking(path.split("/")[3], payload);
    if (path === "/wms/picking-galluse/avvia") return startWmsGallusePicking(payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/bag$/)) return assignWmsGalluseBag(path.split("/")[3], payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/scan$/)) return scanWmsGallusePicking(path.split("/")[3], payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/annulla$/)) return cancelWmsGallusePicking(path.split("/")[3]);
    if (path === "/wms/picking-galluse/demo-a-i") return resetGalluseAiDemo();
    if (path === "/wms/packing/station/scan") return scanWmsPackingStation(payload);
    if (path === "/wms/packaging/stock") return setWmsPackagingStock(payload);
    if (path === "/shopify/oauth/start") return startShopifyOAuth(payload);
    if (path === "/shippypro/label") return createShippyProLabel(payload);
    if (path === "/shippypro/carriers") return listShippyProCarriers(payload);
    if (path === "/wms/spedizioni") return createWmsShipment(payload);
    if (path === "/wms/tickets") return createSupportTicket(payload);
    if (path.match(/^\/wms\/tickets\/[^/]+\/messages$/)) return createSupportMessage(path.split("/")[3], payload);
    if (path === "/wms/ubicazioni") return createWmsLocation(payload);
    if (path === "/wms/ubicazioni/genera") return generateWmsLocations(payload);
    if (path === "/wms/inventario/avvia") return startWmsInventory(payload);
    if (path.match(/^\/wms\/inventario\/[^/]+\/conteggio$/)) return updateWmsInventoryCount(path.split("/")[3], payload);
    if (path.match(/^\/wms\/inventario\/[^/]+\/completa$/)) return completeWmsInventory(path.split("/")[3], payload);
    if (path.match(/^\/wms\/inventario\/[^/]+\/annulla$/)) return cancelWmsInventory(path.split("/")[3]);
    if (path.match(/^\/wms\/inbound\/[^/]+\/avvia$/)) return startWmsInbound(path.split("/")[3], payload);
    if (path.match(/^\/wms\/inbound\/[^/]+\/movimenti$/)) return addWmsInboundMovement(path.split("/")[3], payload);
    if (path.match(/^\/wms\/inbound\/[^/]+\/completa$/)) return completeWmsInbound(path.split("/")[3], payload);
    if (path.match(/^\/wms\/picking\/[^/]+\/avvia$/)) return startWmsPicking(path.split("/")[3]);
    if (path.match(/^\/wms\/picking\/[^/]+\/scan$/)) return scanWmsPicking(path.split("/")[3], payload);
    if (path.match(/^\/wms\/packing\/[^/]+\/avvia$/)) return startWmsPacking(path.split("/")[3], payload);
    if (path.match(/^\/wms\/packing\/[^/]+\/scan$/)) return scanWmsPacking(path.split("/")[3], payload);
    if (path.match(/^\/wms\/packing\/[^/]+\/completa$/)) return completeWmsPacking(path.split("/")[3]);
    if (path === "/referenze") return createReferenza(payload);
    if (path === "/referenze/import") return importReferenze(payload);
    if (path.match(/^\/referenze\/[^/]+\/foto$/)) return uploadReferenzaFoto(path.split("/")[2], payload);
    if (path.match(/^\/entrate\/[^/]+\/documento$/)) return uploadEntrataDocumento(path.split("/")[2], payload);
    if (path === "/entrate") return createEntrata(payload);
    if (path === "/entrate-righe") return createEntrataRiga(payload);
    if (path.match(/^\/entrate\/[^/]+\/ricevi$/)) return riceviEntrata(path.split("/")[2], payload);
    if (path === "/box") return createBox(payload);
    if (path === "/box/etichette-gruppo") return uploadBoxLabelsGroup(payload);
    if (path.match(/^\/box\/[^/]+\/etichette$/)) return uploadBoxLabel(path.split("/")[2], "combined", payload);
    if (path.match(/^\/box\/[^/]+\/etichetta-(amazon|ups)$/)) {
      const [, id, tipo] = path.match(/^\/box\/([^/]+)\/etichetta-(amazon|ups)$/);
      return uploadBoxLabel(id, tipo, payload);
    }
    if (path === "/preparazioni") return createPreparazione(payload);
    if (path === "/preparazioni-righe") return createPreparazioneRiga(payload);
    if (path.match(/^\/preparazioni-righe\/[^/]+\/mancanza$/)) return declarePreparazioneShortage(path.split("/")[2], payload);
    if (path === "/etichette/genera" && config.responseType === "blob") return ok(generateLabelsPdfBlob(payload));
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async put(url, payload) {
    const { path } = pathAndQuery(url);
    if (path.match(/^\/clienti\/[^/]+$/)) return updateCliente(path.split("/")[2], payload);
    if (path.match(/^\/referenze\/[^/]+$/)) return updateReferenza(path.split("/")[2], payload);
    if (path.match(/^\/entrate\/[^/]+$/)) return updateEntrata(path.split("/")[2], payload);
    if (path.match(/^\/entrate-righe\/[^/]+$/)) return updateEntrataRiga(path.split("/")[2], payload);
    if (path.match(/^\/box\/[^/]+\/stato$/)) return updateBoxStato(path.split("/")[2], payload.stato);
    if (path.match(/^\/box\/[^/]+$/)) return updateBox(path.split("/")[2], payload);
    if (path.match(/^\/preparazioni\/[^/]+\/stato$/)) return updatePreparazioneStato(path.split("/")[2], payload.stato);
    if (path.match(/^\/preparazioni\/[^/]+\/righe-stato$/)) return updatePreparazioneRigheStato(path.split("/")[2], payload);
    if (path.match(/^\/preparazioni\/[^/]+$/)) return updatePreparazione(path.split("/")[2], payload);
    if (path.match(/^\/preparazioni-righe\/[^/]+$/)) return updatePreparazioneRiga(path.split("/")[2], payload);
    if (path.match(/^\/shopify\/orders\/[^/]+\/stato$/)) return updateShopifyOrderStatus(path.split("/")[3], payload);
    if (path.match(/^\/shopify\/orders\/[^/]+$/)) return updateClientOrder(path.split("/")[3], payload);
    if (path.match(/^\/wms\/spedizioni\/[^/]+$/)) return updateWmsShipment(path.split("/")[3], payload);
    if (path.match(/^\/wms\/tickets\/[^/]+$/)) return updateSupportTicket(path.split("/")[3], payload);
    if (path === "/wms/mappa") return updateWmsWarehouseMap(payload);
    if (path === "/wms/configurazione") return updateWmsSettings(payload);
    if (path.match(/^\/wms\/carrelli\/[^/]+$/)) return updateWmsCart(decodeURIComponent(path.split("/")[3]), payload);
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async delete(url) {
    const { path } = pathAndQuery(url);
    if (path.match(/^\/entrate\/[^/]+$/)) return deleteEntrata(path.split("/")[2]);
    if (path.match(/^\/entrate-righe\/[^/]+$/)) return deleteEntrataRiga(path.split("/")[2]);
    if (path.match(/^\/box\/[^/]+$/)) return deleteBox(path.split("/")[2]);
    if (path.match(/^\/preparazioni\/[^/]+$/)) return deletePreparazione(path.split("/")[2]);
    if (path.match(/^\/preparazioni-righe\/[^/]+$/)) return deletePreparazioneRiga(path.split("/")[2]);
    if (path.match(/^\/referenze\/[^/]+$/)) return deleteReferenza(path.split("/")[2]);
    if (path.match(/^\/wms\/inbound\/movimenti\/[^/]+$/)) return deleteWmsInboundMovement(path.split("/")[4]);
    fail(`Endpoint non migrato: ${path}`, 404);
  },
};

export function fileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase?.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || path;
}

export function formatApiError(detail) {
  if (detail == null) return "Si è verificato un errore. Riprova.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

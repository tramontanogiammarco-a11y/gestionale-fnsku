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
    .select("id,email,name,role,cliente_id")
    .eq("id", user.id)
    .single();
  if (error || !data) fail("Profilo utente non trovato", 401);
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
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
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
  };
  if (!columns.ean && !columns.titolo) fail("Serve almeno una colonna Titolo o EAN.");

  const cid = await resolveClienteId(clienteId || undefined);
  const rows = parsed.data.map((source) => {
    const value = (field) => columns[field] ? optionalText(source[columns[field]]) : null;
    const ean = value("ean");
    const titolo = value("titolo");
    return {
      cliente_id: cid,
      ean,
      sku: value("sku"),
      asin: value("asin"),
      titolo: titolo || ean,
      fnsku: value("fnsku"),
      origine: "import",
    };
  }).filter((r) => r.titolo);

  const { data: existingRows, error: existingError } = await requireSupabase()
    .from("referenze")
    .select("id,ean,sku,asin,titolo,fnsku")
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
      };
      const changed = Object.entries(patch).some(([key, value]) => optionalText(value) !== optionalText(existing[key]));
      if (changed) {
        const { data: saved, error } = await requireSupabase()
          .from("referenze")
          .update(patch)
          .eq("id", existing.id)
          .select("id,ean,sku,asin,titolo,fnsku")
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
      .select("id,ean,sku,asin,titolo,fnsku")
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
  "Piatti piani ceramica bianca",
  "Piatti fondi porcellana",
  "Piatti dessert set 6 pezzi",
  "Bicchieri acqua vetro",
  "Calici vino trasparenti",
  "Tazze caffe espresso",
  "Tazze colazione ceramica",
  "Set posate acciaio inox",
  "Coltelli cucina inox",
  "Tagliere bambu",
  "Padella antiaderente 28 cm",
  "Pentola acciaio inox",
  "Casseruola con coperchio",
  "Scolapasta inox",
  "Mestoli cucina silicone",
  "Frusta cucina acciaio",
  "Pelapatate inox",
  "Apriscatole manuale",
  "Barattoli vetro ermetici",
  "Contenitori alimentari",
  "Bottiglia olio vetro",
  "Organizer spezie cucina",
  "Portaposate cassetto",
  "Tovaglioli cotone",
  "Strofinacci cucina",
  "Canovacci microfibra",
  "Spugne piatti antigraffio",
  "Detersivo piatti concentrato",
  "Sacchetti freezer richiudibili",
  "Rotoli alluminio cucina",
  "Pellicola trasparente cucina",
  "Carta forno antiaderente",
  "Cestino bagno",
  "Portasapone ceramica",
  "Dispenser sapone liquido",
  "Asciugamani viso cotone",
  "Tappeto bagno antiscivolo",
  "Scopino WC con supporto",
  "Portarotolo carta igienica",
  "Organizer doccia",
  "Appendini guardaroba",
  "Scatole armadio tessuto",
  "Ceste bucato pieghevoli",
  "Molle bucato acciaio",
  "Stendino balcone",
  "Panni microfibra multiuso",
  "Secchio mop con strizzatore",
  "Spruzzino detergente vuoto",
  "Lampadine LED E27",
  "Multipresa elettrica sicurezza",
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

async function getWmsWarehouseMap() {
  await assertWmsStaff();
  const [stockResponse, { data: settings, error: settingsError }] = await Promise.all([
    wmsStock(new URLSearchParams()),
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
  if (locations.length > 250) fail("Puoi aggiornare al massimo 250 ubicazioni alla volta");

  const updates = locations.map((location) => {
    const id = optionalText(location.id);
    if (!id) fail("Ubicazione senza identificativo");
    const mapX = finiteMapNumber(location.map_x, "Coordinata X");
    const mapZ = finiteMapNumber(location.map_z, "Coordinata Z");
    const mapRotation = finiteMapNumber(location.map_rotation || 0, "Rotazione");
    const accessSide = optionalText(location.access_side) || "front";
    if (!["front", "back", "left", "right"].includes(accessSide)) fail("Lato di prelievo non valido");
    if (Math.abs(mapX) > 50 || Math.abs(mapZ) > 50) fail("Le ubicazioni devono restare entro 50 metri dal centro");
    return requireSupabase()
      .from("wms_locations")
      .update({ map_x: mapX, map_z: mapZ, map_rotation: mapRotation, access_side: accessSide, map_updated_at: nowIso() })
      .eq("id", id);
  });

  const results = await Promise.all(updates);
  const locationError = results.find((result) => result.error)?.error;
  if (locationError) fail(locationError.message);

  if (payload.map) {
    const width = finiteMapNumber(payload.map.width, "Larghezza mappa");
    const depth = finiteMapNumber(payload.map.depth, "Profondita mappa");
    const entranceX = finiteMapNumber(payload.map.entrance_x, "Ingresso X");
    const entranceZ = finiteMapNumber(payload.map.entrance_z, "Ingresso Z");
    if (width < 10 || width > 100 || depth < 10 || depth > 100) {
      fail("La mappa deve misurare tra 10 e 100 metri");
    }
    const aisles = normalizeAisles(payload.map.aisles);
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
  let query = requireSupabase().from("shopify_orders").select("*").order("processed_at", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  if (params.get("wms_status")) query = query.eq("wms_status", params.get("wms_status"));
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(await enrichShopifyOrders(data || []));
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
  await assertWmsStaff();
  const clienteId = String(payload.cliente_id || "").trim();
  if (!clienteId) fail("Seleziona il cliente degli ordini CSV");
  if (!Array.isArray(payload.rows) || !payload.rows.length) fail("Il file CSV non contiene righe");

  const normalized = normalizeCsvOrders(payload.rows);
  const { data: references, error: referencesError } = await requireSupabase()
    .from("referenze")
    .select("id,titolo,ean,sku,fnsku")
    .eq("cliente_id", clienteId);
  if (referencesError) fail(referencesError.message);

  const byEan = new Map();
  const bySku = new Map();
  const byFnsku = new Map();
  for (const reference of references || []) {
    if (normalizedText(reference.ean)) byEan.set(normalizedText(reference.ean), reference);
    if (normalizedText(reference.sku)) bySku.set(normalizedText(reference.sku), reference);
    if (normalizedText(reference.fnsku)) byFnsku.set(normalizedText(reference.fnsku), reference);
  }

  const orders = normalized.orders.map((order) => {
    const items = order.items.map((item) => {
      const reference = byEan.get(normalizedText(item.ean))
        || bySku.get(normalizedText(item.sku))
        || byFnsku.get(normalizedText(item.fnsku))
        || null;
      return {
        ...item,
        reference,
        title: item.title || reference?.titolo || item.ean || item.sku || item.fnsku,
      };
    });
    return {
      ...order,
      items,
      pieces: items.reduce((sum, item) => sum + item.quantity, 0),
      unmatched: items.filter((item) => !item.reference).length,
    };
  });

  const preview = {
    valid: normalized.errors.length === 0 && orders.length > 0,
    errors: normalized.errors,
    orders: orders.map((order) => ({
      order_number: order.order_number,
      rows: order.items.length,
      pieces: order.pieces,
      unmatched: order.unmatched,
      destination: [order.zip, order.city].filter(Boolean).join(" "),
    })),
    totals: {
      orders: orders.length,
      rows: orders.reduce((sum, order) => sum + order.items.length, 0),
      pieces: orders.reduce((sum, order) => sum + order.pieces, 0),
      unmatched: orders.reduce((sum, order) => sum + order.unmatched, 0),
    },
  };

  if (payload.dry_run !== false) return ok(preview);
  if (!preview.valid) fail("Correggi gli errori del CSV prima di importare");

  const identifiers = orders.map((order) => csvOrderIdentifier(order.order_number));
  const { data: existingOrders, error: existingError } = await requireSupabase()
    .from("shopify_orders")
    .select("id,shopify_order_id,wms_status,order_name")
    .eq("cliente_id", clienteId)
    .eq("shop_domain", "csv-import")
    .in("shopify_order_id", identifiers);
  if (existingError) fail(existingError.message);
  const existingByIdentifier = new Map((existingOrders || []).map((order) => [order.shopify_order_id, order]));
  const locked = (existingOrders || []).filter((order) => order.wms_status !== "da_preparare");
  if (locked.length) {
    fail(`Non posso aggiornare ${locked.map((order) => order.order_name).join(", ")}: picking gia avviato.`);
  }

  let imported = 0;
  for (const order of orders) {
    const identifier = csvOrderIdentifier(order.order_number);
    const existing = existingByIdentifier.get(identifier);
    const orderRow = {
      cliente_id: clienteId,
      shop_domain: "csv-import",
      shopify_order_id: identifier,
      order_name: order.order_number,
      financial_status: "csv",
      fulfillment_status: "unfulfilled",
      wms_status: "da_preparare",
      processed_at: csvDateOrNow(order.processed_at),
      note: order.note || null,
      customer_email: order.email || null,
      customer_phone: order.phone || null,
      ship_name: order.recipient || null,
      ship_company: order.company || null,
      ship_address1: order.address1 || null,
      ship_address2: order.address2 || null,
      ship_zip: order.zip || null,
      ship_city: order.city || null,
      ship_province: order.province || null,
      ship_country: order.country || null,
      ship_country_code: order.country_code || null,
      raw: { source: "csv", imported_at: nowIso() },
      updated_at: nowIso(),
    };

    let savedOrder;
    if (existing) {
      const { data, error } = await requireSupabase().from("shopify_orders").update(orderRow).eq("id", existing.id).select().single();
      if (error) fail(error.message);
      savedOrder = data;
      const { error: deleteError } = await requireSupabase().from("shopify_order_items").delete().eq("order_id", existing.id);
      if (deleteError) fail(deleteError.message);
    } else {
      const { data, error } = await requireSupabase().from("shopify_orders").insert(orderRow).select().single();
      if (error) fail(error.message);
      savedOrder = data;
    }

    const itemRows = order.items.map((item, index) => ({
      order_id: savedOrder.id,
      shopify_line_item_id: csvItemIdentifier(item, index),
      referenza_id: item.reference?.id || null,
      sku: item.sku || item.reference?.sku || null,
      ean: item.ean || item.reference?.ean || null,
      titolo: item.title,
      quantita: item.quantity,
      fulfillable_quantity: item.quantity,
      fulfillment_status: null,
      raw: { source: "csv", source_row: item.source_row, fnsku: item.fnsku || null },
      updated_at: nowIso(),
    }));
    const { error: itemsError } = await requireSupabase().from("shopify_order_items").insert(itemRows);
    if (itemsError) fail(itemsError.message);
    imported += 1;
  }

  return ok({ ...preview, imported });
}

async function enrichShopifyOrders(orders) {
  const ids = orders.map((order) => order.id);
  const { data: items, error: itemsError } = ids.length
    ? await supabase.from("shopify_order_items").select("*").in("order_id", ids)
    : { data: [], error: null };
  if (itemsError) fail(itemsError.message);
  const cmap = await clientiMap(orders.map((order) => order.cliente_id));
  const byOrder = {};
  for (const item of items || []) {
    byOrder[item.order_id] = byOrder[item.order_id] || [];
    byOrder[item.order_id].push(item);
  }
  return orders.map((order) => ({
    ...order,
    items: byOrder[order.id] || [],
    cliente_ragione_sociale: cmap[order.cliente_id]?.ragione_sociale || null,
  }));
}

async function updateShopifyOrderStatus(id, payload = {}) {
  const profile = await currentProfile();
  if (!isStaff(profile)) fail("Accesso riservato allo staff", 403);

  const allowed = ["da_preparare", "in_preparazione", "pronto", "spedito", "annullato"];
  const stato = optionalText(payload.wms_status || payload.stato);
  if (!allowed.includes(stato)) fail("Stato ordine WMS non valido");

  const { data: order, error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .select("id,wms_status")
    .eq("id", id)
    .single();
  if (orderError || !order) fail(orderError?.message || "Ordine WMS non trovato", 404);

  if (["in_preparazione", "pronto"].includes(stato)) {
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

async function listWmsShipments(params) {
  let query = requireSupabase().from("wms_shipments").select("*").order("created_at", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
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
    corriere: payload.corriere || "manuale",
    servizio: payload.servizio || null,
    stato: "bozza",
    colli: Math.max(1, Number(payload.colli || 1)),
    peso_kg: payload.peso_kg ? Number(payload.peso_kg) : null,
    destinatario,
    payload: {
      origine: "ordine_wms",
      order_name: order.order_name,
      shop_domain: order.shop_domain,
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
  } = await stockSnapshotForCliente(cid);
  const bundleEans = new Set(Object.keys(bundleMap));
  const usageEans = new Set([...Object.keys(ricevuto), ...Object.keys(spedito), ...Object.keys(inPreparazione)]);
  const activeFnskus = new Set(
    [...usageEans, ...(activeOperationalEans || [])]
      .map((ean) => fnskuMap[ean])
      .filter(Boolean)
  );
  const componentDisponibile = {};
  const eans = [...new Set([...Object.keys(titoloMap), ...Object.keys(ricevuto), ...Object.keys(spedito), ...Object.keys(inPreparazione)])]
    .filter((ean) => !bundleEans.has(ean))
    .filter((ean) => usageEans.has(ean) || !activeFnskus.has(fnskuMap[ean]))
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

async function wmsStock(params) {
  await assertWmsStaff();
  const requestedClientId = optionalText(params.get("cliente_id"));
  const { data: allClients, error: clientsError } = await requireSupabase()
    .from("clienti")
    .select("id,ragione_sociale")
    .order("ragione_sociale", { ascending: true });
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
  ] = await Promise.all([
    requireSupabase().from("wms_locations").select("*").order("codice", { ascending: true }),
    requireSupabase().from("wms_inbound_movements").select("*").eq("disposizione", "disponibile").order("created_at", { ascending: false }),
    requireSupabase().from("entrate_righe").select("id,entrata_id,ean,fnsku"),
    clientIds.length
      ? requireSupabase().from("entrate").select("id,cliente_id").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? requireSupabase().from("referenze").select("cliente_id,ean,sku,fnsku,titolo").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    requireSupabase().from("wms_inventory_sessions").select("id").eq("stato", "completata"),
    clientIds.length
      ? requireSupabase().from("wms_outbound_movements").select("*").in("cliente_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? requireSupabase().from("wms_stock_transfers").select("*").in("cliente_id", clientIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = locationsError || movementsError || rowsError || entriesError || referencesError || inventorySessionsError || outboundMovementsError || stockTransfersError;
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
        cliente_id: client.id,
        cliente: client.ragione_sociale,
        ean: optionalText(row.ean),
        skus: [...new Set([...(row.skus || []), reference?.sku].map(optionalText).filter(Boolean))],
        fnsku: optionalText(row.fnsku),
        titolo: optionalText(row.titolo) || "Titolo non disponibile",
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
    if (!movementsByProduct.has(key)) movementsByProduct.set(key, []);
    movementsByProduct.get(key).push({
      ...movement,
      ean: row.ean || product.ean,
      fnsku: row.fnsku || product.fnsku,
      titolo: reference?.titolo || product.titolo,
    });
  }

  const locationContents = new Map();
  const inventoryDeltas = new Map();
  const outboundByProduct = new Map();
  const transfersByProduct = new Map();
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
      const location = (locations || []).find((item) => item.id === locationId);
      return { id: locationId, codice: location?.codice || "Ubicazione rimossa", tipo: location?.tipo || null, quantita };
    }).sort(naturalLocationSort);

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
    .order("processed_at", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  const { data, error } = await query;
  if (error) fail(error.message);

  const timezone = settings.timezone || DEFAULT_WMS_TIMEZONE;
  const cutoff = String(settings.cutoff_time || DEFAULT_WMS_CUTOFF).slice(0, 5);
  const nowParts = zonedDateParts(new Date(), timezone);
  const today = dateKeyFromParts(nowParts);
  const tomorrow = addDaysToDateKey(today, 1);
  const enriched = await enrichShopifyOrders(data || []);
  const active = enriched.filter((order) => !["spedito", "annullato"].includes(order.wms_status));
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

async function wmsPickingPlan(order, items) {
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
  const locationMap = Object.fromEntries(allLocations.map((location) => [location.id, location]));
  const availableEmptySlots = allLocations
    .filter((location) => location.tipo === "slot" && location.stato === "attiva" && !location.occupata)
    .sort(naturalLocationSort);
  const usedSuggestedSlots = new Set();
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
    const slotLocations = (product.ubicazioni || []).filter((location) => location.tipo === "slot").map((location) => {
      const key = `${location.id}:${productKey}`;
      return { ...location, available: Math.max(0, Number(location.quantita || 0) - Number(reserved.get(key) || 0)) };
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
        .map((location) => ({ id: location.id, codice: location.codice, quantita: Number(location.quantita || 0) }));
      const palletAvailable = palletSources.reduce((sum, location) => sum + location.quantita, 0);
      const suggestedSlot = availableEmptySlots.find((location) => !usedSuggestedSlots.has(location.id)) || null;
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

  return { ready: errors.length === 0 && replenishment.length === 0, allocations, replenishment, errors, locationMap, mapSettings: { ...mapSettings, obstacles: allLocations } };
}

async function replenishWmsSlot(payload = {}) {
  const profile = await assertWmsStaff();
  const clienteId = optionalText(payload.cliente_id);
  const productKey = optionalText(payload.product_key);
  const targetLocationId = optionalText(payload.target_location_id);
  const quantity = Math.floor(Number(payload.quantita || 0));
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
  return ok({ moved: quantity, target: target.codice, sources: transfers.length });
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
  const rows = (lines || []).map((line) => ({ ...line, location: locationMap[line.location_id] || null }));
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
  if (!/^B-[0-9]{5}$/.test(code)) fail("Scansiona una bag nel formato B-12345.");
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
  const rows = (lines || []).map((line) => ({ ...line, location: locationMap[line.location_id] || null }));
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
  const route = calculateWarehouseRoute(uniqueLocations, plan.mapSettings);
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

function galluseFixedCartRound(candidates = []) {
  const byClient = new Map();
  for (const order of candidates || []) {
    const current = byClient.get(order.cliente_id) || [];
    current.push(order);
    byClient.set(order.cliente_id, current);
  }
  const [clientId, clientOrders] = [...byClient.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0] || [];
  const firstOrder = clientOrders?.[0];
  if (!clientId || !firstOrder || clientOrders.length < 10) return [];
  const orders = clientOrders.slice(0, 10);
  return [{
    id: `fixed-cart:${firstOrder.cliente_id}`,
    cliente_id: firstOrder.cliente_id,
    cliente: firstOrder.cliente_ragione_sociale || "Cliente",
    numero: 1,
    totale_ordini: clientOrders.length,
    numero_compiti: Math.ceil(clientOrders.length / 10),
    offset: 0,
    orders,
    numero_ordini: orders.length,
    pezzi: orders.reduce((sum, order) => sum + (order.items || []).reduce((inner, item) => inner + Number(item.quantita || 0), 0), 0),
    referenze: new Set(orders.flatMap((order) => (order.items || []).map((item) => item.referenza_id))).size,
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
    rounds: galluseFixedCartRound(candidates),
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
  const rows = (lines || []).map((line) => ({
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

async function wmsGalluseFixedCart(numberOfBags) {
  const { data: positions, error: positionsError } = await requireSupabase()
    .from("wms_galluse_cart_positions")
    .select("*")
    .order("posizione");
  if (positionsError) fail(positionsError.message);
  const cart = (positions || []).slice(0, numberOfBags);
  if (cart.length < numberOfBags) fail("Configura prima tutte le bag fisse del carrello Galluse.", 409);
  const { data: bags, error: bagsError } = await requireSupabase()
    .from("wms_bags")
    .select("id,codice,stato")
    .in("id", cart.map((position) => position.bag_id));
  if (bagsError) fail(bagsError.message);
  const bagMap = Object.fromEntries((bags || []).map((bag) => [bag.id, bag]));
  const missing = cart.filter((position) => !bagMap[position.bag_id]);
  if (missing.length) fail("Una bag fissa del carrello non esiste piu.", 409);
  const busy = cart.filter((position) => bagMap[position.bag_id].stato !== "disponibile");
  if (busy.length) fail(`Le bag ${busy.map((position) => position.bag_code).join(", ")} sono ancora occupate al packing.`, 409);
  return cart.map((position) => ({ ...position, bag: bagMap[position.bag_id] }));
}

async function startWmsGallusePicking(payload = {}) {
  const profile = await assertWmsStaff();
  const requestedClientId = optionalText(payload.cliente_id);
  const operational = await wmsOperationalOrdersData(new URLSearchParams(requestedClientId ? { cliente_id: requestedClientId } : {}));
  const candidates = galluseCandidateOrders(operational.orders);
  const clientId = requestedClientId || candidates[0]?.cliente_id;
  const { data: activeBatches, error: activeBatchesError } = await requireSupabase()
    .from("wms_galluse_batches")
    .select("id")
    .in("stato", ["da_associare_bag", "in_corso"]);
  if (activeBatchesError) fail(activeBatchesError.message);
  if ((activeBatches || []).length) fail("Completa prima il carrello Galluse gia in corso.", 409);
  const orders = candidates.filter((order) => order.cliente_id === clientId).slice(0, 10);
  if (!clientId || orders.length < 10) fail("Il carrello Galluse parte solo con 10 ordini completi.", 409);
  const combinedItems = orders.flatMap((order) => (order.items || []).map((item) => ({ ...item, galluse_order_id: order.id })));
  const itemOrderMap = Object.fromEntries(combinedItems.map((item) => [item.id, item.galluse_order_id]));
  const plan = await wmsPickingPlan({ cliente_id: clientId }, combinedItems);
  if (plan.errors.length) fail(plan.errors.join(" "));
  if (plan.replenishment.length) fail(`Rifornisci prima gli slot per ${plan.replenishment.length} ${plan.replenishment.length === 1 ? "prodotto" : "prodotti"}.`);
  const uniqueLocations = [...new Set(plan.allocations.map((allocation) => allocation.location_id))].map((id) => plan.locationMap[id]).filter(Boolean);
  const route = calculateWarehouseRoute(uniqueLocations, plan.mapSettings);
  if (route.unreachable?.length) fail(`Mappa bloccata: ${route.unreachable.map((location) => location.codice).join(", ")} non e raggiungibile.`);
  const cart = await wmsGalluseFixedCart(orders.length);
  const { data: batch, error: batchError } = await requireSupabase().from("wms_galluse_batches").insert({
    cliente_id: clientId,
    stato: "da_associare_bag",
    numero_bag: orders.length,
    operatore_id: profile.id,
  }).select().single();
  if (batchError || !batch) fail(batchError?.message || "Missione Metodo Galluse non creata");
  const { data: reservedBags, error: reserveError } = await requireSupabase()
    .from("wms_bags")
    .update({ stato: "in_packing", updated_at: nowIso() })
    .in("id", cart.map((position) => position.bag_id))
    .eq("stato", "disponibile")
    .select("id");
  if (reserveError || (reservedBags || []).length !== cart.length) {
    await requireSupabase().from("wms_galluse_batches").delete().eq("id", batch.id);
    fail(reserveError?.message || "Una bag del carrello e stata occupata da un altro flusso. Riprova.", 409);
  }
  const { data: links, error: linksError } = await requireSupabase().from("wms_galluse_orders").insert(orders.map((order, index) => ({
    batch_id: batch.id,
    order_id: order.id,
    posizione_bag: index + 1,
    bag_id: cart[index].bag_id,
    bag_code: cart[index].bag_code,
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
  const { error: statusError } = await requireSupabase().from("shopify_orders").update({ wms_status: "in_preparazione", updated_at: nowIso() }).in("id", orders.map((order) => order.id));
  if (statusError) fail(statusError.message);
  return wmsGalluseSnapshot(batch.id);
}

async function assignWmsGalluseBag(batchId, payload = {}) {
  await assertWmsStaff();
  const position = Math.floor(Number(payload.posizione_bag || 0));
  const code = String(payload.codice || payload.code || "").trim().toUpperCase();
  if (position < 1 || !/^B-[0-9]{5}$/.test(code)) fail("Scansiona una bag valida per la posizione indicata.");
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
    const expectedCartCode = normalizedText("CARRELLO-01");
    if (!code || code !== expectedCartCode) fail("Scansiona il codice master CARRELLO-01.");
    const startedAt = nowIso();
    const { error } = await requireSupabase().from("wms_galluse_batches")
      .update({ stato: "in_corso", started_at: startedAt, updated_at: startedAt })
      .eq("id", batchId);
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
  cleanupSteps.push(requireSupabase().from("wms_stock_transfers").delete().eq("cliente_id", demoClient.id));
  cleanupSteps.push(requireSupabase().from("wms_mass_pick_batches").delete().in("bag_code", cartBagCodes));
  cleanupSteps.push(requireSupabase().from("wms_mass_pick_batches").delete().eq("cliente_id", demoClient.id));
  cleanupSteps.push(requireSupabase().from("wms_galluse_batches").delete().eq("cliente_id", demoClient.id));
  if (demoOrderIds.length) cleanupSteps.push(requireSupabase().from("shopify_orders").delete().in("id", demoOrderIds));
  cleanupSteps.push(requireSupabase().from("entrate").delete().eq("cliente_id", demoClient.id));
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

  const referenceCatalog = [
    "Piatti piani bianchi",
    "Piatti fondi cucina",
    "Bicchieri acqua trasparenti",
    "Bicchieri vino calice",
    "Tazze caffe ceramica",
    "Set posate acciaio",
    "Tovaglioli cotone",
    "Padella antiaderente",
    "Pentola acciaio",
    "Scolapasta cucina",
    "Tagliere legno",
    "Barattoli vetro",
    "Strofinacci cucina",
  ].map((titolo, index) => ({
    cliente_id: demoClient.id,
    titolo,
    ean: `CASA-EAN-${String(index + 1).padStart(3, "0")}`,
    sku: `CASA-SKU-${String(index + 1).padStart(3, "0")}`,
    fnsku: `CASA-FNSKU-${String(index + 1).padStart(3, "0")}`,
    origine: "wms-galluse-casa",
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
  if (Object.keys(referencesByNumber).length < 13) fail("Non sono disponibili tutte le 13 referenze demo.", 409);

  const [{ data: locations, error: locationsError }, { data: movements, error: movementsError }] = await Promise.all([
    requireSupabase().from("wms_locations").select("id,codice,tipo,stato").eq("tipo", "slot").eq("stato", "attiva"),
    requireSupabase().from("wms_inbound_movements").select("location_id").eq("disposizione", "disponibile"),
  ]);
  if (locationsError || movementsError) fail((locationsError || movementsError).message);
  const occupiedLocationIds = new Set((movements || []).map((movement) => movement.location_id).filter(Boolean));
  const freeSlots = (locations || [])
    .filter((location) => !occupiedLocationIds.has(location.id))
    .sort(naturalLocationSort);
  const targetSlots = spreadLocations(freeSlots, 13);
  if (targetSlots.length < 13) fail("Servono 13 slot liberi per creare la prova packing.", 409);

  const { data: entry, error: entryError } = await requireSupabase().from("entrate").insert({
    cliente_id: demoClient.id,
    tipo: "pallet",
    colli: 13,
    ddt: "WMS-GALLUSE-PACK-022",
    corriere: "Demo",
    tracking: "WMS-GALLUSE-PACK-022",
    stato: "ricevuto",
    data_annuncio: nowIso(),
    data_ricezione: nowIso(),
    note: "Fixture packing sparpagliata: 10 ordini, 13 referenze, 22 pezzi totali",
  }).select().single();
  if (entryError || !entry) fail(entryError?.message || "Entrata demo packing non creata");

  const { data: session, error: sessionError } = await requireSupabase().from("wms_inbound_sessions").insert({
    entrata_id: entry.id,
    stato: "completata",
    operatore_id: profile.id,
    started_at: nowIso(),
    completed_at: nowIso(),
    note: "Stock fixture packing 22 pezzi",
  }).select().single();
  if (sessionError || !session) fail(sessionError?.message || "Sessione stock demo non creata");

  const entryRowsPayload = referenceCodes.map((code) => {
    const reference = referencesByNumber[Number(code.match(/(\d+)$/)?.[1] || 0)];
    return {
      entrata_id: entry.id,
      ean: reference.ean,
      fnsku: reference.fnsku,
      quantita: 30,
      quantita_ricevuta: 30,
    };
  });
  const { data: entryRows, error: entryRowsError } = await requireSupabase().from("entrate_righe").insert(entryRowsPayload).select("id,fnsku");
  if (entryRowsError) fail(entryRowsError.message);
  const { error: movementsInsertError } = await requireSupabase().from("wms_inbound_movements").insert((entryRows || []).map((row, index) => ({
    session_id: session.id,
    entrata_riga_id: row.id,
    location_id: targetSlots[index].id,
    disposizione: "disponibile",
    quantita: 30,
    codice_scansionato: targetSlots[index].codice,
    created_by: profile.id,
  })));
  if (movementsInsertError) fail(movementsInsertError.message);

  const orderPlan = [
    [{ ref: 1, qty: 2 }, { ref: 2, qty: 1 }],
    [{ ref: 3, qty: 1 }, { ref: 4, qty: 1 }],
    [{ ref: 5, qty: 1 }, { ref: 6, qty: 1 }, { ref: 7, qty: 1 }],
    [{ ref: 8, qty: 2 }],
    [{ ref: 9, qty: 1 }, { ref: 10, qty: 1 }],
    [{ ref: 11, qty: 2 }, { ref: 12, qty: 1 }],
    [{ ref: 13, qty: 1 }],
    [{ ref: 1, qty: 1 }, { ref: 5, qty: 1 }],
    [{ ref: 2, qty: 1 }, { ref: 8, qty: 1 }],
    [{ ref: 9, qty: 1 }, { ref: 13, qty: 1 }],
  ];
  const createdOrderIds = [];
  const now = Date.now();
  for (const [index, rows] of orderPlan.entries()) {
    const orderNumber = index + 1;
    const { data: order, error: orderInsertError } = await requireSupabase().from("shopify_orders").insert({
      cliente_id: demoClient.id,
      shop_domain: "wms-galluse-demo.aimago.local",
      shopify_order_id: `WMS-GALLUSE-PACK-${String(orderNumber).padStart(3, "0")}`,
      order_name: `#PACK-${String(orderNumber).padStart(3, "0")}`,
      financial_status: "paid",
      fulfillment_status: null,
      wms_status: "da_preparare",
      processed_at: new Date(now - index * 1000).toISOString(),
      raw: { source: "wms_galluse_demo", scenario: "packing-22", cart_position: orderNumber, reference_total: 13, units_total: 22 },
    }).select().single();
    if (orderInsertError || !order) fail(orderInsertError?.message || "Ordine demo packing non creato");
    createdOrderIds.push(order.id);

    const { error: itemsError } = await requireSupabase().from("shopify_order_items").insert(rows.map((row) => {
      const reference = referencesByNumber[row.ref];
      return {
        order_id: order.id,
        shopify_line_item_id: `WMS-GALLUSE-PACK-${String(orderNumber).padStart(3, "0")}-R${String(row.ref).padStart(3, "0")}`,
        referenza_id: reference.id,
        sku: reference.sku,
        ean: reference.ean,
        titolo: reference.titolo,
        quantita: row.qty,
        fulfillable_quantity: row.qty,
        fulfillment_status: null,
        raw: { source: "wms_galluse_demo", scenario: "packing-22", reference_number: row.ref },
      };
    }));
    if (itemsError) fail(itemsError.message);
  }

  return ok({
    created: createdOrderIds.length,
    cliente: demoClient.ragione_sociale,
    cart: "CARRELLO-01",
    bags: cartBagCodes,
    referenze: 13,
    pezzi: orderPlan.flat().reduce((sum, row) => sum + row.qty, 0),
    slots: targetSlots.map((slot) => slot.codice),
    scenario: "packing-22",
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
  if ((slots || []).length < 50) fail("Servono almeno 50 slot attivi per creare il catalogo casa.", 409);
  if ((pallets || []).length < 50) fail("Servono almeno 50 pallet attivi per creare l'overstock casa.", 409);

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
      note: "Stock iniziale casa: 50 referenze, 30 pezzi in slot e 100 pezzi in overstock pallet",
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
      note: "Seed stock casa: slot + overstock pallet",
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

  const targetSlots = shuffledLocations(slots || [], "home-slot-20260828", 50);
  const targetPallets = shuffledLocations(pallets || [], "home-pallet-20260828", 50);
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
  const route = calculateWarehouseRoute(uniqueLocations, mapSettings);
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

async function packingCartSnapshot() {
  const { data: positions, error: positionsError } = await requireSupabase()
    .from("wms_galluse_cart_positions")
    .select("posizione,bag_code")
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
  return ok({
    phase: "cart_ready",
    cart_code: "CARRELLO-01",
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
  const labels = sessions
    .filter((session) => session.carrier_label_code)
    .map((session) => ({
      session_id: session.id,
      order_name: session.order?.order_name || session.order_id,
      code: session.carrier_label_code,
      scanned: Boolean(session.carrier_label_scanned_at),
    }));
  const hasPendingBagCheck = sessions.some((session) => session.stato === "in_verifica_bag");
  const pendingLabels = labels.filter((label) => !label.scanned);
  return ok({
    bag_code: bagCode,
    batch: snapshot.data.batch || null,
    sessions,
    summary: snapshot.data.summary,
    labels,
    phase: sessions.every((session) => session.stato === "completata")
      ? "completed"
      : hasPendingBagCheck
        ? "double_check"
        : pendingLabels.length
          ? "scan_labels"
          : "scan_bag",
  });
}

async function completePackingLabel(session) {
  const completedAt = nowIso();
  const { error: orderError } = await requireSupabase()
    .from("shopify_orders")
    .update({ wms_status: "pronto", updated_at: completedAt })
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
    if (normalizedText(code) === normalizedText("CARRELLO-01")) return packingCartSnapshot();
    if (code.startsWith("PK-")) return completePackingStationLabel(await packingStationSnapshotForLabel(code), code);
    if (!/^B-[0-9]{5}$/.test(code)) fail("Scansiona prima il barcode della bag");
    const snapshot = await packingStationSnapshot(code);
    if (snapshot.data.phase === "completed") {
      if (normalizedText(payload.cart_code) === normalizedText("CARRELLO-01")) return packingCartSnapshot();
      return snapshot;
    }
    const eligible = snapshot.data.sessions.filter((session) => ["in_attesa_packing", "da_imballare", "in_verifica_bag"].includes(session.stato));
    if (!eligible.length) fail("Questa bag e gia in attesa delle etichette");
    const scannedAt = nowIso();
    const { error } = await requireSupabase().from("wms_packing_sessions").update({
      stato: "in_verifica_bag",
      bag_first_scanned_at: scannedAt,
      updated_at: scannedAt,
    }).in("id", eligible.map((session) => session.id));
    if (error) fail(error.message);
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
      stato: "in_attesa_etichetta",
      bag_double_checked_at: scannedAt,
      carrier_label_code: session.carrier_label_code || packingLabelCode(session.id),
      carrier_label_printed_at: scannedAt,
      updated_at: scannedAt,
    }).eq("id", session.id));
    const results = await Promise.all(updates);
    const updateError = results.find((result) => result.error)?.error;
    if (updateError) fail(updateError.message);
    return packingStationSnapshot(activeBagCode);
  }

  return completePackingStationLabel(snapshot, code);
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
  return ok(generateLabelsPdfBlob({ formato: "100x50", mostra_titolo: true, items }));
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
  const { error } = await requireSupabase().from("wms_packing_sessions").update({ stato: "in_corso", station_code: optionalText(payload.station_code) || "PACK-01", operatore_id: profile.id, started_at: nowIso(), updated_at: nowIso() }).eq("id", session.id);
  if (error) fail(error.message);
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
  const { error } = await requireSupabase().from("wms_packing_sessions").update({ stato: "completata", completed_at: nowIso(), updated_at: nowIso() }).eq("id", sessionId);
  if (error) fail(error.message);
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

  const [{ data: entrate, error: entrateError }, { data: preps, error: prepsError }, { data: boxes, error: boxesError }] = await Promise.all([
    supabase.from("entrate").select("*").eq("cliente_id", clienteId).gte("data_ricezione", start).lt("data_ricezione", end),
    supabase.from("preparazioni").select("*").eq("cliente_id", clienteId).in("stato", ["pronto", "spedito"]).gte("data_pronto", start).lt("data_pronto", end),
    supabase.from("box").select("*").eq("cliente_id", clienteId),
  ]);
  const firstError = entrateError || prepsError || boxesError;
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

export const api = {
  async get(url, config = {}) {
    const { path, params } = pathAndQuery(url);
    if (path === "/clienti") return listClienti();
    if (path === "/referenze") return listReferenze(params);
    if (path === "/entrate") return listEntrate(params);
    if (path.startsWith("/entrate/")) return getEntrata(path.split("/")[2]);
    if (path === "/box") return listBox(params);
    if (path === "/preparazioni") return listPreparazioni(params);
    if (path === "/shopify/connections") return listShopifyConnections();
    if (path === "/shopify/orders") return listShopifyOrders(params);
    if (path === "/wms/spedizioni") return listWmsShipments(params);
    if (path === "/wms/stock") return wmsStock(params);
    if (path === "/wms/mappa") return getWmsWarehouseMap();
    if (path === "/wms/scan") return wmsScan(params);
    if (path === "/wms/configurazione") return getWmsSettings();
    if (path === "/wms/ordini") return listWmsOperationalOrders(params);
    if (path === "/wms/picking-massivo") return listWmsMassPicking(params);
    if (path.match(/^\/wms\/picking-massivo\/[^/]+$/)) return wmsMassPickSnapshot(path.split("/")[3]);
    if (path === "/wms/picking-galluse") return listWmsGallusePicking(params);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+$/)) return wmsGalluseSnapshot(path.split("/")[3]);
    if (path === "/wms/packing") return listWmsPacking();
    if (path === "/wms/bags") return listWmsBags();
    if (path === "/wms/bags/storico") return listWmsBagHistory();
    if (path === "/wms/bags/pdf" && config.responseType === "blob") return wmsBagsPdf();
    if (path.match(/^\/wms\/packing\/bag\/B-[0-9]{5}\/etichette$/) && config.responseType === "blob") return wmsPackingCarrierLabelsPdf(path.split("/")[4]);
    if (path.match(/^\/wms\/packing\/bag\/B-[0-9]{5}$/)) return wmsBagPackingSnapshot(path.split("/")[4]);
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
    if (path === "/shopify/import") return importShopify(payload);
    if (path === "/shopify/orders/import") return importShopifyOrders(payload);
    if (path === "/wms/ordini/import-csv") return importCsvWmsOrders(payload);
    if (path === "/wms/rifornimenti") return replenishWmsSlot(payload);
    if (path === "/wms/stock/quantita") return adjustWmsLocationQuantity(payload);
    if (path === "/wms/stock/sposta") return moveWmsStockQuantity(payload);
    if (path === "/wms/stock/pallet-slot") return moveWmsPalletToSlot(payload);
    if (path === "/wms/stock/scambia") return swapWmsLocations(payload);
    if (path === "/wms/stock/home-catalog-reset") return resetWmsHomeStockCatalog();
    if (path === "/wms/picking-massivo/avvia") return startWmsMassPicking(payload);
    if (path.match(/^\/wms\/picking-massivo\/[^/]+\/scan$/)) return scanWmsMassPicking(path.split("/")[3], payload);
    if (path === "/wms/picking-galluse/avvia") return startWmsGallusePicking(payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/bag$/)) return assignWmsGalluseBag(path.split("/")[3], payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/scan$/)) return scanWmsGallusePicking(path.split("/")[3], payload);
    if (path.match(/^\/wms\/picking-galluse\/[^/]+\/annulla$/)) return cancelWmsGallusePicking(path.split("/")[3]);
    if (path === "/wms/picking-galluse/demo-a-i") return resetGalluseAiDemo();
    if (path === "/wms/packing/station/scan") return scanWmsPackingStation(payload);
    if (path === "/shopify/oauth/start") return startShopifyOAuth(payload);
    if (path === "/shippypro/label") return createShippyProLabel(payload);
    if (path === "/shippypro/carriers") return listShippyProCarriers(payload);
    if (path === "/wms/spedizioni") return createWmsShipment(payload);
    if (path === "/wms/ubicazioni") return createWmsLocation(payload);
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
    if (path.match(/^\/wms\/spedizioni\/[^/]+$/)) return updateWmsShipment(path.split("/")[3], payload);
    if (path === "/wms/mappa") return updateWmsWarehouseMap(payload);
    if (path === "/wms/configurazione") return updateWmsSettings(payload);
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

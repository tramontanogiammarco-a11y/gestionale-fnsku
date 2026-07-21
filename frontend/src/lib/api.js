import { createClient } from "@supabase/supabase-js";
import { requireSupabase, supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

const BUCKET = "gestionale-files";

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
  const toInsert = [];
  const updates = [];

  for (const row of rows) {
    const rowTitle = row.titolo || row.ean;
    const found = isRealEan(row.ean, rowTitle)
      ? byRealEan.get(row.ean)
      : byLooseTitle.get(normalizedText(rowTitle));
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
      continue;
    }

    const patch = {};
    if (row.titolo && (!found.titolo || found.titolo === found.ean)) patch.titolo = row.titolo;
    if (row.ean && !isRealEan(row.ean, rowTitle) && !found.ean) patch.ean = row.ean;
    if (row.sku && !found.sku) patch.sku = row.sku;
    if (row.fnsku && !found.fnsku) patch.fnsku = row.fnsku;
    if (Object.keys(patch).length) {
      if (found.id) updates.push({ id: found.id, patch });
      Object.assign(found, patch);
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
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() || "").split(/[;,]/).map((h) => h.trim().toLowerCase());
  const eanIdx = headers.findIndex((h) => ["ean", "barcode", "gtin", "upc"].includes(h));
  const skuIdx = headers.findIndex((h) => h === "sku");
  const asinIdx = headers.findIndex((h) => h === "asin");
  const titleIdx = headers.findIndex((h) => ["titolo", "title", "productname"].includes(h));
  if (eanIdx < 0 && titleIdx < 0) fail("Serve almeno una colonna Titolo o EAN.");

  const cid = await resolveClienteId(clienteId || undefined);
  const rows = lines.map((line) => {
    const cols = line.split(/[;,]/).map((c) => c.trim());
    const ean = eanIdx >= 0 ? cols[eanIdx] : "";
    const titolo = titleIdx >= 0 ? cols[titleIdx] : "";
    return {
      cliente_id: cid,
      ean: optionalText(ean),
      sku: skuIdx >= 0 ? optionalText(cols[skuIdx]) : null,
      asin: asinIdx >= 0 ? optionalText(cols[asinIdx]) : null,
      titolo: titolo || ean,
      origine: "import",
    };
  }).filter((r) => r.titolo);
  if (rows.length) {
    const { error } = await supabase.from("referenze").insert(rows);
    if (error) fail(error.message);
  }
  return ok({ inseriti: rows.length, errori: [], totale_righe: lines.length });
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
  const byEntrata = {};
  for (const r of righe || []) {
    byEntrata[r.entrata_id] = byEntrata[r.entrata_id] || [];
    byEntrata[r.entrata_id].push(r);
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
  if (Object.prototype.hasOwnProperty.call(payload, "fnsku")) updates.fnsku = optionalText(payload.fnsku);
  if (!Object.keys(updates).length) fail("Nessun campo da aggiornare");

  if (Object.prototype.hasOwnProperty.call(payload, "ean") || Object.prototype.hasOwnProperty.call(payload, "fnsku")) {
    const { data: current, error: readError } = await requireSupabase()
      .from("entrate_righe")
      .select("entrata_id,ean")
      .eq("id", id)
      .single();
    if (readError) fail(readError.message);
    const clienteId = await clienteIdForEntrata(current.entrata_id);
    await ensureReferenzeForEntrata(clienteId, [{ ...payload, ean: updates.ean || current.ean }]);
  }

  const { data, error } = await requireSupabase()
    .from("entrate_righe")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function deleteEntrataRiga(id) {
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

  const { error } = await requireSupabase().from("entrate").delete().eq("id", id);
  if (error) fail(error.message);
  return ok({ ok: true });
}

async function riceviEntrata(id) {
  const { data, error } = await requireSupabase()
    .from("entrate")
    .update({ stato: "ricevuto", data_ricezione: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return getEntrata(data.id);
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
  const cmap = await clientiMap((data || []).map((b) => b.cliente_id));
  return ok((data || []).map((b) => ({ ...b, cliente_ragione_sociale: cmap[b.cliente_id]?.ragione_sociale || null })));
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
  const { data: duplicateNumber, error: duplicateError } = await requireSupabase()
    .from("box")
    .select("id")
    .eq("cliente_id", cliente_id)
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
    const { data: duplicateNumber, error: duplicateError } = await requireSupabase()
      .from("box")
      .select("id")
      .eq("cliente_id", current.cliente_id)
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
    .select("id,cliente_id,numero_box,stato")
    .in("id", boxIds);
  if (boxError) fail(boxError.message);
  if ((boxes || []).length !== boxIds.length) fail("Una o piu box non sono disponibili", 404);

  const clienteIds = [...new Set((boxes || []).map((box) => box.cliente_id))];
  if (clienteIds.length !== 1) fail("Le box selezionate devono appartenere allo stesso cliente");
  const nonPronte = (boxes || []).filter((box) => box.stato !== "pronto");
  if (nonPronte.length) fail("Puoi caricare etichette di gruppo solo su box pronte");

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
  const byPrep = {};
  for (const r of righe || []) {
    const ref = refs.find((x) => x.cliente_id && x.ean === r.ean);
    byPrep[r.preparazione_id] = byPrep[r.preparazione_id] || [];
    byPrep[r.preparazione_id].push({ ...r, titolo: ref?.titolo, fnsku: r.fnsku || ref?.fnsku || null, referenza_id: ref?.id });
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

async function listShopifyOrders(params) {
  let query = requireSupabase().from("shopify_orders").select("*").order("processed_at", { ascending: false });
  if (params.get("cliente_id")) query = query.eq("cliente_id", params.get("cliente_id"));
  if (params.get("wms_status")) query = query.eq("wms_status", params.get("wms_status"));
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(await enrichShopifyOrders(data || []));
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
  if (!Object.keys(updates).length) fail("Nessun campo da aggiornare");

  if (Object.prototype.hasOwnProperty.call(payload, "ean") || Object.prototype.hasOwnProperty.call(payload, "sku") || Object.prototype.hasOwnProperty.call(payload, "fnsku")) {
    const { data: current, error: readError } = await requireSupabase()
      .from("preparazioni_righe")
      .select("preparazione_id,ean")
      .eq("id", id)
      .single();
    if (readError) fail(readError.message);
    const clienteId = await clienteIdForPreparazione(current.preparazione_id);
    await ensureReferenzeForEntrata(clienteId, [{ ...payload, ean: updates.ean || current.ean }]);
  }

  const { data, error } = await requireSupabase()
    .from("preparazioni_righe")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
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
  const [{ data: entrate, error: entrateError }, { data: righe, error: righeError }, { data: boxes, error: boxesError }, { data: refs, error: refsError }] = await Promise.all([
    supabase.from("entrate").select("*").eq("cliente_id", cid).in("stato", ["ricevuto", "in_lavorazione", "pronto", "spedito"]),
    supabase.from("entrate_righe").select("*"),
    supabase.from("box").select("*").eq("cliente_id", cid),
    supabase.from("referenze").select("*").eq("cliente_id", cid),
  ]);
  const firstError = entrateError || righeError || boxesError || refsError;
  if (firstError) fail(firstError.message);

  const entrataIds = new Set((entrate || []).map((e) => e.id));
  const ricevuto = {};
  for (const r of righe || []) {
    if (entrataIds.has(r.entrata_id)) ricevuto[r.ean] = (ricevuto[r.ean] || 0) + Number(r.quantita || 0);
  }

  const titoloMap = {};
  const fnskuMap = {};
  const skuMap = {};
  const bundleMap = {};
  const bundleRefs = [];
  for (const ref of refs || []) {
    if (!ref.ean) continue;
    titoloMap[ref.ean] ??= ref.titolo;
    fnskuMap[ref.ean] ??= ref.fnsku;
    if (ref.sku) {
      skuMap[ref.ean] ||= new Set();
      skuMap[ref.ean].add(ref.sku);
    }
    if (ref.is_bundle && ref.componenti?.length) {
      bundleMap[ref.ean] = ref.componenti;
      bundleRefs.push(ref);
    }
  }

  const spedito = {};
  const inPreparazione = {};
  const bundleSpedito = {};
  const bundleInPreparazione = {};
  for (const b of boxes || []) {
    const isSpedito = b.stato === "spedito";
    for (const c of b.contenuto || []) {
      const ean = c.ean;
      const qta = Number(c.quantita || 0);
      if (bundleMap[ean]) {
        const bundleTarget = isSpedito ? bundleSpedito : bundleInPreparazione;
        bundleTarget[ean] = (bundleTarget[ean] || 0) + qta;
        for (const comp of bundleMap[ean]) {
          const compQty = Number(comp.quantita || 1);
          const target = isSpedito ? spedito : inPreparazione;
          target[comp.ean] = (target[comp.ean] || 0) + qta * compQty;
        }
      } else {
        const target = isSpedito ? spedito : inPreparazione;
        target[ean] = (target[ean] || 0) + qta;
      }
    }
  }

  const bundleEans = new Set(Object.keys(bundleMap));
  const componentDisponibile = {};
  const eans = [...new Set([...Object.keys(titoloMap), ...Object.keys(ricevuto), ...Object.keys(spedito), ...Object.keys(inPreparazione)])]
    .filter((ean) => !bundleEans.has(ean))
    .sort();

  const rows = eans.map((ean) => {
    const ric = ricevuto[ean] || 0;
    const prep = inPreparazione[ean] || 0;
    const spe = spedito[ean] || 0;
    const disponibile = Math.max(0, ric - spe);
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

async function preparato(params) {
  const cid = await resolveClienteId(params.get("cliente_id") || undefined);
  const [{ data: preps, error: prepsError }, { data: boxes, error: boxesError }, { data: refs, error: refsError }] = await Promise.all([
    supabase.from("preparazioni").select("*").eq("cliente_id", cid).eq("stato", "pronto"),
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
  const boxesByPrep = boxesByPreparazioneWithFallback(orderedPreps, righe || [], boxes || []);
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
    const richiesto = contenutoTotals(righeByPrep[prep.id] || []);
    const inBox = contenutoTotals((boxesByPrep[prep.id] || []).flatMap((box) => box.contenuto || []));
    Object.keys(richiesto).forEach((ean) => {
      const ref = refByEan[ean] || {};
      rows.push({
        preparazione_id: prep.id,
        preparazione_numero: prepIndex + 1,
        preparazione_data: prep.data_pronto || prep.created_at,
        ean,
        titolo: ref.titolo,
        fnsku: (righeByPrep[prep.id] || []).find((riga) => riga.ean === ean)?.fnsku || ref.fnsku,
        sku: ref.sku,
        skus: skusByEan[ean] || (ref.sku ? [ref.sku] : []),
        richiesto: richiesto[ean],
        in_box: inBox[ean] || 0,
        disponibile: Math.max(0, richiesto[ean] - (inBox[ean] || 0)),
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

function generateLabelsPdfBlob(payload = {}) {
  const { widthPt, heightPt } = parseLabelFormat(payload.formato);
  const items = (payload.items || []).flatMap((item) => {
    const copies = Math.max(1, Math.min(999, Number(item.copie) || 1));
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
    if (path === "/shopify/orders") return listShopifyOrders(params);
    if (path === "/wms/spedizioni") return listWmsShipments(params);
    if (path.startsWith("/preparazioni/")) return getPreparazione(path.split("/")[2]);
    if (path === "/magazzino") return magazzino(params);
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
    if (path === "/shopify/oauth/start") return startShopifyOAuth(payload);
    if (path === "/shippypro/label") return createShippyProLabel(payload);
    if (path === "/shippypro/carriers") return listShippyProCarriers(payload);
    if (path === "/wms/spedizioni") return createWmsShipment(payload);
    if (path === "/referenze") return createReferenza(payload);
    if (path === "/referenze/import") return importReferenze(payload);
    if (path.match(/^\/referenze\/[^/]+\/foto$/)) return uploadReferenzaFoto(path.split("/")[2], payload);
    if (path.match(/^\/entrate\/[^/]+\/documento$/)) return uploadEntrataDocumento(path.split("/")[2], payload);
    if (path === "/entrate") return createEntrata(payload);
    if (path === "/entrate-righe") return createEntrataRiga(payload);
    if (path.match(/^\/entrate\/[^/]+\/ricevi$/)) return riceviEntrata(path.split("/")[2]);
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
    if (path.match(/^\/preparazioni\/[^/]+$/)) return updatePreparazione(path.split("/")[2], payload);
    if (path.match(/^\/preparazioni-righe\/[^/]+$/)) return updatePreparazioneRiga(path.split("/")[2], payload);
    if (path.match(/^\/wms\/spedizioni\/[^/]+$/)) return updateWmsShipment(path.split("/")[3], payload);
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async delete(url) {
    const { path } = pathAndQuery(url);
    if (path.match(/^\/entrate\/[^/]+$/)) return deleteEntrata(path.split("/")[2]);
    if (path.match(/^\/entrate-righe\/[^/]+$/)) return deleteEntrataRiga(path.split("/")[2]);
    if (path.match(/^\/preparazioni\/[^/]+$/)) return deletePreparazione(path.split("/")[2]);
    if (path.match(/^\/preparazioni-righe\/[^/]+$/)) return deletePreparazioneRiga(path.split("/")[2]);
    if (path.match(/^\/referenze\/[^/]+$/)) return deleteReferenza(path.split("/")[2]);
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

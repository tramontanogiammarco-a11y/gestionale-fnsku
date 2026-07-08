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
  let query = requireSupabase().from("referenze").select("*").order("created_at", { ascending: false });
  const clienteId = params.get("cliente_id");
  if (clienteId) query = query.eq("cliente_id", clienteId);
  const { data, error } = await query;
  if (error) fail(error.message);
  return ok(data || []);
}

async function createReferenza(payload) {
  const cliente_id = await resolveClienteId(payload.cliente_id);
  const { data, error } = await requireSupabase()
    .from("referenze")
    .insert({ ...payload, cliente_id, origine: payload.origine || "manuale" })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateReferenza(id, payload) {
  const { data, error } = await requireSupabase()
    .from("referenze")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
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
  if (eanIdx < 0) fail("Colonna EAN non trovata");
  const skuIdx = headers.findIndex((h) => h === "sku");
  const asinIdx = headers.findIndex((h) => h === "asin");
  const titleIdx = headers.findIndex((h) => ["titolo", "title", "productname"].includes(h));

  const cid = await resolveClienteId(clienteId || undefined);
  const rows = lines.map((line) => {
    const cols = line.split(/[;,]/).map((c) => c.trim());
    return {
      cliente_id: cid,
      ean: cols[eanIdx],
      sku: skuIdx >= 0 ? cols[skuIdx] || null : null,
      asin: asinIdx >= 0 ? cols[asinIdx] || null : null,
      titolo: titleIdx >= 0 ? cols[titleIdx] || cols[eanIdx] : cols[eanIdx],
      origine: "import",
    };
  }).filter((r) => r.ean);
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

async function updateEntrataRiga(id, payload) {
  const { data, error } = await requireSupabase()
    .from("entrate_righe")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
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
  const { data, error } = await requireSupabase()
    .from("box")
    .insert({ ...payload, cliente_id, contenuto: payload.contenuto || [] })
    .select()
    .single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateBox(id, payload) {
  const { data, error } = await requireSupabase().from("box").update(payload).eq("id", id).select().single();
  if (error) fail(error.message);
  return ok(data);
}

async function updateBoxStato(id, stato) {
  return updateBox(id, { stato, data_spedito: stato === "spedito" ? nowIso() : null });
}

async function uploadBoxLabel(id, tipo, formData) {
  const file = formData.get("file");
  if (!file) fail("File mancante");
  const { data: box, error: boxError } = await supabase.from("box").select("cliente_id").eq("id", id).single();
  if (boxError) fail(boxError.message);
  const path = `${box.cliente_id}/box/${id}-${tipo}-${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (uploadError) fail(uploadError.message);
  const field = tipo === "amazon" ? "etichetta_amazon_pdf_url" : "etichetta_ups_pdf_url";
  return updateBox(id, { [field]: fileUrl(path) });
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
  const { data: righe, error: righeError } = ids.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", ids)
    : { data: [], error: null };
  if (righeError) fail(righeError.message);
  const refs = await refsFor(preps.map((p) => p.cliente_id));
  const cmap = await clientiMap(preps.map((p) => p.cliente_id));
  const byPrep = {};
  for (const r of righe || []) {
    const ref = refs.find((x) => x.cliente_id && x.ean === r.ean);
    byPrep[r.preparazione_id] = byPrep[r.preparazione_id] || [];
    byPrep[r.preparazione_id].push({ ...r, titolo: ref?.titolo, fnsku: r.fnsku || ref?.fnsku || null, referenza_id: ref?.id });
  }
  return preps.map((p) => ({
    ...p,
    righe: byPrep[p.id] || [],
    cliente_ragione_sociale: cmap[p.cliente_id]?.ragione_sociale || null,
  }));
}

async function refsFor(clienteIds) {
  const ids = [...new Set(clienteIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("referenze").select("*").in("cliente_id", ids);
  if (error) fail(error.message);
  return data || [];
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
  const { data, error } = await requireSupabase()
    .from("preparazioni")
    .update({ stato, data_pronto: stato === "pronto" ? nowIso() : undefined })
    .eq("id", id)
    .select()
    .single();
  if (error) fail(error.message);
  return getPreparazione(data.id);
}

async function deletePreparazione(id) {
  const { data: prep, error: readError } = await requireSupabase()
    .from("preparazioni")
    .select("id,stato")
    .eq("id", id)
    .single();
  if (readError || !prep) fail("Preparazione non trovata", 404);
  if (prep.stato !== "richiesta") {
    fail("Puoi cancellare solo preparazioni ancora in stato Richiesta", 409);
  }

  const { data: deleted, error } = await requireSupabase()
    .from("preparazioni")
    .delete()
    .eq("id", id)
    .eq("stato", "richiesta")
    .select("id");
  if (error) fail(error.message);
  if (!deleted?.length) {
    fail("Supabase non ha cancellato la preparazione: esegui la policy SQL di cancellazione e riprova", 403);
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
  const [{ data: preps }, { data: boxes }, { data: refs }] = await Promise.all([
    supabase.from("preparazioni").select("*").eq("cliente_id", cid).in("stato", ["pronto", "spedito"]),
    supabase.from("box").select("*").eq("cliente_id", cid).neq("stato", "spedito"),
    supabase.from("referenze").select("*").eq("cliente_id", cid),
  ]);
  const prepIds = (preps || []).map((p) => p.id);
  const { data: righe } = prepIds.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
    : { data: [] };
  const richiesto = {};
  for (const r of righe || []) richiesto[r.ean] = (richiesto[r.ean] || 0) + Number(r.quantita || 0);
  const inBox = {};
  for (const b of boxes || []) {
    for (const c of b.contenuto || []) inBox[c.ean] = (inBox[c.ean] || 0) + Number(c.quantita || 0);
  }
  return ok(Object.keys(richiesto).map((ean) => {
    const ref = (refs || []).find((r) => r.ean === ean) || {};
    return {
      ean,
      titolo: ref.titolo,
      fnsku: ref.fnsku,
      sku: ref.sku,
      richiesto: richiesto[ean],
      in_box: inBox[ean] || 0,
      disponibile: Math.max(0, richiesto[ean] - (inBox[ean] || 0)),
    };
  }).filter((r) => r.disponibile > 0));
}

async function dashboardStats() {
  const [entrateRes, referenzeRes, boxRes, clientiRes] = await Promise.all([
    supabase.from("entrate").select("stato"),
    supabase.from("referenze").select("id", { count: "exact", head: true }),
    supabase.from("box").select("id", { count: "exact", head: true }),
    supabase.from("clienti").select("id", { count: "exact", head: true }),
  ]);
  if (entrateRes.error) fail(entrateRes.error.message);
  const conteggi = {};
  for (const e of entrateRes.data || []) conteggi[e.stato] = (conteggi[e.stato] || 0) + 1;
  return ok({
    entrate_per_stato: conteggi,
    totale_entrate: (entrateRes.data || []).length,
    totale_referenze: referenzeRes.count || 0,
    totale_box: boxRes.count || 0,
    totale_clienti: clientiRes.count || 0,
  });
}

async function fatturazione(params) {
  return ok({
    righe: [],
    subtotale: 0,
    iva_perc: 22,
    iva_importo: 0,
    totale: 0,
    cliente_id: params.get("cliente_id"),
    periodo: `${params.get("anno")}-${String(params.get("mese")).padStart(2, "0")}`,
  });
}

function placeholderPdf(message) {
  return new Blob([message], { type: "application/pdf" });
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
    if (path.startsWith("/preparazioni/")) return getPreparazione(path.split("/")[2]);
    if (path === "/magazzino") return magazzino(params);
    if (path === "/preparato") return preparato(params);
    if (path === "/dashboard/stats") return dashboardStats();
    if (path === "/etichette/formati") return ok({ formati: ["40x20", "50x30", "60x30", "100x50"] });
    if (path === "/fatturazione") return fatturazione(params);
    if (path === "/fatturazione/pdf" && config.responseType === "blob") return ok(placeholderPdf("PDF fatturazione in migrazione Supabase."));
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async post(url, payload, config = {}) {
    const { path } = pathAndQuery(url);
    if (path === "/clienti") return createCliente(payload);
    if (path === "/referenze") return createReferenza(payload);
    if (path === "/referenze/import") return importReferenze(payload);
    if (path.match(/^\/referenze\/[^/]+\/foto$/)) return uploadReferenzaFoto(path.split("/")[2], payload);
    if (path === "/entrate") return createEntrata(payload);
    if (path.match(/^\/entrate\/[^/]+\/ricevi$/)) return riceviEntrata(path.split("/")[2]);
    if (path === "/box") return createBox(payload);
    if (path.match(/^\/box\/[^/]+\/etichetta-(amazon|ups)$/)) {
      const [, id, tipo] = path.match(/^\/box\/([^/]+)\/etichetta-(amazon|ups)$/);
      return uploadBoxLabel(id, tipo, payload);
    }
    if (path === "/preparazioni") return createPreparazione(payload);
    if (path === "/etichette/genera" && config.responseType === "blob") return ok(placeholderPdf("PDF etichette FNSKU in migrazione Supabase."));
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async put(url, payload) {
    const { path } = pathAndQuery(url);
    if (path.match(/^\/clienti\/[^/]+$/)) return updateCliente(path.split("/")[2], payload);
    if (path.match(/^\/referenze\/[^/]+$/)) return updateReferenza(path.split("/")[2], payload);
    if (path.match(/^\/entrate-righe\/[^/]+$/)) return updateEntrataRiga(path.split("/")[2], payload);
    if (path.match(/^\/box\/[^/]+\/stato$/)) return updateBoxStato(path.split("/")[2], payload.stato);
    if (path.match(/^\/box\/[^/]+$/)) return updateBox(path.split("/")[2], payload);
    if (path.match(/^\/preparazioni\/[^/]+\/stato$/)) return updatePreparazioneStato(path.split("/")[2], payload.stato);
    fail(`Endpoint non migrato: ${path}`, 404);
  },

  async delete(url) {
    const { path } = pathAndQuery(url);
    if (path.match(/^\/preparazioni\/[^/]+$/)) return deletePreparazione(path.split("/")[2]);
    if (path.match(/^\/referenze\/[^/]+$/)) {
      const { error } = await requireSupabase().from("referenze").delete().eq("id", path.split("/")[2]);
      if (error) fail(error.message);
      return ok({ ok: true });
    }
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

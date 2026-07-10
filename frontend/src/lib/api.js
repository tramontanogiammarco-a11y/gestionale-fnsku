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
  const url = fileUrl(path);
  if (tipo === "combined") {
    return updateBox(id, { etichetta_amazon_pdf_url: url, etichetta_ups_pdf_url: url });
  }
  const field = tipo === "amazon" ? "etichetta_amazon_pdf_url" : "etichetta_ups_pdf_url";
  return updateBox(id, { [field]: url });
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
  const { data: deletedViaRpc, error: rpcError } = await requireSupabase()
    .rpc("delete_requested_preparazione", { prep_id: id });

  if (!rpcError) {
    if (!deletedViaRpc) {
      fail("Preparazione non trovata o gia presa in lavorazione", 409);
    }
    return ok({ ok: true });
  }

  const missingRpc = rpcError.code === "PGRST202" || /delete_requested_preparazione|schema cache|function/i.test(rpcError.message || "");
  if (!missingRpc) fail(rpcError.message);

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
    fail("Esegui la funzione SQL di cancellazione in Supabase e riprova", 403);
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
  const [{ data: preps, error: prepsError }, { data: boxes, error: boxesError }, { data: refs, error: refsError }] = await Promise.all([
    supabase.from("preparazioni").select("*").eq("cliente_id", cid).in("stato", ["pronto", "spedito"]),
    supabase.from("box").select("*").eq("cliente_id", cid).neq("stato", "spedito"),
    supabase.from("referenze").select("*").eq("cliente_id", cid),
  ]);
  const firstError = prepsError || boxesError || refsError;
  if (firstError) fail(firstError.message);

  const prepIds = (preps || []).map((p) => p.id);
  const { data: righe, error: righeError } = prepIds.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
    : { data: [] };
  if (righeError) fail(righeError.message);

  const richiesto = {};
  for (const r of righe || []) richiesto[r.ean] = (richiesto[r.ean] || 0) + Number(r.quantita || 0);
  const inBox = {};
  for (const b of boxes || []) {
    for (const c of b.contenuto || []) inBox[c.ean] = (inBox[c.ean] || 0) + Number(c.quantita || 0);
  }
  const refByEan = {};
  const skusByEan = {};
  for (const ref of refs || []) {
    refByEan[ref.ean] ??= ref;
    if (ref.sku) {
      skusByEan[ref.ean] ||= [];
      if (!skusByEan[ref.ean].includes(ref.sku)) skusByEan[ref.ean].push(ref.sku);
    }
  }

  return ok(Object.keys(richiesto).map((ean) => {
    const ref = refByEan[ean] || {};
    return {
      ean,
      titolo: ref.titolo,
      fnsku: ref.fnsku,
      sku: ref.sku,
      skus: skusByEan[ean] || (ref.sku ? [ref.sku] : []),
      richiesto: richiesto[ean],
      in_box: inBox[ean] || 0,
      disponibile: Math.max(0, richiesto[ean] - (inBox[ean] || 0)),
    };
  }).filter((r) => r.disponibile > 0));
}

async function dashboardStats() {
  const [entrateRes, preparazioniRes, prepRigheRes, boxListRes, referenzeRes, clientiRes] = await Promise.all([
    supabase.from("entrate").select("stato,data_annuncio,cliente_id"),
    supabase.from("preparazioni").select("id,stato,created_at,cliente_id"),
    supabase.from("preparazioni_righe").select("preparazione_id,quantita,servizi"),
    supabase.from("box").select("id,stato,created_at,contenuto"),
    supabase.from("referenze").select("id", { count: "exact", head: true }),
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

  return ok({
    entrate_per_stato: countBy(entrateRes.data || [], "stato"),
    preparazioni_per_stato: countBy(preparazioniRes.data || [], "stato"),
    box_per_stato: countBy(boxListRes.data || [], "stato"),
    trend_operativo,
    totale_entrate: (entrateRes.data || []).length,
    totale_preparazioni: (preparazioniRes.data || []).length,
    totale_referenze: referenzeRes.count || 0,
    totale_box: (boxListRes.data || []).length,
    pezzi_nei_box,
    servizio_usage,
    top_clienti,
    totale_clienti: (clientiRes.data || []).length,
  });
}

async function fatturazione(params) {
  const clienteId = params.get("cliente_id");
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
    if (q <= 0 || p <= 0) return;
    righe.push({ codice, descrizione, quantita: q, prezzo: p, importo: q * p });
  };

  const [{ data: entrate, error: entrateError }, { data: preps, error: prepsError }, { data: boxes, error: boxesError }] = await Promise.all([
    supabase.from("entrate").select("*").eq("cliente_id", clienteId).gte("data_annuncio", start).lt("data_annuncio", end),
    supabase.from("preparazioni").select("*").eq("cliente_id", clienteId).gte("created_at", start).lt("created_at", end),
    supabase.from("box").select("*").eq("cliente_id", clienteId).gte("created_at", start).lt("created_at", end),
  ]);
  const firstError = entrateError || prepsError || boxesError;
  if (firstError) fail(firstError.message);

  const prepIds = (preps || []).map((p) => p.id);
  const { data: prepRighe, error: righeError } = prepIds.length
    ? await supabase.from("preparazioni_righe").select("*").in("preparazione_id", prepIds)
    : { data: [], error: null };
  if (righeError) fail(righeError.message);

  const entrataPallet = (entrate || []).filter((e) => e.tipo === "pallet").reduce((sum, e) => sum + Number(e.colli || 1), 0);
  const entrataScatola = (entrate || []).filter((e) => e.tipo === "scatola").reduce((sum, e) => sum + Number(e.colli || 1), 0);
  addRiga("entrata_pallet", "Entrata pallet", entrataPallet, price("entrata_pallet"));
  addRiga("entrata_scatola", "Entrata scatola", entrataScatola, price("entrata_scatola"));

  const servizioQty = {};
  for (const riga of prepRighe || []) {
    for (const servizio of riga.servizi || []) {
      servizioQty[servizio] = (servizioQty[servizio] || 0) + Number(riga.quantita || 0);
    }
  }
  addRiga("fnsku", "Applicazione etichette FNSKU", servizioQty.fnsku, price("fnsku"));
  addRiga("busta", "Busta trasparente", servizioQty.busta, price("busta"));
  addRiga("nastratura", "Nastratura", servizioQty.nastratura, price("nastratura"));
  addRiga("pluriball", "Pluriball", servizioQty.pluriball, price("pluriball"));

  addRiga("inscatolamento", "Inscatolamento box", (boxes || []).length, price("inscatolamento"));
  const scatola60 = (boxes || []).filter((b) => Number(b.lunghezza_cm || 0) >= 55 || Number(b.larghezza_cm || 0) >= 55).length;
  const scatola40 = (boxes || []).filter((b) => Number(b.lunghezza_cm || 0) > 0 && Number(b.lunghezza_cm || 0) < 55 && Number(b.larghezza_cm || 0) < 55).length;
  addRiga("scatola_60", "Scatola 60x40x40", scatola60, price("scatola_60"));
  addRiga("scatola_40", "Scatola 40x30x30", scatola40, price("scatola_40"));
  addRiga("stoccaggio_pallet", "Stoccaggio pallet mese", palletStoccati, price("stoccaggio_pallet"));

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
      preparazioni: (preps || []).length,
      box: (boxes || []).length,
      servizi: servizioQty,
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
    if (path === "/referenze") return createReferenza(payload);
    if (path === "/referenze/import") return importReferenze(payload);
    if (path.match(/^\/referenze\/[^/]+\/foto$/)) return uploadReferenzaFoto(path.split("/")[2], payload);
    if (path.match(/^\/entrate\/[^/]+\/documento$/)) return uploadEntrataDocumento(path.split("/")[2], payload);
    if (path === "/entrate") return createEntrata(payload);
    if (path.match(/^\/entrate\/[^/]+\/ricevi$/)) return riceviEntrata(path.split("/")[2]);
    if (path === "/box") return createBox(payload);
    if (path.match(/^\/box\/[^/]+\/etichette$/)) return uploadBoxLabel(path.split("/")[2], "combined", payload);
    if (path.match(/^\/box\/[^/]+\/etichetta-(amazon|ups)$/)) {
      const [, id, tipo] = path.match(/^\/box\/([^/]+)\/etichetta-(amazon|ups)$/);
      return uploadBoxLabel(id, tipo, payload);
    }
    if (path === "/preparazioni") return createPreparazione(payload);
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

const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../frontend/node_modules/@supabase/supabase-js"));

function loadEnv() {
  const file = fs.readFileSync(path.join(__dirname, "../frontend/.env.local"), "utf8");
  return Object.fromEntries(file.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function shuffled(rows) {
  return [...rows].sort(() => Math.random() - 0.5);
}

async function main() {
  const env = loadEnv();
  const password = process.env.WMS_ADMIN_PASSWORD;
  if (!password) throw new Error("Imposta WMS_ADMIN_PASSWORD prima di eseguire lo script");
  const supabase = createClient(env.REACT_APP_SUPABASE_URL, env.REACT_APP_SUPABASE_ANON_KEY);
  requireData(await supabase.auth.signInWithPassword({ email: "admin@prepcenter.it", password }), "Login admin");

  const profile = requireData(await supabase.from("profiles").select("id").eq("email", "admin@prepcenter.it").single(), "Profilo admin");
  const existing = requireData(await supabase.from("clienti").select("id").eq("email", "wms-demo-picking@aimago.test").maybeSingle(), "Ricerca demo");
  if (existing) requireData(await supabase.from("clienti").delete().eq("id", existing.id), "Reset demo precedente");

  const [locations, inbound, transfers, outbound] = await Promise.all([
    supabase.from("wms_locations").select("id,codice,tipo,stato"),
    supabase.from("wms_inbound_movements").select("location_id"),
    supabase.from("wms_stock_transfers").select("source_location_id,target_location_id"),
    supabase.from("wms_outbound_movements").select("location_id"),
  ]);
  const locationRows = requireData(locations, "Ubicazioni");
  const occupied = new Set([
    ...requireData(inbound, "Movimenti inbound").map((row) => row.location_id),
    ...requireData(transfers, "Trasferimenti").flatMap((row) => [row.source_location_id, row.target_location_id]),
    ...requireData(outbound, "Movimenti outbound").map((row) => row.location_id),
  ].filter(Boolean));
  const emptyPallets = shuffled(locationRows.filter((row) => row.tipo === "pallet" && row.stato === "attiva" && !occupied.has(row.id))).slice(0, 10);
  const emptySlots = shuffled(locationRows.filter((row) => row.tipo === "slot" && row.stato === "attiva" && !occupied.has(row.id))).slice(0, 10);
  if (emptyPallets.length < 10 || emptySlots.length < 10) throw new Error("Servono almeno 10 pallet e 10 slot mai utilizzati");

  const client = requireData(await supabase.from("clienti").insert({
    ragione_sociale: "WMS Demo Picking",
    email: "wms-demo-picking@aimago.test",
    note: "Cliente tecnico isolato per prove picking slot-only",
  }).select().single(), "Creazione cliente demo");

  const referenceRows = Array.from({ length: 10 }, (_, index) => ({
    cliente_id: client.id,
    titolo: `Prodotto demo picking ${String(index + 1).padStart(2, "0")}`,
    ean: `29900000000${String(index + 1).padStart(2, "0")}`,
    sku: `DEMO-SKU-${String(index + 1).padStart(3, "0")}`,
    fnsku: `XDEMO${String(index + 1).padStart(5, "0")}`,
    origine: "test_wms",
  }));
  const references = requireData(await supabase.from("referenze").insert(referenceRows).select(), "Referenze demo");
  const entry = requireData(await supabase.from("entrate").insert({
    cliente_id: client.id,
    tipo: "pallet",
    colli: 10,
    stato: "ricevuto",
    data_ricezione: new Date().toISOString(),
    note: "[TEST WMS] Stock demo picking slot-only",
  }).select().single(), "Entrata demo");
  const entryRows = requireData(await supabase.from("entrate_righe").insert(references.map((reference) => ({
    entrata_id: entry.id,
    ean: reference.ean,
    fnsku: reference.fnsku,
    quantita: 25,
    quantita_ricevuta: 25,
  }))).select(), "Righe entrata demo");
  const session = requireData(await supabase.from("wms_inbound_sessions").insert({
    entrata_id: entry.id,
    stato: "completata",
    operatore_id: profile.id,
    completed_at: new Date().toISOString(),
    note: "[TEST WMS] Ubicazione iniziale su pallet",
  }).select().single(), "Sessione inbound demo");
  requireData(await supabase.from("wms_inbound_movements").insert(entryRows.map((row, index) => ({
    session_id: session.id,
    entrata_riga_id: row.id,
    location_id: emptyPallets[index].id,
    disposizione: "disponibile",
    quantita: 25,
    codice_scansionato: emptyPallets[index].codice,
    created_by: profile.id,
  }))), "Movimenti pallet demo");

  requireData(await supabase.from("wms_stock_transfers").insert(references.map((reference, index) => ({
    cliente_id: client.id,
    product_key: `fnsku:${reference.fnsku.toLowerCase()}`,
    source_location_id: emptyPallets[index].id,
    target_location_id: emptySlots[index].id,
    quantita: 8,
    operatore_id: profile.id,
  }))), "Rifornimenti slot demo");

  const order = requireData(await supabase.from("shopify_orders").insert({
    cliente_id: client.id,
    shop_domain: "csv-import",
    shopify_order_id: "csv:test-pick-001",
    order_name: "TEST-PICK-001",
    financial_status: "csv",
    fulfillment_status: "unfulfilled",
    wms_status: "da_preparare",
    processed_at: new Date().toISOString(),
    note: "[TEST WMS] Ordine con 10 SKU prelevabili solo da slot",
    raw: { source: "wms-demo-seed" },
  }).select().single(), "Ordine demo");
  const quantities = [2, 1, 3, 2, 4, 1, 2, 3, 1, 2];
  requireData(await supabase.from("shopify_order_items").insert(references.map((reference, index) => ({
    order_id: order.id,
    shopify_line_item_id: `demo-line-${index + 1}`,
    referenza_id: reference.id,
    sku: reference.sku,
    ean: reference.ean,
    titolo: reference.titolo,
    quantita: quantities[index],
    fulfillable_quantity: quantities[index],
    raw: { source: "wms-demo-seed" },
  }))), "Righe ordine demo");

  console.log(JSON.stringify({
    client_id: client.id,
    order_id: order.id,
    order_name: order.order_name,
    placements: references.map((reference, index) => ({
      sku: reference.sku,
      ean: reference.ean,
      pallet: emptyPallets[index].codice,
      slot: emptySlots[index].codice,
      slot_quantity: 8,
      order_quantity: quantities[index],
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

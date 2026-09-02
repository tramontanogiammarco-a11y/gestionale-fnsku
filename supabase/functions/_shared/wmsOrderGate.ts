type SupabaseAdmin = any;

const ACTIVE_ENTRY_STATUSES = ["ricevuto", "in_lavorazione", "pronto", "spedito"];
const ACTIVE_GATE_STATUSES = ["da_verificare", "verifica_indirizzo", "verifica_stock", "attesa_refill", "eccezione_indirizzo", "eccezione_stock"];

function text(value: unknown) { return String(value || "").trim(); }
function norm(value: unknown) { return text(value).toLowerCase(); }
function productKey(reference: any) {
  return reference?.fnsku ? `fnsku:${norm(reference.fnsku)}`
    : reference?.ean ? `ean:${norm(reference.ean)}`
      : reference?.sku ? `sku:${norm(reference.sku)}` : "";
}
function balanceKey(locationId: string, key: string) { return `${locationId}:${key}`; }
function add(map: Map<string, number>, key: string, quantity: unknown) {
  map.set(key, Number(map.get(key) || 0) + Number(quantity || 0));
}
export function wmsGateError(error: unknown) {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .map((part) => text(part))
      .filter(Boolean);
    if (parts.length) return new Error([...new Set(parts)].join(" · "));
  }
  return new Error(text(error) || "Verifica ordine non riuscita");
}
function addressCheck(order: any) {
  const countryCode = norm(order.ship_country_code || order.ship_country || "IT");
  const address = text(order.ship_address1);
  const zip = text(order.ship_zip);
  const city = text(order.ship_city);
  const province = text(order.ship_province);
  const recipient = text(order.ship_name || order.ship_company);
  const reasons = [
    ...(!recipient ? ["Destinatario mancante"] : []),
    ...(!address ? ["Indirizzo mancante"] : []),
    ...(address && !/\d/.test(address) ? ["Numero civico non riconosciuto"] : []),
    ...(!zip ? ["CAP mancante"] : []),
    ...(!city ? ["Citta mancante"] : []),
    ...(!countryCode ? ["Paese mancante"] : []),
    ...(["it", "ita", "italia", "italy"].includes(countryCode) && zip && !/^\d{5}$/.test(zip) ? ["CAP italiano non valido"] : []),
    ...(["it", "ita", "italia", "italy"].includes(countryCode) && !province ? ["Provincia mancante"] : []),
  ];
  return {
    valid: reasons.length === 0,
    confidence: reasons.length ? 0 : 0.92,
    source: "controllo_server",
    reasons,
    normalized: { recipient, address, zip, city, province, country_code: countryCode },
    verified_at: new Date().toISOString(),
  };
}

async function rows<T = any>(promise: PromiseLike<{ data: T[] | null; error: any }>) {
  const { data, error } = await promise;
  if (error) throw wmsGateError(error);
  return data || [];
}

async function activeReservations(admin: SupabaseAdmin, clienteId: string) {
  const reserved = new Map<string, number>();
  const [allTasks, massBatches, galluseBatches] = await Promise.all([
    rows(admin.from("wms_pick_tasks").select("id,order_id").in("stato", ["da_prelevare", "in_corso"])),
    rows(admin.from("wms_mass_pick_batches").select("id").eq("cliente_id", clienteId).eq("stato", "in_corso")),
    rows(admin.from("wms_galluse_batches").select("id").eq("cliente_id", clienteId).in("stato", ["da_associare_bag", "in_corso"])),
  ]);
  const taskOrders = allTasks.length
    ? await rows(admin.from("shopify_orders").select("id").eq("cliente_id", clienteId).in("id", allTasks.map((row: any) => row.order_id)))
    : [];
  const clientOrderIds = new Set(taskOrders.map((row: any) => row.id));
  const tasks = allTasks.filter((row: any) => clientOrderIds.has(row.order_id));
  const [pickLines, massLines, galluseLines] = await Promise.all([
    tasks.length ? rows(admin.from("wms_pick_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("task_id", tasks.map((row: any) => row.id))) : [],
    massBatches.length ? rows(admin.from("wms_mass_pick_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("batch_id", massBatches.map((row: any) => row.id))) : [],
    galluseBatches.length ? rows(admin.from("wms_galluse_lines").select("location_id,product_key,quantita_attesa,quantita_prelevata").in("batch_id", galluseBatches.map((row: any) => row.id))) : [],
  ]);
  for (const line of [...pickLines, ...massLines, ...galluseLines] as any[]) {
    add(reserved, balanceKey(line.location_id, line.product_key), Math.max(0, Number(line.quantita_attesa || 0) - Number(line.quantita_prelevata || 0)));
  }
  return reserved;
}

async function priorQueueReservations(admin: SupabaseAdmin, order: any, referencesById: Map<string, any>) {
  const queued = await rows(admin.from("shopify_orders").select("id,processed_at,created_at").eq("cliente_id", order.cliente_id).eq("wms_status", "da_preparare"));
  const ordered = [...queued.filter((row: any) => row.id !== order.id), order].sort((left: any, right: any) => {
    const byDate = String(left.processed_at || left.created_at || "").localeCompare(String(right.processed_at || right.created_at || ""));
    return byDate || String(left.id).localeCompare(String(right.id));
  });
  const priorIds = ordered.slice(0, Math.max(0, ordered.findIndex((row: any) => row.id === order.id))).map((row: any) => row.id);
  if (!priorIds.length) return new Map<string, number>();
  const priorItems = await rows(admin.from("shopify_order_items").select("referenza_id,quantita").in("order_id", priorIds).not("referenza_id", "is", null));
  const missingReferenceIds = [...new Set(priorItems.map((item: any) => item.referenza_id).filter((id: string) => !referencesById.has(id)))];
  if (missingReferenceIds.length) {
    const references = await rows(admin.from("referenze").select("id,ean,fnsku,sku").in("id", missingReferenceIds));
    references.forEach((reference: any) => referencesById.set(reference.id, reference));
  }
  const result = new Map<string, number>();
  for (const item of priorItems as any[]) {
    const key = productKey(referencesById.get(item.referenza_id));
    if (key) add(result, key, item.quantita);
  }
  return result;
}

async function physicalBalances(admin: SupabaseAdmin, clienteId: string, references: any[], locations: any[]) {
  const balance = new Map<string, number>();
  const referencesByFnsku = new Map(references.filter((row) => norm(row.fnsku)).map((row) => [norm(row.fnsku), row]));
  const referencesByEan = new Map(references.filter((row) => norm(row.ean)).map((row) => [norm(row.ean), row]));
  const entries = await rows(admin.from("entrate").select("id").eq("cliente_id", clienteId).in("stato", ACTIVE_ENTRY_STATUSES));
  const entryRows = entries.length
    ? await rows(admin.from("entrate_righe").select("id,ean,fnsku").in("entrata_id", entries.map((row: any) => row.id)))
    : [];
  const entryRowMap = new Map(entryRows.map((row: any) => [row.id, row]));
  const inbound = entryRows.length
    ? await rows(admin.from("wms_inbound_movements").select("entrata_riga_id,location_id,quantita,disposizione,created_at").in("entrata_riga_id", entryRows.map((row: any) => row.id)).eq("disposizione", "disponibile").order("created_at"))
    : [];
  for (const movement of inbound as any[]) {
    if (!movement.location_id) continue;
    const source: any = entryRowMap.get(movement.entrata_riga_id);
    const reference = referencesByFnsku.get(norm(source?.fnsku)) || referencesByEan.get(norm(source?.ean));
    const key = productKey(reference);
    if (key) add(balance, balanceKey(movement.location_id, key), movement.quantita);
  }

  const [placements, transfers, outbound, completedInventories] = await Promise.all([
    rows(admin.from("wms_stock_placements").select("location_id,product_key,quantita").eq("cliente_id", clienteId)),
    rows(admin.from("wms_stock_transfers").select("source_location_id,target_location_id,product_key,quantita,created_at").eq("cliente_id", clienteId).order("created_at")),
    rows(admin.from("wms_outbound_movements").select("location_id,product_key,quantita").eq("cliente_id", clienteId)),
    rows(admin.from("wms_inventory_sessions").select("id").eq("stato", "completata")),
  ]);
  for (const placement of placements as any[]) add(balance, balanceKey(placement.location_id, placement.product_key), placement.quantita);
  const inventory = completedInventories.length
    ? await rows(admin.from("wms_inventory_counts").select("location_id,product_key,quantita_attesa,quantita_contata").eq("cliente_id", clienteId).in("session_id", completedInventories.map((row: any) => row.id)))
    : [];
  for (const count of inventory as any[]) add(balance, balanceKey(count.location_id, count.product_key), Number(count.quantita_contata || 0) - Number(count.quantita_attesa || 0));
  for (const transfer of transfers as any[]) {
    const sourceKey = balanceKey(transfer.source_location_id, transfer.product_key);
    const moved = Math.min(Math.max(0, Number(balance.get(sourceKey) || 0)), Number(transfer.quantita || 0));
    add(balance, sourceKey, -moved);
    add(balance, balanceKey(transfer.target_location_id, transfer.product_key), moved);
  }
  for (const movement of outbound as any[]) add(balance, balanceKey(movement.location_id, movement.product_key), -Number(movement.quantita || 0));
  for (const [key, quantity] of balance) balance.set(key, Math.max(0, quantity));
  return { balance, locationMap: new Map(locations.map((location) => [location.id, location])) };
}

export async function evaluateWmsOrderGate(admin: SupabaseAdmin, orderId: string, actorId: string | null = null) {
  const orderResult = await admin.from("shopify_orders").select("*").eq("id", orderId).single();
  if (orderResult.error || !orderResult.data) throw orderResult.error ? wmsGateError(orderResult.error) : new Error("Ordine non trovato");
  const order = orderResult.data;
  if (!["in_verifica", "eccezione", "in_attesa_refill", "da_preparare"].includes(order.wms_status)) return order;
  const checkedAt = new Date().toISOString();
  const addressValidation = addressCheck(order);
  let update: any;
  let reason = "";

  if (!addressValidation.valid) {
    update = { wms_status: "eccezione", gate_status: "eccezione_indirizzo", exception_type: "indirizzo", exception_reasons: addressValidation.reasons, address_validation: addressValidation, stock_shortages: [], refill_requirements: [], gate_checked_at: checkedAt, unblocked_at: null, updated_at: checkedAt };
    reason = addressValidation.reasons.join("; ");
  } else {
    const items = await rows(admin.from("shopify_order_items").select("id,referenza_id,titolo,quantita").eq("order_id", order.id));
    const referenceIds = [...new Set(items.map((item: any) => item.referenza_id).filter(Boolean))];
    const references = referenceIds.length ? await rows(admin.from("referenze").select("id,cliente_id,titolo,ean,fnsku,sku").eq("cliente_id", order.cliente_id).in("id", referenceIds)) : [];
    const referencesById = new Map(references.map((reference: any) => [reference.id, reference]));
    const locations = await rows(admin.from("wms_locations").select("id,codice,tipo,stato").in("tipo", ["slot", "pallet"]));
    const [{ balance, locationMap }, reserved, queued] = await Promise.all([
      physicalBalances(admin, order.cliente_id, references, locations),
      activeReservations(admin, order.cliente_id),
      priorQueueReservations(admin, order, referencesById),
    ]);
    const required = new Map<string, { quantity: number; reference: any; title: string }>();
    const stockShortages: any[] = [];
    for (const item of items as any[]) {
      const reference = referencesById.get(item.referenza_id);
      const key = productKey(reference);
      if (!reference || !key) {
        stockShortages.push({ referenza_id: item.referenza_id || null, titolo: item.titolo || "Riga ordine", required: Number(item.quantita || 0), available: 0, missing: Number(item.quantita || 0), reason: "Referenza non collegata" });
        continue;
      }
      const current = required.get(key) || { quantity: 0, reference, title: reference.titolo || item.titolo };
      current.quantity += Number(item.quantita || 0);
      required.set(key, current);
    }
    const refillRequirements: any[] = [];
    const activeEmptySlot = locations.find((location: any) => location.tipo === "slot" && location.stato === "attiva" && ![...balance.keys()].some((key) => key.startsWith(`${location.id}:`) && Number(balance.get(key) || 0) > 0));
    for (const [key, demand] of required) {
      let slotAvailable = 0;
      let palletAvailable = 0;
      let existingSlot: any = null;
      for (const [locationProductKey, quantity] of balance) {
        if (!locationProductKey.endsWith(`:${key}`)) continue;
        const locationId = locationProductKey.slice(0, -(key.length + 1));
        const location: any = locationMap.get(locationId);
        if (!location || location.stato !== "attiva") continue;
        const available = Math.max(0, Number(quantity || 0) - Number(reserved.get(locationProductKey) || 0));
        if (location.tipo === "slot") { slotAvailable += available; existingSlot ||= location; }
        if (location.tipo === "pallet") palletAvailable += available;
      }
      let queueRemaining = Number(queued.get(key) || 0);
      const reservedFromSlot = Math.min(slotAvailable, queueRemaining);
      slotAvailable -= reservedFromSlot;
      queueRemaining -= reservedFromSlot;
      palletAvailable = Math.max(0, palletAvailable - queueRemaining);
      if (slotAvailable >= demand.quantity) continue;
      const remaining = demand.quantity - slotAvailable;
      const targetSlot = existingSlot || activeEmptySlot || null;
      if (palletAvailable >= remaining && targetSlot) {
        refillRequirements.push({ order_id: order.id, cliente_id: order.cliente_id, referenza_id: demand.reference.id, product_key: key, titolo: demand.title, quantita: remaining, pallet_available: palletAvailable, target_slot: { id: targetSlot.id, codice: targetSlot.codice } });
      } else {
        stockShortages.push({ referenza_id: demand.reference.id, titolo: demand.title, required: demand.quantity, available: slotAvailable + palletAvailable, missing: Math.max(0, demand.quantity - slotAvailable - palletAvailable), reason: !targetSlot ? "Nessuno slot attivo disponibile" : "Stock totale insufficiente" });
      }
    }
    if (stockShortages.length) {
      update = { wms_status: "eccezione", gate_status: "eccezione_stock", exception_type: "stock", exception_reasons: stockShortages.map((row) => row.titolo), address_validation: addressValidation, stock_shortages: stockShortages, refill_requirements: [], gate_checked_at: checkedAt, unblocked_at: null, updated_at: checkedAt };
      reason = "Stock insufficiente";
    } else if (refillRequirements.length) {
      update = { wms_status: "in_attesa_refill", gate_status: "attesa_refill", exception_type: null, exception_reasons: [], address_validation: { ...addressValidation, requires_replenishment: true }, stock_shortages: [], refill_requirements: refillRequirements, gate_checked_at: checkedAt, unblocked_at: null, updated_at: checkedAt };
      reason = "Stock disponibile a pallet: rifornimento slot richiesto";
    } else {
      update = { wms_status: "da_preparare", gate_status: "sbloccato", exception_type: null, exception_reasons: [], address_validation: { ...addressValidation, requires_replenishment: false }, stock_shortages: [], refill_requirements: [], gate_checked_at: checkedAt, unblocked_at: checkedAt, updated_at: checkedAt };
      reason = "Controlli automatici superati";
    }
  }

  const saved = await admin.from("shopify_orders").update(update).eq("id", order.id).select().single();
  if (saved.error) throw wmsGateError(saved.error);
  const event = await admin.from("wms_order_gate_events").insert({ order_id: order.id, cliente_id: order.cliente_id, from_status: order.gate_status || "da_verificare", to_status: update.gate_status, reason, details: { address_validation: update.address_validation, stock_shortages: update.stock_shortages }, created_by: actorId });
  if (event.error) throw wmsGateError(event.error);
  return saved.data;
}

export async function recheckWmsOrderGates(admin: SupabaseAdmin, clienteId: string | null, actorId: string | null, limit = 500) {
  let query = admin.from("shopify_orders").select("id").in("gate_status", ACTIVE_GATE_STATUSES).order("created_at", { ascending: true }).limit(Math.min(500, Math.max(1, limit)));
  if (clienteId) query = query.eq("cliente_id", clienteId);
  const pending = await rows(query);
  const results: any[] = [];
  for (const order of pending as any[]) {
    try { results.push({ id: order.id, order: await evaluateWmsOrderGate(admin, order.id, actorId) }); }
    catch (error) { results.push({ id: order.id, error: error instanceof Error ? error.message : "Verifica non riuscita" }); }
  }
  return { checked: results.length, unblocked: results.filter((row) => row.order?.gate_status === "sbloccato").length, results };
}

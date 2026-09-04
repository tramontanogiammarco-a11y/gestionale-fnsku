const ORDER_GATE_EXPECTATIONS = {
  eccezione: new Set(["eccezione_indirizzo", "eccezione_stock"]),
  in_attesa_refill: new Set(["attesa_refill"]),
  da_preparare: new Set(["sbloccato"]),
  hold: new Set(["hold_cliente"]),
};

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function productKey(row = {}) {
  if (row.product_key) return normalized(row.product_key);
  if (row.fnsku) return `fnsku:${normalized(row.fnsku)}`;
  if (row.ean) return `ean:${normalized(row.ean)}`;
  return "";
}

function ageMinutes(value, now) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.max(0, Math.floor((now.getTime() - timestamp) / 60000))
    : 0;
}

function issue(id, severity, kind, title, detail, action, to, metadata = {}) {
  return { id, severity, kind, title, detail, action, to, metadata };
}

export function buildWmsDiagnostics({
  orders = [],
  bags = [],
  activeBagCodes = [],
  locations = [],
  slotAssignments = [],
  stockIntegrityIssues = [],
  work = [],
  products = [],
  now = new Date(),
} = {}) {
  const issues = [];
  const activeBags = new Set(activeBagCodes.map((code) => normalized(code)).filter(Boolean));

  for (const order of orders) {
    const expectedGates = ORDER_GATE_EXPECTATIONS[order.wms_status];
    if (expectedGates && !expectedGates.has(order.gate_status)) {
      issues.push(issue(
        `order-gate:${order.id}`,
        "critical",
        "order",
        `${order.order_name || "Ordine"}: stato non coerente`,
        `Lo stato ${order.wms_status} non e compatibile con il gate ${order.gate_status || "mancante"}.`,
        "Ricontrolla l'ordine",
        "/wms/orders",
        { order_id: order.id },
      ));
    }
    if (order.wms_status === "in_verifica" && ageMinutes(order.updated_at || order.created_at, now) >= 15) {
      issues.push(issue(
        `order-verification:${order.id}`,
        "warning",
        "order",
        `${order.order_name || "Ordine"}: verifica ferma`,
        `Il controllo automatico non conclude da ${ageMinutes(order.updated_at || order.created_at, now)} minuti.`,
        "Ricontrolla l'ordine",
        "/wms/orders",
        { order_id: order.id },
      ));
    }
    if (order.wms_status === "in_attesa_refill" && !(order.refill_requirements || []).length) {
      issues.push(issue(
        `order-refill:${order.id}`,
        "critical",
        "order",
        `${order.order_name || "Ordine"}: refill senza dettaglio`,
        "L'ordine attende un refill ma non contiene alcuna referenza da rifornire.",
        "Ricontrolla l'ordine",
        "/wms/orders",
        { order_id: order.id },
      ));
    }
    if (order.wms_status === "da_preparare" && (order.refill_requirements || []).length) {
      issues.push(issue(
        `order-ready-refill:${order.id}`,
        "critical",
        "order",
        `${order.order_name || "Ordine"}: preparabile ma richiede refill`,
        "Il gate ha lasciato un fabbisogno refill su un ordine indicato come pronto.",
        "Ricontrolla l'ordine",
        "/wms/orders",
        { order_id: order.id },
      ));
    }
  }

  for (const bag of bags) {
    const code = normalized(bag.codice);
    const linked = activeBags.has(code);
    if (bag.stato !== "disponibile" && !linked && ageMinutes(bag.updated_at, now) >= 15) {
      issues.push(issue(
        `bag-orphan:${bag.id}`,
        "critical",
        "bag",
        `${bag.codice}: occupata senza attivita`,
        `La bag risulta ${bag.stato}, ma non e collegata a picking, refill o packing attivi.`,
        "Apri storico bag",
        "/wms-app/bag-storico",
        { bag_id: bag.id, bag_code: bag.codice },
      ));
    }
    if (bag.stato === "disponibile" && linked) {
      issues.push(issue(
        `bag-linked-free:${bag.id}`,
        "critical",
        "bag",
        `${bag.codice}: libera durante una lavorazione`,
        "La bag e collegata a una lavorazione attiva ma risulta disponibile per un nuovo utilizzo.",
        "Apri storico bag",
        "/wms-app/bag-storico",
        { bag_id: bag.id, bag_code: bag.codice },
      ));
    }
  }

  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const assignmentMap = new Map(slotAssignments.map((assignment) => [assignment.location_id, assignment]));
  for (const location of locations.filter((row) => row.tipo === "slot")) {
    const contents = location.contenuto || [];
    if (contents.length > 1) {
      issues.push(issue(
        `slot-mixed:${location.id}`,
        "critical",
        "stock",
        `${location.codice}: piu referenze nello stesso slot`,
        `${contents.length} referenze condividono uno slot che deve essere dedicato a un solo prodotto.`,
        "Apri lo slot",
        `/wms-app/ubicazioni?code=${encodeURIComponent(location.codice)}`,
        { location_id: location.id, location_code: location.codice },
      ));
    }
    for (const content of contents) {
      const assignment = assignmentMap.get(location.id);
      const contentKey = productKey(content);
      if (!assignment) {
        issues.push(issue(
          `slot-unassigned:${location.id}`,
          "warning",
          "stock",
          `${location.codice}: assegnazione mancante`,
          "Lo slot contiene stock ma non ha una referenza persistente assegnata.",
          "Apri lo slot",
          `/wms-app/ubicazioni?code=${encodeURIComponent(location.codice)}`,
          { location_id: location.id, location_code: location.codice },
        ));
      } else if (normalized(assignment.product_key) !== contentKey || assignment.cliente_id !== content.cliente_id) {
        issues.push(issue(
          `slot-conflict:${location.id}:${contentKey}`,
          "critical",
          "stock",
          `${location.codice}: referenza incompatibile`,
          "Il contenuto fisico calcolato non coincide con l'assegnazione persistente dello slot.",
          "Apri lo slot",
          `/wms-app/ubicazioni?code=${encodeURIComponent(location.codice)}`,
          { location_id: location.id, location_code: location.codice },
        ));
      }
    }
  }
  for (const assignment of slotAssignments) {
    if (!locationMap.has(assignment.location_id)) {
      issues.push(issue(
        `slot-missing:${assignment.location_id}`,
        "warning",
        "stock",
        "Assegnazione collegata a uno slot assente",
        "Una referenza e assegnata a un'ubicazione che non compare piu nell'anagrafica WMS.",
        "Apri stock",
        "/wms/stock",
        { location_id: assignment.location_id },
      ));
    }
  }

  for (const row of stockIntegrityIssues) {
    issues.push(issue(
      `stock-ledger:${row.id || `${row.kind}:${row.location_id}:${row.product_key}`}`,
      "critical",
      "stock",
      row.title || "Movimento stock incoerente",
      row.detail || "Un movimento richiede piu stock di quello disponibile nella sua ubicazione.",
      "Apri stock",
      row.location_code ? `/wms-app/ubicazioni?code=${encodeURIComponent(row.location_code)}` : "/wms/stock",
      row,
    ));
  }

  for (const row of work.filter((item) => item.stalled)) {
    issues.push(issue(
      `work-stalled:${row.kind}:${row.id}`,
      "warning",
      "mission",
      `${row.label}: lavorazione ferma`,
      `${row.detail || "Lavorazione"} non viene aggiornata da ${row.age_minutes} minuti.`,
      row.kind === "packing" ? "Apri Packing Station" : "Apri app operativa",
      row.kind === "packing" ? "/packing-station" : "/wms-app",
      { work_id: row.id, work_kind: row.kind },
    ));
  }

  const unlocated = products.filter((product) => Number(product.non_ubicato || 0) > 0);
  if (unlocated.length) {
    const quantity = unlocated.reduce((sum, product) => sum + Number(product.non_ubicato || 0), 0);
    issues.push(issue(
      "stock-unlocated",
      "warning",
      "stock",
      `${quantity} pezzi senza ubicazione operativa`,
      `${unlocated.length} referenze risultano disponibili nello storico ma non sono collocate in slot o pallet.`,
      "Apri stock",
      "/wms/stock",
      { references: unlocated.length, quantity },
    ));
  }

  const uniqueIssues = [...new Map(issues.map((row) => [row.id, row])).values()]
    .sort((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical") || left.title.localeCompare(right.title, "it"));
  return {
    issues: uniqueIssues,
    summary: {
      total: uniqueIssues.length,
      critical: uniqueIssues.filter((row) => row.severity === "critical").length,
      warning: uniqueIssues.filter((row) => row.severity === "warning").length,
      orders: uniqueIssues.filter((row) => row.kind === "order").length,
      bags: uniqueIssues.filter((row) => row.kind === "bag").length,
      stock: uniqueIssues.filter((row) => row.kind === "stock").length,
      missions: uniqueIssues.filter((row) => row.kind === "mission").length,
    },
  };
}

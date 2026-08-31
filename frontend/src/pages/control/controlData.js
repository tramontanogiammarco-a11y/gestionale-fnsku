import { api } from "@/lib/api";

export function queryForClient(clientId) {
  return clientId ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
}

export async function loadControlData({ clientId, clients, includeStock = true }) {
  const suffix = queryForClient(clientId);
  const [ordersRes, shipmentsRes, ticketsRes, returnsRes] = await Promise.all([
    api.get(`/shopify/orders${suffix}`),
    api.get(`/wms/spedizioni${suffix}`),
    api.get(`/wms/tickets${suffix}`).catch(() => ({ data: [] })),
    api.get(`/wms/resi${suffix}`).catch(() => ({ data: [] })),
  ]);

  let stock = [];
  if (includeStock) {
    if (clientId || !clients?.length) {
      stock = (await api.get(`/magazzino${suffix}`)).data || [];
    } else {
      const chunks = await Promise.all(clients.map(async (client) => {
        const response = await api.get(`/magazzino?cliente_id=${encodeURIComponent(client.id)}`);
        return (response.data || []).map((row) => ({ ...row, cliente_id: client.id, cliente_nome: client.ragione_sociale }));
      }));
      stock = chunks.flat();
    }
  }
  return {
    orders: ordersRes.data || [],
    shipments: shipmentsRes.data || [],
    tickets: ticketsRes.data || [],
    returns: returnsRes.data || [],
    stock,
  };
}

export const ORDER_STATUS = {
  in_verifica: { label: "In verifica", tone: "sky" },
  eccezione: { label: "Eccezione", tone: "rose" },
  da_preparare: { label: "Nuovo", tone: "amber" },
  in_preparazione: { label: "In preparazione", tone: "sky" },
  in_attesa_packing: { label: "Pronto da imballare", tone: "violet" },
  in_packing: { label: "In imballaggio", tone: "sky" },
  imballato: { label: "Imballato", tone: "violet" },
  spedito: { label: "Spedito", tone: "teal" },
  annullato: { label: "Annullato", tone: "slate" },
};

export const SHIPMENT_STATUS = {
  bozza: "Bozza", da_inviare: "Da inviare", creata: "Etichetta creata",
  in_transito: "In transito", in_consegna: "In consegna", consegnata: "Consegnata",
  giacenza: "In giacenza", indirizzo_errato: "Indirizzo errato",
  consegna_fallita: "Consegna fallita", ritardo: "In ritardo", danneggiata: "Danneggiata",
  smarrita: "Smarrita", rientro_mittente: "Rientro al mittente", errore: "Errore", annullata: "Annullata",
};

export const EXCEPTION_STATUSES = new Set(["giacenza", "indirizzo_errato", "consegna_fallita", "ritardo", "danneggiata", "smarrita", "rientro_mittente", "errore"]);

export function exceptionGuidance(subject = {}) {
  const reasons = Array.isArray(subject.exception_reasons)
    ? subject.exception_reasons.filter(Boolean).map(String)
    : subject.exception_reasons ? [String(subject.exception_reasons)] : [];

  if (subject.exception_type === "stock") {
    const shortages = Array.isArray(subject.stock_shortages) ? subject.stock_shortages : [];
    const details = shortages.map((row) => {
      const name = row.titolo || row.sku || row.ean || "Prodotto";
      const required = Number(row.required);
      const available = Number(row.available);
      const missing = Number(row.missing);
      if (Number.isFinite(required) && Number.isFinite(available)) {
        return `${name}: richiesti ${required}, disponibili ${available}, mancanti ${Number.isFinite(missing) ? missing : Math.max(0, required - available)}`;
      }
      return name;
    });
    return {
      reason: (details.length ? details : reasons).join(" · ") || "Quantita disponibile insufficiente",
      action: "Rifornisci le referenze mancanti. Appena lo stock torna disponibile, ricontrolla l'ordine per sbloccarlo.",
    };
  }

  if (subject.exception_type === "indirizzo") {
    const reason = reasons.join(" · ") || "Indirizzo incompleto o non verificato";
    const normalized = reason.toLowerCase();
    let action = "Apri Modifica, correggi i dati del destinatario e salva: l'ordine tornera automaticamente in verifica.";
    if (normalized.includes("cap")) action = "Correggi il CAP con 5 cifre e verifica che corrisponda alla citta, poi salva l'ordine.";
    else if (normalized.includes("provincia")) action = "Inserisci la sigla della provincia, per esempio RM o MI, poi salva l'ordine.";
    else if (normalized.includes("civico") || normalized.includes("numero")) action = "Aggiungi il numero civico all'indirizzo e salva nuovamente l'ordine.";
    else if (normalized.includes("incomplet") || normalized.includes("mancant")) action = "Completa nome, via, numero civico, CAP, citta, provincia e paese, poi salva l'ordine.";
    return { reason, action };
  }

  if (EXCEPTION_STATUSES.has(subject.stato)) {
    const shipmentActions = {
      giacenza: "Contatta il destinatario e comunica al corriere le istruzioni di riconsegna o svincolo.",
      indirizzo_errato: "Correggi l'indirizzo del destinatario e chiedi al corriere lo svincolo della spedizione.",
      consegna_fallita: "Verifica il motivo del tentativo fallito e concorda una nuova consegna con destinatario e corriere.",
      ritardo: "Controlla il tracking e apri una segnalazione al corriere se non ci sono aggiornamenti.",
      danneggiata: "Apri una pratica con il corriere e allega le prove del danno.",
      smarrita: "Apri subito una ricerca spedizione con il corriere.",
      rientro_mittente: "Verifica il motivo del rientro e decidi se rispedire o rimborsare.",
      errore: "Controlla il dettaglio tecnico e riprova; se persiste, apri un ticket operativo.",
    };
    return {
      reason: subject.note || SHIPMENT_STATUS[subject.stato] || "Problema di consegna",
      action: shipmentActions[subject.stato] || "Verifica il tracking e contatta il corriere.",
    };
  }

  return {
    reason: reasons.join(" · ") || subject.note || "Richiede verifica operativa",
    action: "Controlla i dati dell'ordine e apri un ticket se serve assistenza.",
  };
}

export function orderPieces(order) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Date(value).toLocaleString("it-IT", withTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

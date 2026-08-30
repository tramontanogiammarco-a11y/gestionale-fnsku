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
  da_preparare: { label: "Nuovo", tone: "amber" },
  in_preparazione: { label: "In preparazione", tone: "sky" },
  pronto: { label: "Pronto", tone: "violet" },
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

export function orderPieces(order) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.quantita || 0), 0);
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Date(value).toLocaleString("it-IT", withTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

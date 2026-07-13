import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  shipment_id?: string;
  carrier_name?: string;
  carrier_id?: number | string | null;
  carrier_service?: string | null;
  weight_kg?: number | string | null;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
    if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ detail: "Variabili Supabase mancanti" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ detail: "Non autenticato" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ detail: "Sessione non valida" }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !["admin", "staff"].includes(profile?.role)) {
      return json({ detail: "Accesso riservato allo staff" }, 403);
    }

    const payload: Payload = await req.json().catch(() => ({}));
    const shipmentId = String(payload.shipment_id || "").trim();
    if (!shipmentId) return json({ detail: "Spedizione obbligatoria" }, 400);

    const apiKey = Deno.env.get("SHIPPYPRO_API_KEY");
    if (!apiKey) return json({ detail: "Configura SHIPPYPRO_API_KEY su Supabase" }, 400);

    const fromAddress = senderAddressFromEnv();
    const missingSender = requiredSenderFields(fromAddress);
    if (missingSender.length) {
      return json({ detail: `Configura mittente ShippyPro su Supabase: ${missingSender.join(", ")}` }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: shipment, error: shipmentError } = await adminClient
      .from("wms_shipments")
      .select("*, shopify_orders(*)")
      .eq("id", shipmentId)
      .single();
    if (shipmentError || !shipment) return json({ detail: shipmentError?.message || "Spedizione non trovata" }, 404);
    if (shipment.stato === "creata" && shipment.tracking) {
      return json({ ok: true, shipment, detail: "Etichetta gia generata" });
    }

    const carrier = resolveCarrier(payload, shipment.corriere);
    if (!carrier.name || !carrier.id) {
      return json({
        detail: `Manca configurazione ShippyPro per ${String(shipment.corriere || "corriere").toUpperCase()}: imposta SHIPPYPRO_CARRIER_NAME_${String(shipment.corriere || "").toUpperCase()} e SHIPPYPRO_CARRIER_ID_${String(shipment.corriere || "").toUpperCase()}`,
      }, 400);
    }

    const order = shipment.shopify_orders;
    const destinatario = shipment.destinatario || {};
    const missingRecipient = requiredRecipientFields(destinatario);
    if (missingRecipient.length) {
      return json({ detail: `Mancano dati destinatario: ${missingRecipient.join(", ")}` }, 400);
    }
    if (needsItalianStreetNumber(shipment.corriere, destinatario) && !hasStreetNumber(destinatario.indirizzo1)) {
      return json({
        detail: "Aggiungi il numero civico nell'indirizzo destinatario prima di generare l'etichetta GLS/BRT.",
      }, 400);
    }
    if (!requiredShipmentWeight(payload.weight_kg || shipment.peso_kg)) {
      return json({
        detail: "Inserisci il peso in kg nei dati spedizione prima di generare l'etichetta GLS/BRT.",
      }, 400);
    }

    const currency = order?.currency || "EUR";
    const totalValue = `${Number(order?.total_price || 0).toFixed(2)} ${currency}`;
    const commonParams = {
      to_address: {
        name: destinatario.nome,
        company: destinatario.azienda || "",
        street1: destinatario.indirizzo1,
        street2: destinatario.indirizzo2 || "",
        city: destinatario.citta,
        state: normalizeProvince(destinatario.paese_codice || "IT", destinatario.provincia),
        zip: destinatario.cap,
        country: normalizeCountry(destinatario.paese_codice || "IT"),
        phone: destinatario.telefono || fromAddress.phone,
        email: destinatario.email || fromAddress.email,
      },
      from_address: fromAddress,
      parcels: buildParcels(Number(shipment.colli || 1), payload.weight_kg || shipment.peso_kg),
      TotalValue: totalValue,
      Insurance: 0,
      InsuranceCurrency: currency,
      CashOnDelivery: 0,
      CashOnDeliveryCurrency: currency,
      ContentDescription: "Ordine ecommerce",
    };
    const transactionId = cleanTransactionId(`${order?.order_name || "ordine"}-${shipment.id}`);
    const directCarrier = isDirectLabelCarrier(shipment.corriere);
    const rate = directCarrier ? null : await getBestRate(apiKey, commonParams, carrier, transactionId);
    const detailedPricing = normalizeDetailedPricing(rate?.detailed_pricing);

    const shippyPayload = {
      Method: "Ship",
      Params: {
        ...commonParams,
        TransactionID: transactionId,
        ...(directCarrier ? {} : { MarketplacePlatform: order?.shop_domain ? "Shopify" : "WMS" }),
        CashOnDeliveryType: 0,
        CarrierName: directCarrier ? carrier.name : stringFromRate(rate?.carrier) || carrier.name,
        CarrierID: Number(directCarrier ? carrier.id : stringFromRate(rate?.carrier_id) || carrier.id),
        CarrierService: directCarrier ? carrier.service || "Standard" : stringFromRate(rate?.service) || carrier.service || "Standard",
        ...(!directCarrier && rate?.rate_id ? { RateID: String(rate.rate_id) } : {}),
        ...(!directCarrier && rate?.order_id ? { OrderID: String(rate.order_id) } : {}),
        ...(rate?.rate ? { ShipmentCost: Number(rate.rate), ShipmentCostCurrency: currency } : {}),
        ...(detailedPricing.length && rate?.zone_name ? { zone_name: String(rate.zone_name) } : {}),
        ...(detailedPricing.length && rate?.weight_range ? { weight_range: String(rate.weight_range) } : {}),
        ...(detailedPricing.length ? { detailed_pricing: detailedPricing } : {}),
        ...(directCarrier ? {} : { BillAccountNumber: "", PaymentMethod: order?.financial_status || "" }),
        LabelType: "PDF",
        Async: false,
      },
    };
    const requestPayload = directCarrier ? minimalShipPayload(shippyPayload, { includeRateFields: false }) : shippyPayload;

    let shipped: Record<string, unknown>;
    let alreadyCreatedOrderId = shippyOrderIdFromShipment(shipment);
    let generatedOrderId = alreadyCreatedOrderId;
    try {
      if (alreadyCreatedOrderId) {
        const labelResponse = await getLabelUrlWithRetry(apiKey, alreadyCreatedOrderId);
        shipped = mergeShippyResponses({ NewOrderID: alreadyCreatedOrderId, OrderID: alreadyCreatedOrderId }, labelResponse);
      } else {
        shipped = directCarrier ? await shippyproJson(apiKey, requestPayload) : await shipWithCarrierFallback(apiKey, requestPayload);
        const createdOrderId = shippyOrderId(shipped);
        generatedOrderId = createdOrderId || generatedOrderId;
        if (createdOrderId) {
          await adminClient
            .from("wms_shipments")
            .update({
              carrier_reference: createdOrderId,
              payload: requestPayload,
              response: shipped,
              updated_at: new Date().toISOString(),
            })
            .eq("id", shipment.id);
        }
        if (createdOrderId && !hasLabelOrTracking(shipped)) {
          const labelResponse = await getLabelUrlWithRetry(apiKey, createdOrderId);
          shipped = mergeShippyResponses(shipped, labelResponse);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore creazione etichetta ShippyPro";
      const response = error instanceof ShippyProApiError ? error.body : null;
      const savedOrderId = response ? shippyOrderId(response) || generatedOrderId : generatedOrderId;
      await adminClient
        .from("wms_shipments")
        .update({
          stato: "errore",
          payload: requestPayload,
          response,
          errore: message,
          ...(savedOrderId ? { carrier_reference: savedOrderId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id);
      throw error;
    }
    const nestedLabelUrl = findNestedString(shipped, LABEL_URL_KEYS);
    const pdfValue = firstPdf(shipped);
    const labelUrl = normalizeLabelUrl(shipped?.LabelURL) || urlLike(pdfValue) || nestedLabelUrl;
    const pdfBase64 = pdfValue && !urlLike(pdfValue) ? pdfValue : null;
    const labelPath = pdfBase64
      ? await storeBase64Pdf(adminClient, shipment.cliente_id, shipment.id, pdfBase64)
      : null;

    const finalLabelUrl = labelPath
      ? storagePublicUrl(supabaseUrl, "gestionale-files", labelPath)
      : labelUrl;

    const tracking = shipped?.TrackingNumber || firstParcelTracking(shipped) || findNestedString(shipped, TRACKING_KEYS) || null;
    const createdOrderId = shippyOrderId(shipped);
    if (!finalLabelUrl && !tracking) {
      const apiError = shippyproError(shipped);
      const message = createdOrderId
        ? [
          `ShippyPro ha creato l'ordine ${createdOrderId}, ma la label non e ancora disponibile.`,
          "Riprova tra qualche secondo: ora la recupero senza creare doppioni.",
          apiError ? `Dettaglio ShippyPro: ${apiError}` : `Risposta ricevuta: ${summarizeShippyResponse(shipped)}`,
        ].join(" ")
        : apiError || `ShippyPro non ha restituito etichetta o tracking. Risposta ricevuta: ${summarizeShippyResponse(shipped)}`;
      await adminClient
        .from("wms_shipments")
        .update({
          stato: "errore",
          payload: requestPayload,
          response: shipped,
          errore: message,
          ...(createdOrderId ? { carrier_reference: createdOrderId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id);
      throw new Error(message);
    }

    const { data: updated, error: updateError } = await adminClient
      .from("wms_shipments")
      .update({
        stato: "creata",
        tracking,
        label_url: finalLabelUrl,
        carrier_reference: String(createdOrderId || shipment.id),
        payload: requestPayload,
        response: shipped,
        errore: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipment.id)
      .select()
      .single();
    if (updateError) return json({ detail: updateError.message }, 400);

    if (order?.id) {
      await adminClient.from("shopify_orders").update({ wms_status: "spedito", updated_at: new Date().toISOString() }).eq("id", order.id);
    }

    return json({ ok: true, shipment: updated, tracking, label_url: updated.label_url });
  } catch (error) {
    console.error("shippypro-create-label", error);
    return json({ detail: error instanceof Error ? error.message : "Errore creazione etichetta ShippyPro" }, 500);
  }
});

function senderAddressFromEnv() {
  const country = normalizeCountry(Deno.env.get("SHIPPYPRO_SENDER_COUNTRY") || "IT");
  return {
    name: Deno.env.get("SHIPPYPRO_SENDER_NAME") || "Aimago",
    company: Deno.env.get("SHIPPYPRO_SENDER_COMPANY") || "AIMAGO SRLS",
    street1: Deno.env.get("SHIPPYPRO_SENDER_ADDRESS1") || "",
    street2: Deno.env.get("SHIPPYPRO_SENDER_ADDRESS2") || "",
    city: Deno.env.get("SHIPPYPRO_SENDER_CITY") || "",
    state: normalizeProvince(country, Deno.env.get("SHIPPYPRO_SENDER_STATE") || ""),
    zip: Deno.env.get("SHIPPYPRO_SENDER_ZIP") || "",
    country,
    phone: Deno.env.get("SHIPPYPRO_SENDER_PHONE") || "",
    email: Deno.env.get("SHIPPYPRO_SENDER_EMAIL") || "",
  };
}

function requiredSenderFields(address: Record<string, unknown>) {
  const fields = [
    ["SHIPPYPRO_SENDER_NAME", address.name],
    ["SHIPPYPRO_SENDER_ADDRESS1", address.street1],
    ["SHIPPYPRO_SENDER_ZIP", address.zip],
    ["SHIPPYPRO_SENDER_CITY", address.city],
    ["SHIPPYPRO_SENDER_PHONE", address.phone],
    ["SHIPPYPRO_SENDER_EMAIL", address.email],
  ];
  if (normalizeCountry(address.country) === "IT") fields.push(["SHIPPYPRO_SENDER_STATE", address.state]);
  return fields.filter(([, value]) => !value).map(([key]) => key as string);
}

function requiredRecipientFields(destinatario: Record<string, unknown>) {
  const fields = [
    ["nome", destinatario.nome],
    ["indirizzo", destinatario.indirizzo1],
    ["CAP", destinatario.cap],
    ["citta", destinatario.citta],
    ["telefono", destinatario.telefono],
    ["email", destinatario.email],
  ];
  if (normalizeCountry(destinatario.paese_codice || destinatario.paese || "IT") === "IT") fields.push(["provincia", destinatario.provincia]);
  return fields.filter(([, value]) => !value).map(([key]) => key as string);
}

function requiredShipmentWeight(weight: unknown) {
  const value = Number(weight || 0);
  return Number.isFinite(value) && value > 0;
}

function needsItalianStreetNumber(corriere: unknown, destinatario: Record<string, unknown>) {
  const carrier = String(corriere || "").trim().toLowerCase();
  const country = normalizeCountry(destinatario.paese_codice || destinatario.paese || "IT");
  return country === "IT" && ["gls", "brt"].includes(carrier);
}

function isDirectLabelCarrier(corriere: unknown) {
  return ["gls", "brt"].includes(String(corriere || "").trim().toLowerCase());
}

function hasStreetNumber(value: unknown) {
  return /\d/.test(String(value || ""));
}

async function getBestRate(
  apiKey: string,
  commonParams: Record<string, unknown>,
  carrier: { name: string; id: string; service: string },
  transactionId: string,
) {
  const ratesResponse = await shippyproJson(apiKey, {
    Method: "GetRates",
    Params: {
      ...commonParams,
      ShippingService: carrier.service || "Standard",
      RateCarriers: [`${carrier.name}|${carrier.id}`],
      TransactionID: transactionId,
    },
  });

  const rates = Array.isArray(ratesResponse?.Rates) ? ratesResponse.Rates as Array<Record<string, unknown>> : [];
  const carrierId = String(carrier.id);
  const carrierName = carrier.name.toLowerCase();
  const carrierService = carrier.service.toLowerCase();
  const matched = rates.find((rate) => {
    const sameId = String(rate.carrier_id || "") === carrierId;
    const sameName = String(rate.carrier || "").toLowerCase() === carrierName;
    const sameService = !carrierService || String(rate.service || "").toLowerCase() === carrierService;
    return (sameId || sameName) && sameService;
  }) || rates.find((rate) => String(rate.carrier_id || "") === carrierId)
    || rates.find((rate) => String(rate.carrier || "").toLowerCase() === carrierName)
    || rates[0];

  if (!matched) {
    const ratesErrors = Array.isArray(ratesResponse?.RatesErrors) ? ratesResponse.RatesErrors : [];
    const detail = ratesErrors.map((entry) => rateErrorMessage(entry)).filter(Boolean).join(" | ");
    throw new Error(detail || "ShippyPro non ha trovato una tariffa valida per questo corriere e indirizzo.");
  }

  return matched;
}

function rateErrorMessage(entry: unknown) {
  const row = entry as Record<string, unknown>;
  return [
    row?.carrier_label || row?.carrier,
    row?.error_message || row?.message || row?.error,
  ].filter(Boolean).join(": ");
}

function stringFromRate(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeDetailedPricing(value: unknown) {
  if (Array.isArray(value)) return value.filter(isPricingItem);
  if (isPricingItem(value)) return [value];
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(isPricingItem);
  }
  return [];
}

function isPricingItem(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Boolean(item.type && item.price !== undefined && item.desc);
}

function resolveCarrier(payload: Payload, corriere: string | null | undefined) {
  const key = String(corriere || "").trim().toUpperCase();
  const service = String(payload.carrier_service || Deno.env.get(`SHIPPYPRO_CARRIER_SERVICE_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_SERVICE") || "").trim();
  return {
    name: String(payload.carrier_name || Deno.env.get(`SHIPPYPRO_CARRIER_NAME_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_NAME") || "").trim(),
    id: String(payload.carrier_id || Deno.env.get(`SHIPPYPRO_CARRIER_ID_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_ID") || "").trim(),
    service,
  };
}

function cleanTransactionId(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/\//g, "-")
    .replace(/[#"]/g, "")
    .slice(0, 255);
}

function normalizeCountry(value: unknown) {
  const country = String(value || "IT").trim().toUpperCase();
  if (country === "ITALIA" || country === "ITALY") return "IT";
  return country || "IT";
}

function normalizeProvince(country: unknown, value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (normalizeCountry(country) !== "IT") return raw;
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (compact.length === 2) return compact;
  return ITALIAN_PROVINCES[compact] || raw;
}

const ITALIAN_PROVINCES: Record<string, string> = {
  AGRIGENTO: "AG",
  ALESSANDRIA: "AL",
  ANCONA: "AN",
  AOSTA: "AO",
  AREZZO: "AR",
  ASCOLIPICENO: "AP",
  ASTI: "AT",
  AVELLINO: "AV",
  BARI: "BA",
  BARLETTAANDRIATRANI: "BT",
  BELLUNO: "BL",
  BENEVENTO: "BN",
  BERGAMO: "BG",
  BIELLA: "BI",
  BOLOGNA: "BO",
  BOLZANO: "BZ",
  BRESCIA: "BS",
  BRINDISI: "BR",
  CAGLIARI: "CA",
  CALTANISSETTA: "CL",
  CAMPOBASSO: "CB",
  CASERTA: "CE",
  CATANIA: "CT",
  CATANZARO: "CZ",
  CHIETI: "CH",
  COMO: "CO",
  COSENZA: "CS",
  CREMONA: "CR",
  CROTONE: "KR",
  CUNEO: "CN",
  ENNA: "EN",
  FERMO: "FM",
  FERRARA: "FE",
  FIRENZE: "FI",
  FOGGIA: "FG",
  FORLICESENA: "FC",
  FROSINONE: "FR",
  GENOVA: "GE",
  GORIZIA: "GO",
  GROSSETO: "GR",
  IMPERIA: "IM",
  ISERNIA: "IS",
  LASPEZIA: "SP",
  LAQUILA: "AQ",
  LATINA: "LT",
  LECCE: "LE",
  LECCO: "LC",
  LIVORNO: "LI",
  LODI: "LO",
  LUCCA: "LU",
  MACERATA: "MC",
  MANTOVA: "MN",
  MASSACARRARA: "MS",
  MATERA: "MT",
  MESSINA: "ME",
  MILANO: "MI",
  MODENA: "MO",
  MONZABRIANZA: "MB",
  NAPOLI: "NA",
  NOVARA: "NO",
  NUORO: "NU",
  ORISTANO: "OR",
  PADOVA: "PD",
  PALERMO: "PA",
  PARMA: "PR",
  PAVIA: "PV",
  PERUGIA: "PG",
  PESAROEURBINO: "PU",
  PESCARA: "PE",
  PIACENZA: "PC",
  PISA: "PI",
  PISTOIA: "PT",
  PORDENONE: "PN",
  POTENZA: "PZ",
  PRATO: "PO",
  RAGUSA: "RG",
  RAVENNA: "RA",
  REGGIOCALABRIA: "RC",
  REGGIOEMILIA: "RE",
  RIETI: "RI",
  RIMINI: "RN",
  ROMA: "RM",
  ROVIGO: "RO",
  SALERNO: "SA",
  SASSARI: "SS",
  SAVONA: "SV",
  SIENA: "SI",
  SIRACUSA: "SR",
  SONDRIO: "SO",
  SUDSARDEGNA: "SU",
  TARANTO: "TA",
  TERAMO: "TE",
  TERNI: "TR",
  TORINO: "TO",
  TRAPANI: "TP",
  TRENTO: "TN",
  TREVISO: "TV",
  TRIESTE: "TS",
  UDINE: "UD",
  VARESE: "VA",
  VENEZIA: "VE",
  VERBANOCUSIOOSSOLA: "VB",
  VERCELLI: "VC",
  VERONA: "VR",
  VIBOVALENTIA: "VV",
  VICENZA: "VI",
  VITERBO: "VT",
};

function buildParcels(colli: number, weight: number | string | null | undefined) {
  const safeColli = Math.max(1, Math.min(50, Number(colli || 1)));
  const totalWeight = Math.max(0.1, Number(weight || 1));
  const weightPerParcel = Number(Math.max(0.1, totalWeight / safeColli).toFixed(3));
  const length = Number(Deno.env.get("SHIPPYPRO_PARCEL_LENGTH_CM") || 30);
  const width = Number(Deno.env.get("SHIPPYPRO_PARCEL_WIDTH_CM") || 20);
  const height = Number(Deno.env.get("SHIPPYPRO_PARCEL_HEIGHT_CM") || 15);

  return Array.from({ length: safeColli }, (_, index) => ({
    length,
    width,
    height,
    weight: weightPerParcel,
    Attributes: {
      parcelID: String(index + 1),
      parcelType: "Box",
    },
  }));
}

async function shippyproJson(apiKey: string, body: Record<string, unknown>) {
  const response = await fetch("https://www.shippypro.com/api/v1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      Referer: "aimago-wms",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ShippyProApiError(shippyproError(data) || `ShippyPro HTTP ${response.status}`, data, response.status);
  const error = shippyproError(data);
  if (error && !normalizeLabelUrl(data?.LabelURL) && !firstPdf(data)) {
    throw new ShippyProApiError(error, data, response.status);
  }
  return data;
}

async function shipWithCarrierFallback(apiKey: string, body: Record<string, unknown>) {
  try {
    return await shippyproJson(apiKey, body);
  } catch (error) {
    const params = (body.Params || {}) as Record<string, unknown>;
    const firstError = error;

    try {
      return await shippyproJson(apiKey, minimalShipPayload(body));
    } catch (_) {
      // Some ShippyPro/GLS accounts reject optional pricing/platform fields.
      // If the compact payload also fails, try once without the service name.
    }

    if (!params.CarrierService) throw firstError;

    const retryBody = {
      ...body,
      Params: {
        ...params,
        CarrierService: undefined,
      },
    };
    delete (retryBody.Params as Record<string, unknown>).CarrierService;

    try {
      return await shippyproJson(apiKey, retryBody);
    } catch (serviceLessError) {
      try {
        return await shippyproJson(apiKey, minimalShipPayload(retryBody));
      } catch (_) {
        throw serviceLessError;
      }
    }
  }
}

class ShippyProApiError extends Error {
  body: Record<string, unknown>;
  status: number;

  constructor(message: string, body: Record<string, unknown>, status: number) {
    super(message);
    this.name = "ShippyProApiError";
    this.body = body;
    this.status = status;
  }
}

function minimalShipPayload(body: Record<string, unknown>, options: { includeRateFields?: boolean } = {}) {
  const params = (body.Params || {}) as Record<string, unknown>;
  const minimalParams: Record<string, unknown> = {
    to_address: params.to_address,
    from_address: params.from_address,
    parcels: params.parcels,
    TransactionID: params.TransactionID,
    ContentDescription: params.ContentDescription,
    CarrierName: params.CarrierName,
    CarrierID: params.CarrierID,
    CarrierService: params.CarrierService,
    LabelType: "PDF",
  };

  if (options.includeRateFields !== false) {
    if (params.RateID) minimalParams.RateID = params.RateID;
    if (params.OrderID) minimalParams.OrderID = params.OrderID;
  }

  for (const key of Object.keys(minimalParams)) {
    if (minimalParams[key] === undefined || minimalParams[key] === null || minimalParams[key] === "") {
      delete minimalParams[key];
    }
  }

  return {
    Method: "Ship",
    Params: minimalParams,
  };
}

async function getLabelUrlWithRetry(apiKey: string, orderId: string, attempts = 3) {
  let lastResponse: Record<string, unknown> | null = null;
  const numericOrderId = /^\d+$/.test(orderId) ? Number(orderId) : orderId;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(1200);
    for (const requestBody of [
      { Method: "GetLabelUrl", Params: { OrderID: numericOrderId, LabelType: "PDF" } },
      { Method: "GetOrder", Params: { OrderID: numericOrderId } },
    ]) {
      try {
        const response = await shippyproJson(apiKey, requestBody);
        lastResponse = mergeShippyResponses({ NewOrderID: orderId, OrderID: orderId }, response);
        if (hasLabelOrTracking(lastResponse)) return lastResponse;
      } catch (error) {
        if (!(error instanceof ShippyProApiError)) throw error;
        lastResponse = mergeShippyResponses(
          { NewOrderID: orderId, OrderID: orderId },
          error.body || {},
        );
      }
    }
  }
  return lastResponse || { NewOrderID: orderId, OrderID: orderId };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasLabelOrTracking(response: Record<string, unknown>) {
  const pdfValue = firstPdf(response);
  return Boolean(
    normalizeLabelUrl(response?.LabelURL) ||
      urlLike(pdfValue) ||
      pdfValue ||
      response?.TrackingNumber ||
      firstParcelTracking(response) ||
      findNestedString(response, LABEL_URL_KEYS) ||
      findNestedString(response, TRACKING_KEYS)
  );
}

function shippyOrderId(response: Record<string, unknown> | null | undefined) {
  if (!response) return "";
  const direct = response.NewOrderID || response.OrderID || response.order_id || response.id;
  const nested = findNestedPrimitive(response, ORDER_ID_KEYS);
  return String(direct || nested || "").trim();
}

function shippyOrderIdFromShipment(shipment: Record<string, unknown>) {
  const response = shipment.response && typeof shipment.response === "object"
    ? shipment.response as Record<string, unknown>
    : null;
  const errorText = typeof shipment.errore === "string" ? shipment.errore : "";
  return String(shipment.carrier_reference || shippyOrderId(response) || shippyOrderIdFromText(errorText) || "").trim();
}

function shippyOrderIdFromText(value: string) {
  return value.match(/(?:NewOrderID|OrderID)\s*=\s*([0-9]+)/i)?.[1] || "";
}

function mergeShippyResponses(shipResponse: Record<string, unknown>, labelResponse: Record<string, unknown>) {
  return {
    ...shipResponse,
    ...labelResponse,
    ShipResponse: shipResponse,
    LabelResponse: labelResponse,
    NewOrderID: shipResponse.NewOrderID || shipResponse.OrderID || labelResponse.OrderID || labelResponse.NewOrderID,
  };
}

function normalizeLabelUrl(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return String(value.find((entry) => typeof entry === "string" && entry.trim()) || "").trim() || null;
  return null;
}

function urlLike(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

const LABEL_URL_KEYS = new Set(["labelurl", "label_url", "label", "url", "pdfurl", "pdf_url"]);
const PDF_KEYS = new Set(["pdf", "labelpdf", "label_pdf"]);
const TRACKING_KEYS = new Set(["trackingnumber", "tracking_number", "trackingcode", "tracking_code", "tracking"]);
const ORDER_ID_KEYS = new Set(["neworderid", "orderid", "order_id", "id"]);

function findNestedString(value: unknown, keys: Set<string>): string | null {
  if (!value) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNestedString(entry, keys);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (keys.has(normalizeKey(key)) && typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
  }
  for (const entry of Object.values(record)) {
    const found = findNestedString(entry, keys);
    if (found) return found;
  }
  return null;
}

function findNestedPrimitive(value: unknown, keys: Set<string>): string | number | null {
  if (!value || typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNestedPrimitive(entry, keys);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (keys.has(normalizeKey(key)) && (typeof entry === "string" || typeof entry === "number") && String(entry).trim()) {
      return entry;
    }
  }
  for (const entry of Object.values(record)) {
    const found = findNestedPrimitive(entry, keys);
    if (found !== null) return found;
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstPdf(response: Record<string, unknown>) {
  const pdf = response?.PDF;
  if (Array.isArray(pdf)) {
    const value = pdf.find((entry) => typeof entry === "string" && entry.trim());
    if (typeof value === "string") return value;
  }
  const parcels = response?.Parcels;
  if (Array.isArray(parcels)) {
    for (const entry of parcels) {
      const parcel = entry as Record<string, unknown>;
      if (typeof parcel.PDF === "string" && parcel.PDF.trim()) return parcel.PDF;
    }
  }
  return findNestedString(response, PDF_KEYS);
}

function firstParcelTracking(response: Record<string, unknown>) {
  const parcels = response?.Parcels;
  if (!Array.isArray(parcels)) return null;
  for (const entry of parcels) {
    const parcel = entry as Record<string, unknown>;
    if (typeof parcel.TrackingNumber === "string" && parcel.TrackingNumber.trim()) return parcel.TrackingNumber;
  }
  return null;
}

async function storeBase64Pdf(
  adminClient: ReturnType<typeof createClient>,
  clienteId: string,
  shipmentId: string,
  pdfBase64: string,
) {
  const bytes = Uint8Array.from(atob(pdfBase64.replace(/^data:application\/pdf;base64,/, "")), (char) => char.charCodeAt(0));
  const path = `${clienteId}/spedizioni/${shipmentId}-shippypro-label.pdf`;
  const { error } = await adminClient.storage.from("gestionale-files").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

function storagePublicUrl(supabaseUrl: string, bucket: string, path: string) {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

function shippyproError(body: Record<string, unknown>) {
  const pieces = [
    body?.ErrorMessage,
    body?.ReturnErrorMessage,
    body?.Message,
    body?.message,
    body?.error,
    extractNestedErrors(body?.Errors),
    extractNestedErrors(body?.errors),
    typeof body?.ErrorType === "string" ? body.ErrorType : "",
  ].filter((value) => typeof value === "string" && value.trim());
  const message = pieces.length ? pieces.join(" ") : "";
  if (/system exception/i.test(message)) {
    return [
      "ShippyPro/GLS ha rifiutato la spedizione con un errore generico.",
      "Controlla numero civico, telefono, email, CAP/provincia e peso/colli nei dati spedizione.",
      message,
    ].join(" ");
  }
  return message;
}

function summarizeShippyResponse(body: Record<string, unknown>) {
  const interesting = [
    "OrderID",
    "NewOrderID",
    "TransactionID",
    "Status",
    "Result",
    "Message",
    "ErrorMessage",
    "ReturnErrorMessage",
    "TrackingNumber",
    "LabelURL",
  ];
  const parts = interesting
    .filter((key) => body?.[key] !== undefined && body?.[key] !== null && body?.[key] !== "")
    .map((key) => `${key}=${String(body[key]).slice(0, 160)}`);
  if (parts.length) return parts.join(", ");
  return `campi: ${Object.keys(body || {}).slice(0, 20).join(", ") || "nessuno"}`;
}

function extractNestedErrors(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => extractNestedErrors(entry)).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      record.message,
      record.Message,
      record.error,
      record.ErrorMessage,
      record.ReturnErrorMessage,
    ].filter((entry) => typeof entry === "string" && entry.trim()).join(" ");
  }
  return "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function corsHeadersFor(req: Request) {
  return {
    ...corsHeaders,
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") || corsHeaders["Access-Control-Allow-Headers"],
  };
}

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
    const rate = await getBestRate(apiKey, commonParams, carrier, transactionId);

    const shippyPayload = {
      Method: "Ship",
      Params: {
        ...commonParams,
        TransactionID: transactionId,
        MarketplacePlatform: order?.shop_domain ? "Shopify" : "WMS",
        CashOnDeliveryType: 0,
        CarrierName: stringFromRate(rate?.carrier) || carrier.name,
        CarrierID: Number(stringFromRate(rate?.carrier_id) || carrier.id),
        CarrierService: stringFromRate(rate?.service) || carrier.service || "Standard",
        ...(rate?.rate_id ? { RateID: String(rate.rate_id) } : {}),
        ...(rate?.order_id ? { OrderID: String(rate.order_id) } : {}),
        ...(rate?.rate ? { ShipmentCost: Number(rate.rate), ShipmentCostCurrency: currency } : {}),
        ...(rate?.zone_name ? { zone_name: String(rate.zone_name) } : {}),
        ...(rate?.weight_range ? { weight_range: String(rate.weight_range) } : {}),
        ...(rate?.detailed_pricing ? { detailed_pricing: normalizeDetailedPricing(rate.detailed_pricing) } : {}),
        BillAccountNumber: "",
        PaymentMethod: order?.financial_status || "",
        LabelType: "PDF",
        Async: false,
      },
    };

    const shipped = await shipWithCarrierFallback(apiKey, shippyPayload);
    const labelUrl = normalizeLabelUrl(shipped?.LabelURL);
    const pdfBase64 = firstPdf(shipped);
    const labelPath = pdfBase64
      ? await storeBase64Pdf(adminClient, shipment.cliente_id, shipment.id, pdfBase64)
      : null;

    const finalLabelUrl = labelPath
      ? storagePublicUrl(supabaseUrl, "gestionale-files", labelPath)
      : labelUrl;

    const tracking = shipped?.TrackingNumber || firstParcelTracking(shipped) || null;
    if (!finalLabelUrl && !tracking) {
      throw new Error(shippyproError(shipped) || "ShippyPro non ha restituito etichetta o tracking");
    }

    const { data: updated, error: updateError } = await adminClient
      .from("wms_shipments")
      .update({
        stato: "creata",
        tracking,
        label_url: finalLabelUrl,
        carrier_reference: String(shipped?.NewOrderID || shipped?.OrderID || shipment.id),
        payload: shippyPayload,
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
  return [
    ["SHIPPYPRO_SENDER_NAME", address.name],
    ["SHIPPYPRO_SENDER_ADDRESS1", address.street1],
    ["SHIPPYPRO_SENDER_ZIP", address.zip],
    ["SHIPPYPRO_SENDER_CITY", address.city],
    ["SHIPPYPRO_SENDER_PHONE", address.phone],
    ["SHIPPYPRO_SENDER_EMAIL", address.email],
  ].filter(([, value]) => !value).map(([key]) => key as string);
}

function requiredRecipientFields(destinatario: Record<string, unknown>) {
  return [
    ["nome", destinatario.nome],
    ["indirizzo", destinatario.indirizzo1],
    ["CAP", destinatario.cap],
    ["citta", destinatario.citta],
  ].filter(([, value]) => !value).map(([key]) => key as string);
}

function needsItalianStreetNumber(corriere: unknown, destinatario: Record<string, unknown>) {
  const carrier = String(corriere || "").trim().toLowerCase();
  const country = normalizeCountry(destinatario.paese_codice || destinatario.paese || "IT");
  return country === "IT" && ["gls", "brt"].includes(carrier);
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
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return value;
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
  if (!response.ok) throw new Error(shippyproError(data) || `ShippyPro HTTP ${response.status}`);
  const error = shippyproError(data);
  if (error && !normalizeLabelUrl(data?.LabelURL) && !firstPdf(data)) throw new Error(error);
  return data;
}

async function shipWithCarrierFallback(apiKey: string, body: Record<string, unknown>) {
  try {
    return await shippyproJson(apiKey, body);
  } catch (error) {
    const params = (body.Params || {}) as Record<string, unknown>;
    if (!params.CarrierService) throw error;

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
    } catch (_) {
      throw error;
    }
  }
}

function normalizeLabelUrl(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return String(value.find((entry) => typeof entry === "string" && entry.trim()) || "").trim() || null;
  return null;
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
  return null;
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
    typeof body?.ErrorType === "string" ? body.ErrorType : "",
  ].filter(Boolean);
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

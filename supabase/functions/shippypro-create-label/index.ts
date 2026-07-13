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

    const shippyPayload = {
      Method: "Ship",
      Params: {
        to_address: {
          name: destinatario.nome,
          company: destinatario.azienda || "",
          street1: destinatario.indirizzo1,
          street2: destinatario.indirizzo2 || "",
          city: destinatario.citta,
          state: destinatario.provincia || "",
          zip: destinatario.cap,
          country: destinatario.paese_codice || "IT",
          phone: destinatario.telefono || fromAddress.phone,
          email: destinatario.email || fromAddress.email,
        },
        from_address: fromAddress,
        parcels: buildParcels(Number(shipment.colli || 1), payload.weight_kg || shipment.peso_kg),
        TotalValue: `${Number(order?.total_price || 0).toFixed(2)} ${order?.currency || "EUR"}`,
        TransactionID: order?.order_name || shipment.id,
        MarketplacePlatform: order?.shop_domain ? "Shopify" : "WMS",
        ContentDescription: "Ordine ecommerce",
        Insurance: 0,
        InsuranceCurrency: order?.currency || "EUR",
        CashOnDelivery: 0,
        CashOnDeliveryCurrency: order?.currency || "EUR",
        CashOnDeliveryType: 0,
        CarrierName: carrier.name,
        CarrierID: Number(carrier.id),
        ...(carrier.service ? { CarrierService: carrier.service } : {}),
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
  return {
    name: Deno.env.get("SHIPPYPRO_SENDER_NAME") || "Aimago",
    company: Deno.env.get("SHIPPYPRO_SENDER_COMPANY") || "AIMAGO SRLS",
    street1: Deno.env.get("SHIPPYPRO_SENDER_ADDRESS1") || "",
    street2: Deno.env.get("SHIPPYPRO_SENDER_ADDRESS2") || "",
    city: Deno.env.get("SHIPPYPRO_SENDER_CITY") || "",
    state: Deno.env.get("SHIPPYPRO_SENDER_STATE") || "",
    zip: Deno.env.get("SHIPPYPRO_SENDER_ZIP") || "",
    country: Deno.env.get("SHIPPYPRO_SENDER_COUNTRY") || "IT",
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

function resolveCarrier(payload: Payload, corriere: string | null | undefined) {
  const key = String(corriere || "").trim().toUpperCase();
  const service = String(payload.carrier_service || Deno.env.get(`SHIPPYPRO_CARRIER_SERVICE_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_SERVICE") || "").trim();
  return {
    name: String(payload.carrier_name || Deno.env.get(`SHIPPYPRO_CARRIER_NAME_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_NAME") || "").trim(),
    id: String(payload.carrier_id || Deno.env.get(`SHIPPYPRO_CARRIER_ID_${key}`) || Deno.env.get("SHIPPYPRO_CARRIER_ID") || "").trim(),
    service,
  };
}

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
  return pieces.length ? pieces.join(" ") : "";
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

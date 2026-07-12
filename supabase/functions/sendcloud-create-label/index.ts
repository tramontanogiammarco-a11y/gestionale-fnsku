import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  shipment_id?: string;
  shipping_option_code?: string;
  contract_id?: number | string | null;
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

    const apiKey = Deno.env.get("SENDCLOUD_API_KEY");
    const apiSecret = Deno.env.get("SENDCLOUD_API_SECRET");
    if (!apiKey || !apiSecret) {
      return json({ detail: "Configura SENDCLOUD_API_KEY e SENDCLOUD_API_SECRET su Supabase" }, 400);
    }

    const defaultShippingOption = Deno.env.get("SENDCLOUD_SHIPPING_OPTION_CODE");
    const shippingOptionCode = String(payload.shipping_option_code || defaultShippingOption || "").trim();
    if (!shippingOptionCode) {
      return json({ detail: "Manca il metodo Sendcloud: imposta SENDCLOUD_SHIPPING_OPTION_CODE o inserisci il codice metodo" }, 400);
    }

    const fromAddress = senderAddressFromEnv();
    const missingSender = requiredSenderFields(fromAddress);
    if (missingSender.length) {
      return json({ detail: `Configura mittente Sendcloud su Supabase: ${missingSender.join(", ")}` }, 400);
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

    const order = shipment.shopify_orders;
    const destinatario = shipment.destinatario || {};
    const missingRecipient = requiredRecipientFields(destinatario);
    if (missingRecipient.length) {
      return json({ detail: `Mancano dati destinatario: ${missingRecipient.join(", ")}` }, 400);
    }

    const sendcloudPayload = {
      label_details: {
        mime_type: "application/pdf",
        dpi: 72,
      },
      to_address: {
        name: destinatario.nome,
        company_name: destinatario.azienda || undefined,
        address_line_1: destinatario.indirizzo1,
        address_line_2: destinatario.indirizzo2 || undefined,
        postal_code: destinatario.cap,
        city: destinatario.citta,
        country_code: destinatario.paese_codice || "IT",
        phone_number: destinatario.telefono || undefined,
        email: destinatario.email || undefined,
      },
      from_address: fromAddress,
      ship_with: {
        type: "shipping_option_code",
        properties: {
          shipping_option_code: shippingOptionCode,
          ...(payload.contract_id ? { contract_id: Number(payload.contract_id) } : {}),
        },
      },
      order_number: order?.order_name || shipment.id,
      total_order_price: order?.total_price
        ? { value: String(order.total_price), currency: order.currency || "EUR" }
        : undefined,
      parcels: buildParcels(Number(shipment.colli || 1), payload.weight_kg || shipment.peso_kg),
    };

    const announced = await sendcloudJson("/shipments/announce", apiKey, apiSecret, {
      method: "POST",
      body: JSON.stringify(sendcloudPayload),
    });

    const firstParcel = announced?.data?.parcels?.[0];
    if (!firstParcel?.id) {
      throw new Error("Sendcloud non ha restituito il collo/parcel creato");
    }

    const labelPath = await downloadAndStoreLabel({
      adminClient,
      apiKey,
      apiSecret,
      bucket: "gestionale-files",
      clienteId: shipment.cliente_id,
      shipmentId: shipment.id,
      parcelId: firstParcel.id,
    });

    const tracking = firstParcel.tracking_number || null;
    const { data: updated, error: updateError } = await adminClient
      .from("wms_shipments")
      .update({
        stato: "creata",
        tracking,
        label_url: storagePublicUrl(supabaseUrl, "gestionale-files", labelPath),
        carrier_reference: String(announced?.data?.id || firstParcel.id),
        payload: sendcloudPayload,
        response: announced,
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
    console.error("sendcloud-create-label", error);
    return json({ detail: error instanceof Error ? error.message : "Errore creazione etichetta Sendcloud" }, 500);
  }
});

function senderAddressFromEnv() {
  return {
    name: Deno.env.get("SENDCLOUD_SENDER_NAME") || "Aimago",
    company_name: Deno.env.get("SENDCLOUD_SENDER_COMPANY") || "AIMAGO SRLS",
    address_line_1: Deno.env.get("SENDCLOUD_SENDER_ADDRESS1") || "",
    address_line_2: Deno.env.get("SENDCLOUD_SENDER_ADDRESS2") || undefined,
    postal_code: Deno.env.get("SENDCLOUD_SENDER_ZIP") || "",
    city: Deno.env.get("SENDCLOUD_SENDER_CITY") || "",
    country_code: Deno.env.get("SENDCLOUD_SENDER_COUNTRY") || "IT",
    phone_number: Deno.env.get("SENDCLOUD_SENDER_PHONE") || undefined,
    email: Deno.env.get("SENDCLOUD_SENDER_EMAIL") || undefined,
  };
}

function requiredSenderFields(address: Record<string, unknown>) {
  return [
    ["SENDCLOUD_SENDER_ADDRESS1", address.address_line_1],
    ["SENDCLOUD_SENDER_ZIP", address.postal_code],
    ["SENDCLOUD_SENDER_CITY", address.city],
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

function buildParcels(colli: number, weight: number | string | null | undefined) {
  const safeColli = Math.max(1, Math.min(50, Number(colli || 1)));
  const totalWeight = Math.max(0.1, Number(weight || 1));
  const weightPerParcel = Math.max(0.1, totalWeight / safeColli).toFixed(3);
  return Array.from({ length: safeColli }, () => ({
    weight: { value: weightPerParcel, unit: "kg" },
  }));
}

async function sendcloudJson(path: string, key: string, secret: string, init: RequestInit = {}) {
  const response = await fetch(`https://panel.sendcloud.sc/api/v3${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(sendcloudError(body) || `Sendcloud HTTP ${response.status}`);
  }
  return body;
}

async function downloadAndStoreLabel(args: {
  adminClient: ReturnType<typeof createClient>;
  apiKey: string;
  apiSecret: string;
  bucket: string;
  clienteId: string;
  shipmentId: string;
  parcelId: number | string;
}) {
  const response = await fetch(`https://panel.sendcloud.sc/api/v3/parcels/${args.parcelId}/documents/label?paper_size=A6`, {
    headers: {
      Accept: "application/pdf",
      Authorization: `Basic ${btoa(`${args.apiKey}:${args.apiSecret}`)}`,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(sendcloudError(body) || `Download etichetta Sendcloud HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const path = `${args.clienteId}/spedizioni/${args.shipmentId}-sendcloud-label.pdf`;
  const { error } = await args.adminClient.storage.from(args.bucket).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

function storagePublicUrl(supabaseUrl: string, bucket: string, path: string) {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

function sendcloudError(body: Record<string, unknown>) {
  const errors = body?.errors;
  if (Array.isArray(errors)) {
    return errors.map((entry) => {
      const error = entry as Record<string, unknown>;
      return error.detail || error.title || error.code;
    }).filter(Boolean).join(" ");
  }
  if (errors && typeof errors === "object") return JSON.stringify(errors);
  return typeof body?.message === "string" ? body.message : "";
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

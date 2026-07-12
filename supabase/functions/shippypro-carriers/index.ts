import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
    if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) return json({ detail: "Variabili Supabase mancanti" }, 500);

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

    const apiKey = Deno.env.get("SHIPPYPRO_API_KEY");
    if (!apiKey) return json({ detail: "Configura SHIPPYPRO_API_KEY su Supabase" }, 400);

    const data = await shippyproJson(apiKey, {
      Method: "GetCarriers",
      Params: {},
    });

    return json({
      ok: true,
      carriers: flattenCarriers(data?.Carriers),
      raw: data,
    });
  } catch (error) {
    console.error("shippypro-carriers", error);
    return json({ detail: error instanceof Error ? error.message : "Errore lettura corrieri ShippyPro" }, 500);
  }
});

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
  if (!response.ok) throw new Error(data?.ErrorMessage || `ShippyPro HTTP ${response.status}`);
  if (data?.ErrorMessage) throw new Error(String(data.ErrorMessage));
  return data;
}

function flattenCarriers(carriers: unknown) {
  if (!carriers || typeof carriers !== "object") return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const [carrierName, entries] of Object.entries(carriers as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const carrier = entry as Record<string, unknown>;
      rows.push({
        carrier_name: carrierName,
        carrier_id: carrier.CarrierID,
        carrier_service: carrier.CarrierService,
        label: carrier.Label,
        services: carrier.ServicesList,
      });
    }
  }
  return rows;
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

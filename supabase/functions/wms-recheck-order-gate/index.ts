import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recheckWmsOrderGates } from "../_shared/wmsOrderGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return json({ detail: "Configurazione Supabase mancante" }, 500);
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) return json({ detail: "Sessione non valida" }, 401);
  const { data: profile, error: profileError } = await userClient.from("profiles").select("role,cliente_id").eq("id", authData.user.id).single();
  if (profileError || !["admin", "staff", "cliente"].includes(profile?.role)) return json({ detail: "Profilo non autorizzato" }, 403);

  const payload = await req.json().catch(() => ({}));
  const clienteId = profile.role === "cliente" ? String(profile.cliente_id || "") : String(payload.cliente_id || "").trim() || null;
  if (profile.role === "cliente" && !clienteId) return json({ detail: "Profilo cliente non associato" }, 403);
  try {
    const admin = createClient(url, service);
    return json(await recheckWmsOrderGates(admin, clienteId, authData.user.id, Number(payload.limit || 500)));
  } catch (error) {
    console.error("wms-recheck-order-gate", error);
    return json({ detail: error instanceof Error ? error.message : "Ricontrollo non riuscito" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

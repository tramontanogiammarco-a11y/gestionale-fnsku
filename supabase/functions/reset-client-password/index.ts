import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ detail: "Configurazione Supabase mancante" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
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
  if (profileError || profile?.role !== "admin") return json({ detail: "Operazione riservata agli amministratori" }, 403);

  const payload = await req.json().catch(() => ({}));
  const clienteId = String(payload.cliente_id || "").trim();
  const password = String(payload.password || "");
  if (!clienteId || password.length < 10) return json({ detail: "La password deve contenere almeno 10 caratteri" }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: cliente, error: clienteError } = await adminClient
    .from("clienti")
    .select("id,email,user_id")
    .eq("id", clienteId)
    .single();
  if (clienteError || !cliente?.user_id) return json({ detail: "Account cliente non trovato" }, 404);

  const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(cliente.user_id);
  const authEmail = String(authUserData?.user?.email || "").trim().toLowerCase();
  if (authUserError || !authEmail) return json({ detail: "Email Auth del cliente non trovata" }, 404);

  const { error: updateError } = await adminClient.auth.admin.updateUserById(cliente.user_id, {
    password,
    user_metadata: { password_reset_by_admin_at: new Date().toISOString() },
  });
  if (updateError) return json({ detail: updateError.message }, 400);

  const verificationClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verificationError } = await verificationClient.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (verificationError) {
    return json({ detail: `Password aggiornata ma verifica accesso fallita: ${verificationError.message}` }, 500);
  }
  await verificationClient.auth.signOut();

  return json({ ok: true, email: authEmail, email_changed: authEmail !== String(cliente.email || "").trim().toLowerCase() }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

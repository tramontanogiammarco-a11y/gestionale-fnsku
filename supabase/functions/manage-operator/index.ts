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

  const { data: caller } = await userClient.from("profiles").select("role").eq("id", authData.user.id).single();
  if (caller?.role !== "admin") return json({ detail: "Operazione riservata agli amministratori" }, 403);

  const payload = await req.json().catch(() => ({}));
  const action = String(payload.action || "").trim();
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (action === "create") {
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!name || !email || password.length < 10) return json({ detail: "Inserisci nome, email e una password di almeno 10 caratteri" }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: "staff", is_operator: true },
    });
    if (createError || !created.user) return json({ detail: createError?.message || "Impossibile creare l'operatore" }, 400);

    const { data: profile, error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      email,
      name,
      role: "staff",
      cliente_id: null,
      is_operator: true,
      operator_active: true,
    }).select("id,email,name,role,is_operator,operator_active,created_at").single();
    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ detail: profileError?.message || "Impossibile creare il profilo operatore" }, 400);
    }
    return json(profile);
  }

  const operatorId = String(payload.operator_id || "").trim();
  if (!operatorId) return json({ detail: "Operatore non specificato" }, 400);
  const { data: operator } = await admin.from("profiles").select("id,email,name,is_operator").eq("id", operatorId).single();
  if (!operator?.is_operator) return json({ detail: "Account operatore non trovato" }, 404);

  if (action === "status") {
    const active = Boolean(payload.active);
    const { data, error } = await admin.from("profiles").update({ operator_active: active }).eq("id", operatorId)
      .select("id,email,name,role,is_operator,operator_active,created_at").single();
    if (error) return json({ detail: error.message }, 400);
    return json(data);
  }

  if (action === "password") {
    const password = String(payload.password || "");
    if (password.length < 10) return json({ detail: "La password deve contenere almeno 10 caratteri" }, 400);
    const { error } = await admin.auth.admin.updateUserById(operatorId, {
      password,
      user_metadata: { password_reset_by_admin_at: new Date().toISOString() },
    });
    if (error) return json({ detail: error.message }, 400);

    const verifier = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: verificationError } = await verifier.auth.signInWithPassword({ email: operator.email, password });
    if (verificationError) return json({ detail: `Password aggiornata ma verifica fallita: ${verificationError.message}` }, 500);
    await verifier.auth.signOut();
    return json({ ok: true, email: operator.email });
  }

  return json({ detail: "Azione non riconosciuta" }, 400);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  ragione_sociale: string;
  email: string;
  password: string;
  note?: string | null;
  listino?: Record<string, number> | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ detail: "Metodo non consentito" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ detail: "Variabili Supabase mancanti" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) {
    return json({ detail: "Non autenticato" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) {
    return json({ detail: "Sessione non valida" }, 401);
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !["admin", "staff"].includes(profile?.role)) {
    return json({ detail: "Accesso riservato allo staff" }, 403);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch (_) {
    return json({ detail: "JSON non valido" }, 400);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const ragioneSociale = String(payload.ragione_sociale || "").trim();

  if (!email || !password || !ragioneSociale) {
    return json({ detail: "Compila ragione sociale, email e password" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: ragioneSociale, role: "cliente" },
  });

  if (createError || !created.user) {
    return json({ detail: createError?.message || "Impossibile creare utente" }, 400);
  }

  const { data: cliente, error: clienteError } = await adminClient
    .from("clienti")
    .insert({
      ragione_sociale: ragioneSociale,
      email,
      user_id: created.user.id,
      note: payload.note ?? null,
      listino: payload.listino ?? undefined,
    })
    .select()
    .single();

  if (clienteError || !cliente) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ detail: clienteError?.message || "Impossibile creare cliente" }, 400);
  }

  const { error: profileInsertError } = await adminClient.from("profiles").insert({
    id: created.user.id,
    email,
    name: ragioneSociale,
    role: "cliente",
    cliente_id: cliente.id,
  });

  if (profileInsertError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    await adminClient.from("clienti").delete().eq("id", cliente.id);
    return json({ detail: profileInsertError.message }, 400);
  }

  return json(cliente, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ detail: "Metodo non consentito" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!url || !anon || !token) return json({ detail: "Sessione non valida" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ detail: "Sessione non valida" }, 401);
  const { data: profile } = await userClient.from("profiles").select("role").eq("id", authData.user.id).single();
  if (!profile || !["admin", "staff", "cliente"].includes(profile.role)) return json({ detail: "Profilo non autorizzato" }, 403);

  const input = await req.json().catch(() => ({}));
  const address = clean(input.address);
  const zip = clean(input.zip);
  const city = clean(input.city);
  const province = clean(input.province);
  const country = clean(input.country_code || "IT").toUpperCase();
  if (!address || !zip || !city || !country) return json({ valid: false, confidence: 0, source: "google_maps", reasons: ["Dati indirizzo incompleti"] });

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
  if (!apiKey) {
    return json({
      valid: true,
      confidence: 0.92,
      source: "controllo_locale",
      map_check: "google_maps_non_configurato",
      reasons: [],
      normalized: { address, zip, city, province, country_code: country },
      verified_at: new Date().toISOString(),
    });
  }

  const query = [address, `${zip} ${city}`, province, country].filter(Boolean).join(", ");
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== "OK" || !Array.isArray(body.results) || !body.results.length) {
    return json({ valid: false, confidence: 0, source: "google_maps", map_check: "non_trovato", reasons: ["Indirizzo non trovato su Google Maps"] });
  }

  const components = body.results[0].address_components || [];
  const component = (type: string) => clean(components.find((item: any) => Array.isArray(item.types) && item.types.includes(type))?.long_name);
  const postalCode = component("postal_code");
  const locality = component("locality") || component("postal_town") || component("administrative_area_level_3");
  const normalizedZip = zip.replace(/\s/g, "").toUpperCase();
  const validZip = !postalCode || postalCode.replace(/\s/g, "").toUpperCase() === normalizedZip;
  const validCity = !locality || normalize(locality) === normalize(city);
  const reasons = [
    ...(validZip ? [] : ["Il CAP non corrisponde alla via trovata su Google Maps"]),
    ...(validCity ? [] : ["La citta non corrisponde alla via trovata su Google Maps"]),
  ];
  return json({
    valid: reasons.length === 0,
    confidence: reasons.length ? 0.35 : 0.99,
    source: "google_maps",
    map_check: reasons.length ? "discordanza" : "verificato",
    reasons,
    normalized: { address, zip: postalCode || zip, city: locality || city, province, country_code: country },
    verified_at: new Date().toISOString(),
  });
});

function clean(value: unknown) { return String(value || "").trim(); }
function normalize(value: unknown) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

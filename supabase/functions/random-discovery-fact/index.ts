// Supabase Edge Function template — random discovery fact
// Deploy: supabase functions deploy random-discovery-fact
//
// Invoke from client:
//   const { data, error } = await supabase.functions.invoke('random-discovery-fact', {
//     body: { attribute_type: 'Lore' }  // optional
//   });

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" }
        }
      }
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const attributeType = body.attribute_type ?? null;

    const { data, error } = await supabase.rpc("get_random_discovery_fact", {
      p_attribute_type: attributeType
    });

    if (error) throw error;

    if (!data) {
      return new Response(JSON.stringify({ error: "No discovery facts found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ fact: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

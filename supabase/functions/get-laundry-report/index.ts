import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

// Cabeçalhos CORS para lidar com requisições pre-flight
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Resposta imediata para requisições OPTIONS (pre-flight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { hotel_id, start_date, end_date } = await req.json();

    if (!hotel_id || !start_date || !end_date) {
      throw new Error("Parâmetros hotel_id, start_date e end_date são obrigatórios.");
    }
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const monthDate = start_date.substring(0, 8) + '01';

    // Busca todos os dados necessários em paralelo
    const [
      itemsRes,
      guestCountsRes,
      laundryEntriesRes,
      definitionRes
    ] = await Promise.all([
      supabaseAdmin.from("laundry_items").select("id, name, display_order").eq("hotel_id", hotel_id).eq("is_active", true).order('display_order'),
      supabaseAdmin.from("daily_guest_counts").select("date, guest_count").eq("hotel_id", hotel_id).gte("date", start_date).lte("date", end_date),
      supabaseAdmin.from("laundry_entries").select("item_id, entry_date, quantity").eq("hotel_id", hotel_id).gte("entry_date", start_date).lte("entry_date", end_date),
      supabaseAdmin.from('fortnight_definitions').select('*').eq('hotel_id', hotel_id).eq('month_date', monthDate).maybeSingle()
    ]);

    const anyError = [itemsRes, guestCountsRes, laundryEntriesRes, definitionRes].find(res => res.error)?.error;
    if (anyError) throw anyError;

    // Busca o preço correto para cada item
    const pricePromises = (itemsRes.data || []).map(item =>
      supabaseAdmin
        .from('laundry_item_prices')
        .select('price')
        .eq('item_id', item.id)
        .lte('effective_date', start_date)
        .order('effective_date', { ascending: false })
        .limit(1)
        .single()
    );
    const priceResults = await Promise.all(pricePromises);
    const itemsWithPrices = (itemsRes.data || []).map((item, index) => ({
      ...item,
      price: priceResults[index].data?.price || 0
    }));

    const responsePayload = {
      items: itemsWithPrices,
      guestCounts: guestCountsRes.data,
      laundryEntries: laundryEntriesRes.data,
      definition: definitionRes.data
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error("Erro na função:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
});
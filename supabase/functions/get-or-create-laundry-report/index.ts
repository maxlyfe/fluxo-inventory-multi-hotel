import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'https://deno.land/std@0.224.0/datetime/mod.ts';

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { hotel_id, month_date_str } = await req.json(); // Recebe YYYY-MM-DD
    if (!hotel_id || !month_date_str) throw new Error("hotel_id e month_date_str são obrigatórios.");

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const monthStart = startOfMonth(new Date(month_date_str + 'T12:00:00'));
    const monthStartDate = format(monthStart, "yyyy-MM-dd");

    // 1. Busca itens ativos
    const { data: items, error: itemsError } = await supabaseAdmin.from("laundry_items").select("id, name, display_order").eq("hotel_id", hotel_id).eq("is_active", true).order('display_order');
    if (itemsError) throw itemsError;

    // 2. Busca os preços mais recentes para cada item, válidos ATÉ o início do mês solicitado
    const pricePromises = items.map(item => 
      supabaseAdmin.from('laundry_item_prices').select('price').eq('item_id', item.id).lte('effective_date', monthStartDate).order('effective_date', { ascending: false }).limit(1).single()
    );
    const priceResults = await Promise.all(pricePromises);
    const itemsWithPrices = items.map((item, index) => ({ ...item, price: priceResults[index].data?.price || 0 }));
    
    // 3. Busca a definição da quinzena JÁ SALVA para este mês
    const { data: definition, error: defError } = await supabaseAdmin.from('fortnight_definitions').select('*').eq('hotel_id', hotel_id).eq('month_date', monthStartDate).maybeSingle();
    if (defError) throw defError;

    // 4. Busca os dados JÁ SALVOS para o mês inteiro
    const monthEnd = endOfMonth(monthStart);
    const { data: guestCounts, error: guestError } = await supabaseAdmin.from("daily_guest_counts").select("date, guest_count").eq("hotel_id", hotel_id).gte("date", monthStartDate).lte("date", format(monthEnd, "yyyy-MM-dd"));
    if (guestError) throw guestError;
    
    const { data: laundryEntries, error: entriesError } = await supabaseAdmin.from("laundry_entries").select("item_id, entry_date, quantity").eq("hotel_id", hotel_id).gte("entry_date", monthStartDate).lte("date", format(monthEnd, "yyyy-MM-dd"));
    if (entriesError) throw entriesError;

    const responsePayload = {
        items: itemsWithPrices,
        guestCounts: guestCounts || [],
        laundryEntries: laundryEntries || [],
        definition: definition || null
    };

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
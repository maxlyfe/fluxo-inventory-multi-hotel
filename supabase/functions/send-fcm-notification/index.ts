// Importações necessárias
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Interface para os dados esperados no corpo da requisição
interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: { [key: string]: string }; // Dados adicionais para deep linking, etc.
}

serve(async (req) => {
  // Tratar requisição OPTIONS para CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Obter o payload da requisição
    const payload: PushNotificationPayload = await req.json();
    const { userId, title, body, data } = payload;

    if (!userId || !title || !body) {
      return new Response(JSON.stringify({ error: "Missing required fields: userId, title, body" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Inicializar o cliente Supabase
    // Substitua pelos seus próprios valores de URL e Chave Anon do Supabase
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Buscar os tokens FCM do usuário no banco de dados
    const { data: fcmTokensData, error: fcmTokensError } = await supabaseAdmin
      .from("user_fcm_tokens")
      .select("token")
      .eq("user_id", userId);

    if (fcmTokensError) {
      console.error("Error fetching FCM tokens:", fcmTokensError);
      return new Response(JSON.stringify({ error: "Failed to fetch FCM tokens", details: fcmTokensError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!fcmTokensData || fcmTokensData.length === 0) {
      return new Response(JSON.stringify({ message: "No FCM tokens found for this user." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200, // Não é um erro, apenas não há tokens para enviar
      });
    }

    const tokens = fcmTokensData.map(t => t.token);

    // 2. Chave do Servidor FCM (substitua pela sua chave real do Firebase Console)
    const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY") ?? "";
    if (!FCM_SERVER_KEY) {
      console.error("FCM_SERVER_KEY is not set in environment variables.");
      return new Response(JSON.stringify({ error: "FCM server key not configured." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // 3. Construir e enviar a notificação para cada token
    const fcmUrl = "https://fcm.googleapis.com/fcm/send";
    const results = [];

    for (const token of tokens) {
      const notificationPayload = {
        to: token,
        notification: {
          title: title,
          body: body,
          // Adicione 'icon' e 'click_action' se necessário para web push
          // icon: "/your-icon.png",
          // click_action: data?.target_path || "/"
        },
        data: data || {} // Dados customizados
      };

      try {
        const response = await fetch(fcmUrl, {
          method: "POST",
          headers: {
            "Authorization": `key=${FCM_SERVER_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(notificationPayload),
        });

        const responseData = await response.json();
        results.push({ token, status: response.status, response: responseData });

        // 4. Lidar com tokens inválidos ou não registrados
        if (responseData.failure > 0 || responseData.canonical_ids > 0) {
          responseData.results.forEach(async (result: any, index: number) => {
            const currentToken = tokens[index]; // Assumindo que a ordem é mantida
            if (result.error === "NotRegistered" || result.error === "InvalidRegistration") {
              console.warn(`Token ${currentToken} is invalid. Removing from database.`);
              const { error: deleteError } = await supabaseAdmin
                .from("user_fcm_tokens")
                .delete()
                .match({ token: currentToken });
              if (deleteError) {
                console.error(`Failed to delete token ${currentToken}:`, deleteError);
              }
            } else if (result.message_id && result.registration_id) {
              // Token foi atualizado, atualizar no banco
              console.log(`Token ${currentToken} updated to ${result.registration_id}. Updating in database.`);
              const { error: updateError } = await supabaseAdmin
                .from("user_fcm_tokens")
                .update({ token: result.registration_id })
                .match({ token: currentToken });
              if (updateError) {
                console.error(`Failed to update token ${currentToken}:`, updateError);
              }
            }
          });
        }
      } catch (fetchError) {
        console.error(`Error sending FCM message to token ${token}:`, fetchError);
        results.push({ token, status: "FETCH_ERROR", error: fetchError.message });
      }
    }

    return new Response(JSON.stringify({ message: "FCM messages processed.", results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("General error in Edge Function:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});


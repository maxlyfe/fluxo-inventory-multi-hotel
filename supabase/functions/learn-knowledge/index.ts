// supabase/functions/learn-knowledge/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY')!)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { textToLearn } = await req.json()
    if (!textToLearn) {
      throw new Error('O texto para aprender (textToLearn) está faltando!')
    }

    // Apenas administradores podem ensinar o bot (exemplo de segurança)
    // Você pode remover ou ajustar esta lógica conforme necessário
    // const user = await supabase.auth.getUser()
    // if (!user || user.data.user?.app_metadata?.claims?.role !== 'admin') {
    //   throw new Error('Apenas administradores podem ensinar o chatbot.')
    // }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('DB_SERVICE_ROLE_KEY')!
    )

    // 1. Gera o vetor para o novo conhecimento
    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
    const embeddingResult = await embeddingModel.embedContent(textToLearn);
    const newEmbedding = embeddingResult.embedding.values;

    // 2. Salva o texto e o vetor na nova tabela
    const { error } = await supabaseAdmin.from('custom_knowledge').insert({
      content: textToLearn,
      embedding: newEmbedding,
    });

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ message: "Conhecimento adicionado com sucesso!" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error("Erro na função learn-knowledge:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

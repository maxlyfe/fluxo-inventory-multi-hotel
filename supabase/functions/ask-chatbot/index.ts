// supabase/functions/ask-chatbot/index.ts

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
    const { query } = await req.json()
    if (!query) {
      throw new Error('A pergunta (query) está faltando!')
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('DB_SERVICE_ROLE_KEY')!
    )

    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
    const embeddingResult = await embeddingModel.embedContent(query);
    const queryEmbedding = embeddingResult.embedding.values;

    const { data: contextChunks, error: matchError } = await supabaseAdmin.rpc(
      'match_project_embeddings',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 7,
      }
    )

    if (matchError) {
      throw matchError
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    let prompt;

    // --- LÓGICA CONDICIONAL ---
    // Se encontramos contexto relevante, agimos como um especialista.
    if (contextChunks && contextChunks.length > 0) {
      const contextText = contextChunks.map((chunk: any) => `-- Trecho do arquivo: ${chunk.file_path}\n${chunk.content}`).join('\n\n');
      
      prompt = `
        Você é um assistente especialista no sistema "hotel-requisition-system".

        **VISÃO GERAL DO SISTEMA (SUA FONTE DE VERDADE):**
        - **Para criar uma requisição de setor:** O usuário seleciona o setor na página inicial, escolhe os produtos e quantidades na página do setor, e clica em "Adicionar" para enviar o pedido ao estoque.
        - **Para criar um novo item no inventário:** O usuário vai para a página de 'Inventário', clica em "+ Novo Item", e preenche o formulário "Novo Produto".

        **SUA TAREFA:**
        1. Use a **VISÃO GERAL DO SISTEMA** e o **CONTEXTO DE CÓDIGO** para criar um guia passo a passo simples para o usuário.
        2. NÃO use jargão técnico.
        3. Formate listas com uma linha em branco entre cada passo.

        **CONTEXTO DE CÓDIGO (para detalhes):**
        ${contextText}

        **PERGUNTA DO USUÁRIO:**
        ${query}

        **GUIA PASSO A PASSO PARA O USUÁRIO:**
      `
    } else {
      // Se NÃO encontramos contexto, agimos como um assistente de IA geral.
      prompt = `
        Você é um assistente de IA prestativo e amigável. Responda à pergunta do usuário da melhor forma possível.
        
        PERGUNTA:
        ${query}
      `
    }
    
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()

    return new Response(JSON.stringify({ answer: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error("Erro na Edge Function:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

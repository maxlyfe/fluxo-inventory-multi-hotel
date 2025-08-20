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
    
    const contextText = contextChunks.map((chunk: any) => `-- Trecho do arquivo: ${chunk.file_path}\n${chunk.content}`).join('\n\n');

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // --- PROMPT ATUALIZADO COM INSTRUÇÕES DE FORMATAÇÃO ---
    const prompt = `
      Você é um assistente especialista no sistema "hotel-requisition-system".

      **VISÃO GERAL DO SISTEMA (SUA FONTE DE VERDADE):**
      - **Para criar uma requisição de setor:**
        1. Na página inicial ('/'), o usuário seleciona o setor desejado.
        2. O sistema o leva para a página daquele setor, que exibe uma lista de produtos disponíveis.
        3. O usuário informa a quantidade de cada produto que deseja e clica em "Adicionar".
        4. Ao clicar em "Adicionar", o pedido é enviado automaticamente para o setor de estoque.
      
      - **Para criar um novo item no inventário:**
        1. Na página inicial, o usuário clica no botão "Inventário" para ir para a URL '/inventory'.
        2. Na página de inventário, ele clica no botão "+ Novo Item".
        3. Um formulário chamado "Novo Produto" aparecerá. O usuário deve preenchê-lo e salvar.

      **SUA TAREFA:**
      1. Use a **VISÃO GERAL DO SISTEMA** acima como a principal fonte para responder à pergunta do usuário.
      2. Use o **CONTEXTO DE CÓDIGO** abaixo apenas para obter pequenos detalhes, como o nome exato de um botão ou de um campo de texto.
      3. Sua resposta DEVE ser um guia passo a passo simples para um usuário final. NÃO use jargão técnico.
      4. Se a pergunta for sobre algo que não está na VISÃO GERAL DO SISTEMA e nem no CONTEXTO DE CÓDIGO, responda: "Não encontrei informações sobre como fazer isso no sistema."
      5. Formate o guia como uma lista numerada. **IMPORTANTE: Coloque uma linha em branco entre cada passo para facilitar a leitura.**

      **CONTEXTO DE CÓDIGO (para detalhes):**
      ${contextText}

      **PERGUNTA DO USUÁRIO:**
      ${query}

      **GUIA PASSO A PASSO PARA O USUÁRIO:**
    `
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

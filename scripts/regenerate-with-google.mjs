// scripts/regenerate-with-google.mjs
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

// --- CONFIGURAÇÃO ---
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !geminiApiKey) {
  throw new Error('Variáveis de ambiente do Supabase ou Gemini estão faltando no .env!');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const genAI = new GoogleGenerativeAI(geminiApiKey);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const FOLDER_TO_SCAN = 'src';
const FILES_TO_INCLUDE = /\.(ts|tsx|md|sql)$/;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
// --------------------

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.substring(i, i + size));
  }
  return chunks;
}

async function readFilesRecursively(dir) {
  let files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'node_modules' && item.name !== 'dist' && item.name !== '.git') {
        files = files.concat(await readFilesRecursively(fullPath));
      }
    } else if (FILES_TO_INCLUDE.test(item.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// Função para gerar embeddings em lotes para não sobrecarregar a API
async function generateEmbeddingsBatch(chunks) {
    const requests = chunks.map(chunk => ({
        model: "embedding-001",
        content: { parts: [{ text: chunk }] }
    }));
    const result = await embeddingModel.batchEmbedContents({ requests });
    return result.embeddings.map(e => e.values);
}


async function main() {
  console.log('Iniciando a REGERAÇÃO de embeddings com o modelo do Google...');

  console.log('Limpando embeddings antigos da tabela...');
  const { error: deleteError } = await supabase.from('project_embeddings').delete().neq('id', 0);
  if (deleteError) {
    console.error('Erro ao limpar a tabela:', deleteError);
    return;
  }
  console.log('Tabela limpa com sucesso.');

  console.log(`Buscando arquivos em '${FOLDER_TO_SCAN}'...`);
  const files = await readFilesRecursively(FOLDER_TO_SCAN);
  console.log(`Encontrados ${files.length} arquivos para processar.`);

  for (const filePath of files) {
    try {
      console.log(`Processando: ${filePath}`);
      const content = await fs.readFile(filePath, 'utf-8');
      const chunks = chunkText(content);
      
      if (chunks.length === 0) continue;

      // Gera os embeddings para todos os chunks do arquivo de uma vez
      const embeddings = await generateEmbeddingsBatch(chunks);

      const recordsToInsert = chunks.map((chunk, index) => ({
        file_path: filePath,
        content: chunk,
        embedding: embeddings[index],
      }));

      // Salva todos os registros do arquivo no Supabase
      const { error } = await supabase.from('project_embeddings').insert(recordsToInsert);
      if (error) {
        console.error(`Erro ao salvar chunks de ${filePath}:`, error.message);
      }
       // Adiciona um pequeno delay para não exceder os limites de taxa da API
      await new Promise(resolve => setTimeout(resolve, 1000)); 

    } catch (readError) {
      console.error(`Erro ao ler o arquivo ${filePath}:`, readError.message);
    }
  }

  console.log('-----------------------------------------');
  console.log('✅ Processo de REGERAÇÃO de embeddings concluído!');
  console.log('-----------------------------------------');
}

main();
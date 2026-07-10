// netlify/functions/nf-dfe-sync.ts
// Job agendado: consulta a Distribuição DF-e da SEFAZ a cada 2 horas para
// todos os hotéis com "Receber NF" habilitado e grava as notas em nf_received.
// O intervalo de 2h respeita a regra da SEFAZ de 1h mínima entre consultas
// sem documentos novos (rejeição 656 — consumo indevido).

import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { consultaDFe } from './lib/dfe';

const SUPABASE_URL         = process.env.SUPABASE_URL         || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const MAX_LOTES_POR_HOTEL = 8; // até ~400 documentos por execução por hotel

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

interface HotelConfig {
  hotel_id: string;
  cnpj: string | null;
  certificado_base64: string | null;
  certificado_senha: string | null;
  dfe_ultimo_nsu: string | null;
}

async function syncHotel(db: ReturnType<typeof getDb>, cfg: HotelConfig): Promise<{ novas: number; status: string }> {
  if (!cfg.cnpj || cfg.cnpj.replace(/\D/g, '').length !== 14) return { novas: 0, status: 'cnpj-invalido' };
  if (!cfg.certificado_base64 || !cfg.certificado_senha)      return { novas: 0, status: 'sem-certificado' };

  let ultNSU = cfg.dfe_ultimo_nsu || '0';
  let novas = 0;

  for (let lote = 0; lote < MAX_LOTES_POR_HOTEL; lote++) {
    const result = await consultaDFe({
      certificado_base64: cfg.certificado_base64,
      certificado_senha: cfg.certificado_senha,
      cnpj: cfg.cnpj,
      // Notas reais de fornecedores só existem no ambiente de produção
      ambiente: 'producao',
      ultNSU,
    });

    // 137 = nenhum documento; 138 = documentos localizados
    if (result.cStat !== '137' && result.cStat !== '138') {
      return { novas, status: `sefaz-${result.cStat}` };
    }

    ultNSU = result.ultNSU;

    for (const doc of result.docs) {
      const { error } = await db
        .from('nf_received')
        .upsert({
          hotel_id: cfg.hotel_id,
          nsu: doc.nsu,
          schema_doc: doc.schema,
          tipo: doc.tipo,
          chave_acesso: doc.chave_acesso,
          numero_nf: doc.numero_nf,
          serie: doc.serie,
          emitente_nome: doc.emitente_nome,
          emitente_cnpj: doc.emitente_cnpj,
          valor_total: doc.valor_total,
          data_emissao: doc.data_emissao,
          xml: doc.xml,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'hotel_id,chave_acesso', ignoreDuplicates: false });
      if (!error) novas++;
    }

    // Persiste progresso do NSU a cada lote
    await db
      .from('nf_hotel_config')
      .update({ dfe_ultimo_nsu: ultNSU, dfe_ultima_consulta: new Date().toISOString() })
      .eq('hotel_id', cfg.hotel_id);

    if (result.cStat === '137' || result.ultNSU >= result.maxNSU) break;
  }

  return { novas, status: 'ok' };
}

const handler = schedule('0 */2 * * *', async () => {
  const startedAt = Date.now();
  try {
    const db = getDb();

    const { data: configs, error } = await db
      .from('nf_hotel_config')
      .select('hotel_id, cnpj, certificado_base64, certificado_senha, dfe_ultimo_nsu')
      .eq('nf_recebidas_enabled', true)
      .eq('is_active', true);
    if (error) throw error;

    if (!configs?.length) {
      console.log('[nf-dfe-sync] Nenhum hotel com Receber NF habilitado.');
      return { statusCode: 200 };
    }

    for (const cfg of configs as HotelConfig[]) {
      try {
        const r = await syncHotel(db, cfg);
        console.log(`[nf-dfe-sync] hotel=${cfg.hotel_id} status=${r.status} novas=${r.novas}`);
      } catch (err) {
        // Falha de um hotel (cert vencido, SEFAZ fora etc.) não bloqueia os demais
        console.error(`[nf-dfe-sync] hotel=${cfg.hotel_id} erro:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[nf-dfe-sync] Concluído em ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${configs.length} hotel/is).`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('[nf-dfe-sync] Falha geral:', err instanceof Error ? err.message : err);
    return { statusCode: 500 };
  }
});

export { handler };

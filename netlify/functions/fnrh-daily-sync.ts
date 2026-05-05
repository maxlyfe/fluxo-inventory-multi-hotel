// netlify/functions/fnrh-daily-sync.ts
// Job noturno: envia check-ins e check-outs do dia à API FNRH Gov (SERPRO)
// Executa às 02:50 UTC = 23:50 BRT (UTC-3)

import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL       = process.env.SUPABASE_URL       || process.env.VITE_SUPABASE_URL       || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const FNRH_URLS: Record<string, string> = {
  producao:    'https://fnrh.turismo.serpro.gov.br/FNRH_API/rest/v2',
  homologacao: 'https://hom-lowcode.serpro.gov.br/FNRH_API/rest/v2',
};

const ERBON_NETLIFY_PROXY = '/.netlify/functions/erbon-proxy';  // não usado aqui
// O job chama Erbon diretamente (server-side, sem CORS)

// ── Supabase client (service role — bypass RLS) ────────────────────────────

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ── FNRH API helpers ──────────────────────────────────────────────────────────

async function fnrhFetch(
  cfg: { usuario: string; senha: string; cpf_responsavel: string; ambiente: string },
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const baseUrl = FNRH_URLS[cfg.ambiente] || FNRH_URLS.producao;
  const credentials = Buffer.from(`${cfg.usuario}:${cfg.senha}`).toString('base64');
  const headers: Record<string, string> = {
    'Authorization': `Basic ${credentials}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
  if (cfg.cpf_responsavel) headers['cpf_solicitante'] = cfg.cpf_responsavel;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ── Erbon helpers (server-side direct call) ────────────────────────────────

async function erbonGetToken(cfg: {
  erbon_base_url: string; erbon_hotel_id: string;
  erbon_username: string; erbon_password: string;
}): Promise<string> {
  const base = cfg.erbon_base_url.replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
  const path = `/hotel/${cfg.erbon_hotel_id}/auth/token`;
  const res = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      'username': cfg.erbon_username,
      'password': cfg.erbon_password,
    },
  });
  if (!res.ok) throw new Error(`Erbon auth failed: ${res.status}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Erbon: access_token missing');
  return data.access_token;
}

async function erbonSearchBookings(
  cfg: { erbon_base_url: string; erbon_hotel_id: string; erbon_username: string; erbon_password: string },
  params: { checkin?: string; checkout?: string; status?: string }
): Promise<Array<{
  bookingInternalID: number;
  erbonNumber: number;
  status: string;
  checkInDateTime: string;
  checkOutDateTime: string;
  adultQuantity: number;
  guestList: Array<{ id: number; name: string; email: string; phone: string; documents: Array<{ documentType: string; number: string }> }>;
}>> {
  const token = await erbonGetToken(cfg);
  const base  = cfg.erbon_base_url.replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
  const path  = `/hotel/${cfg.erbon_hotel_id}/booking/search`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
  if (params.checkin)  headers['checkin']  = params.checkin;
  if (params.checkout) headers['checkout'] = params.checkout;
  if (params.status)   headers['status']   = params.status;

  const res = await fetch(`${base}${path}`, { method: 'POST', headers });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ── Mapeamentos FNRH ──────────────────────────────────────────────────────────

function erbonGenderToFNRH(genderId: number | null | undefined): string {
  if (genderId === 1) return 'HOMEM';
  if (genderId === 2) return 'MULHER';
  if (genderId === 3) return 'OUTRO';
  return 'NAOINFORMADO';
}

function docTypeToFNRH(docType: string | null | undefined): 'CPF' | 'PASSAPORTE' {
  if (docType === 'PASSPORT' || docType === 'PASSAPORTE') return 'PASSAPORTE';
  return 'CPF';
}

function calcAgeFromDate(birthDateStr: string | null | undefined): number | null {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ── Busca dados FNRH do hóspede em wci_sessions / wci_checkin_guests ─────────

interface FnrhGuestData {
  name: string;
  document_type: string | null;
  document_number: string | null;
  birth_date: string | null;
  gender_id: number | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  address_country: string | null;
  address_state: string | null;
  address_city: string | null;
  address_street: string | null;
  address_zipcode: string | null;
  address_neighborhood: string | null;
  fnrh_raca_id: string | null;
  fnrh_deficiencia_id: string | null;
  fnrh_tipo_deficiencia_id: string | null;
  fnrh_motivo_viagem_id: string | null;
  fnrh_meio_transporte_id: string | null;
  // Menor de idade
  fnrh_grau_parentesco_id: string | null;
  fnrh_responsavel_documento: string | null;
  fnrh_responsavel_doc_tipo: string | null;
}

async function fetchFnrhExtrasForBooking(
  db: ReturnType<typeof createClient>,
  bookingId: number
): Promise<FnrhGuestData[]> {
  // Fonte primária: wci_checkin_fichas → wci_checkin_guests (dados persistidos)
  const { data: fichas } = await db
    .from('wci_checkin_fichas')
    .select(`
      id,
      wci_checkin_guests(
        name, document_type, document_number, birth_date, gender_id, nationality,
        email, phone,
        address_country, address_state, address_city, address_street, address_zipcode, address_neighborhood,
        fnrh_raca_id, fnrh_deficiencia_id, fnrh_tipo_deficiencia_id,
        fnrh_motivo_viagem_id, fnrh_meio_transporte_id,
        fnrh_grau_parentesco_id, fnrh_responsavel_documento, fnrh_responsavel_doc_tipo
      )
    `)
    .eq('booking_number', String(bookingId));

  if (fichas && fichas.length > 0) {
    const guests: FnrhGuestData[] = [];
    for (const f of fichas) {
      const g = (f as any).wci_checkin_guests;
      if (Array.isArray(g)) guests.push(...g);
    }
    if (guests.length > 0) return guests;
  }

  // Fallback: wci_sessions (sessão ainda não finalizada / sem assinatura)
  const { data: sessions } = await db
    .from('wci_sessions')
    .select('guests')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!sessions?.length) return [];
  const rawGuests = (sessions[0] as any).guests;
  if (!Array.isArray(rawGuests)) return [];

  return rawGuests.map((g: any): FnrhGuestData => ({
    name:              g.name                        || '',
    document_type:     g.documents?.[0]?.documentType || null,
    document_number:   g.documents?.[0]?.number       || null,
    birth_date:        g.birthDate                   || null,
    gender_id:         g.genderID                    || null,
    nationality:       g.nationality                 || null,
    email:             g.email                       || null,
    phone:             g.phone                       || null,
    address_country:      g.address?.country         || null,
    address_state:        g.address?.state           || null,
    address_city:         g.address?.city            || null,
    address_street:       g.address?.street          || null,
    address_zipcode:      g.address?.zipcode         || null,
    address_neighborhood: g.address?.neighborhood    || null,
    // FNRH fields — novos guests têm fnrh_extra; legados podem ter na raiz
    fnrh_raca_id:             g.fnrh_extra?.raca_id             ?? g.fnrh_raca_id             ?? null,
    fnrh_deficiencia_id:      g.fnrh_extra?.deficiencia_id      ?? g.fnrh_deficiencia_id      ?? null,
    fnrh_tipo_deficiencia_id: g.fnrh_extra?.tipo_deficiencia_id ?? g.fnrh_tipo_deficiencia_id ?? null,
    fnrh_motivo_viagem_id:    g.fnrh_extra?.motivo_viagem_id    ?? g.fnrh_motivo_viagem_id    ?? null,
    fnrh_meio_transporte_id:  g.fnrh_extra?.meio_transporte_id  ?? g.fnrh_meio_transporte_id  ?? null,
    fnrh_grau_parentesco_id:    g.fnrh_extra?.grau_parentesco_id    ?? null,
    fnrh_responsavel_documento: g.fnrh_extra?.responsavel_documento ?? null,
    fnrh_responsavel_doc_tipo:  g.fnrh_extra?.responsavel_doc_tipo  ?? null,
  }));
}

// ── Verifica idempotência ──────────────────────────────────────────────────────

async function jaEnviado(
  db: ReturnType<typeof createClient>,
  hotelId: string,
  erbonBookingId: string,
  action: string
): Promise<{ sent: boolean; fnrhReservaId?: string }> {
  const { data } = await db
    .from('fnrh_sync_log')
    .select('status, fnrh_reserva_id')
    .eq('hotel_id', hotelId)
    .eq('erbon_booking_id', erbonBookingId)
    .eq('action', action)
    .in('status', ['SUCESSO', 'CHECKOUT_ENVIADO'])
    .limit(1)
    .maybeSingle();
  if (!data) return { sent: false };
  return { sent: true, fnrhReservaId: (data as any).fnrh_reserva_id };
}

// ── Log helpers ────────────────────────────────────────────────────────────────

async function salvarLog(
  db: ReturnType<typeof createClient>,
  entry: {
    hotel_id: string;
    erbon_booking_id: string;
    numero_reserva?: string | null;
    guest_name?: string | null;
    guest_document?: string | null;
    action: string;
    status: string;
    fnrh_reserva_id?: string | null;
    fnrh_hospede_id?: string | null;
    fnrh_pessoa_id?: string | null;
    request_payload?: unknown;
    response_payload?: unknown;
    error_detail?: unknown;
    retry_count?: number;
  }
): Promise<void> {
  await db.from('fnrh_sync_log').insert({
    ...entry,
    retry_count:   entry.retry_count ?? 0,
    updated_at:    new Date().toISOString(),
  });
}

// ── Processamento de CHECK-IN ──────────────────────────────────────────────────

async function processCheckin(
  db: ReturnType<typeof createClient>,
  hotelId: string,
  fnrhCfg: { usuario: string; senha: string; cpf_responsavel: string; ambiente: string },
  booking: {
    bookingInternalID: number;
    erbonNumber: number;
    checkInDateTime: string;
    checkOutDateTime: string;
    adultQuantity: number;
    guestList: Array<{ id: number; name: string; email: string; phone: string; documents: Array<{ documentType: string; number: string }> }>;
  },
  today: string
): Promise<void> {
  const erbonId = String(booking.bookingInternalID);

  // Idempotência
  const { sent } = await jaEnviado(db, hotelId, erbonId, 'CHECKIN');
  if (sent) {
    console.log(`[FNRH] CHECKIN ${erbonId} já enviado — skip`);
    return;
  }

  // Busca dados FNRH do WCI
  const wciGuests = await fetchFnrhExtrasForBooking(db, booking.bookingInternalID);

  // Se não há dados WCI, salva como PENDENTE
  if (!wciGuests || wciGuests.length === 0) {
    await salvarLog(db, {
      hotel_id: hotelId,
      erbon_booking_id: erbonId,
      numero_reserva: String(booking.erbonNumber),
      guest_name: booking.guestList[0]?.name || null,
      guest_document: booking.guestList[0]?.documents?.[0]?.number || null,
      action: 'CHECKIN',
      status: 'PENDENTE',
      error_detail: { message: 'WCI não preenchido para esta reserva' },
    });
    console.log(`[FNRH] CHECKIN ${erbonId} — WCI ausente → PENDENTE`);
    return;
  }

  // Monta dados_hospede
  const mainWci = wciGuests[0];
  const cpfResp = fnrhCfg.cpf_responsavel;

  // Conta adultos e menores a partir dos dados WCI
  let qtdAdulto = 0;
  let qtdMenor  = 0;
  for (const g of wciGuests) {
    const age = calcAgeFromDate(g.birth_date);
    if (age !== null && age < 18) qtdMenor++;
    else qtdAdulto++;
  }
  if (qtdAdulto === 0) qtdAdulto = booking.adultQuantity || 1; // fallback Erbon

  const dadosHospede = wciGuests.map((g, idx) => {
    const guestAge  = calcAgeFromDate(g.birth_date);
    const isMinor   = guestAge !== null && guestAge < 18;

    // Responsável: para menor usa o doc informado no WCI; para adulto usa CPF do hotel
    const respDoc     = isMinor && g.fnrh_responsavel_documento
      ? g.fnrh_responsavel_documento
      : cpfResp;
    const respDocTipo = isMinor && g.fnrh_responsavel_doc_tipo
      ? (g.fnrh_responsavel_doc_tipo === 'PASSAPORTE' ? 'PASSAPORTE' : 'CPF')
      : 'CPF';

    const dadosFicha: Record<string, string> = {
      motivo_viagem_id:   g.fnrh_motivo_viagem_id   || 'LAZER_FERIAS',
      meio_transporte_id: g.fnrh_meio_transporte_id || 'AUTOMOVEL',
    };
    if (isMinor && g.fnrh_grau_parentesco_id) {
      dadosFicha.grau_parentesco_id = g.fnrh_grau_parentesco_id;
    }

    return {
      is_principal: idx === 0,
      situacao_hospede: 'CHECKIN_REALIZADO',
      check_in_em:  new Date(booking.checkInDateTime).toISOString(),
      check_out_em: new Date(booking.checkOutDateTime).toISOString(),
      dados_pessoais: {
        nome:                 g.name || '',
        nome_social:          g.name || '',
        PaisNacionalidade_id: g.nationality || 'BR',
        genero_id:            erbonGenderToFNRH(g.gender_id),
        GeneroDescricao:      erbonGenderToFNRH(g.gender_id),
        data_nascimento:      g.birth_date || '1990-01-01',
        raca_id:              g.fnrh_raca_id             || 'NAOINFORMAR',
        deficiencia_id:       g.fnrh_deficiencia_id      || 'NAOINFORMAR',
        tipo_deficiencia_id:  g.fnrh_tipo_deficiencia_id || '',
        documento_id: {
          numero_documento:  g.document_number || '',
          tipo_documento_id: docTypeToFNRH(g.document_type),
        },
        contato: {
          email:             g.email                || '',
          telefone:          g.phone                || '',
          cep:               g.address_zipcode      || '',
          logradouro:        g.address_street       || '',
          numero:            '',
          complemento:       '',
          bairro:            g.address_neighborhood || '',
          PaisResidencia_id: g.address_country      || 'BR',
          cidade_id:         null,
          estado_id:         g.address_state        || '',
        },
      },
      responsavel: {
        numero_documento:  respDoc,
        tipo_documento_id: respDocTipo,
      },
      dados_ficha: dadosFicha,
    };
  });

  const payload = {
    reserva: {
      numero_reserva:           String(booking.erbonNumber),
      numero_reserva_ota:       String(booking.erbonNumber),
      data_entrada:             today,
      data_saida:               booking.checkOutDateTime.substring(0, 10),
      quantidade_hospede_adulto: qtdAdulto,
      quantidade_hospede_menor:  qtdMenor,
      origem_reserva_id:        'MEIOHOSPEDAGEM',
    },
    dados_hospede: dadosHospede,
  };

  try {
    const { status, data } = await fnrhFetch(fnrhCfg, '/hospedagem/registrar', 'POST', payload);
    if (status === 200) {
      const d = data as any;
      await salvarLog(db, {
        hotel_id:         hotelId,
        erbon_booking_id: erbonId,
        numero_reserva:   String(booking.erbonNumber),
        guest_name:       mainWci.name,
        guest_document:   mainWci.document_number,
        action:           'CHECKIN',
        status:           'SUCESSO',
        fnrh_reserva_id:  d?.dados?.reserva?.reserva_id || null,
        fnrh_hospede_id:  d?.dados?.dados_hospedes?.[0]?.hospede_id || null,
        fnrh_pessoa_id:   d?.dados?.dados_hospedes?.[0]?.hospede?.pessoa_id || null,
        request_payload:  payload,
        response_payload: data as Record<string, unknown>,
      });
      console.log(`[FNRH] CHECKIN ${erbonId} → SUCESSO`);
    } else {
      await salvarLog(db, {
        hotel_id:         hotelId,
        erbon_booking_id: erbonId,
        numero_reserva:   String(booking.erbonNumber),
        guest_name:       mainWci.name,
        guest_document:   mainWci.document_number,
        action:           'CHECKIN',
        status:           'ERRO',
        request_payload:  payload,
        response_payload: data as Record<string, unknown>,
        error_detail:     { code: status, message: (data as any)?.mensagem || `HTTP ${status}`, body: JSON.stringify(data) },
      });
      console.error(`[FNRH] CHECKIN ${erbonId} → ERRO ${status}`);
    }
  } catch (err: any) {
    await salvarLog(db, {
      hotel_id:         hotelId,
      erbon_booking_id: erbonId,
      numero_reserva:   String(booking.erbonNumber),
      guest_name:       mainWci.name,
      guest_document:   mainWci.document_number,
      action:           'CHECKIN',
      status:           'ERRO',
      request_payload:  payload,
      error_detail:     { message: err.message || 'Erro desconhecido' },
    });
    console.error(`[FNRH] CHECKIN ${erbonId} → EXCEPTION:`, err.message);
  }
}

// ── Processamento de CHECKOUT ─────────────────────────────────────────────────

async function processCheckout(
  db: ReturnType<typeof createClient>,
  hotelId: string,
  fnrhCfg: { usuario: string; senha: string; cpf_responsavel: string; ambiente: string },
  booking: { bookingInternalID: number; erbonNumber: number; checkOutDateTime: string; guestList: Array<{ name: string; documents: Array<{ number: string }> }> }
): Promise<void> {
  const erbonId = String(booking.bookingInternalID);

  // Idempotência
  const { sent } = await jaEnviado(db, hotelId, erbonId, 'CHECKOUT');
  if (sent) {
    console.log(`[FNRH] CHECKOUT ${erbonId} já enviado — skip`);
    return;
  }

  // Precisa do fnrh_reserva_id do check-in
  const { data: ciLog } = await db
    .from('fnrh_sync_log')
    .select('fnrh_reserva_id')
    .eq('hotel_id', hotelId)
    .eq('erbon_booking_id', erbonId)
    .eq('action', 'CHECKIN')
    .eq('status', 'SUCESSO')
    .limit(1)
    .maybeSingle();

  const fnrhReservaId = (ciLog as any)?.fnrh_reserva_id;

  if (!fnrhReservaId) {
    await salvarLog(db, {
      hotel_id:         hotelId,
      erbon_booking_id: erbonId,
      numero_reserva:   String(booking.erbonNumber),
      guest_name:       booking.guestList[0]?.name || null,
      guest_document:   booking.guestList[0]?.documents?.[0]?.number || null,
      action:           'CHECKOUT',
      status:           'PENDENTE',
      error_detail:     { message: 'Check-in FNRH não encontrado — não é possível enviar checkout' },
    });
    console.log(`[FNRH] CHECKOUT ${erbonId} → sem fnrh_reserva_id → PENDENTE`);
    return;
  }

  const dtUTC = new Date(booking.checkOutDateTime).toISOString();

  try {
    const { status, data } = await fnrhFetch(fnrhCfg, `/reservas/${fnrhReservaId}/checkout`, 'POST', dtUTC);
    if (status === 200) {
      await salvarLog(db, {
        hotel_id:         hotelId,
        erbon_booking_id: erbonId,
        numero_reserva:   String(booking.erbonNumber),
        guest_name:       booking.guestList[0]?.name || null,
        action:           'CHECKOUT',
        status:           'CHECKOUT_ENVIADO',
        fnrh_reserva_id:  fnrhReservaId,
        response_payload: data as Record<string, unknown>,
      });
      console.log(`[FNRH] CHECKOUT ${erbonId} → CHECKOUT_ENVIADO`);
    } else {
      await salvarLog(db, {
        hotel_id:         hotelId,
        erbon_booking_id: erbonId,
        numero_reserva:   String(booking.erbonNumber),
        guest_name:       booking.guestList[0]?.name || null,
        action:           'CHECKOUT',
        status:           'ERRO',
        fnrh_reserva_id:  fnrhReservaId,
        response_payload: data as Record<string, unknown>,
        error_detail:     { code: status, message: (data as any)?.mensagem || `HTTP ${status}`, body: JSON.stringify(data) },
      });
      console.error(`[FNRH] CHECKOUT ${erbonId} → ERRO ${status}`);
    }
  } catch (err: any) {
    await salvarLog(db, {
      hotel_id:         hotelId,
      erbon_booking_id: erbonId,
      numero_reserva:   String(booking.erbonNumber),
      guest_name:       booking.guestList[0]?.name || null,
      action:           'CHECKOUT',
      status:           'ERRO',
      fnrh_reserva_id:  fnrhReservaId,
      error_detail:     { message: err.message || 'Erro desconhecido' },
    });
    console.error(`[FNRH] CHECKOUT ${erbonId} → EXCEPTION:`, err.message);
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

const handler = schedule('50 2 * * *', async () => {
  console.log('[FNRH Daily Sync] Iniciando às', new Date().toISOString());

  let db: ReturnType<typeof createClient>;
  try {
    db = getDb();
  } catch (err: any) {
    console.error('[FNRH Daily Sync] DB init error:', err.message);
    return { statusCode: 500 };
  }

  // Data de hoje em BRT (UTC-3)
  const nowUTC  = new Date();
  const nowBRT  = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
  const today   = nowBRT.toISOString().substring(0, 10);
  const yesterday = new Date(nowBRT.getTime() - 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  console.log(`[FNRH] Processando check-ins de ${today} e check-outs de ${yesterday}–${today}`);

  // Busca hotéis com FNRH ativo
  const { data: fnrhConfigs, error: cfgErr } = await db
    .from('fnrh_hotel_configs')
    .select('*')
    .eq('is_active', true);

  if (cfgErr || !fnrhConfigs?.length) {
    console.log('[FNRH] Nenhum hotel com FNRH ativo.');
    return { statusCode: 200 };
  }

  for (const fnrhCfg of fnrhConfigs) {
    const hotelId = fnrhCfg.hotel_id;
    console.log(`[FNRH] Hotel ${hotelId} — iniciando`);

    // Busca config Erbon do hotel
    const { data: erbonCfgData } = await db
      .from('erbon_hotel_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      .maybeSingle();

    if (!erbonCfgData) {
      console.log(`[FNRH] Hotel ${hotelId} — Erbon não configurado, skip`);
      continue;
    }

    const erbonCfg = erbonCfgData as {
      erbon_base_url: string; erbon_hotel_id: string;
      erbon_username: string; erbon_password: string;
    };

    // ── CHECK-INS do dia ──────────────────────────────────────────────────────
    try {
      const checkIns = await erbonSearchBookings(erbonCfg, {
        checkin: today,
        status: 'CHECK-IN',
      });
      console.log(`[FNRH] ${checkIns.length} check-ins hoje (${today})`);

      for (const bk of checkIns) {
        try {
          await processCheckin(db, hotelId, fnrhCfg, bk, today);
        } catch (e: any) {
          console.error(`[FNRH] Erro processando check-in ${bk.bookingInternalID}:`, e.message);
        }
      }
    } catch (e: any) {
      console.error(`[FNRH] Erro ao buscar check-ins:`, e.message);
    }

    // ── CHECK-OUTS do dia e pendentes de ontem ────────────────────────────────
    const checkoutDates = [today, yesterday];
    for (const coDate of checkoutDates) {
      try {
        const checkOuts = await erbonSearchBookings(erbonCfg, {
          checkout: coDate,
          status: 'CHECK-OUT',
        });
        console.log(`[FNRH] ${checkOuts.length} check-outs de ${coDate}`);

        for (const bk of checkOuts) {
          try {
            await processCheckout(db, hotelId, fnrhCfg, bk);
          } catch (e: any) {
            console.error(`[FNRH] Erro processando check-out ${bk.bookingInternalID}:`, e.message);
          }
        }
      } catch (e: any) {
        console.error(`[FNRH] Erro ao buscar check-outs de ${coDate}:`, e.message);
      }
    }

    console.log(`[FNRH] Hotel ${hotelId} — concluído`);
  }

  console.log('[FNRH Daily Sync] Concluído às', new Date().toISOString());
  return { statusCode: 200 };
});

export { handler };

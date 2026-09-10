// src/pages/reception/wciErbonResendService.ts
//
// Reenvio manual da ficha de web check-in para a Erbon, a partir da recepção.
//
// O envio no fluxo do hóspede é best-effort de propósito: se a Erbon estiver
// fora do ar, recusar a credencial ou rejeitar o payload, o check-in continua e
// o dado fica gravado no LyFe. O que faltava era o caminho de volta — poder
// reenviar depois, sem refazer o check-in nem digitar no PMS.
//
// Fonte de verdade do reenvio são as tabelas `wci_checkin_fichas` /
// `wci_checkin_guests` (o que a recepção vê na tela), não a sessão do hóspede,
// que já expirou. Cada etapa é independente e reporta o próprio resultado: uma
// falha no anexo do regulamento não impede o cadastro de subir.

import { supabase } from '../../lib/supabase';
import { erbonService, type ErbonGuestPayload } from '../../lib/erbonService';
import {
  saveGuestFNRH,
  submitSignature,
  submitAttachment,
  isManualRef,
} from '../webcheckin/webCheckinService';

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Subconjunto de `wci_checkin_guests` que o reenvio precisa. */
export interface ResendGuest {
  id: string;
  is_main_guest?: boolean;
  erbon_guest_id?: number | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  gender_id?: number | null;
  nationality?: string | null;
  profession?: string | null;
  vehicle_registration?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  document_expiration?: string | null;
  address_country?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_zipcode?: string | null;
  document_front_url?: string | null;
  document_back_url?: string | null;
}

/** Subconjunto de `wci_checkin_fichas` que o reenvio precisa. */
export interface ResendFicha {
  booking_number: string | null;
  booking_internal_id?: number | null;
  signature_data?: string | null;
  hotel_rules_doc_url?: string | null;
  lgpd_doc_url?: string | null;
}

export type ResendStepStatus = 'ok' | 'error' | 'skipped';

export interface ResendStep {
  key: 'guest' | 'attach' | 'signature' | 'rules' | 'lgpd' | 'docFront' | 'docBack';
  label: string;
  status: ResendStepStatus;
  detail?: string;
}

export interface ResendResult {
  ok: boolean;                    // true quando nenhuma etapa terminou em erro
  erbonGuestId: number | null;    // id do hóspede na Erbon após o envio
  steps: ResendStep[];
}

/** Erro de pré-condição: nada foi enviado, e a recepção precisa saber por quê. */
export class ResendBlockedError extends Error {}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Baixa um arquivo do Storage (URL pública) e devolve o base64 puro. */
async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const CHUNK = 8192;  // btoa em string gigante estoura a stack em aparelho fraco
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Extensão/mime a partir do nome do arquivo no Storage. */
function guessFileType(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function safeName(name: string): string {
  return (name || 'hospede').replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Monta o payload da Erbon a partir da linha da ficha. Espelha o que o fluxo
 * do hóspede monta em WCICompanionEntry: a Erbon não aceita 'DNI' (vai como
 * PASSPORT) e tem um campo único de logradouro, então rua e número voltam a ser
 * uma linha só — o inverso do que a ficha guarda em colunas separadas.
 */
export function buildErbonPayloadFromFicha(guest: ResendGuest): ErbonGuestPayload {
  const nationality   = guest.nationality || undefined;
  const addressCountry = guest.address_country || (nationality && nationality !== 'BR' ? nationality : 'BR');
  const isBR           = addressCountry === 'BR';
  const erbonStreet    = [guest.address_street?.trim(), guest.address_number?.trim()]
    .filter(Boolean).join(', ') || undefined;
  const erbonDocType   = guest.document_type === 'DNI' ? 'PASSPORT' : guest.document_type;
  const docNumber      = guest.document_number?.trim();

  return {
    id: guest.erbon_guest_id && guest.erbon_guest_id > 0 ? guest.erbon_guest_id : 0,
    name: guest.name,
    email: guest.email?.trim() || undefined,
    phone: guest.phone?.trim() || undefined,
    birthDate: guest.birth_date || undefined,
    genderID: guest.gender_id || undefined,
    nationality,
    profession: guest.profession?.trim() || undefined,
    vehicleRegistration: guest.vehicle_registration?.trim() || undefined,
    documents: docNumber && erbonDocType ? [{
      documentType: erbonDocType,
      number: docNumber,
      country: addressCountry,
      ...(guest.document_expiration ? { expirationDate: `${guest.document_expiration}T00:00:00` } : {}),
    }] : [],
    address: {
      country:      addressCountry,
      state:        isBR ? (guest.address_state || undefined) : undefined,
      zipcode:      isBR ? (guest.address_zipcode || undefined) : undefined,
      city:         guest.address_city || undefined,
      street:       erbonStreet,
      neighborhood: guest.address_neighborhood || undefined,
    },
  };
}

// ── Reenvio ──────────────────────────────────────────────────────────────────

/**
 * Reenvia para a Erbon tudo o que o hóspede preencheu: cadastro, assinatura,
 * regulamento/LGPD assinados e fotos do documento.
 *
 * Lança ResendBlockedError quando não há como enviar (hotel sem Erbon ativo,
 * ficha de sessão manual, reserva sem vínculo interno). Fora disso não lança:
 * o resultado de cada etapa vem em `steps`.
 */
export async function resendGuestToErbon(
  hotelId: string,
  ficha: ResendFicha,
  guest: ResendGuest,
): Promise<ResendResult> {
  const config = await erbonService.getConfig(hotelId).catch(() => null);
  if (!config?.is_active) {
    throw new ResendBlockedError('Este hotel não tem integração Erbon ativa.');
  }
  if (isManualRef(ficha.booking_number)) {
    throw new ResendBlockedError(
      'Ficha de check-in manual (contingência): a reserva não existe na Erbon, não há o que reenviar.',
    );
  }
  const bookingInternalId = Number(ficha.booking_internal_id || 0);
  if (!bookingInternalId) {
    throw new ResendBlockedError(
      'Esta ficha não guardou o ID interno da reserva na Erbon. Refaça o check-in pela busca de reserva para vinculá-la.',
    );
  }

  const steps: ResendStep[] = [];
  const ts = Date.now();
  const fileBase = safeName(guest.name);

  // ── 1. Cadastro do hóspede ────────────────────────────────────────────────
  // Mesma retentativa sem genderID do fluxo do hóspede: a Erbon devolve 400
  // quando o gênero informado não existe na base dela.
  const payload = buildErbonPayloadFromFicha(guest);
  const existingId = guest.erbon_guest_id && guest.erbon_guest_id > 0 ? guest.erbon_guest_id : null;
  let erbonGuestId: number | null = existingId;
  let guestOk = false;
  let guestError = '';

  try {
    erbonGuestId = await saveGuestFNRH(hotelId, bookingInternalId, existingId, payload);
    guestOk = true;
  } catch (e1) {
    try {
      erbonGuestId = await saveGuestFNRH(hotelId, bookingInternalId, existingId, { ...payload, genderID: undefined });
      guestOk = true;
    } catch (e2) {
      // As duas mensagens, porque as tentativas falham por motivos diferentes:
      // a 1ª costuma trazer o campo recusado, a 2ª confirma que não era o gênero.
      const m1 = (e1 as Error)?.message || 'erro sem mensagem';
      const m2 = (e2 as Error)?.message || 'erro sem mensagem';
      guestError = m1 === m2 ? m1 : `${m1} | sem genero: ${m2}`;
    }
  }
  steps.push({
    key: 'guest',
    label: 'Cadastro do hóspede',
    status: guestOk ? 'ok' : 'error',
    detail: guestOk ? (erbonGuestId ? `ID Erbon ${erbonGuestId}` : 'enviado') : guestError,
  });

  // ── 2. Vínculo com a reserva ──────────────────────────────────────────────
  // `guests/update` grava no cadastro geral do hotel, não na reserva. Um
  // hóspede pode estar atualizado e continuar invisível na reserva se o
  // `attach` nunca aconteceu — o `addGuestToBooking` engole falha de vínculo
  // de propósito (o hóspede foi criado, só não ficou ligado). É exatamente o
  // caso em que a recepção aperta "enviar", recebe OK e não vê nada no PMS.
  // Por isso aqui a reserva é lida de volta e o vínculo é refeito se faltar.
  if (guestOk) {
    try {
      const booking = await erbonService.fetchBookingByInternalId(hotelId, bookingInternalId);
      if (!booking) {
        steps.push({
          key: 'attach', label: 'Vínculo com a reserva', status: 'error',
          detail: 'não foi possível ler a reserva na Erbon para conferir',
        });
      } else {
        const list = (booking.guestList || []) as Array<{ id?: number }>;
        const attached = !!erbonGuestId && list.some(g => Number(g.id) === Number(erbonGuestId));
        if (attached) {
          steps.push({ key: 'attach', label: 'Vínculo com a reserva', status: 'ok', detail: 'já consta na reserva' });
        } else if (erbonGuestId && erbonGuestId > 0) {
          try {
            await erbonService.attachGuestToBooking(hotelId, bookingInternalId, erbonGuestId, !!guest.is_main_guest);
            steps.push({ key: 'attach', label: 'Vínculo com a reserva', status: 'ok', detail: 'hóspede vinculado agora' });
          } catch (e) {
            steps.push({ key: 'attach', label: 'Vínculo com a reserva', status: 'error', detail: (e as Error)?.message });
          }
        } else {
          steps.push({
            key: 'attach', label: 'Vínculo com a reserva', status: 'error',
            detail: 'a Erbon não devolveu o ID do hóspede, não há como vincular',
          });
        }
      }
    } catch (e) {
      steps.push({ key: 'attach', label: 'Vínculo com a reserva', status: 'error', detail: (e as Error)?.message });
    }
  } else {
    steps.push({ key: 'attach', label: 'Vínculo com a reserva', status: 'skipped', detail: 'cadastro não subiu' });
  }

  // ── 3. Assinatura ─────────────────────────────────────────────────────────
  if (ficha.signature_data) {
    try {
      const sigBase64 = ficha.signature_data.replace(/^data:image\/\w+;base64,/, '');
      await submitSignature(hotelId, bookingInternalId, sigBase64, erbonGuestId ?? undefined);
      steps.push({ key: 'signature', label: 'Assinatura', status: 'ok' });
    } catch (e) {
      steps.push({ key: 'signature', label: 'Assinatura', status: 'error', detail: (e as Error)?.message });
    }
  } else {
    steps.push({ key: 'signature', label: 'Assinatura', status: 'skipped', detail: 'hóspede não assinou' });
  }

  // ── 4-7. Anexos (termos assinados + fotos do documento) ───────────────────
  const attachments: Array<{ key: ResendStep['key']; label: string; url: string | null | undefined; file: string }> = [
    { key: 'rules',    label: 'Regulamento assinado', url: ficha.hotel_rules_doc_url, file: `Regulamento_${fileBase}_${ts}` },
    { key: 'lgpd',     label: 'Termo LGPD assinado',  url: ficha.lgpd_doc_url,        file: `LGPD_${fileBase}_${ts}` },
    { key: 'docFront', label: 'Documento (frente)',   url: guest.document_front_url,  file: `doc_${fileBase}_${ts}_1` },
    { key: 'docBack',  label: 'Documento (verso)',    url: guest.document_back_url,   file: `doc_${fileBase}_${ts}_2` },
  ];

  for (const att of attachments) {
    if (!att.url) {
      steps.push({ key: att.key, label: att.label, status: 'skipped', detail: 'não enviado pelo hóspede' });
      continue;
    }
    try {
      const fileType = guessFileType(att.url);
      const ext = fileType.split('/').pop() === 'png' ? 'png' : fileType === 'application/pdf' ? 'pdf' : 'jpg';
      const base64 = await urlToBase64(att.url);
      const sent = await submitAttachment(hotelId, bookingInternalId, base64, `${att.file}.${ext}`, fileType);
      steps.push({
        key: att.key, label: att.label,
        status: sent ? 'ok' : 'error',
        detail: sent ? undefined : 'a Erbon não aceitou o anexo',
      });
    } catch (e) {
      steps.push({ key: att.key, label: att.label, status: 'error', detail: (e as Error)?.message || 'falha ao baixar/enviar' });
    }
  }

  const failed = steps.filter(s => s.status === 'error');
  const ok = failed.length === 0;

  // Resultado fica na própria linha do hóspede — a recepção enxerga o que
  // falhou sem reabrir a tela, e o próximo reenvio atualiza em vez de duplicar
  // o cadastro (quando um ID novo veio da Erbon).
  try {
    await supabase.rpc('wci_mark_guest_erbon_sync', {
      p_guest_id: guest.id,
      p_ok: ok,
      p_erbon_guest_id: erbonGuestId && erbonGuestId > 0 ? erbonGuestId : null,
      p_error: ok ? null : failed.map(s => `${s.label}: ${s.detail || 'erro'}`).join(' | ').slice(0, 500),
    });
  } catch { /* best-effort: o envio à Erbon já aconteceu, a marcação não pode desfazê-lo */ }

  return { ok, erbonGuestId, steps };
}

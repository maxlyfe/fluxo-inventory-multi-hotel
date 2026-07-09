// src/lib/omnibeesService.ts
// Integração com o PMS Pull WebService da Omnibees (SOAP / OTA 2014B).
//
// O Fluxo atua como PMS: puxa as reservas que entraram na Omnibees pelos
// canais (Booking, Expedia, site...), grava em internal_bookings (source =
// 'omnibees') e confirma a entrega (OTA_NotifReport) — sem confirmação a
// Omnibees reenvia a reserva.
//
// Operações do WSDL (namespace http://connectors.omnibees.com/):
//   OTA_Ping                → OTA_PingRQ / OTA_PingRS
//   OTA_Read                → OTA_ReadRQ / OTA_ResRetrieveRS
//   ReservationConfirmation → OTA_NotifReportRQ / OTA_NotifReportRS
// Body OTA no namespace http://www.opentravel.org/OTA/2003/05.

import { supabase } from './supabase';
import { format, subDays } from 'date-fns';

const isDev = import.meta.env.DEV;
const DEV_PROXY_PREFIX = '/omnibees-api';
const NETLIFY_PROXY = '/.netlify/functions/omnibees-proxy';
const OTA_NS = 'http://www.opentravel.org/OTA/2003/05';
const CONNECTORS_NS = 'http://connectors.omnibees.com/';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface OmnibeesConfig {
  id: string;
  hotel_id: string;
  hotel_code: string;
  chain_code: string | null;
  user_code: string;
  username: string;
  password: string;
  base_url: string;
  is_active: boolean;
  last_sync_at: string | null;
}

export interface OmnibeesReservation {
  /** nº da reserva no sistema Omnibees (ResID_Value) */
  externalId: string;
  /** Book | Modify | Cancel */
  status: string;
  channel: string | null;
  createdAt: string | null;
  checkin: string | null;   // yyyy-MM-dd
  checkout: string | null;  // yyyy-MM-dd
  roomType: string | null;
  ratePlan: string | null;
  adults: number;
  children: number;
  total: number | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  comments: string | null;
}

// ── Helpers SOAP ──────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildEnvelope(config: OmnibeesConfig, otaBody: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <OmnibeesCredentials xmlns="${CONNECTORS_NS}">
      <UserCode>${xmlEscape(config.user_code)}</UserCode>
      <UserName>${xmlEscape(config.username)}</UserName>
      <UserPassword>${xmlEscape(config.password)}</UserPassword>
    </OmnibeesCredentials>
  </soap:Header>
  <soap:Body>${otaBody}</soap:Body>
</soap:Envelope>`;
}

function resolveUrl(baseUrl: string): string {
  if (isDev) {
    // Em dev o Vite faz proxy de /omnibees-api → https://pms.omnibees.com
    try {
      const u = new URL(baseUrl);
      return `${DEV_PROXY_PREFIX}${u.pathname}`;
    } catch { return `${DEV_PROXY_PREFIX}/OTA2014B/PullWebService.asmx`; }
  }
  return NETLIFY_PROXY;
}

async function soapCall(config: OmnibeesConfig, action: string, otaBody: string): Promise<Document> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': `${CONNECTORS_NS}${action}`,
  };
  if (!isDev) headers['x-omnibees-url'] = config.base_url;

  const res = await fetch(resolveUrl(config.base_url), {
    method: 'POST',
    headers,
    body: buildEnvelope(config, otaBody),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Omnibees ${action} falhou (${res.status}): ${text.slice(0, 300)}`);

  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Resposta Omnibees não é XML válido: ${text.slice(0, 200)}`);
  }
  // Erros SOAP / OTA
  const fault = byLocal(doc, 'Fault')[0];
  if (fault) throw new Error(`SOAP Fault: ${fault.textContent?.slice(0, 300)}`);
  const err = byLocal(doc, 'Error')[0];
  if (err) {
    const msg = err.getAttribute('ShortText') || err.textContent || 'erro desconhecido';
    throw new Error(`Omnibees: ${msg}`);
  }
  return doc;
}

/** Busca elementos por localName (ignora prefixos de namespace) */
function byLocal(root: Document | Element, name: string): Element[] {
  const all = (root as Document).getElementsByTagName
    ? (root as Document).getElementsByTagName('*')
    : (root as Element).getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}

function nowStamp(): string {
  return new Date().toISOString();
}

function echoToken(): string {
  return `fluxo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Parsing da reserva (OTA_ResRetrieveRS → OmnibeesReservation) ─────────────

function parseReservation(hr: Element): OmnibeesReservation | null {
  // nº da reserva Omnibees: HotelReservationIDs/HotelReservationID (ResID_Value)
  let externalId = '';
  for (const idEl of byLocal(hr, 'HotelReservationID')) {
    const v = idEl.getAttribute('ResID_Value');
    if (v) { externalId = v; break; }
  }
  if (!externalId) {
    const uid = byLocal(hr, 'UniqueID')[0];
    externalId = uid?.getAttribute('ID') || '';
  }
  if (!externalId) return null;

  const status = hr.getAttribute('ResStatus') || 'Book';
  const createdAt = hr.getAttribute('CreateDateTime');

  const roomStay = byLocal(hr, 'RoomStay')[0];
  const timeSpan = roomStay ? byLocal(roomStay, 'TimeSpan')[0] : null;
  const checkin = timeSpan?.getAttribute('Start')?.slice(0, 10) || null;
  const checkout = timeSpan?.getAttribute('End')?.slice(0, 10) || null;

  const roomTypeEl = roomStay ? byLocal(roomStay, 'RoomType')[0] : null;
  const roomType = roomTypeEl?.getAttribute('RoomTypeCode')
    || byLocal(roomTypeEl || hr, 'RoomDescription')[0]?.getAttribute('Name')
    || null;

  const ratePlanEl = roomStay ? byLocal(roomStay, 'RatePlan')[0] : null;
  const ratePlan = ratePlanEl?.getAttribute('RatePlanName') || ratePlanEl?.getAttribute('RatePlanCode') || null;

  let adults = 0, children = 0;
  for (const gc of byLocal(roomStay || hr, 'GuestCount')) {
    const age = gc.getAttribute('AgeQualifyingCode');
    const count = parseInt(gc.getAttribute('Count') || '0', 10) || 0;
    if (age === '10' || age === null) adults += count;
    else children += count;
  }

  // Total: preferir ResGlobalInfo/Total, senão RoomStay/Total
  let total: number | null = null;
  const globalInfo = byLocal(hr, 'ResGlobalInfo')[0];
  const totalEl = (globalInfo && byLocal(globalInfo, 'Total')[0]) || (roomStay && byLocal(roomStay, 'Total')[0]);
  if (totalEl) {
    const v = parseFloat(totalEl.getAttribute('AmountAfterTax') || totalEl.getAttribute('AmountBeforeTax') || '');
    if (!isNaN(v)) total = v;
  }

  // Hóspede principal: primeiro ResGuest → Profile → Customer
  let guestName: string | null = null, guestEmail: string | null = null, guestPhone: string | null = null;
  const customer = byLocal(hr, 'Customer')[0];
  if (customer) {
    const given = byLocal(customer, 'GivenName')[0]?.textContent || '';
    const surname = byLocal(customer, 'Surname')[0]?.textContent || '';
    guestName = `${given} ${surname}`.trim() || null;
    guestEmail = byLocal(customer, 'Email')[0]?.textContent?.trim() || null;
    const tel = byLocal(customer, 'Telephone')[0];
    guestPhone = tel?.getAttribute('PhoneNumber') || null;
  }

  // Canal de venda
  const channelEl = byLocal(hr, 'BookingChannel')[0];
  const channel = channelEl
    ? (byLocal(channelEl, 'CompanyName')[0]?.textContent?.trim() || channelEl.getAttribute('Type') || null)
    : null;

  // Comentários
  const comments = byLocal(hr, 'Comment')
    .map(c => c.textContent?.trim())
    .filter(Boolean)
    .join(' | ') || null;

  return {
    externalId, status, channel, createdAt, checkin, checkout,
    roomType, ratePlan, adults: adults || 2, children, total,
    guestName, guestEmail, guestPhone, comments,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const omnibeesService = {
  async getConfig(hotelId: string): Promise<OmnibeesConfig | null> {
    const { data } = await supabase
      .from('omnibees_hotel_config')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    return (data as OmnibeesConfig) || null;
  },

  async saveConfig(cfg: Partial<OmnibeesConfig> & { hotel_id: string }): Promise<void> {
    const existing = await this.getConfig(cfg.hotel_id);
    const payload = {
      hotel_code: cfg.hotel_code,
      chain_code: cfg.chain_code || null,
      user_code: cfg.user_code,
      username: cfg.username,
      password: cfg.password,
      base_url: cfg.base_url || 'https://pms.omnibees.com/OTA2014B/PullWebService.asmx',
      is_active: cfg.is_active ?? true,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error } = await supabase.from('omnibees_hotel_config').update(payload).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('omnibees_hotel_config').insert({ ...payload, hotel_id: cfg.hotel_id });
      if (error) throw error;
    }
  },

  /** OTA_Ping — valida credenciais/conectividade */
  async testConnection(cfg: OmnibeesConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const token = echoToken();
      const body = `<OTA_PingRQ xmlns="${OTA_NS}" Version="3.0" TimeStamp="${nowStamp()}" EchoToken="${token}">
        <EchoData>fluxo</EchoData>
      </OTA_PingRQ>`;
      const doc = await soapCall(cfg, 'OTA_Ping', body);
      const rs = byLocal(doc, 'OTA_PingRS')[0];
      const success = rs ? byLocal(rs, 'Success').length > 0 || !!byLocal(rs, 'EchoData')[0] : false;
      return success ? { success: true } : { success: false, error: 'Resposta inesperada do OTA_Ping.' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Erro ao conectar.' };
    }
  },

  /** OTA_Read — reservas não entregues criadas na janela (máx. 5 dias atrás) */
  async fetchUndeliveredReservations(cfg: OmnibeesConfig, daysBack = 4): Promise<OmnibeesReservation[]> {
    const start = format(subDays(new Date(), Math.min(daysBack, 4)), 'yyyy-MM-dd');
    const end = format(new Date(), 'yyyy-MM-dd');
    const chainAttr = cfg.chain_code ? ` ChainCode="${xmlEscape(cfg.chain_code)}"` : '';
    const body = `<OTA_ReadRQ xmlns="${OTA_NS}" Version="3.0" TimeStamp="${nowStamp()}" EchoToken="${echoToken()}">
      <ReadRequests>
        <HotelReadRequests HotelCode="${xmlEscape(cfg.hotel_code)}"${chainAttr}>
          <SelectionCriteria Start="${start}" End="${end}" SelectionType="AllUndelivered" />
        </HotelReadRequests>
      </ReadRequests>
    </OTA_ReadRQ>`;
    const doc = await soapCall(cfg, 'OTA_Read', body);
    const out: OmnibeesReservation[] = [];
    for (const hr of byLocal(doc, 'HotelReservation')) {
      const r = parseReservation(hr);
      if (r) out.push(r);
    }
    return out;
  },

  /** OTA_NotifReport — confirma a entrega das reservas (obrigatório) */
  async confirmReservations(cfg: OmnibeesConfig, reservations: OmnibeesReservation[]): Promise<void> {
    if (reservations.length === 0) return;
    const items = reservations.map(r => `
          <HotelReservation CreateDateTime="${xmlEscape(r.createdAt || nowStamp())}" ResStatus="${xmlEscape(r.status)}">
            <ResGlobalInfo>
              <HotelReservationIDs>
                <HotelReservationID ResID_Type="14" ResID_Value="${xmlEscape(r.externalId)}" ResID_Source="Fluxo" />
              </HotelReservationIDs>
            </ResGlobalInfo>
          </HotelReservation>`).join('');
    const body = `<OTA_NotifReportRQ xmlns="${OTA_NS}" Version="3.0" TimeStamp="${nowStamp()}" EchoToken="${echoToken()}">
      <Success />
      <UniqueID Type="10" ID="${xmlEscape(cfg.hotel_code)}" />
      <NotifDetails>
        <HotelNotifReport>
          <HotelReservations>${items}
          </HotelReservations>
        </HotelNotifReport>
      </NotifDetails>
    </OTA_NotifReportRQ>`;
    await soapCall(cfg, 'ReservationConfirmation', body);
  },

  /**
   * RateDetailsNotif (OTA_HotelRateAmountNotifRQ) — envia PREÇOS por período
   * para um plano tarifário/tipo de quarto JÁ MAPEADO na Omnibees.
   * Regras da doc: período máx. 184 dias; para CRIAR um dia novo é preciso
   * informar todas as ocupações configuradas do quarto (para atualizar, não).
   */
  async sendPrices(cfg: OmnibeesConfig, params: {
    ratePlanCode: string;
    invTypeCode: string;
    start: string;              // yyyy-MM-dd
    end: string;                // yyyy-MM-dd
    currency?: string;
    /** preços por ocupação de ADULTOS: [{ guests: 1, amount: 350 }, { guests: 2, amount: 420 }] */
    adultPrices: { guests: number; amount: number }[];
    /** preço de criança (opcional — AgeQualifyingCode 8) */
    childAmount?: number | null;
    /** allotment opcional (NumberOfUnits) */
    numberOfUnits?: number | null;
  }): Promise<void> {
    const currency = params.currency || 'BRL';
    const baseAmts = [
      ...params.adultPrices
        .filter(p => p.amount > 0)
        .map(p => `<BaseByGuestAmt AgeQualifyingCode="10" NumberOfGuests="${p.guests}" AmountAfterTax="${p.amount.toFixed(2)}" />`),
      ...(params.childAmount && params.childAmount > 0
        ? [`<BaseByGuestAmt AgeQualifyingCode="8" NumberOfGuests="1" AmountAfterTax="${params.childAmount.toFixed(2)}" />`]
        : []),
    ].join('\n              ');
    if (!baseAmts) throw new Error('Informe pelo menos um preço.');

    const unitsAttr = params.numberOfUnits != null && params.numberOfUnits >= 0
      ? ` NumberOfUnits="${params.numberOfUnits}"` : '';

    const body = `<OTA_HotelRateAmountNotifRQ xmlns="${OTA_NS}" Version="3.0" TimeStamp="${nowStamp()}" EchoToken="${echoToken()}">
      <RateAmountMessages HotelCode="${xmlEscape(cfg.hotel_code)}">
        <RateAmountMessage LocatorID="1">
          <StatusApplicationControl Start="${params.start}" End="${params.end}" RatePlanCode="${xmlEscape(params.ratePlanCode)}" InvTypeCode="${xmlEscape(params.invTypeCode)}" />
          <Rates>
            <Rate CurrencyCode="${xmlEscape(currency)}"${unitsAttr}>
              <BaseByGuestAmts>
              ${baseAmts}
              </BaseByGuestAmts>
            </Rate>
          </Rates>
        </RateAmountMessage>
      </RateAmountMessages>
    </OTA_HotelRateAmountNotifRQ>`;
    await soapCall(cfg, 'RateDetailsNotif', body);
  },

  /**
   * Sincroniza: puxa reservas não entregues, grava em internal_bookings
   * (source='omnibees', dedupe por external_id) e confirma a entrega.
   * Retorna quantas reservas foram processadas.
   */
  async syncHotel(hotelId: string): Promise<number> {
    const cfg = await this.getConfig(hotelId);
    if (!cfg || !cfg.is_active) return 0;

    const reservations = await this.fetchUndeliveredReservations(cfg);
    if (reservations.length > 0) {
      // Status atual das já existentes — check-in/out feitos aqui não são revertidos
      const ids = reservations.map(r => r.externalId);
      const { data: existing } = await supabase
        .from('internal_bookings')
        .select('external_id, status')
        .eq('hotel_id', hotelId)
        .in('external_id', ids);
      const statusMap = new Map((existing || []).map((e: any) => [e.external_id, e.status]));

      const rows = reservations
        .filter(r => r.checkin && r.checkout)
        .map(r => {
          const current = statusMap.get(r.externalId);
          let status: string;
          if (r.status.toUpperCase().startsWith('CANCEL')) status = 'cancelled';
          else if (current === 'checkedin' || current === 'checkedout') status = current;
          else status = 'confirmed';
          return {
            hotel_id: hotelId,
            source: 'omnibees',
            external_id: r.externalId,
            code: `OB-${r.externalId}`,
            channel: r.channel,
            guest_name: r.guestName || `Reserva Omnibees ${r.externalId}`,
            guest_email: r.guestEmail,
            guest_phone: r.guestPhone,
            checkin: r.checkin,
            checkout: r.checkout,
            adults: r.adults,
            children: r.children,
            total_rate: r.total,
            status,
            notes: [r.roomType && `Tipo: ${r.roomType}`, r.ratePlan && `Tarifa: ${r.ratePlan}`, r.comments]
              .filter(Boolean).join(' · ') || null,
            updated_at: new Date().toISOString(),
          };
        });

      if (rows.length > 0) {
        const { error } = await supabase
          .from('internal_bookings')
          .upsert(rows, { onConflict: 'hotel_id,external_id' });
        if (error) throw error;
      }

      // Confirma a entrega — sem isso a Omnibees reenvia indefinidamente
      await this.confirmReservations(cfg, reservations);
    }

    await supabase.from('omnibees_hotel_config')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', cfg.id);

    return reservations.length;
  },
};

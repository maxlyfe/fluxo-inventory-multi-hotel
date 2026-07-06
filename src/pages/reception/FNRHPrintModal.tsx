// src/pages/reception/FNRHPrintModal.tsx
// Modal para selecionar hóspedes e emitir FNRH (Ficha Nacional de Registro de Hóspedes)
import React, { useState, useEffect } from 'react';
import { X, Printer, Loader2, Check, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Types ────────────────────────────────────────────────────────────────────

interface FNRHGuest {
  id: string;
  is_main_guest: boolean;
  name: string;
  email: string | null;
  phone: string | null;
  document_type: string | null;
  document_number: string | null;
  birth_date: string | null;
  gender_id: number | null;
  nationality: string | null;
  profession: string | null;
  address_street: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zipcode: string | null;
  address_country: string | null;
  fnrh_motivo_viagem_id: string | null;
  fnrh_meio_transporte_id: string | null;
}

interface HotelInfo {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  endereco: string;
  estado: string;
  municipio: string;
  cep: string;
  telefone: string;
  email: string;
  cadastur: string;
  tipo: string;
  categoria: string;
}

interface FNRHPrintModalProps {
  open: boolean;
  onClose: () => void;
  hotelId: string;
  bookingNumber: string;
  roomNumber: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  guestCount: number;
  guests: FNRHGuest[];
  guestSignatures: Record<string, string | null>;
}

// ── Label maps ───────────────────────────────────────────────────────────────

const GENDER: Record<number, string> = { 1: 'Masculino', 2: 'Feminino', 3: 'Outro' };

const MOTIVO_LABEL: Record<string, string> = {
  LAZER_FERIAS: 'Lazer/Férias', NEGOCIOS: 'Negócios', COMPRAS: 'Compras',
  CONGRESSO_FEIRA: 'Congresso/Feira', ESTUDOS_CURSOS: 'Estudos/Cursos',
  PARENTES_AMIGOS: 'Parentes/Amigos', RELIGIAO: 'Religião', SAUDE: 'Saúde',
};

const TRANSPORTE_LABEL: Record<string, string> = {
  AUTOMOVEL: 'Carro', AVIAO: 'Avião', ONIBUS: 'Ônibus',
  MOTO: 'Moto', NAVIO_BARCO: 'Navio/Barco', TREM: 'Trem',
  BICICLETA: 'Bicicleta', PE: 'A pé',
};

const MOTIVO_PDF_MAP: Record<string, string> = {
  LAZER_FERIAS: 'lazer', NEGOCIOS: 'negocios', CONGRESSO_FEIRA: 'congresso',
  PARENTES_AMIGOS: 'parentes', ESTUDOS_CURSOS: 'estudos', RELIGIAO: 'religiao', SAUDE: 'saude',
};

const TRANSPORTE_PDF_MAP: Record<string, string> = {
  AVIAO: 'aviao', AUTOMOVEL: 'carro', ONIBUS: 'onibus',
  MOTO: 'moto', NAVIO_BARCO: 'navio', TREM: 'trem',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  try { return format(new Date(d), 'dd/MM/yyyy', { locale: ptBR }); } catch { return d; }
}

function fmtCnpj(v: string): string {
  const n = v.replace(/\D/g, '');
  if (n.length !== 14) return v;
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

function fmtCpf(v: string): string {
  const n = v.replace(/\D/g, '');
  if (n.length !== 11) return v;
  return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
}

// ── Generate print HTML ──────────────────────────────────────────────────────

function generateFNRHHtml(hotel: HotelInfo, guest: FNRHGuest, booking: {
  bookingNumber: string;
  roomNumber: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  guestCount: number;
  signatureData: string | null;
}): string {
  const motivoId = guest.fnrh_motivo_viagem_id || '';
  const transporteId = guest.fnrh_meio_transporte_id || '';

  const motivoChecks = ['lazer', 'negocios', 'congresso', 'parentes', 'estudos', 'religiao', 'saude'].map(k => {
    const checked = MOTIVO_PDF_MAP[motivoId] === k;
    return `<td style="border:1px solid #000;padding:4px;text-align:center;font-size:10px;">${checked ? '☑' : '☐'}</td>`;
  }).join('');

  const transporteChecks = ['aviao', 'carro', 'onibus', 'moto', 'navio', 'trem', 'outro'].map(k => {
    const checked = TRANSPORTE_PDF_MAP[transporteId] === k;
    return `<td style="border:1px solid #000;padding:4px;text-align:center;font-size:10px;">${checked ? '☑' : '☐'}</td>`;
  }).join('');

  const docType = guest.document_type || '';
  const docNumber = guest.document_number || '';
  const cpfValue = docType.toUpperCase() === 'CPF' ? (docNumber ? fmtCpf(docNumber) : '') : '';
  const docDisplay = docNumber;
  const docTypeDisplay = docType;

  const signatureHtml = booking.signatureData
    ? `<img src="${booking.signatureData}" style="max-height:60px;max-width:280px;" />`
    : '<div style="border-bottom:1px solid #000;width:300px;height:40px;"></div>';

  const now = new Date();
  const timestamp = format(now, "dd/MM/yyyy HH:mm:ss", { locale: ptBR });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>FNRH - ${guest.name || 'Hóspede'}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 3px 5px; vertical-align: top; }
  .header-table td { border: none; }
  .field-label { font-size: 8px; color: #555; text-transform: uppercase; letter-spacing: 0.3px; }
  .field-value { font-size: 11px; font-weight: bold; min-height: 14px; }
  .section-border { border: 1px solid #000; }
  .check-table td { font-size: 9px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div style="max-width:780px;margin:0 auto;">

<!-- TÍTULO -->
<table style="margin-bottom:8px;">
  <tr>
    <td style="font-size:13px;font-weight:bold;letter-spacing:1px;">FICHA NACIONAL DE REGISTRO DE HÓSPEDES - FNRH</td>
    <td style="text-align:right;font-size:11px;font-weight:bold;">UH: ${booking.roomNumber || '________'}</td>
  </tr>
</table>

<!-- CABEÇALHO DO HOTEL -->
<table style="border:1px solid #000;margin-bottom:8px;">
  <tr>
    <td style="width:60%;padding:8px;" class="header-table">
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">RAZÃO SOCIAL:</span> <span style="font-size:11px;">${hotel.razao_social}</span></div>
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">NOME FANTASIA:</span> <span style="font-size:11px;">${hotel.nome_fantasia}</span></div>
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">ENDEREÇO:</span> <span style="font-size:11px;">${hotel.endereco}</span></div>
      <div><span style="font-weight:bold;font-size:10px;">ESTADO:</span> <span style="font-size:11px;">${hotel.estado}</span>
        <span style="margin-left:20px;font-weight:bold;font-size:10px;">MUNICÍPIO:</span> <span style="font-size:11px;">${hotel.municipio}</span></div>
    </td>
    <td style="width:40%;padding:8px;" class="header-table">
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">CNPJ:</span> <span style="font-size:11px;">${hotel.cnpj ? fmtCnpj(hotel.cnpj) : ''}</span>
        <span style="margin-left:20px;font-weight:bold;font-size:10px;">CAT:</span> <span style="font-size:11px;">${hotel.categoria}</span></div>
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">CADASTUR:</span> <span style="font-size:11px;">${hotel.cadastur}</span>
        <span style="margin-left:20px;font-weight:bold;font-size:10px;">TIPO:</span> <span style="font-size:11px;">${hotel.tipo}</span></div>
      <div style="margin-bottom:4px;"><span style="font-weight:bold;font-size:10px;">CEP:</span> <span style="font-size:11px;">${hotel.cep}</span>
        <span style="margin-left:20px;font-weight:bold;font-size:10px;">TEL:</span> <span style="font-size:11px;">${hotel.telefone}</span></div>
      <div><span style="font-weight:bold;font-size:10px;">EMAIL:</span> <span style="font-size:11px;">${hotel.email}</span></div>
    </td>
  </tr>
</table>

<!-- DADOS DO HÓSPEDE -->
<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td colspan="2" style="border:1px solid #000;width:40%;">
      <div class="field-label">NOME COMPLETO - FULL NAME</div>
      <div class="field-value">${guest.name || ''}</div>
    </td>
    <td style="border:1px solid #000;width:20%;">
      <div class="field-label">EMAIL</div>
      <div class="field-value" style="font-size:9px;word-break:break-all;">${guest.email || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">TELEFONE - PHONE</div>
      <div class="field-value">${guest.phone || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">PROFISSÃO - OCCUPATION</div>
      <div class="field-value">${guest.profession || ''}</div>
    </td>
  </tr>
</table>

<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td style="border:1px solid #000;width:20%;">
      <div class="field-label">NACIONALIDADE - CITIZENSHIP</div>
      <div class="field-value">${guest.nationality || ''}</div>
    </td>
    <td colspan="3" style="border:1px solid #000;width:50%;">
      <div class="field-label">DOCUMENTO DE IDENTIDADE - TRAVEL DOCUMENT</div>
      <table style="width:100%;margin-top:2px;">
        <tr>
          <td style="width:40%;font-size:9px;"><span class="field-label">Número / Number</span><br/><span class="field-value">${docDisplay}</span></td>
          <td style="width:25%;font-size:9px;"><span class="field-label">Tipo / Type</span><br/><span class="field-value">${docTypeDisplay}</span></td>
          <td style="width:35%;font-size:9px;"><span class="field-label">Órgão Expedidor / Issuing</span><br/><span class="field-value"></span></td>
        </tr>
      </table>
    </td>
    <td style="border:1px solid #000;width:30%; vertical-align:top;">
      <div style="display:flex;gap:0;">
        <div style="flex:1;padding-right:4px;">
          <div class="field-label">DATA NASC - BIRTH DATE</div>
          <div class="field-value">${fmtDate(guest.birth_date)}</div>
        </div>
        <div style="flex:1;padding-right:4px;">
          <div class="field-label">GÊNERO - GENDER</div>
          <div class="field-value">${guest.gender_id ? (GENDER[guest.gender_id] || '') : ''}</div>
        </div>
      </div>
    </td>
  </tr>
</table>

<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">CPF</div>
      <div class="field-value">${cpfValue}</div>
    </td>
    <td style="border:1px solid #000;width:30%;">
      <div class="field-label">RESIDÊNCIA PERMANENTE - PERMANENT ADDRESS</div>
      <div class="field-value" style="font-size:9px;">${guest.address_street || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">CIDADE - CITY</div>
      <div class="field-value">${guest.address_city || ''}</div>
    </td>
  </tr>
</table>

<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">CEP - ZIP CODE</div>
      <div class="field-value">${guest.address_zipcode || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">ESTADO - STATE</div>
      <div class="field-value">${guest.address_state || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">PAÍS - COUNTRY</div>
      <div class="field-value">${guest.address_country || ''}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">Reserva N.</div>
      <div class="field-value">${booking.bookingNumber}</div>
    </td>
    <td style="border:1px solid #000;width:10%;">
      <div class="field-label">N. HÓSPEDES</div>
      <div class="field-value">${booking.guestCount}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">CHECK-IN</div>
      <div class="field-value">${fmtDate(booking.checkinDate)}</div>
    </td>
    <td style="border:1px solid #000;width:15%;">
      <div class="field-label">CHECK-OUT</div>
      <div class="field-value">${fmtDate(booking.checkoutDate)}</div>
    </td>
  </tr>
</table>

<!-- PROCEDÊNCIA / DESTINO -->
<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td style="border:1px solid #000;width:35%;">
      <div class="field-label">ÚLTIMA PROCEDÊNCIA - ARRIVING FROM</div>
      <table style="width:100%;margin-top:2px;">
        <tr>
          <td style="font-size:9px;width:33%;"><span class="field-label">País / Country</span><br/><span class="field-value"></span></td>
          <td style="font-size:9px;width:33%;"><span class="field-label">Estado / State</span><br/><span class="field-value"></span></td>
          <td style="font-size:9px;width:34%;"><span class="field-label">Cidade / City</span><br/><span class="field-value"></span></td>
        </tr>
      </table>
    </td>
    <td style="border:1px solid #000;width:35%;">
      <div class="field-label">PRÓXIMO DESTINO - NEXT DESTINATION</div>
      <table style="width:100%;margin-top:2px;">
        <tr>
          <td style="font-size:9px;width:33%;"><span class="field-label">País / Country</span><br/><span class="field-value"></span></td>
          <td style="font-size:9px;width:33%;"><span class="field-label">Estado / State</span><br/><span class="field-value"></span></td>
          <td style="font-size:9px;width:34%;"><span class="field-label">Cidade / City</span><br/><span class="field-value"></span></td>
        </tr>
      </table>
    </td>
    <td style="border:1px solid #000;width:30%;">
      <div class="field-label">TOTAL ADIANTAMENTOS</div>
      <div class="field-value"></div>
    </td>
  </tr>
</table>

<!-- MOTIVO DA VIAGEM -->
<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td colspan="7" style="border-bottom:1px solid #000;padding:3px 5px;">
      <div class="field-label" style="font-weight:bold;">MOTIVO DA VIAGEM - PURPOSE OF TRIP</div>
    </td>
  </tr>
  <tr class="check-table">
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'lazer' ? '☑' : '☐'} Lazer - Férias<br/>Leisure</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'negocios' ? '☑' : '☐'} Negócios<br/>Business</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'congresso' ? '☑' : '☐'} Congresso - Feira<br/>Convention - Fair</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'parentes' ? '☑' : '☐'} Parentes - Amigos<br/>Relatives - Friends</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'estudos' ? '☑' : '☐'} Estudos - Cursos<br/>Studies - Courses</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'religiao' ? '☑' : '☐'} Religião<br/>Religion</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${MOTIVO_PDF_MAP[motivoId] === 'saude' ? '☑' : '☐'} Saúde<br/>Health</td>
  </tr>
</table>

<!-- MEIO DE TRANSPORTE -->
<table style="border:1px solid #000;margin-bottom:1px;">
  <tr>
    <td colspan="7" style="border-bottom:1px solid #000;padding:3px 5px;">
      <div class="field-label" style="font-weight:bold;">MEIO DE TRANSPORTE - ARRIVING BY</div>
    </td>
  </tr>
  <tr class="check-table">
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'aviao' ? '☑' : '☐'} Avião<br/>Plane</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'carro' ? '☑' : '☐'} Carro<br/>Car</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'onibus' ? '☑' : '☐'} Ônibus<br/>Bus</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'moto' ? '☑' : '☐'} Moto<br/>Motorcycle</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'navio' ? '☑' : '☐'} Navio - Barco<br/>Ship - Ferry Boat</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${TRANSPORTE_PDF_MAP[transporteId] === 'trem' ? '☑' : '☐'} Trem<br/>Train</td>
    <td style="border:1px solid #000;padding:4px;text-align:center;font-size:9px;">${!TRANSPORTE_PDF_MAP[transporteId] && transporteId ? '☑' : '☐'} Outro<br/>Other</td>
  </tr>
</table>

<!-- CONTATO EMERGÊNCIA / OBSERVAÇÕES -->
<table style="border:1px solid #000;margin-bottom:8px;">
  <tr>
    <td style="border:1px solid #000;width:50%;height:50px;vertical-align:top;">
      <div class="field-label">Contato de Emergência - Emergency Contact</div>
      <div class="field-value"></div>
    </td>
    <td style="border:1px solid #000;width:50%;height:50px;vertical-align:top;">
      <div class="field-label">OBSERVAÇÕES - NOTES</div>
      <div class="field-value"></div>
    </td>
  </tr>
</table>

<!-- ASSINATURA -->
<div style="margin-top:12px;margin-bottom:8px;">
  <div style="margin-bottom:4px;">
    ${signatureHtml}
  </div>
  <div style="border-top:1px solid #000;width:320px;padding-top:2px;">
    <span style="font-size:9px;font-weight:bold;">ASSINATURA DO HÓSPEDE - GUEST'S SIGNATURE</span>
  </div>
</div>

<!-- RODAPÉ -->
<div style="margin-top:16px;font-size:8px;color:#666;display:flex;justify-content:space-between;border-top:1px solid #ccc;padding-top:4px;">
  <span>Processado por computador em ${timestamp}</span>
  <span style="float:right;">1 / 1</span>
</div>

</div>
</body>
</html>`;
}

// ── Print function ───────────────────────────────────────────────────────────

function printFNRH(htmlPages: string[]) {
  const combined = htmlPages.join('<div style="page-break-before:always;"></div>');
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(combined);
  win.document.close();
  setTimeout(() => {
    win.print();
  }, 600);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FNRHPrintModal({
  open, onClose, hotelId, bookingNumber, roomNumber,
  checkinDate, checkoutDate, guestCount, guests, guestSignatures,
}: FNRHPrintModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hotelInfo, setHotelInfo] = useState<HotelInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(guests.map(g => g.id)));
    loadHotelInfo();
  }, [open, hotelId]);

  async function loadHotelInfo() {
    setLoading(true);
    try {
      const [hotelRes, nfRes] = await Promise.all([
        supabase.from('hotels').select('name, fantasy_name, corporate_name, cnpj, address').eq('id', hotelId).single(),
        supabase.from('nf_hotel_config').select('razao_social, nome_fantasia, cnpj, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, telefone, email').eq('hotel_id', hotelId).maybeSingle(),
      ]);

      const h = hotelRes.data;
      const nf = nfRes.data;

      const endereco = nf
        ? [nf.endereco_logradouro, nf.endereco_numero, nf.endereco_bairro].filter(Boolean).join(', ')
        : (h?.address || '');

      setHotelInfo({
        razao_social: nf?.razao_social || h?.corporate_name || h?.name || '',
        nome_fantasia: nf?.nome_fantasia || h?.fantasy_name || h?.name || '',
        cnpj: nf?.cnpj || h?.cnpj || '',
        endereco,
        estado: nf?.endereco_uf || '',
        municipio: nf?.endereco_cidade || '',
        cep: nf?.endereco_cep || '',
        telefone: nf?.telefone || '',
        email: nf?.email || '',
        cadastur: '',
        tipo: '',
        categoria: '',
      });
    } catch {
      setHotelInfo({
        razao_social: '', nome_fantasia: '', cnpj: '', endereco: '',
        estado: '', municipio: '', cep: '', telefone: '', email: '',
        cadastur: '', tipo: '', categoria: '',
      });
    } finally {
      setLoading(false);
    }
  }

  function toggleGuest(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === guests.length) setSelected(new Set());
    else setSelected(new Set(guests.map(g => g.id)));
  }

  function handlePrint() {
    if (!hotelInfo || selected.size === 0) return;

    const selectedGuests = guests.filter(g => selected.has(g.id));
    const pages = selectedGuests.map(guest =>
      generateFNRHHtml(hotelInfo, guest, {
        bookingNumber,
        roomNumber,
        checkinDate,
        checkoutDate,
        guestCount,
        signatureData: guestSignatures[guest.id] || null,
      })
    );
    printFNRH(pages);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-900/20">
              <Printer className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">Emitir FNRH</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Reserva #{bookingNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Selecione os hóspedes para emitir a FNRH:
                </p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-teal-600 dark:text-teal-400 hover:underline font-medium"
                >
                  {selected.size === guests.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              {guests.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum hóspede cadastrado nesta reserva.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {guests.map(guest => (
                    <label
                      key={guest.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selected.has(guest.id)
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 dark:border-teal-600'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        selected.has(guest.id)
                          ? 'border-teal-500 bg-teal-500'
                          : 'border-slate-300 dark:border-slate-500'
                      }`}>
                        {selected.has(guest.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={selected.has(guest.id)}
                        onChange={() => toggleGuest(guest.id)}
                        className="sr-only"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">
                            {guest.name || 'Sem nome'}
                          </span>
                          {guest.is_main_guest && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              Principal
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {[
                            guest.document_type && guest.document_number ? `${guest.document_type}: ${guest.document_number}` : null,
                            guest.nationality,
                          ].filter(Boolean).join(' · ') || 'Dados incompletos'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {selected.size} de {guests.length} selecionado{selected.size !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handlePrint}
              disabled={selected.size === 0 || loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Printer className="w-4 h-4" />
              Imprimir {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// src/pages/erbon/InternalBookingModal.tsx
// Reservas INTERNAS (hotéis sem Erbon), criadas/geridas pelo Planning:
//  - Criar/editar: UH, datas in/out, hóspede, pax, tarifa, observações
//  - Ações: check-in, check-out, cancelar
//  - Pagamentos: lançar e listar (saldo vs tarifa)
//  - Hóspedes: incluir via web-checkin (QR/link com o código da reserva)

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Loader2, Users, CalendarRange, Wallet, QrCode, Link2, CheckCircle2,
  LogIn, LogOut, Ban, Plus, Trash2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { createManualSession } from '../webcheckin/webCheckinService';
import { ensureHotelWciCode } from '../../lib/wciCode';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface InternalBooking {
  id: string;
  hotel_id: string;
  room_id: string | null;
  code: string;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  checkin: string;   // yyyy-MM-dd
  checkout: string;  // yyyy-MM-dd
  adults: number;
  children: number;
  status: string;    // confirmed | checkedin | checkedout | cancelled
  total_rate: number | null;
  notes: string | null;
}

interface Payment {
  id: string;
  amount: number;
  method: string | null;
  notes: string | null;
  paid_at: string;
}

interface RoomOption { id: string; name: string; category: string; }

interface InternalBookingModalProps {
  hotelId: string;
  rooms: RoomOption[];
  /** null = criar nova reserva */
  booking: InternalBooking | null;
  /** pré-seleção ao criar (clique em célula vazia futuro) */
  defaultRoomId?: string | null;
  defaultCheckin?: string | null;
  onSaved: () => void;
  onClose: () => void;
}

type Tab = 'dados' | 'pagamentos' | 'hospedes';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_credito', label: 'Cartão de Crédito' },
  { value: 'cartao_debito', label: 'Cartão de Débito' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'outro', label: 'Outro' },
];

export const INTERNAL_STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmada',
  checkedin: 'In-house',
  checkedout: 'Encerrada',
  cancelled: 'Cancelada',
};

const InternalBookingModal: React.FC<InternalBookingModalProps> = ({
  hotelId, rooms, booking, defaultRoomId, defaultCheckin, onSaved, onClose,
}) => {
  const { addNotification } = useNotification();
  const { user } = useAuth();
  const isNew = !booking;

  const [tab, setTab] = useState<Tab>('dados');
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  // ── Campos ──
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [guestName, setGuestName]   = useState(booking?.guest_name || '');
  const [guestPhone, setGuestPhone] = useState(booking?.guest_phone || '');
  const [guestEmail, setGuestEmail] = useState(booking?.guest_email || '');
  const [roomId, setRoomId]         = useState(booking?.room_id || defaultRoomId || '');
  const [checkin, setCheckin]       = useState(booking?.checkin || defaultCheckin || todayStr);
  const [checkout, setCheckout]     = useState(booking?.checkout || format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'));
  const [adults, setAdults]         = useState(booking?.adults ?? 2);
  const [children, setChildren]     = useState(booking?.children ?? 0);
  const [totalRate, setTotalRate]   = useState(booking?.total_rate != null ? String(booking.total_rate) : '');
  const [notes, setNotes]           = useState(booking?.notes || '');

  const status = booking?.status || 'confirmed';
  const nights = useMemo(() => {
    try { return Math.max(differenceInCalendarDays(parseISO(checkout), parseISO(checkin)), 0); } catch { return 0; }
  }, [checkin, checkout]);

  // ── Pagamentos ──
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');
  const [payNotes, setPayNotes] = useState('');
  const [addingPay, setAddingPay] = useState(false);

  const loadPayments = useCallback(async () => {
    if (!booking) { setPayments([]); return; }
    const { data } = await supabase
      .from('internal_booking_payments')
      .select('*')
      .eq('booking_id', booking.id)
      .order('paid_at', { ascending: false });
    setPayments((data || []) as Payment[]);
  }, [booking?.id]);

  useEffect(() => { if (tab === 'pagamentos' && payments === null) loadPayments(); }, [tab]);

  const totalPaid = (payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const rateNum = parseFloat(totalRate) || 0;

  // ── Web-checkin ──
  const [wciUrl, setWciUrl] = useState<string | null>(null);
  const [generatingWci, setGeneratingWci] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [fichas, setFichas] = useState<{ guest_name: string; created_at: string }[] | null>(null);

  const loadFichas = useCallback(async () => {
    if (!booking) { setFichas([]); return; }
    const { data } = await supabase
      .from('wci_checkin_fichas')
      .select('guest_name, created_at')
      .eq('hotel_id', hotelId)
      .eq('booking_number', booking.code)
      .order('created_at', { ascending: false });
    setFichas((data || []) as any[]);
  }, [booking?.id, hotelId]);

  useEffect(() => { if (tab === 'hospedes' && fichas === null) loadFichas(); }, [tab]);

  const handleGenerateWci = async () => {
    if (!booking) return;
    setGeneratingWci(true);
    try {
      // Gera o wci_code automaticamente se o hotel ainda não tiver
      const wciCode = await ensureHotelWciCode(hotelId);
      if (!wciCode) {
        addNotification('Não foi possível gerar o código de web-checkin do hotel.', 'error');
        return;
      }
      const token = await createManualSession(hotelId, booking.guest_name, booking.code);
      const groupMatch = window.location.pathname.match(/^\/grupo\/([^/]+)/);
      const base = groupMatch ? `${window.location.origin}/grupo/${groupMatch[1]}` : window.location.origin;
      setWciUrl(`${base}/web-checkin/${wciCode}/companion/${token}`);
    } catch (e: any) {
      addNotification('Erro ao gerar link: ' + (e.message || ''), 'error');
    } finally {
      setGeneratingWci(false);
    }
  };

  const copyWciLink = async () => {
    if (!wciUrl) return;
    try {
      await navigator.clipboard.writeText(wciUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch { addNotification('Não foi possível copiar o link.', 'error'); }
  };

  // ── Salvar / ações ──
  const canSave = guestName.trim() && roomId && checkin && checkout && checkout > checkin;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload = {
        hotel_id: hotelId,
        room_id: roomId || null,
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim() || null,
        guest_email: guestEmail.trim() || null,
        checkin, checkout,
        adults, children,
        total_rate: totalRate ? parseFloat(totalRate) : null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (isNew) {
        const { error } = await supabase.from('internal_bookings')
          .insert({ ...payload, status: 'confirmed', created_by: user?.id || null });
        if (error) throw error;
        addNotification('Reserva criada!', 'success');
      } else {
        const { error } = await supabase.from('internal_bookings')
          .update(payload).eq('id', booking!.id);
        if (error) throw error;
        addNotification('Reserva atualizada!', 'success');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      addNotification('Erro ao salvar: ' + (e.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (newStatus: string, confirmMsg?: string) => {
    if (!booking) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    setActioning(newStatus);
    try {
      const { error } = await supabase.from('internal_bookings')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', booking.id);
      if (error) throw error;
      addNotification(`Reserva: ${INTERNAL_STATUS_LABEL[newStatus] || newStatus}.`, 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      addNotification('Erro: ' + (e.message || ''), 'error');
    } finally {
      setActioning(null);
    }
  };

  const handleAddPayment = async () => {
    if (!booking || addingPay) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    setAddingPay(true);
    try {
      const { error } = await supabase.from('internal_booking_payments').insert({
        booking_id: booking.id,
        hotel_id: hotelId,
        amount,
        method: payMethod,
        notes: payNotes.trim() || null,
        created_by: user?.id || null,
      });
      if (error) throw error;
      setPayAmount(''); setPayNotes('');
      await loadPayments();
      addNotification('Pagamento lançado!', 'success');
    } catch (e: any) {
      addNotification('Erro ao lançar pagamento: ' + (e.message || ''), 'error');
    } finally {
      setAddingPay(false);
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!confirm('Excluir este pagamento?')) return;
    await supabase.from('internal_booking_payments').delete().eq('id', id);
    await loadPayments();
  };

  // ── UI helpers ──
  const inputCls = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50';
  const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1';

  const headerBg = status === 'checkedin'
    ? 'linear-gradient(135deg, #34d399, #059669)'
    : status === 'checkedout'
      ? 'linear-gradient(135deg, #94a3b8, #64748b)'
      : status === 'cancelled'
        ? 'linear-gradient(135deg, #f87171, #dc2626)'
        : 'linear-gradient(135deg, #818cf8, #4f46e5)';

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode, disabled = false) => (
    <button onClick={() => !disabled && setTab(t)} disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors border-b-2 disabled:opacity-30 ${
        tab === t
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      }`}>
      {icon}{label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
        style={{ maxHeight: '92dvh' }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between shrink-0" style={{ background: headerBg }}>
          <div className="text-white min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
              {isNew ? 'Nova reserva' : `Reserva ${booking!.code} · ${INTERNAL_STATUS_LABEL[status] || status}`}
            </p>
            <h3 className="text-base font-bold truncate">{guestName || 'Reserva interna'}</h3>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-white/80 hover:text-white hover:bg-white/20 transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 shrink-0">
          {tabBtn('dados', 'Dados', <CalendarRange className="w-3.5 h-3.5" />)}
          {tabBtn('pagamentos', 'Pagamentos', <Wallet className="w-3.5 h-3.5" />, isNew)}
          {tabBtn('hospedes', 'Hóspedes', <Users className="w-3.5 h-3.5" />, isNew)}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── DADOS ── */}
          {tab === 'dados' && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Hóspede titular *</label>
                <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)}
                  placeholder="Nome completo" className={inputCls} autoFocus={isNew} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Telefone</label>
                  <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>E-mail</label>
                  <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>UH *</label>
                <select value={roomId} onChange={e => setRoomId(e.target.value)} className={inputCls}>
                  <option value="">Selecione a UH...</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name} · {r.category}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Check-in *</label>
                  <input type="date" value={checkin} onChange={e => setCheckin(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Check-out *</label>
                  <input type="date" value={checkout} min={checkin} onChange={e => setCheckout(e.target.value)} className={inputCls} />
                </div>
              </div>
              {nights > 0 && (
                <p className="text-[11px] text-gray-400 -mt-1">{nights} diária{nights > 1 ? 's' : ''}</p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Adultos</label>
                  <input type="number" min={1} value={adults} onChange={e => setAdults(Math.max(1, parseInt(e.target.value) || 1))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Crianças</label>
                  <input type="number" min={0} value={children} onChange={e => setChildren(Math.max(0, parseInt(e.target.value) || 0))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Tarifa total (R$)</label>
                  <input type="number" min={0} step="0.01" value={totalRate} onChange={e => setTotalRate(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Observações</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
              </div>

              {/* Ações de status */}
              {!isNew && status !== 'cancelled' && (
                <div className="flex gap-2 pt-1">
                  {status === 'confirmed' && (
                    <button onClick={() => setStatus('checkedin')} disabled={actioning !== null}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                      {actioning === 'checkedin' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />} Check-in
                    </button>
                  )}
                  {status === 'checkedin' && (
                    <button onClick={() => setStatus('checkedout')} disabled={actioning !== null}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                      {actioning === 'checkedout' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />} Check-out
                    </button>
                  )}
                  {status !== 'checkedout' && (
                    <button onClick={() => setStatus('cancelled', 'Cancelar esta reserva?')} disabled={actioning !== null}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-800 text-red-500 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60">
                      {actioning === 'cancelled' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} Cancelar
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PAGAMENTOS ── */}
          {tab === 'pagamentos' && !isNew && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60">
                  <p className="text-[9px] font-bold uppercase text-gray-400">Tarifa</p>
                  <p className="text-sm font-black text-gray-800 dark:text-white">{rateNum ? fmtBRL(rateNum) : '—'}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                  <p className="text-[9px] font-bold uppercase text-gray-400">Pago</p>
                  <p className="text-sm font-black text-emerald-600">{fmtBRL(totalPaid)}</p>
                </div>
                <div className={`p-2.5 rounded-xl ${rateNum - totalPaid > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800/60'}`}>
                  <p className="text-[9px] font-bold uppercase text-gray-400">Saldo</p>
                  <p className={`text-sm font-black ${rateNum - totalPaid > 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    {rateNum ? fmtBRL(Math.max(rateNum - totalPaid, 0)) : '—'}
                  </p>
                </div>
              </div>

              {/* Lançar pagamento */}
              <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Lançar pagamento</p>
                <div className="flex gap-2">
                  <input type="number" min={0} step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                    placeholder="Valor" className={`${inputCls} flex-1`} />
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className={`${inputCls} flex-1`}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <input type="text" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                  placeholder="Observação (opcional)" className={inputCls} />
                <button onClick={handleAddPayment} disabled={addingPay || !payAmount || parseFloat(payAmount) <= 0}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
                  {addingPay ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Adicionar
                </button>
              </div>

              {/* Lista */}
              {payments === null ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
              ) : payments.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Nenhum pagamento lançado.</p>
              ) : (
                <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
                  {payments.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmtBRL(p.amount)}</p>
                        <p className="text-[11px] text-gray-400">
                          {PAYMENT_METHODS.find(m => m.value === p.method)?.label || p.method || '—'}
                          {' · '}{format(parseISO(p.paid_at), 'dd/MM/yyyy HH:mm')}
                          {p.notes && ` · ${p.notes}`}
                        </p>
                      </div>
                      <button onClick={() => handleDeletePayment(p.id)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── HÓSPEDES (web-checkin) ── */}
          {tab === 'hospedes' && !isNew && (
            <div className="space-y-4">
              <button onClick={handleGenerateWci} disabled={generatingWci}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                {generatingWci ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                Incluir hóspede via Web-checkin
              </button>
              <p className="text-[11px] text-gray-400 -mt-2">
                O QR/link abre o formulário já vinculado ao código <strong>{booking?.code}</strong> desta reserva.
              </p>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Fichas preenchidas</p>
                {fichas === null ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
                ) : fichas.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma ficha preenchida ainda.</p>
                ) : (
                  <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
                    {fichas.map((f, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-gray-700 dark:text-gray-200 truncate mr-3">{f.guest_name}</span>
                        <span className="text-[11px] text-gray-400 whitespace-nowrap">
                          {format(parseISO(f.created_at), 'dd/MM HH:mm')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé — salvar */}
        {tab === 'dados' && status !== 'cancelled' && (
          <div className="flex gap-2 p-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Fechar
            </button>
            <button onClick={handleSave} disabled={!canSave || saving}
              className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {isNew ? 'Criar Reserva' : 'Salvar Alterações'}
            </button>
          </div>
        )}
      </div>

      {/* ── Sub-modal: QR web-checkin ── */}
      {wciUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={e => { e.stopPropagation(); setWciUrl(null); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full max-w-xs bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 text-center">
            <QrCode className="w-7 h-7 text-indigo-500 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Web-checkin · Reserva {booking?.code}</h4>
            <p className="text-xs text-gray-400 mb-4">
              Escaneie com o celular ou copie o link para o hóspede preencher a própria ficha.
            </p>
            <div className="bg-white p-3 rounded-2xl inline-block border border-gray-100">
              <QRCodeSVG value={wciUrl} size={180} level="M" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={copyWciLink}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                  linkCopied ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}>
                {linkCopied ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copiado!</> : <><Link2 className="w-3.5 h-3.5" /> Copiar link</>}
              </button>
              <button onClick={() => { setWciUrl(null); loadFichas(); }}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InternalBookingModal;

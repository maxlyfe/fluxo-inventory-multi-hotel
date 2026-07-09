// src/pages/diretoria/OmnibeesRates.tsx
// Diretoria → Tarifas Omnibees
// Envia preços (RateDetailsNotif / OTA_HotelRateAmountNotifRQ) para planos
// tarifários JÁ MAPEADOS na Omnibees. Estrutura pronta para operar assim que
// as credenciais Omnibees do hotel forem cadastradas em Configurações.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Tags, Plus, Trash2, Loader2, Send, Info, CheckCircle2, XCircle,
  Settings, History, AlertCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { omnibeesService, OmnibeesConfig } from '../../lib/omnibeesService';
import { useHotel } from '../../context/HotelContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

interface RatePlan {
  id: string;
  hotel_id: string;
  name: string;
  rate_plan_code: string;
  inv_type_code: string;
  currency: string;
}

interface SendLog {
  id: string;
  rate_plan_code: string;
  inv_type_code: string;
  start_date: string;
  end_date: string;
  prices: any;
  success: boolean;
  error: string | null;
  created_at: string;
}

const inputCls = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1';
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const OmnibeesRates: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [config, setConfig] = useState<OmnibeesConfig | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(true);

  // ── Planos cadastrados ──
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [newPlan, setNewPlan] = useState({ name: '', rate_plan_code: '', inv_type_code: '' });
  const [addingPlan, setAddingPlan] = useState(false);

  // ── Form de envio ──
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [planId, setPlanId] = useState('');
  const [start, setStart] = useState(todayStr);
  const [end, setEnd] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [price1, setPrice1] = useState('');
  const [price2, setPrice2] = useState('');
  const [price3, setPrice3] = useState('');
  const [priceChild, setPriceChild] = useState('');
  const [allotment, setAllotment] = useState('');
  const [sending, setSending] = useState(false);

  // ── Log ──
  const [logs, setLogs] = useState<SendLog[]>([]);

  const rangeDays = useMemo(() => {
    try { return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1; } catch { return 0; }
  }, [start, end]);

  const selectedPlan = plans.find(p => p.id === planId) || null;

  // ── Loads ──────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoadingCfg(true);
    const [cfg, plansR, logsR] = await Promise.all([
      omnibeesService.getConfig(selectedHotel.id).catch(() => null),
      supabase.from('omnibees_rate_plans').select('*').eq('hotel_id', selectedHotel.id).order('name'),
      supabase.from('omnibees_rate_send_log').select('*').eq('hotel_id', selectedHotel.id)
        .order('created_at', { ascending: false }).limit(20),
    ]);
    setConfig(cfg);
    setPlans((plansR.data || []) as RatePlan[]);
    setLogs((logsR.data || []) as SendLog[]);
    setLoadingCfg(false);
  }, [selectedHotel?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Planos: CRUD ───────────────────────────────────────────────────────────
  const handleAddPlan = async () => {
    if (!selectedHotel?.id || !newPlan.name.trim() || !newPlan.rate_plan_code.trim() || !newPlan.inv_type_code.trim()) return;
    setAddingPlan(true);
    try {
      const { error } = await supabase.from('omnibees_rate_plans').insert({
        hotel_id: selectedHotel.id,
        name: newPlan.name.trim(),
        rate_plan_code: newPlan.rate_plan_code.trim(),
        inv_type_code: newPlan.inv_type_code.trim(),
      });
      if (error) throw error;
      setNewPlan({ name: '', rate_plan_code: '', inv_type_code: '' });
      await loadAll();
      addNotification('Plano cadastrado!', 'success');
    } catch (e: any) {
      addNotification('Erro ao cadastrar: ' + (e.message || ''), 'error');
    } finally {
      setAddingPlan(false);
    }
  };

  const handleDeletePlan = async (id: string) => {
    if (!confirm('Remover este plano do cadastro local? (não altera nada na Omnibees)')) return;
    await supabase.from('omnibees_rate_plans').delete().eq('id', id);
    if (planId === id) setPlanId('');
    await loadAll();
  };

  // ── Envio ──────────────────────────────────────────────────────────────────
  const canSend = !!config?.is_active && !!selectedPlan && rangeDays >= 1 && rangeDays <= 184
    && (parseFloat(price1) > 0 || parseFloat(price2) > 0 || parseFloat(price3) > 0);

  const handleSend = async () => {
    if (!canSend || !selectedHotel?.id || !config || !selectedPlan || sending) return;
    setSending(true);
    const adultPrices = [
      { guests: 1, amount: parseFloat(price1) || 0 },
      { guests: 2, amount: parseFloat(price2) || 0 },
      { guests: 3, amount: parseFloat(price3) || 0 },
    ].filter(p => p.amount > 0);
    const childAmount = parseFloat(priceChild) || null;
    const numberOfUnits = allotment !== '' ? parseInt(allotment, 10) : null;

    let success = false, errMsg: string | null = null;
    try {
      await omnibeesService.sendPrices(config, {
        ratePlanCode: selectedPlan.rate_plan_code,
        invTypeCode: selectedPlan.inv_type_code,
        start, end,
        currency: selectedPlan.currency || 'BRL',
        adultPrices,
        childAmount,
        numberOfUnits,
      });
      success = true;
      addNotification('Tarifas enviadas para a Omnibees!', 'success');
    } catch (e: any) {
      errMsg = e.message || 'Erro desconhecido';
      addNotification('Erro no envio: ' + errMsg, 'error');
    }

    // Log do envio (sucesso ou falha)
    await supabase.from('omnibees_rate_send_log').insert({
      hotel_id: selectedHotel.id,
      rate_plan_code: selectedPlan.rate_plan_code,
      inv_type_code: selectedPlan.inv_type_code,
      start_date: start,
      end_date: end,
      prices: { adultPrices, childAmount, numberOfUnits },
      success,
      error: errMsg,
      created_by: user?.id || null,
    });
    await loadAll();
    setSending(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!selectedHotel) {
    return <div className="p-6 text-center text-gray-400">Selecione um hotel.</div>;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Tags className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Tarifas Omnibees</h1>
          <p className="text-xs text-gray-400">Envio de preços para os canais de venda · {selectedHotel.name}</p>
        </div>
      </div>

      {/* Status da integração */}
      {loadingCfg ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
      ) : !config?.is_active ? (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            A integração Omnibees deste hotel ainda não está ativa. Você já pode <strong>cadastrar os planos
            tarifários</strong> abaixo — o envio de preços é liberado assim que as credenciais forem configuradas em{' '}
            <Link to="/admin/omnibees" className="underline font-bold inline-flex items-center gap-1">
              Configurações → Omnibees <Settings className="w-3 h-3" />
            </Link>.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Os preços são enviados para planos/quartos <strong>já mapeados na Omnibees</strong> (RatePlanCode e
            código do quarto). Período máximo por envio: <strong>184 dias</strong>. Para criar dias novos é preciso
            informar todas as ocupações configuradas do quarto.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Planos tarifários mapeados ── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Tags className="w-4 h-4 text-indigo-500" /> Planos tarifários mapeados
          </h2>

          {plans.length === 0 ? (
            <p className="text-xs text-gray-400">
              Nenhum plano cadastrado. Informe abaixo os códigos exatamente como estão na Omnibees.
            </p>
          ) : (
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/60">
              {plans.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-400">
                      Plano: <span className="font-mono">{p.rate_plan_code}</span>
                      {' · '}Quarto: <span className="font-mono">{p.inv_type_code}</span>
                      {' · '}{p.currency}
                    </p>
                  </div>
                  <button onClick={() => handleDeletePlan(p.id)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Novo plano */}
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-600 p-3 space-y-2">
            <p className={labelCls}>Cadastrar plano</p>
            <input type="text" value={newPlan.name}
              onChange={e => setNewPlan(f => ({ ...f, name: e.target.value }))}
              placeholder="Nome amigável (ex.: BAR — Standard)" className={inputCls} />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={newPlan.rate_plan_code}
                onChange={e => setNewPlan(f => ({ ...f, rate_plan_code: e.target.value }))}
                placeholder="RatePlanCode" className={inputCls} />
              <input type="text" value={newPlan.inv_type_code}
                onChange={e => setNewPlan(f => ({ ...f, inv_type_code: e.target.value }))}
                placeholder="Código do quarto" className={inputCls} />
            </div>
            <button onClick={handleAddPlan}
              disabled={addingPlan || !newPlan.name.trim() || !newPlan.rate_plan_code.trim() || !newPlan.inv_type_code.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
              {addingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Adicionar
            </button>
          </div>
        </div>

        {/* ── Enviar tarifas ── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" /> Enviar tarifas
          </h2>

          <div>
            <label className={labelCls}>Plano tarifário *</label>
            <select value={planId} onChange={e => setPlanId(e.target.value)} className={inputCls}>
              <option value="">Selecione...</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>De *</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Até (inclusive) *</label>
              <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className={inputCls} />
            </div>
          </div>
          {rangeDays > 0 && (
            <p className={`text-[11px] ${rangeDays > 184 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
              {rangeDays} dia{rangeDays > 1 ? 's' : ''}{rangeDays > 184 && ' — máximo 184 dias por envio'}
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>1 adulto (R$)</label>
              <input type="number" min={0} step="0.01" value={price1} onChange={e => setPrice1(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>2 adultos (R$)</label>
              <input type="number" min={0} step="0.01" value={price2} onChange={e => setPrice2(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>3 adultos (R$)</label>
              <input type="number" min={0} step="0.01" value={price3} onChange={e => setPrice3(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Criança (R$, opcional)</label>
              <input type="number" min={0} step="0.01" value={priceChild} onChange={e => setPriceChild(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Allotment (opcional)</label>
              <input type="number" min={0} value={allotment} onChange={e => setAllotment(e.target.value)}
                placeholder="UHs à venda" className={inputCls} />
            </div>
          </div>

          <button onClick={handleSend} disabled={!canSend || sending}
            title={!config?.is_active ? 'Configure a Omnibees primeiro' : undefined}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar para a Omnibees
          </button>
        </div>
      </div>

      {/* ── Histórico de envios ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-500" /> Últimos envios
        </h2>
        {logs.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhum envio registrado ainda.</p>
        ) : (
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/60">
            {logs.map(l => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {l.success
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 dark:text-gray-100 truncate">
                    <span className="font-mono text-xs">{l.rate_plan_code}/{l.inv_type_code}</span>
                    {' · '}{format(parseISO(l.start_date), 'dd/MM')} → {format(parseISO(l.end_date), 'dd/MM/yyyy')}
                    {(l.prices?.adultPrices || []).map((p: any) =>
                      ` · ${p.guests}p ${fmtBRL(p.amount)}`).join('')}
                  </p>
                  {l.error && <p className="text-[11px] text-red-400 truncate">{l.error}</p>}
                </div>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  {format(parseISO(l.created_at), 'dd/MM HH:mm')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OmnibeesRates;

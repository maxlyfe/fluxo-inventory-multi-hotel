// src/components/RequestLinkModal.tsx
// Gera links públicos temporários de requisição por setor.
// O colaborador abre o link SEM login, informa o nome e faz pedidos.

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  X, Link2, Loader2, Check, Copy, CalendarClock, CheckCircle2,
} from 'lucide-react';

interface Sector { id: string; name: string; }
interface GeneratedLink { sectorId: string; sectorName: string; url: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function randomToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

/** Data padrão de expiração: hoje + 7 dias (formato yyyy-mm-dd) */
function defaultExpiry(): string {
  const d = new Date(Date.now() + 7 * 86400000);
  return d.toISOString().slice(0, 10);
}

export default function RequestLinkModal({ isOpen, onClose }: Props) {
  const { selectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [sectors, setSectors]       = useState<Sector[]>([]);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [expiry, setExpiry]         = useState(defaultExpiry());
  const [loading, setLoading]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [links, setLinks]           = useState<GeneratedLink[]>([]);
  const [copiedId, setCopiedId]     = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !selectedHotel?.id) return;
    setLinks([]); setSelected(new Set()); setExpiry(defaultExpiry());
    setLoading(true);
    supabase.from('sectors').select('id, name').eq('hotel_id', selectedHotel.id).order('name')
      .then(({ data, error }) => {
        if (error) addNotification('Erro ao carregar setores: ' + error.message, 'error');
        setSectors(data || []);
        setLoading(false);
      });
  }, [isOpen, selectedHotel?.id]);

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const expiryValid = useMemo(() => {
    if (!expiry) return false;
    return new Date(expiry + 'T23:59:59') > new Date();
  }, [expiry]);

  const handleGenerate = async () => {
    if (!selectedHotel?.id || selected.size === 0 || !expiryValid) return;
    setGenerating(true);
    try {
      const expiresAt = new Date(expiry + 'T23:59:59').toISOString();
      const rows = [...selected].map(sectorId => ({
        token: randomToken(),
        hotel_id: selectedHotel.id,
        sector_id: sectorId,
        expires_at: expiresAt,
        created_by: user?.id || null,
      }));
      const { data, error } = await supabase
        .from('sector_request_tokens')
        .insert(rows)
        .select('token, sector_id');
      if (error) throw error;

      const result: GeneratedLink[] = (data || []).map((r: any) => ({
        sectorId: r.sector_id,
        sectorName: sectors.find(s => s.id === r.sector_id)?.name || 'Setor',
        url: `${window.location.origin}/request/${r.token}`,
      }));
      result.sort((a, b) => a.sectorName.localeCompare(b.sectorName));
      setLinks(result);
      addNotification(`${result.length} link(s) gerado(s)!`, 'success');
    } catch (e: any) {
      addNotification('Erro ao gerar links: ' + e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const copyOne = async (l: GeneratedLink) => {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopiedId(l.sectorId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { addNotification('Não foi possível copiar.', 'error'); }
  };

  const copyAll = async () => {
    const text = links.map(l => `${l.sectorName}:\n${l.url}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId('__all__');
      setTimeout(() => setCopiedId(null), 2000);
    } catch { addNotification('Não foi possível copiar.', 'error'); }
  };

  if (!isOpen) return null;

  const fmtExpiry = expiry ? expiry.split('-').reverse().join('/') : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center">
              <Link2 className="w-4.5 h-4.5 text-teal-600 dark:text-teal-400" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Links de Requisição</h2>
              <p className="text-xs text-slate-400">Colaboradores pedem material sem login</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {links.length === 0 ? (
            <>
              {/* Validade */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5" /> Válido até
                </label>
                <input
                  type="date" value={expiry} min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setExpiry(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                />
                {!expiryValid && <p className="text-xs text-red-500 mt-1">Escolha uma data futura.</p>}
              </div>

              {/* Setores */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Setores ({selected.size}/{sectors.length})
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setSelected(new Set(sectors.map(s => s.id)))} className="text-xs text-teal-600 dark:text-teal-400 hover:underline font-semibold">Selecionar tudo</button>
                    <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:underline font-semibold">Limpar</button>
                  </div>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-teal-500" /></div>
                ) : sectors.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">Nenhum setor cadastrado neste hotel.</p>
                ) : (
                  <div className="space-y-1 max-h-[40vh] overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800 p-1.5">
                    {sectors.map(s => {
                      const on = selected.has(s.id);
                      return (
                        <button key={s.id} onClick={() => toggle(s.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${on ? 'bg-teal-50 dark:bg-teal-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                          <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-teal-600 border-teal-600' : 'border-slate-300 dark:border-slate-600'}`}>
                            {on && <Check className="w-3.5 h-3.5 text-white" />}
                          </span>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Links gerados */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800/50">
                <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                <p className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed">
                  Envie cada link ao grupo do setor. Válidos até <strong>{fmtExpiry}</strong>.
                  Quem abrir informa o nome e faz o pedido — sem precisar de login.
                </p>
              </div>
              <div className="space-y-2">
                {links.map(l => (
                  <div key={l.sectorId} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{l.sectorName}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{l.url}</p>
                    </div>
                    <button onClick={() => copyOne(l)}
                      className={`flex items-center gap-1 px-2.5 h-9 rounded-lg text-xs font-semibold shrink-0 transition-colors ${copiedId === l.sectorId ? 'bg-emerald-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}>
                      {copiedId === l.sectorId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === l.sectorId ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {links.length === 0 ? (
            <>
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
              </button>
              <button onClick={handleGenerate} disabled={generating || selected.size === 0 || !expiryValid}
                className="flex-[2] py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Gerar {selected.size > 0 ? `${selected.size} link(s)` : 'links'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setLinks([])} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Gerar outros
              </button>
              <button onClick={copyAll}
                className={`flex-[2] py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 ${copiedId === '__all__' ? 'bg-emerald-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}>
                {copiedId === '__all__' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedId === '__all__' ? 'Copiados!' : 'Copiar todos'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

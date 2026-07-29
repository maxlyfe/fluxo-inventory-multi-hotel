// src/components/AppGroupGate.tsx
// Tela do APK do sistema (com.lyfe.fluxo) para configurar/trocar o grupo.
// Valida o slug (get_group_by_slug), salva no dispositivo e recarrega na rota
// /grupo/<slug>/login (o basename só é calculado no load → precisa de reload).

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { setAppGroupSlug } from '../lib/appGroup';
import LoginBackdrop from './LoginBackdrop';
import { isRateLimit, SLUG_RATE_LIMIT_MESSAGE, SLUG_RATE_LIMIT_SECONDS } from '../lib/rateLimit';
import { Building2, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

export default function AppGroupGate() {
  const [slug, setSlug]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase();
    if (!clean || cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_group_by_slug', { p_slug: clean });
      // 429 = guarda anti-enumeração do banco (5 códigos errados em 30s).
      if (isRateLimit(rpcErr)) {
        setError(SLUG_RATE_LIMIT_MESSAGE);
        setCooldown(SLUG_RATE_LIMIT_SECONDS);
        setLoading(false);
        return;
      }
      const g = Array.isArray(data) ? data[0] : data;
      if (!g) {
        setError('Grupo não encontrado. Confira o código com o responsável.');
        setLoading(false);
        return;
      }
      setAppGroupSlug(g.slug);
      // Reload na rota do grupo — o basename é calculado no carregamento.
      window.location.assign(`/grupo/${g.slug}/login`);
    } catch {
      setError('Não foi possível validar o grupo. Tente novamente.');
      setLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)', color: 'white',
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <LoginBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-3xl overflow-hidden" style={{
          background: 'rgba(255,255,255,0.035)', backdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.6), rgba(59,130,246,0.4), transparent)' }} />
          <div className="px-8 pt-9 pb-8">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.25) 0%, rgba(59,130,246,0.15) 100%)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <Building2 className="w-7 h-7 text-amber-400" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white text-center">Configurar grupo</h1>
            <p className="text-sm text-white/40 mt-2 text-center leading-relaxed">
              Informe o código do seu grupo hoteleiro para acessar o sistema neste aparelho.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-3">
              <input
                type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" autoFocus
                value={slug}
                onChange={e => { setSlug(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()); setError(''); }}
                placeholder="código do grupo"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none text-center font-mono tracking-wider"
                style={inputBase}
              />

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs px-3 py-2.5 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{error}
                </div>
              )}

              <button type="submit" disabled={loading || !slug.trim() || cooldown > 0}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(59,130,246,0.2) 100%)', border: '1px solid rgba(245,158,11,0.3)', color: 'white' }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {cooldown > 0 ? `Aguarde ${cooldown}s` : loading ? 'Validando...' : 'Continuar'}
              </button>
            </form>
          </div>
          <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), rgba(245,158,11,0.3), transparent)' }} />
        </div>
        <p className="text-center mt-5 text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.12)' }}>
          LyFe Hoteles
        </p>
      </div>
    </div>
  );
}

// src/pages/webcheckin/WCIGroupGate.tsx
// Tela inicial do app de Web Check-in: o operador informa o slug do grupo.
// Uma vez configurado, o app mostra apenas os hotéis daquele grupo.

import React, { useState } from 'react';
import { resolveWciGroupBySlug, WciGroup } from './webCheckinService';
import { Building2, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  onResolved: (group: WciGroup) => void;
}

export default function WCIGroupGate({ onResolved }: Props) {
  const [slug, setSlug]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase();
    if (!clean) return;
    setLoading(true);
    setError('');
    try {
      const group = await resolveWciGroupBySlug(clean);
      if (!group) {
        setError('Grupo não encontrado. Confira o código com o responsável.');
        return;
      }
      onResolved(group);
    } catch {
      setError('Não foi possível validar o grupo. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center',
    }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{
          fontSize: 'clamp(1.8rem, 6vw, 2.8rem)', fontWeight: 900, color: '#fff',
          letterSpacing: '-0.02em', textShadow: '0 2px 20px rgba(0,133,174,0.6)', lineHeight: 1,
        }}>
          LyFe
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.3em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
          Web Check-in
        </div>
      </div>

      <div style={{
        width: '100%', maxWidth: 380,
        background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.13)', borderRadius: 24,
        padding: '2rem 1.75rem', boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 1.25rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,133,174,0.22)', border: '1px solid rgba(0,200,255,0.3)',
        }}>
          <Building2 size={26} color="#4db8d4" />
        </div>
        <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fff' }}>Configurar grupo</h1>
        <p style={{ margin: '0.5rem 0 1.5rem', fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
          Informe o código do grupo hoteleiro para liberar o check-in das suas unidades.
        </p>

        <form onSubmit={submit}>
          <input
            type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" autoFocus
            value={slug}
            onChange={e => { setSlug(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()); setError(''); }}
            placeholder="ex: meridiana"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '0.9rem 1rem',
              borderRadius: 14, fontSize: '1rem', fontFamily: 'monospace',
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff', outline: 'none', textAlign: 'center', letterSpacing: '0.05em',
            }}
          />

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              marginTop: 12, padding: '0.6rem 0.8rem', borderRadius: 12,
              background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.35)',
              color: '#fca5a5', fontSize: '0.8rem',
            }}>
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <button type="submit" disabled={loading || !slug.trim()}
            style={{
              width: '100%', marginTop: 16, padding: '0.95rem', borderRadius: 16,
              border: 'none', cursor: loading || !slug.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !slug.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'linear-gradient(135deg, #0085ae, #006688)', color: '#fff',
              fontSize: '0.95rem', fontWeight: 800,
            }}>
            {loading ? <Loader2 size={18} className="wci-spin" style={{ animation: 'wci-spin 0.8s linear infinite' }} /> : <ArrowRight size={18} />}
            {loading ? 'Validando...' : 'Continuar'}
          </button>
        </form>
      </div>

      <p style={{ marginTop: 24, fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
        LyFe Hoteles
      </p>

      <style>{`@keyframes wci-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

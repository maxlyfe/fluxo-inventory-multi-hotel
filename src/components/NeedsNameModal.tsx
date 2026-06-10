// src/components/NeedsNameModal.tsx
// Pop-up global "informe seu nome" — aparece quando um usuário (ex.: novo via
// Google) está autenticado mas ainda não definiu o nome. Antes vivia no /login
// (aposentado); agora é global, então funciona em qualquer fluxo (inclusive
// login por grupo).

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, AlertCircle, Loader2 } from 'lucide-react';

export default function NeedsNameModal() {
  const { user, needsName, saveName, logout } = useAuth();
  const [name, setName]     = useState('');
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  if (!user || !needsName) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || name.trim().length < 2) {
      setError('Por favor, insira seu nome completo.');
      return;
    }
    setSaving(true);
    const result = await saveName(name);
    if (!result.success) setError(result.message || 'Erro ao salvar.');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(6,12,24,0.85)', backdropFilter: 'blur(16px)' }}>
      <div className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl" style={{ background: 'rgba(13,20,35,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 0 60px rgba(245,158,11,0.15)' }}>
        <div className="px-6 pt-8 pb-6 text-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(59,130,246,0.1) 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <User className="h-8 w-8 text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Bem-vindo!</h2>
          <p className="text-sm text-white/40 mt-1">Como devemos te chamar?</p>
        </div>
        <div className="px-6 py-6">
          <p className="text-xs text-white/30 text-center mb-5 leading-relaxed">
            Seu nome aparecerá em requisições, chamados e registros do sistema.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-amber-400/80 uppercase tracking-widest mb-1.5">Nome completo</label>
              <input
                type="text" value={name} autoFocus
                onChange={e => { setName(e.target.value); setError(''); }}
                placeholder="Ex: Maria da Silva"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{error}
              </div>
            )}
            <button type="submit" disabled={saving || !name.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#0a0f1e' }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Salvando...' : 'Continuar →'}
            </button>
          </form>
          <button onClick={() => logout()} className="w-full text-center text-xs text-white/20 hover:text-white/40 mt-4 transition-colors">
            Cancelar e sair
          </button>
        </div>
      </div>
    </div>
  );
}

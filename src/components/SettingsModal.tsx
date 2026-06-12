// src/components/SettingsModal.tsx
// Modal de Configurações (acessível pelo menu do perfil). Inclui a troca de
// grupo no APK do sistema — reaproveita a config persistida em app_group_slug.

import React, { useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { useIsNative, setAppGroupSlug } from '../lib/appGroup';
import { X, Building2, RefreshCw, Loader2, Settings as SettingsIcon } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: Props) {
  const { currentGroup } = useGroup();
  const { logout } = useAuth();
  const isNative = useIsNative();
  const [switching, setSwitching] = useState(false);

  if (!isOpen) return null;

  // APK: trocar de grupo → encerra a sessão, limpa a config e volta ao gate.
  const handleSwitchGroup = async () => {
    setSwitching(true);
    setAppGroupSlug(null);
    try { await logout(); } catch { /* ignore */ }
    window.location.assign('/');
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-3xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/10 flex items-center justify-center">
              <SettingsIcon className="w-4.5 h-4.5 text-gray-600 dark:text-gray-300" style={{ width: 18, height: 18 }} />
            </div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Configurações</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Grupo atual */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Grupo</p>
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{currentGroup?.name || '—'}</p>
                {currentGroup?.slug && <p className="text-[11px] font-mono text-gray-400 truncate">/grupo/{currentGroup.slug}</p>}
              </div>
            </div>
          </div>

          {/* Trocar de grupo — só no APK */}
          {isNative && (
            <div>
              <button onClick={handleSwitchGroup} disabled={switching}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-50 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-white/10">
                {switching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {switching ? 'Saindo...' : 'Trocar de grupo'}
              </button>
              <p className="text-[11px] text-gray-400 mt-2 text-center leading-relaxed">
                Encerra a sessão neste aparelho e permite configurar outro grupo.
              </p>
            </div>
          )}

          {!isNative && (
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              Para acessar outro grupo, use o link <span className="font-mono">/grupo/&lt;código&gt;</span> no navegador.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

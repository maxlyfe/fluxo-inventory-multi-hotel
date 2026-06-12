// src/components/MobileAppModal.tsx
// Modal de download dos apps (Android APKs + instruções iOS).
// Os links de APK apontam SEMPRE para o domínio de produção, para que o
// download funcione independentemente do basename do grupo (/grupo/<slug>).

import React from 'react';
import { Smartphone, Apple, UserPlus } from 'lucide-react';

// Domínio de produção — os APKs ficam em public/downloads/ servidos pela raiz.
const PROD_ORIGIN = 'https://lyfehoteles.com.br';
const APK_MAIN = `${PROD_ORIGIN}/downloads/${encodeURIComponent('LyFe Hoteles.apk')}`;
const APK_WCI  = `${PROD_ORIGIN}/downloads/${encodeURIComponent('LyFe Web Check-in.apk')}`;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileAppModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-md bg-gray-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-8 text-center bg-gradient-to-br from-amber-500/10 to-blue-500/10 border-b border-white/5">
          <Smartphone className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-black text-white uppercase tracking-tight">LyFe Hoteles</h2>
          <p className="text-sm text-white/40 mt-1">Escolha sua plataforma para começar</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Android */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-amber-500/80 uppercase tracking-[0.2em] ml-1">Android (Instalação Direta)</p>

            {/* Sistema principal */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 group hover:border-amber-500/30 transition-all text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Smartphone className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">LyFe Hoteles</p>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Sistema Completo</p>
                  </div>
                </div>
                <a href={APK_MAIN} download
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-gray-900 text-xs font-black rounded-lg transition-all active:scale-95">
                  BAIXAR
                </a>
              </div>
            </div>

            {/* Web Check-in */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 group hover:border-emerald-500/30 transition-all text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <UserPlus className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">LyFe Web Check-in</p>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Exclusivo Hóspedes</p>
                  </div>
                </div>
                <a href={APK_WCI} download
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-lg transition-all active:scale-95">
                  BAIXAR
                </a>
              </div>
            </div>
          </div>

          {/* iOS */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Apple className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-tight">iPhone (iOS)</p>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Modo Web App</p>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-white/50 font-medium">Siga os passos no Safari:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[11px] text-white/70 bg-black/20 p-2 rounded-lg">
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-white font-bold flex-shrink-0">1</span>
                  <span>Toque no botão de <b>Compartilhar</b> (quadrado com seta)</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-white/70 bg-black/20 p-2 rounded-lg">
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-white font-bold flex-shrink-0">2</span>
                  <span>Role e toque em <b>"Adicionar à Tela de Início"</b></span>
                </div>
              </div>
            </div>
          </div>

          <button onClick={onClose} className="w-full py-3 text-sm font-bold text-white/40 hover:text-white transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

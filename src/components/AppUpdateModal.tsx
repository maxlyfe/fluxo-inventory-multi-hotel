import React from 'react';
import { Download, Rocket, X, AlertCircle } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate';

const AppUpdateModal: React.FC = () => {
  const { updateAvailable, manifest, currentVersion, startUpdate, dismissUpdate } = useAppUpdate();

  if (!updateAvailable || !manifest) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-gray-800 rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl border border-white/20 transform animate-in zoom-in-95 duration-300">
        
        {/* Header Decor */}
        <div className="relative h-32 bg-gradient-to-br from-sky-600 to-indigo-700 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M0 100 C 20 0 50 0 100 100 Z" fill="white" />
            </svg>
          </div>
          <div className="relative w-20 h-20 bg-white/20 backdrop-blur-xl rounded-3xl flex items-center justify-center border border-white/30 shadow-xl">
            <Rocket className="w-10 h-10 text-white animate-bounce" />
          </div>
          
          {!manifest.forceUpdate && (
            <button 
              onClick={dismissUpdate}
              className="absolute top-6 right-6 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <h2 className="text-2xl font-black text-gray-800 dark:text-white mb-2">Atualização Disponível!</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 leading-relaxed">
            Uma nova versão do <strong>Fluxo</strong> está pronta para ser instalada. 
            Mantenha seu app atualizado para garantir a melhor performance.
          </p>

          {/* Version Pills */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              v{currentVersion}
            </div>
            <div className="w-4 h-px bg-gray-200 dark:bg-gray-600" />
            <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 rounded-full text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest border border-emerald-200 dark:border-emerald-800/50">
              v{manifest.latestVersion}
            </div>
          </div>

          {/* Release Notes */}
          {manifest.notes && (
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl p-4 mb-8 text-left border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2 text-sky-600 dark:text-sky-400">
                <AlertCircle className="w-4 h-4" />
                <span className="text-[10px] font-black uppercase tracking-wider">O que mudou:</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-medium italic">
                "{manifest.notes}"
              </p>
            </div>
          )}

          {/* Action */}
          <button 
            onClick={startUpdate}
            className="w-full py-5 bg-sky-600 hover:bg-sky-700 text-white rounded-[2rem] font-black text-lg transition-all shadow-xl shadow-sky-200 dark:shadow-none flex items-center justify-center gap-3 active:scale-[0.98]"
          >
            <Download className="w-6 h-6" />
            ATUALIZAR AGORA
          </button>
          
          <p className="mt-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
            Download rápido e seguro
          </p>
        </div>
      </div>
    </div>
  );
};

export default AppUpdateModal;

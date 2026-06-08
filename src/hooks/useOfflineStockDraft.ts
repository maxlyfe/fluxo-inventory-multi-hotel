// src/hooks/useOfflineStockDraft.ts
// ---------------------------------------------------------------------------
// Rascunho offline-first para conferência de estoque.
//
// Problema real: dentro dos estoques a internet cai e a contagem se perde.
//
// Solução em 2 camadas:
//   1) localStorage — gravação INSTANTÂNEA a cada alteração. Funciona 100%
//      offline e persiste no WebView do APK (sobrevive a fechar o app).
//   2) Servidor — autosave com debounce (~2,5s). Se estiver offline, fica
//      "pendente" e sincroniza sozinho assim que a internet voltar.
//
// O componente continua dono do estado `counts`. Este hook só persiste,
// sincroniza e reporta o status.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const PREFIX = 'fluxo_stock_draft_v1:';

export interface StoredDraft {
  counts: Record<string, number>;
  updatedAt: number; // epoch ms
}

/** Monta a chave de localStorage para o contexto da contagem. */
export function buildDraftKey(parts: { token?: string; hotelId?: string; sectorId?: string | null }): string {
  if (parts.token) return `${PREFIX}token:${parts.token}`;
  return `${PREFIX}${parts.hotelId ?? 'nohotel'}:${parts.sectorId || 'main'}`;
}

/** Lê o rascunho salvo localmente (ou null). */
export function readLocalDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed && parsed.counts && typeof parsed.counts === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Apaga o rascunho local (ex.: após finalizar a contagem com sucesso). */
export function clearLocalDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

interface UseOfflineDraftOptions {
  /** Chave única do contexto. null/undefined desliga o hook. */
  storageKey: string | null;
  /** Estado atual da contagem. */
  counts: Record<string, number>;
  /** Liga o autosave. Desligue durante revisão/contagem delegada. */
  enabled: boolean;
  /** Persiste o rascunho no servidor (status draft) — sem UI/toast. */
  saveDraftToServer: () => Promise<void>;
  /** Debounce do autosave ao servidor (ms). Padrão 2500. */
  debounceMs?: number;
}

export function useOfflineStockDraft({
  storageKey,
  counts,
  enabled,
  saveDraftToServer,
  debounceMs = 2500,
}: UseOfflineDraftOptions) {
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef   = useRef(false);
  const pendingRef  = useRef(false); // há alterações ainda não confirmadas no servidor

  // Mantém a função de save mais recente sem recriar o effect
  const saveFnRef = useRef(saveDraftToServer);
  useEffect(() => { saveFnRef.current = saveDraftToServer; }, [saveDraftToServer]);

  // Envia o rascunho ao servidor (se houver pendência e estiver online)
  const flush = useCallback(async () => {
    if (!enabled || !storageKey) return;
    if (!pendingRef.current || savingRef.current) return;
    if (Object.keys(counts).length === 0) { pendingRef.current = false; return; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setStatus('offline'); return; }

    savingRef.current = true;
    setStatus('saving');
    try {
      await saveFnRef.current();
      pendingRef.current = false;
      setStatus('saved');
    } catch {
      setStatus('error'); // continua pendente; tentará de novo na próxima alteração / reconexão
    } finally {
      savingRef.current = false;
    }
  }, [enabled, storageKey, counts]);

  // 1) Persistência local instantânea + 2) agenda autosave debounced
  useEffect(() => {
    if (!enabled || !storageKey) return;
    if (Object.keys(counts).length === 0) return;

    // Grava local imediatamente — à prova de offline e de fechar o app
    try {
      localStorage.setItem(storageKey, JSON.stringify({ counts, updatedAt: Date.now() } as StoredDraft));
    } catch { /* quota/full — ignora */ }

    // Marca pendência e agenda envio ao servidor
    pendingRef.current = true;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline');
    } else if (status !== 'saving') {
      setStatus('idle'); // "alterações não salvas ainda"
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void flush(); }, debounceMs);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, enabled, storageKey, debounceMs]);

  // Reage a online/offline: ao voltar a internet, sincroniza pendências
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => { setIsOnline(true); if (pendingRef.current) void flush(); };
    const goOffline = () => { setIsOnline(false); setStatus('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flush]);

  /** Força o envio imediato (ex.: ao tentar fechar). */
  const flushNow = useCallback(() => { void flush(); }, [flush]);

  return { status, isOnline, flushNow, hasPending: () => pendingRef.current };
}

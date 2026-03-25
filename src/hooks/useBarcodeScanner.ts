import { useEffect, useRef, useCallback } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  enabled?: boolean;
  minLength?: number;
  maxGap?: number;
}

/**
 * Hook que detecta input de leitor USB de código de barras.
 * Scanners USB emulam teclado: enviam caracteres rápido (< 30ms) e finalizam com Enter.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 4,
  maxGap = 50,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRef = useRef(onScan);

  // Manter ref atualizada sem re-registrar listener
  onScanRef.current = onScan;

  const resetBuffer = useCallback(() => {
    bufferRef.current = '';
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetBuffer();
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;

      // Limpar timeout anterior
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          const barcode = bufferRef.current;
          bufferRef.current = '';
          onScanRef.current(barcode);
        } else {
          bufferRef.current = '';
        }
        lastKeyTimeRef.current = 0;
        return;
      }

      // Apenas caracteres imprimíveis (length === 1 filtra teclas especiais)
      if (e.key.length !== 1) return;

      if (gap < maxGap && bufferRef.current.length > 0) {
        bufferRef.current += e.key;
      } else {
        bufferRef.current = e.key;
      }

      lastKeyTimeRef.current = now;

      // Timeout de limpeza: reseta buffer se nenhuma tecla por 100ms
      cleanupTimerRef.current = setTimeout(() => {
        bufferRef.current = '';
      }, 100);
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
      bufferRef.current = '';
    };
  }, [enabled, minLength, maxGap, resetBuffer]);
}

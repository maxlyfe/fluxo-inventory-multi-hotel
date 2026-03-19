// src/hooks/useErbonData.ts
// Hook genérico para fetch de dados da API Erbon PMS.
// Verifica se o hotel tem Erbon configurado antes de buscar.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useHotel } from '../context/HotelContext';
import { erbonService, ErbonConfig } from '../lib/erbonService';

interface UseErbonDataReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  erbonConfigured: boolean;
  config: ErbonConfig | null;
}

export function useErbonData<T>(
  fetchFn: (hotelId: string) => Promise<T>,
  deps: any[] = [],
  options?: { autoRefreshMs?: number }
): UseErbonDataReturn<T> {
  const { selectedHotel } = useHotel();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erbonConfigured, setErbonConfigured] = useState(false);
  const [config, setConfig] = useState<ErbonConfig | null>(null);
  const mountedRef = useRef(true);

  const hotelId = selectedHotel?.id;

  const fetchData = useCallback(async () => {
    if (!hotelId) {
      setLoading(false);
      setErbonConfigured(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Verificar config Erbon
      const cfg = await erbonService.getConfig(hotelId);
      if (!mountedRef.current) return;

      if (!cfg || !cfg.is_active) {
        setErbonConfigured(false);
        setConfig(null);
        setData(null);
        setLoading(false);
        return;
      }

      setErbonConfigured(true);
      setConfig(cfg);

      // Buscar dados
      const result = await fetchFn(hotelId);
      if (!mountedRef.current) return;
      setData(result);
    } catch (err: any) {
      if (!mountedRef.current) return;
      console.error('[useErbonData] Erro:', err);
      setError(err.message || 'Erro ao buscar dados do Erbon');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!options?.autoRefreshMs || !erbonConfigured) return;
    const interval = setInterval(fetchData, options.autoRefreshMs);
    return () => clearInterval(interval);
  }, [fetchData, options?.autoRefreshMs, erbonConfigured]);

  return { data, loading, error, refetch: fetchData, erbonConfigured, config };
}

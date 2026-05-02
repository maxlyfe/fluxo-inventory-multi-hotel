import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimePostgresUpdatePayload } from '@supabase/supabase-js';

/**
 * Hook para ouvir mudanças em tempo real em uma tabela do Supabase.
 * @param table - Nome da tabela (ex: 'sector_stock')
 * @param filter - Filtro opcional (ex: 'hotel_id=eq.UUID')
 * @param onUpdate - Callback disparado na mudança
 */
export function useRealtimeSubscription<T extends { [key: string]: any }>(
  table: string,
  filter?: string,
  onUpdate?: (payload: RealtimePostgresUpdatePayload<T>) => void
) {
  useEffect(() => {
    // Canal único para esta subscrição
    const channelName = `realtime-${table}-${filter || 'all'}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: table,
          filter: filter,
        },
        (payload) => {
          if (onUpdate) onUpdate(payload as any);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, onUpdate]);
}

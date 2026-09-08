// src/hooks/useGroupHotels.ts
//
// Lista de unidades do grupo atual, já filtrada. É o caminho padrão para
// qualquer seletor ou filtro de hotel numa tela autenticada: evita repetir o
// `.eq('group_id', ...)` e, principalmente, evita esquecer dele.
//
// Ver `src/lib/hotelsService.ts` para o motivo de o filtro ser obrigatório.

import { useCallback, useEffect, useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { listGroupHotels, GroupHotel, ListGroupHotelsOptions } from '../lib/hotelsService';

export function useGroupHotels<T = GroupHotel>(options: ListGroupHotelsOptions = {}) {
  const { currentGroup } = useGroup();
  const [hotels, setHotels] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  // Desmontado em primitivos: o objeto de opções costuma ser literal no local
  // da chamada, então usar ele como dependência recarregaria a cada render.
  const { columns, includeInactive, excludeHotelId, orderBy } = options;
  const groupId = currentGroup?.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listGroupHotels<T>(groupId, {
        columns, includeInactive, excludeHotelId, orderBy,
      });
      setHotels(rows);
    } catch {
      setHotels([]);
    } finally {
      setLoading(false);
    }
  }, [groupId, columns, includeInactive, excludeHotelId, orderBy]);

  useEffect(() => { load(); }, [load]);

  return { hotels, loading, reload: load, groupId };
}

// src/lib/seasonHelper.ts
import { supabase } from './supabase';
import { erbonService } from './erbonService';
import { format, addDays } from 'date-fns';

export type Season = 'alta' | 'baixa';

export interface SeasonInfo {
  season: Season;
  source: 'manual' | 'auto';
  occupancyAvg?: number;
  threshold?: number;
}

export async function detectSeason(hotelId: string): Promise<SeasonInfo> {
  const { data: config } = await supabase
    .from('erbon_hotel_config')
    .select('season_mode, high_season_occupancy_threshold, is_active')
    .eq('hotel_id', hotelId)
    .single();

  const mode = config?.season_mode || 'auto';
  const threshold = config?.high_season_occupancy_threshold ?? 40;

  if (mode === 'alta' || mode === 'baixa') {
    return { season: mode, source: 'manual' };
  }

  if (!config?.is_active) {
    return { season: 'baixa', source: 'auto', occupancyAvg: 0, threshold };
  }

  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    const weekAhead = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const occupancyData = await erbonService.fetchOccupancyWithPension(hotelId, today, weekAhead);

    console.log('[SeasonHelper] Occupancy raw data:', JSON.stringify(occupancyData?.slice(0, 2)));

    if (!occupancyData || occupancyData.length === 0) {
      console.warn('[SeasonHelper] Nenhum dado de ocupação retornado');
      return { season: 'baixa', source: 'auto', occupancyAvg: 0, threshold };
    }

    // occupancy pode vir como percentual (30 = 30%) ou decimal (0.30 = 30%)
    // Também pode vir via roomSalledConfirmed / roomAvailable
    let avgOccupancy: number;

    // Tenta calcular via quartos vendidos / disponíveis (mais confiável)
    const hasRoomData = occupancyData.some(d => d.roomAvailable > 0);
    if (hasRoomData) {
      const totalSold = occupancyData.reduce((sum, d) => sum + (d.roomSalledConfirmed || 0), 0);
      const totalAvailable = occupancyData.reduce((sum, d) => sum + (d.roomAvailable || 0), 0);
      avgOccupancy = totalAvailable > 0 ? (totalSold / totalAvailable) * 100 : 0;
      console.log(`[SeasonHelper] Via quartos: ${totalSold}/${totalAvailable} = ${avgOccupancy.toFixed(1)}%`);
    } else {
      // Fallback: usa campo occupancy direto
      const rawAvg = occupancyData.reduce((sum, d) => sum + (d.occupancy || 0), 0) / occupancyData.length;
      // Se todos os valores são <= 1, provavelmente é decimal (0.30 = 30%)
      avgOccupancy = rawAvg <= 1 ? rawAvg * 100 : rawAvg;
      console.log(`[SeasonHelper] Via campo occupancy: raw=${rawAvg}, normalizado=${avgOccupancy.toFixed(1)}%`);
    }

    const season: Season = avgOccupancy >= threshold ? 'alta' : 'baixa';
    const roundedAvg = Math.round(avgOccupancy * 100) / 100;

    console.log(`[SeasonHelper] Resultado: ${season} (${roundedAvg}% vs threshold ${threshold}%)`);
    return { season, source: 'auto', occupancyAvg: roundedAvg, threshold };
  } catch (err) {
    console.error('[SeasonHelper] Erro ao detectar temporada:', err);
    return { season: 'baixa', source: 'auto', occupancyAvg: 0, threshold };
  }
}

export function getApplicableMinMax(
  item: {
    min_quantity: number;
    max_quantity: number;
    min_quantity_low?: number | null;
    max_quantity_low?: number | null;
    min_quantity_high?: number | null;
    max_quantity_high?: number | null;
  },
  season: Season
): { min: number; max: number } {
  if (season === 'alta') {
    return {
      min: item.min_quantity_high ?? item.min_quantity,
      max: item.max_quantity_high ?? item.max_quantity,
    };
  }
  return {
    min: item.min_quantity_low ?? item.min_quantity,
    max: item.max_quantity_low ?? item.max_quantity,
  };
}

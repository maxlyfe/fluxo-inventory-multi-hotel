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

    if (!occupancyData || occupancyData.length === 0) {
      return { season: 'baixa', source: 'auto', occupancyAvg: 0, threshold };
    }

    const avgOccupancy = occupancyData.reduce((sum, d) => sum + (d.occupancy || 0), 0) / occupancyData.length;
    const season: Season = avgOccupancy > threshold ? 'alta' : 'baixa';

    return { season, source: 'auto', occupancyAvg: Math.round(avgOccupancy * 100) / 100, threshold };
  } catch {
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

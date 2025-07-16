import { supabase } from './supabase';
import { format, startOfYear, endOfYear } from 'date-fns'; // format foi adicionado aqui

// Interfaces espelhando as tabelas do DB
export interface UtilityReadingInsert {
  hotel_id: string;
  utility_type: 'ENEL' | 'PROLAGOS';
  reading_date: string;
  reading_value: number;
  observations?: string;
}

export interface UtilityReading extends UtilityReadingInsert {
  id: string;
  created_at: string;
}

export interface WaterTruckEntryInsert {
  hotel_id: string;
  supply_date: string;
  seal_number?: string;
  service_order?: string;
  volume_m3: number;
}

export interface WaterTruckEntry extends WaterTruckEntryInsert {
  id: string;
  created_at: string;
}


// --- Funções para Leituras de Medidores (Enel/Prolagos) ---

export const getUtilityReadingsForYear = async (hotelId: string, year: Date) => {
  const startDate = format(startOfYear(year), 'yyyy-MM-dd');
  const endDate = format(endOfYear(year), 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('utility_readings')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('reading_date', startDate)
    .lte('reading_date', endDate)
    .order('reading_date', { ascending: false });
  
  return { data, error };
};

export const addUtilityReading = async (reading: UtilityReadingInsert) => {
  const { data, error } = await supabase
    .from('utility_readings')
    .insert(reading)
    .select()
    .single();
  return { data, error };
};

export const updateUtilityReading = async (id: string, updates: Partial<UtilityReadingInsert>) => {
  const { data, error } = await supabase
    .from('utility_readings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
};

export const deleteUtilityReading = async (id: string) => {
  const { error } = await supabase
    .from('utility_readings')
    .delete()
    .eq('id', id);
  return { error };
};


// --- Funções para Entradas de Pipas d'Água ---

export const getWaterTruckEntriesForYear = async (hotelId: string, year: Date) => {
    const startDate = format(startOfYear(year), 'yyyy-MM-dd');
    const endDate = format(endOfYear(year), 'yyyy-MM-dd');
  
    const { data, error } = await supabase
      .from('water_truck_entries')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('supply_date', startDate)
      .lte('supply_date', endDate)
      .order('supply_date', { ascending: false });

    return { data, error };
};

export const addWaterTruckEntry = async (entry: WaterTruckEntryInsert) => {
  const { data, error } = await supabase
    .from('water_truck_entries')
    .insert(entry)
    .select()
    .single();
  return { data, error };
};

export const updateWaterTruckEntry = async (id: string, updates: Partial<WaterTruckEntryInsert>) => {
  const { data, error } = await supabase
    .from('water_truck_entries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
};

export const deleteWaterTruckEntry = async (id: string) => {
  const { error } = await supabase
    .from('water_truck_entries')
    .delete()
    .eq('id', id);
  return { error };
};
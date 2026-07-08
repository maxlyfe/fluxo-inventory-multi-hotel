// src/lib/wciCode.ts
// Garante que o hotel tenha um wci_code (código opaco usado nas URLs públicas
// do web-checkin). Se não existir, gera a partir do nome do hotel e salva —
// nenhum hotel fica bloqueado por falta de cadastro manual.

import { supabase } from './supabase';

const COMBINING_MARKS = /[̀-ͯ]/g;

export async function ensureHotelWciCode(hotelId: string): Promise<string | null> {
  const { data: hotel } = await supabase
    .from('hotels')
    .select('wci_code, name')
    .eq('id', hotelId)
    .single();
  if (!hotel) return null;
  if (hotel.wci_code) return hotel.wci_code;

  const base = (hotel.name || 'hotel')
    .toLowerCase()
    .normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'hotel';

  let code = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: clash } = await supabase
      .from('hotels')
      .select('id')
      .eq('wci_code', code)
      .neq('id', hotelId)
      .maybeSingle();
    if (!clash) break;
    code = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { error } = await supabase.from('hotels').update({ wci_code: code }).eq('id', hotelId);
  if (error) return null;
  return code;
}

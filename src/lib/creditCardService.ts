import { supabase } from './supabase';

export type CardBrand = 'visa' | 'master' | 'elo' | 'amex' | 'hipercard' | 'outros';

export interface CreditCard {
  id: string;
  hotel_id: string;
  name: string;
  last_4_digits: string;
  card_brand: CardBrand | null;
  closing_day: number;
  due_day: number;
  active: boolean;
  created_at: string;
  hotels?: { name: string };
}

export const BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  master: 'Mastercard',
  elo: 'Elo',
  amex: 'Amex',
  hipercard: 'Hipercard',
  outros: 'Outros',
};

const SELECT = '*, hotels(name)';

export async function list(hotelId: string): Promise<CreditCard[]> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select(SELECT)
    .eq('hotel_id', hotelId)
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as CreditCard[];
}

export async function listAll(hotelId: string): Promise<CreditCard[]> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select(SELECT)
    .eq('hotel_id', hotelId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as CreditCard[];
}

export async function listByGroup(groupId: string): Promise<CreditCard[]> {
  const { data: hotels } = await supabase
    .from('hotels')
    .select('id')
    .eq('group_id', groupId)
    .eq('is_active', true);
  if (!hotels?.length) return [];

  const hotelIds = hotels.map((h) => h.id);
  const { data, error } = await supabase
    .from('credit_cards')
    .select(SELECT)
    .in('hotel_id', hotelIds)
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as CreditCard[];
}

export async function save(card: Partial<CreditCard> & { hotel_id: string }): Promise<CreditCard> {
  if (card.id) {
    const { data, error } = await supabase
      .from('credit_cards')
      .update({
        name: card.name,
        last_4_digits: card.last_4_digits,
        card_brand: card.card_brand,
        closing_day: card.closing_day,
        due_day: card.due_day,
        active: card.active,
      })
      .eq('id', card.id)
      .select(SELECT)
      .single();
    if (error) throw error;
    return data as CreditCard;
  }
  const { data, error } = await supabase
    .from('credit_cards')
    .insert({
      hotel_id: card.hotel_id,
      name: card.name,
      last_4_digits: card.last_4_digits,
      card_brand: card.card_brand,
      closing_day: card.closing_day,
      due_day: card.due_day,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase
    .from('credit_cards')
    .update({ active: false })
    .eq('id', id);
  if (error) throw error;
}

export function calculateCardDueDate(
  purchaseDate: string,
  closingDay: number,
  dueDay: number,
  installmentIndex = 0,
): string {
  const d = new Date(purchaseDate + 'T12:00:00');
  const purchaseDay = d.getDate();

  let baseMonth: Date;
  if (purchaseDay <= closingDay) {
    baseMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  } else {
    baseMonth = new Date(d.getFullYear(), d.getMonth() + 2, 1);
  }

  const targetMonth = new Date(
    baseMonth.getFullYear(),
    baseMonth.getMonth() + installmentIndex,
    1,
  );

  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  const day = Math.min(dueDay, lastDay);

  const due = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
  return due.toISOString().split('T')[0];
}

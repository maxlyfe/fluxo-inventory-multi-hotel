import { supabase } from './supabase';

export interface ChartAccount {
  id: string;
  name: string;
  sort_order: number;
  hotel_id: string | null;
}

export interface ChartAccountSub {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  hotel_id: string | null;
  sort_order: number;
}

export interface ChartAccountGroup extends ChartAccount {
  subs: ChartAccountSub[];
}

export const chartOfAccountsService = {
  /** Global (hotel_id null) + hotel-specific accounts with their subaccounts. */
  async listGrouped(hotelId: string): Promise<ChartAccountGroup[]> {
    const [accRes, subRes] = await Promise.all([
      supabase
        .from('chart_of_accounts')
        .select('id, name, sort_order, hotel_id')
        .or(`hotel_id.is.null,hotel_id.eq.${hotelId}`)
        .order('sort_order'),
      supabase
        .from('chart_of_accounts_sub')
        .select('id, account_id, name, description, hotel_id, sort_order')
        .or(`hotel_id.is.null,hotel_id.eq.${hotelId}`)
        .order('sort_order'),
    ]);
    if (accRes.error) throw accRes.error;
    if (subRes.error) throw subRes.error;
    const subs = subRes.data ?? [];
    return (accRes.data ?? []).map(a => ({
      ...a,
      subs: subs.filter(s => s.account_id === a.id),
    }));
  },
};

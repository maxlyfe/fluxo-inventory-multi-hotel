import { supabase } from './supabase';

export interface CashflowPoint {
  month: string;      // yyyy-mm
  inflow: number;     // AR net expected + inflows
  outflow: number;    // AP amounts
  balance: number;    // cumulative
}

export interface SectorSpend {
  accountId: string;
  accountName: string;
  total: number;
  subs: { subId: string; subName: string; total: number }[];
}

export interface FinanceSummary {
  apOpenMonth: number;      // a pagar no mês corrente (aberto/parcial)
  arOpenMonth: number;      // a receber no mês corrente
  apOverdue: number;        // vencidos em aberto
  arOverdue: number;        // atrasados a receber
  projectedBalance: number; // (AR - AP) próximos 90 dias
}

function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export const cashflowService = {
  async summary(hotelId: string): Promise<FinanceSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';
    const monthEndD = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0);
    const monthEnd = monthEndD.toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);

    const [ap, ar] = await Promise.all([
      supabase.from('ap_titles')
        .select('amount, amount_paid, due_date, status')
        .eq('hotel_id', hotelId)
        .in('status', ['aberto', 'parcial'])
        .lte('due_date', in90),
      supabase.from('ar_titles')
        .select('net_amount, amount_received, expected_date, status')
        .eq('hotel_id', hotelId)
        .in('status', ['previsto', 'parcial'])
        .lte('expected_date', in90),
    ]);
    if (ap.error) throw ap.error;
    if (ar.error) throw ar.error;

    let apOpenMonth = 0, arOpenMonth = 0, apOverdue = 0, arOverdue = 0, apNext = 0, arNext = 0;
    for (const t of ap.data ?? []) {
      const open = Number(t.amount) - Number(t.amount_paid);
      apNext += open;
      if (t.due_date >= monthStart && t.due_date <= monthEnd) apOpenMonth += open;
      if (t.due_date < today) apOverdue += open;
    }
    for (const t of ar.data ?? []) {
      const open = Number(t.net_amount) - Number(t.amount_received);
      arNext += open;
      if (t.expected_date >= monthStart && t.expected_date <= monthEnd) arOpenMonth += open;
      if (t.expected_date < today) arOverdue += open;
    }
    return { apOpenMonth, arOpenMonth, apOverdue, arOverdue, projectedBalance: arNext - apNext };
  },

  /** Monthly projection of expected inflows vs outflows within [from, to]. */
  async projection(hotelId: string, from: string, to: string): Promise<CashflowPoint[]> {
    const [ap, ar, inflows] = await Promise.all([
      supabase.from('ap_titles')
        .select('amount, amount_paid, due_date, status')
        .eq('hotel_id', hotelId)
        .neq('status', 'cancelado')
        .gte('due_date', from).lte('due_date', to),
      supabase.from('ar_titles')
        .select('net_amount, amount_received, expected_date, status')
        .eq('hotel_id', hotelId)
        .neq('status', 'cancelado')
        .gte('expected_date', from).lte('expected_date', to),
      supabase.from('money_inflows')
        .select('amount, inflow_date')
        .eq('hotel_id', hotelId)
        .gte('inflow_date', from).lte('inflow_date', to),
    ]);
    if (ap.error) throw ap.error;
    if (ar.error) throw ar.error;
    if (inflows.error) throw inflows.error;

    const months = new Map<string, { inflow: number; outflow: number }>();
    const bucket = (m: string) => {
      if (!months.has(m)) months.set(m, { inflow: 0, outflow: 0 });
      return months.get(m)!;
    };
    for (const t of ap.data ?? []) bucket(monthKey(t.due_date)).outflow += Number(t.amount);
    for (const t of ar.data ?? []) bucket(monthKey(t.expected_date)).inflow += Number(t.net_amount);
    for (const i of inflows.data ?? []) bucket(monthKey(i.inflow_date)).inflow += Number(i.amount);

    const keys = Array.from(months.keys()).sort();
    let running = 0;
    return keys.map(k => {
      const { inflow, outflow } = months.get(k)!;
      running += inflow - outflow;
      return { month: k, inflow, outflow, balance: running };
    });
  },

  /** Spend grouped by chart of accounts (categoria → subcategoria) within [from, to]. */
  async spendBySector(hotelId: string, from: string, to: string): Promise<{ groups: SectorSpend[]; unclassified: number; total: number }> {
    const { data, error } = await supabase
      .from('ap_titles')
      .select('amount, chart_account_sub_id, chart_of_accounts_sub(id, name, chart_of_accounts(id, name))')
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelado')
      .gte('due_date', from).lte('due_date', to);
    if (error) throw error;

    const byAccount = new Map<string, SectorSpend>();
    let unclassified = 0;
    let total = 0;
    for (const t of (data ?? []) as any[]) {
      const amount = Number(t.amount);
      total += amount;
      const sub = t.chart_of_accounts_sub;
      const acc = sub?.chart_of_accounts;
      if (!sub || !acc) { unclassified += amount; continue; }
      if (!byAccount.has(acc.id)) {
        byAccount.set(acc.id, { accountId: acc.id, accountName: acc.name, total: 0, subs: [] });
      }
      const g = byAccount.get(acc.id)!;
      g.total += amount;
      const s = g.subs.find(x => x.subId === sub.id);
      if (s) s.total += amount;
      else g.subs.push({ subId: sub.id, subName: sub.name, total: amount });
    }
    const groups = Array.from(byAccount.values()).sort((a, b) => b.total - a.total);
    groups.forEach(g => g.subs.sort((a, b) => b.total - a.total));
    return { groups, unclassified, total };
  },
};

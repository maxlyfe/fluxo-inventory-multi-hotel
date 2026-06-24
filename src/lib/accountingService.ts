// src/lib/accountingService.ts
import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IbsCbsUsage {
  id: string;
  hotel_id: string;
  usage_date: string;
  period_month: number;
  period_year: number;
  ibs_used: number;
  cbs_used: number;
  description: string | null;
  created_at: string;
}

export interface PurchaseCreditRow {
  purchase_id: string;
  purchase_date: string;
  invoice_number: string | null;
  total_amount: number;
  supplier_id: string;
  supplier_name: string;    // display name
  supplier_razao: string | null;
  supplier_cnpj: string | null;
  ibs_rate: number;         // percentage, e.g. 12.5
  cbs_rate: number;
  ibs_credit: number;       // total_amount * ibs_rate / 100
  cbs_credit: number;
  ncm_codes: string[];      // unique NCM codes from purchase items
}

export interface PeriodSummary {
  ibs_total: number;
  cbs_total: number;
  ibs_used: number;
  cbs_used: number;
  ibs_available: number;
  cbs_available: number;
  total_purchases_amount: number;
  purchases_count: number;
  usages: IbsCbsUsage[];
  rows: PurchaseCreditRow[];
}

export interface YearlyMonth {
  month: number;
  ibs_credit: number;
  cbs_credit: number;
  ibs_used: number;
  cbs_used: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseRate(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace('%', '').replace(',', '.').trim());
  return isNaN(n) ? 0 : n;
}

export function supplierDisplayName(s: {
  nome?: string | null;
  nome_fantasia?: string | null;
  razao_social?: string | null;
}): string {
  return s.nome_fantasia || s.razao_social || s.nome || '';
}

// ── Service ───────────────────────────────────────────────────────────────────

export const accountingService = {

  async getPeriodSummary(
    hotelId: string,
    year: number,
    month: number,
  ): Promise<PeriodSummary> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [{ data: purchases, error: pe }, { data: usages, error: ue }] = await Promise.all([
      supabase
        .from('purchases')
        .select(`
          id, purchase_date, invoice_number, total_amount, supplier_id, supplier,
          purchase_items ( ncm ),
          suppliers:supplier_id ( id, nome, nome_fantasia, razao_social, cnpj, ibs, cbs )
        `)
        .eq('hotel_id', hotelId)
        .gte('purchase_date', start)
        .lte('purchase_date', end)
        .not('supplier_id', 'is', null),
      supabase
        .from('accounting_ibs_cbs_usage')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('period_year', year)
        .eq('period_month', month)
        .order('created_at'),
    ]);

    if (pe) throw pe;
    if (ue) throw ue;

    const rows: PurchaseCreditRow[] = (purchases || []).map((p: any) => {
      const sup      = p.suppliers;
      const ibsRate  = parseRate(sup?.ibs);
      const cbsRate  = parseRate(sup?.cbs);
      const ncmCodes = [...new Set(
        (p.purchase_items || []).map((i: any) => i.ncm).filter(Boolean),
      )] as string[];
      return {
        purchase_id:   p.id,
        purchase_date: p.purchase_date,
        invoice_number: p.invoice_number,
        total_amount:  p.total_amount,
        supplier_id:   p.supplier_id,
        supplier_name: supplierDisplayName(sup || {}) || p.supplier || '',
        supplier_razao: sup?.razao_social || null,
        supplier_cnpj:  sup?.cnpj || null,
        ibs_rate:  ibsRate,
        cbs_rate:  cbsRate,
        ibs_credit: (p.total_amount * ibsRate) / 100,
        cbs_credit: (p.total_amount * cbsRate) / 100,
        ncm_codes:  ncmCodes,
      };
    });

    const ibs_total = rows.reduce((s, r) => s + r.ibs_credit, 0);
    const cbs_total = rows.reduce((s, r) => s + r.cbs_credit, 0);
    const ibs_used  = (usages || []).reduce((s: number, u: any) => s + Number(u.ibs_used), 0);
    const cbs_used  = (usages || []).reduce((s: number, u: any) => s + Number(u.cbs_used), 0);

    return {
      ibs_total,
      cbs_total,
      ibs_used,
      cbs_used,
      ibs_available: Math.max(0, ibs_total - ibs_used),
      cbs_available: Math.max(0, cbs_total - cbs_used),
      total_purchases_amount: rows.reduce((s, r) => s + r.total_amount, 0),
      purchases_count: rows.length,
      usages: (usages || []) as IbsCbsUsage[],
      rows,
    };
  },

  async getYearlySummary(hotelId: string, year: number): Promise<YearlyMonth[]> {
    const [{ data: purchases }, { data: usages }] = await Promise.all([
      supabase
        .from('purchases')
        .select(`
          purchase_date, total_amount,
          suppliers:supplier_id ( ibs, cbs )
        `)
        .eq('hotel_id', hotelId)
        .gte('purchase_date', `${year}-01-01`)
        .lte('purchase_date', `${year}-12-31`)
        .not('supplier_id', 'is', null),
      supabase
        .from('accounting_ibs_cbs_usage')
        .select('period_month, ibs_used, cbs_used')
        .eq('hotel_id', hotelId)
        .eq('period_year', year),
    ]);

    const monthly: Record<number, YearlyMonth> = {};
    for (let m = 1; m <= 12; m++) {
      monthly[m] = { month: m, ibs_credit: 0, cbs_credit: 0, ibs_used: 0, cbs_used: 0 };
    }

    (purchases || []).forEach((p: any) => {
      const m = parseInt(p.purchase_date.split('-')[1], 10);
      const ibsRate = parseRate(p.suppliers?.ibs);
      const cbsRate = parseRate(p.suppliers?.cbs);
      monthly[m].ibs_credit += (p.total_amount * ibsRate) / 100;
      monthly[m].cbs_credit += (p.total_amount * cbsRate) / 100;
    });

    (usages || []).forEach((u: any) => {
      monthly[u.period_month].ibs_used += Number(u.ibs_used);
      monthly[u.period_month].cbs_used += Number(u.cbs_used);
    });

    return Object.values(monthly);
  },

  async addUsage(
    hotelId: string,
    usage: Omit<IbsCbsUsage, 'id' | 'hotel_id' | 'created_at'>,
  ): Promise<void> {
    const { error } = await supabase
      .from('accounting_ibs_cbs_usage')
      .insert({ ...usage, hotel_id: hotelId });
    if (error) throw error;
  },

  async deleteUsage(id: string): Promise<void> {
    const { error } = await supabase
      .from('accounting_ibs_cbs_usage')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

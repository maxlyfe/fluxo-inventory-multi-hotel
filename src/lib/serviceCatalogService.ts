// serviceCatalogService.ts — Catálogo de Serviços do hotel
// CRUD + compartilhamento entre unidades do grupo (share_key + upsert):
// copiar = insere nas unidades onde não existe; empurrar edição = sobrescreve.

import { supabase } from './supabase';

export type ServicePricingMode = 'fixed' | 'variable';

export interface HotelService {
  id: string;
  hotel_id: string;
  share_key: string;
  name: string;
  description: string | null;
  category: string | null;
  pricing_mode: ServicePricingMode;
  price: number | null;
  lc116_code: string | null;
  municipal_tax_code: string | null;
  cnae: string | null;
  iss_rate: number | null;
  iss_retained: boolean;
  iss_exigibilidade: string;
  nbs_code: string | null;
  ibs_cbs_cst: string | null;
  ibs_cbs_cclasstrib: string | null;
  nfce_eligible: boolean;
  nfce_ncm: string | null;
  nfce_cfop: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type HotelServiceInput = Omit<HotelService, 'id' | 'share_key' | 'created_at' | 'updated_at'> & {
  id?: string;
};

async function list(hotelId: string, includeInactive = false): Promise<HotelService[]> {
  let query = supabase
    .from('services')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HotelService[];
}

async function save(input: HotelServiceInput): Promise<HotelService> {
  const payload = { ...input, updated_at: new Date().toISOString() };
  if (input.id) {
    const { data, error } = await supabase
      .from('services')
      .update(payload)
      .eq('id', input.id)
      .select()
      .single();
    if (error) throw error;
    return data as HotelService;
  }
  const { data, error } = await supabase
    .from('services')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as HotelService;
}

async function setActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('services')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw error;
}

/** Campos copiados/empurrados no compartilhamento (identidade e flags locais ficam de fora). */
function shareableFields(svc: HotelService) {
  return {
    name: svc.name,
    description: svc.description,
    category: svc.category,
    pricing_mode: svc.pricing_mode,
    price: svc.price,
    lc116_code: svc.lc116_code,
    municipal_tax_code: svc.municipal_tax_code,
    cnae: svc.cnae,
    iss_rate: svc.iss_rate,
    iss_retained: svc.iss_retained,
    iss_exigibilidade: svc.iss_exigibilidade,
    nbs_code: svc.nbs_code,
    ibs_cbs_cst: (svc as any).ibs_cbs_cst ?? '000',
    ibs_cbs_cclasstrib: (svc as any).ibs_cbs_cclasstrib ?? '000001',
    nfce_eligible: (svc as any).nfce_eligible ?? false,
    nfce_ncm: (svc as any).nfce_ncm ?? null,
    nfce_cfop: (svc as any).nfce_cfop ?? '5102',
  };
}

/**
 * Compartilha um serviço com outras unidades do grupo.
 * mode 'copy': cria nas unidades onde ainda não existe (não toca cópias existentes).
 * mode 'push': cria OU sobrescreve as cópias com a versão atual (empurrar edição).
 * Retorna quantas unidades foram criadas/atualizadas.
 */
async function shareToHotels(
  service: HotelService,
  hotelIds: string[],
  mode: 'copy' | 'push',
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0, skipped = 0;

  const { data: existing } = await supabase
    .from('services')
    .select('id, hotel_id')
    .eq('share_key', service.share_key)
    .in('hotel_id', hotelIds);
  const existingByHotel = new Map((existing ?? []).map((e: { id: string; hotel_id: string }) => [e.hotel_id, e.id]));

  for (const hid of hotelIds) {
    const existingId = existingByHotel.get(hid);
    if (existingId) {
      if (mode === 'copy') { skipped++; continue; }
      const { error } = await supabase
        .from('services')
        .update({ ...shareableFields(service), updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await supabase
        .from('services')
        .insert({
          ...shareableFields(service),
          hotel_id: hid,
          share_key: service.share_key,
          is_active: true,
        });
      if (error) throw error;
      created++;
    }
  }

  return { created, updated, skipped };
}

export const serviceCatalogService = {
  list,
  save,
  setActive,
  remove,
  shareToHotels,
};

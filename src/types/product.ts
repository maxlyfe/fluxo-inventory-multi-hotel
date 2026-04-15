// src/types/product.ts
// Tipo centralizado de Produto

export interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
  category: string;
  updated_at: string;
  supplier?: string;
  image_url?: string;
  description?: string;
  is_active: boolean;
  hotel_id?: string;
  last_purchase_date?: string;
  last_purchase_price?: number;
  average_price?: number;
  is_portionable?: boolean;
  is_portion?: boolean;
  auto_portion_product_id?: string | null;
  auto_portion_multiplier?: number | null;
  is_starred?: boolean;
  unit_measure?: string;
  product_type?: string;
  mcu_code?: string;
  tax_percentage?: number;
  created_at?: string;
}

export const UNIT_MEASURE_OPTIONS = [
  { value: 'und', label: 'Unidade (und)' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'g', label: 'Grama (g)' },
  { value: 'l', label: 'Litro (l)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'cx', label: 'Caixa (cx)' },
  { value: 'pct', label: 'Pacote (pct)' },
] as const;

export const PRODUCT_TYPE_OPTIONS = [
  { value: 'consumo', label: 'Consumo' },
  { value: 'controle', label: 'Controle' },
] as const;

export const UNIT_MEASURE_LABELS: Record<string, string> = {
  und: 'und', kg: 'kg', g: 'g', l: 'l', ml: 'ml', cx: 'cx', pct: 'pct',
};

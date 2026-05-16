export type UnitType = 'g' | 'ml' | 'und' | 'kg' | 'l' | 'cx' | 'pct' | 'lt' | 'fardo' | 'saco' | 'caixa' | 'pote' | 'lata' | 'bisnaga' | 'sachê' | 'duzia';

export interface Ingredient {
  id: string;
  name: string;
  unit: UnitType;
  price_per_unit: number;
  purchase_qty_per_unit?: number; // quantas unidades de receita vêm em 1 embalagem comprada
  created_at: string;
  product_id?: string | null;
  hotel_id?: string | null;
}

export interface DishCategory {
  id: string;
  hotel_id: string | null;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface Side {
  id: string;
  name: string;
  created_at: string;
  hotel_id?: string | null;
}

export interface SideIngredient {
  id: string;
  side_id: string;
  ingredient_id: string;
  quantity: number;
  unit: UnitType;
  ingredient?: Ingredient;
}

export interface Dish {
  id: string;
  name: string;
  type: 'dish' | 'drink';
  category_id?: string | null;
  created_at: string;
  hotel_id?: string | null;
  production_sector_id?: string | null;
}

export interface DishIngredient {
  id: string;
  dish_id: string;
  ingredient_id: string;
  quantity: number;
  unit: UnitType;
  ingredient?: Ingredient;
}

export interface DishSide {
  id: string;
  dish_id: string;
  side_id: string;
  quantity: number;
  side?: Side;
}

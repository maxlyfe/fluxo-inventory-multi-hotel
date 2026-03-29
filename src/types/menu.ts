export type UnitType = 'g' | 'ml' | 'und';

export interface Ingredient {
  id: string;
  name: string;
  unit: UnitType;
  price_per_unit: number;
  created_at: string;
}

export interface Side {
  id: string;
  name: string;
  created_at: string;
}

export interface SideIngredient {
  id: string;
  side_id: string;
  ingredient_id: string;
  quantity: number;
  ingredient?: Ingredient;
}

export interface Dish {
  id: string;
  name: string;
  created_at: string;
}

export interface DishIngredient {
  id: string;
  dish_id: string;
  ingredient_id: string;
  quantity: number;
  ingredient?: Ingredient;
}

export interface DishSide {
  id: string;
  dish_id: string;
  side_id: string;
  quantity: number;
  side?: Side;
}

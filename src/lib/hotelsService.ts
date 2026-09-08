// src/lib/hotelsService.ts
//
// Fonte única para listar unidades. Toda tela que monta um seletor, filtro ou
// lista de hotéis deve passar por aqui.
//
// Por que existe: o RLS de `hotels` dá passe livre ao perfil dev
// (`is_dev_user(auth.uid())`), de propósito, porque o painel `/lyfe-dev`
// precisa enxergar todos os grupos. O efeito colateral é que qualquer
// `select` de `hotels` sem `.eq('group_id', ...)` devolve as unidades de
// TODOS os grupos quando quem está logado é o dev. Espalhado por 20 telas,
// isso vira vazamento de tenant: estando no grupo Meridiana apareciam
// unidades do grupo Teste.
//
// Regra: falha fechada. Sem grupo definido a lista volta vazia, nunca
// completa. Mostrar nada é um bug visível e sem risco; mostrar o grupo errado
// é um vazamento silencioso.
//
// A única exceção legítima é o painel do dev (`GroupsManagement.tsx`), que
// lista grupos e unidades de propósito e continua com query própria.

import { supabase } from './supabase';

export interface GroupHotel {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ListGroupHotelsOptions {
  /** Colunas do select. Padrão: 'id, name' */
  columns?: string;
  /** Incluir unidades ocultas (is_active = false). Padrão: false */
  includeInactive?: boolean;
  /** Remove uma unidade do resultado (útil em "transferir para outra unidade") */
  excludeHotelId?: string | null;
  /** Coluna de ordenação. Padrão: 'name' */
  orderBy?: string;
}

/**
 * Unidades de um grupo.
 *
 * `groupId` nulo devolve lista vazia por decisão de segurança, não por
 * descuido: ver o comentário do topo do arquivo.
 */
export async function listGroupHotels<T = GroupHotel>(
  groupId: string | null | undefined,
  options: ListGroupHotelsOptions = {},
): Promise<T[]> {
  if (!groupId) return [];

  const {
    columns = 'id, name',
    includeInactive = false,
    excludeHotelId = null,
    orderBy = 'name',
  } = options;

  // group_id entra sempre no select para que o filtro sobreviva mesmo se
  // alguém passar `columns` sem ele e quiser conferir o resultado.
  let query = supabase
    .from('hotels')
    .select(columns)
    .eq('group_id', groupId);

  if (!includeInactive) query = query.eq('is_active', true);
  if (excludeHotelId) query = query.neq('id', excludeHotelId);

  const { data, error } = await query.order(orderBy);
  if (error) throw error;
  return (data || []) as T[];
}

/**
 * Grupo ao qual uma unidade pertence.
 *
 * Serve para fluxos que só conhecem o hotel e precisam limitar uma lista ao
 * grupo dele: páginas públicas por token, por exemplo, que não têm o
 * GroupContext carregado.
 */
export async function getHotelGroupId(hotelId: string): Promise<string | null> {
  const { data } = await supabase
    .from('hotels')
    .select('group_id')
    .eq('id', hotelId)
    .maybeSingle();
  return (data?.group_id as string | undefined) ?? null;
}

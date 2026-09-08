// src/lib/fetchAllRows.ts
//
// Paginação de selects grandes.
//
// O PostgREST corta toda resposta em 1000 linhas por padrão, sem erro e sem
// aviso: o código recebe um array válido, só que incompleto. O sintoma aparece
// muito depois e disfarçado de outra coisa — "sumiu um produto da busca" —
// porque a lista veio ordenada e o corte cai no meio do alfabeto.
//
// Uso:
//   const products = await fetchAllRows<Product>((from, to) =>
//     supabase.from('products').select('*')
//       .eq('hotel_id', hotelId)
//       .order('name').order('id')
//       .range(from, to)
//   );

/** Teto de linhas por requisição imposto pelo PostgREST */
export const POSTGREST_PAGE_SIZE = 1000;

interface PagedResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

/**
 * Executa o mesmo select em páginas até esgotar as linhas.
 *
 * A função recebe uma fábrica de query em vez de uma query pronta porque o
 * builder do supabase-js é descartável: reaproveitar a mesma instância entre
 * páginas repetiria a primeira faixa.
 *
 * Sempre ordene por um critério único (ex.: `.order('name').order('id')`). Com
 * ordenação ambígua o Postgres pode devolver a mesma linha em duas páginas e
 * omitir outra.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PagedResult<T>>,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;

    const page = data || [];
    rows.push(...page);

    // Página incompleta significa fim do conjunto. Não dá para confiar em
    // `count`: a contagem exata custa caro e nem sempre vem na resposta.
    if (page.length < pageSize) break;
  }

  return rows;
}

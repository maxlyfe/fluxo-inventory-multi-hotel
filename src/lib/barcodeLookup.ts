import { supabase } from './supabase';

/**
 * Busca o produto vinculado a um código de barras.
 *
 * Tolerante a pequenas variações de formatação que causam falha de leitura
 * mesmo com o código "cadastrado": espaços/caracteres invisíveis vindos do
 * leitor, e o clássico descompasso UPC-A (12 dígitos) ↔ EAN-13 (13 dígitos,
 * com zero à esquerda) — alguns leitores/sistemas normalizam um formato e
 * não o outro. Também não quebra silenciosamente se o mesmo código estiver
 * cadastrado em mais de uma linha (o antigo `.maybeSingle()` retornava erro
 * e a busca era exibida como "não encontrado" mesmo com o código existindo).
 */
export async function findProductIdByBarcode(hotelId: string, rawBarcode: string): Promise<string | null> {
  const code = rawBarcode.trim();
  if (!code) return null;

  const candidates = new Set<string>([code]);
  const digitsOnly = code.replace(/\D/g, '');
  if (digitsOnly) {
    candidates.add(digitsOnly);
    const noLeadingZeros = digitsOnly.replace(/^0+/, '') || '0';
    candidates.add(noLeadingZeros);
    candidates.add(noLeadingZeros.padStart(12, '0')); // UPC-A
    candidates.add(noLeadingZeros.padStart(13, '0')); // EAN-13
  }

  const { data, error } = await supabase
    .from('product_barcodes')
    .select('product_id, barcode, products!inner(hotel_id)')
    .in('barcode', Array.from(candidates))
    .eq('products.hotel_id', hotelId);

  if (error) {
    console.error('Erro ao buscar código de barras:', error);
    return null;
  }
  if (!data || data.length === 0) return null;

  // Prioriza correspondência exata; senão usa a primeira encontrada entre as variações.
  const exact = data.find(r => r.barcode === code);
  return (exact || data[0]).product_id;
}

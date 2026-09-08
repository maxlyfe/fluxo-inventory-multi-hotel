// Utility function to normalize text for searching
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Function to check if a search term matches a target text
export function searchMatch(searchTerm: string, targetText: string): boolean {
  const normalizedSearch = normalizeText(searchTerm);
  const normalizedTarget = normalizeText(targetText);
  return normalizedTarget.includes(normalizedSearch);
}

/**
 * Casa todos os termos digitados, em qualquer ordem, contra um ou mais campos.
 *
 * `searchMatch` compara a frase inteira como substring, então "goma tapioca"
 * não acha "Tapioca de Goma". Numa lista de estoque, em que o nome do produto
 * quase nunca sai na ordem em que a pessoa pensa nele, isso derruba a busca.
 */
export function searchMatchAll(searchTerm: string, ...targets: (string | null | undefined)[]): boolean {
  const terms = normalizeText(searchTerm).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeText(targets.filter(Boolean).join(' '));
  return terms.every(t => haystack.includes(t));
}

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
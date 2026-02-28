import { useState, useMemo } from 'react';

/**
 * Opções de configuração para o hook useFilter.
 * @template T - Tipo dos itens na lista.
 */
interface FilterOptions<T> {
  /** Lista inicial de itens a serem filtrados. */
  initialItems: T[];
  /** Campos nos quais a busca textual será aplicada. */
  searchFields?: (keyof T)[];
  /** Campo usado para o filtro de categoria/tipo (opcional). */
  filterField?: keyof T;
}

/**
 * Hook personalizado para filtrar e buscar em uma lista de itens.
 * 
 * @template T - Tipo dos itens na lista.
 * @param {FilterOptions<T>} options - Opções de configuração do filtro.
 * @returns Objeto contendo o termo de busca, valor do filtro, funções para atualizá-los e a lista de itens filtrados.
 */
export const useFilter = <T extends Record<string, any>>({
  initialItems,
  searchFields = [], // Default to empty array if not provided
  filterField
}: FilterOptions<T>) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterValue, setFilterValue] = useState<string>(''); // State for the category/type filter value

  const filteredItems = useMemo(() => {
    // Start with the initial list
    let result = [...initialItems];

    // Apply category/type filter if filterField and filterValue are set
    if (filterField && filterValue) {
      result = result.filter(item => {
        const fieldValue = item[filterField];
        // Handle potential null/undefined values and case-insensitive comparison
        return fieldValue != null && String(fieldValue).toLowerCase() === filterValue.toLowerCase();
      });
    }

    // Apply search term filter if searchTerm is not empty
    if (searchTerm.trim() && searchFields.length > 0) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter(item => {
        // Check if any of the specified searchFields contain the searchTerm
        return searchFields.some(field => {
          const value = item[field];
          // Handle potential null/undefined values and case-insensitive comparison
          return value != null && String(value).toLowerCase().includes(searchLower);
        });
      });
    }

    return result;
  }, [initialItems, searchTerm, filterValue, filterField, searchFields]);

  return {
    searchTerm,
    setSearchTerm, // Function to update the search term
    filterValue,
    setFilterValue, // Function to update the filter value
    filteredItems // The resulting filtered list
  };
};

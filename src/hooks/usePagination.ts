import { useState, useMemo } from 'react';

/**
 * Opções de configuração para o hook usePagination.
 */
interface PaginationOptions {
  /** Número inicial de itens por página (padrão: 10). */
  initialPageSize?: number;
  /** Página inicial (padrão: 1). */
  initialPage?: number;
}

/**
 * Hook personalizado para gerenciar a paginação de uma lista de itens no lado do cliente.
 * 
 * @template T - Tipo dos itens na lista.
 * @param {T[]} items - A lista completa de itens a serem paginados.
 * @param {PaginationOptions} options - Opções de configuração da paginação.
 * @returns Objeto contendo o estado da paginação, a lista de itens paginados e funções para controlar a paginação.
 */
export const usePagination = <T>(
  items: T[],
  { initialPageSize = 10, initialPage = 1 }: PaginationOptions = {}
) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Calcula o número total de páginas com base no tamanho da lista e no tamanho da página
  const totalPages = useMemo(() => 
    Math.max(1, Math.ceil(items.length / pageSize)), 
    [items.length, pageSize]
  );

  // Garante que a página atual seja sempre válida (entre 1 e totalPages)
  // Isso é útil se a lista de itens ou o tamanho da página mudar
  useMemo(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    } else if (currentPage < 1) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Calcula os itens a serem exibidos na página atual
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return items.slice(startIndex, endIndex);
  }, [items, currentPage, pageSize]);

  // Funções para controlar a paginação
  const goToPage = (page: number) => {
    const validPage = Math.min(Math.max(1, page), totalPages);
    setCurrentPage(validPage);
  };

  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  // Função para alterar o número de itens por página
  const changePageSize = (newSize: number) => {
    const validSize = Math.max(1, newSize);
    setPageSize(validSize);
    // Resetar para a página 1 ao mudar o tamanho da página pode ser uma boa prática
    setCurrentPage(1); 
  };

  return {
    currentPage,      // A página atual
    pageSize,         // O número de itens por página
    totalPages,       // O número total de páginas
    paginatedItems,   // A lista de itens para a página atual
    goToPage,         // Função para ir para uma página específica
    nextPage,         // Função para ir para a próxima página
    prevPage,         // Função para ir para a página anterior
    changePageSize    // Função para alterar o tamanho da página
  };
};

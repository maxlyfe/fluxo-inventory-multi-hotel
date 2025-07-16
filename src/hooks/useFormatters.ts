/**
 * Hook personalizado para formatação de valores
 * 
 * Este hook fornece funções para formatar moeda, data e data/hora
 * de acordo com o padrão brasileiro.
 */
export const useFormatters = () => {
  /**
   * Formata um valor numérico como moeda brasileira (R$)
   * @param value - Valor numérico a ser formatado
   * @returns String formatada (ex: "R$ 1.234,56")
   */
  const formatCurrency = (value: number) => {
    // Adiciona verificação para evitar erros com valores não numéricos
    if (typeof value !== 'number' || isNaN(value)) {
      return ''; // Ou retorna um valor padrão como "R$ 0,00"
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  /**
   * Formata uma data no padrão brasileiro (dd/mm/aaaa)
   * @param date - Data a ser formatada (string ou objeto Date)
   * @returns String formatada (ex: "15/04/2025")
   */
  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      // Verifica se a data é válida
      if (isNaN(d.getTime())) return ''; 
      return new Intl.DateTimeFormat('pt-BR').format(d);
    } catch (error) {
      console.error("Erro ao formatar data:", date, error);
      return '';
    }
  };

  /**
   * Formata uma data e hora no padrão brasileiro (dd/mm/aaaa hh:mm)
   * @param date - Data a ser formatada (string ou objeto Date)
   * @returns String formatada (ex: "15/04/2025 14:30")
   */
  const formatDateTime = (date: string | Date | null | undefined) => {
    if (!date) return '';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      // Verifica se a data é válida
      if (isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(d);
    } catch (error) {
      console.error("Erro ao formatar data/hora:", date, error);
      return '';
    }
  };

  /**
   * Formata um número com casas decimais específicas
   * @param value - Valor numérico a ser formatado
   * @param decimals - Número de casas decimais (padrão: 2)
   * @returns String formatada (ex: "1.234,56")
   */
  const formatNumber = (value: number, decimals: number = 2) => {
    if (typeof value !== 'number' || isNaN(value)) {
      return '';
    }
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  };

  /**
   * Formata um número como percentual
   * @param value - Valor numérico a ser formatado (0.1 = 10%)
   * @param decimals - Número de casas decimais (padrão: 2)
   * @returns String formatada (ex: "10,00%")
   */
  const formatPercent = (value: number, decimals: number = 2) => {
    if (typeof value !== 'number' || isNaN(value)) {
      return '';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  };

  return {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatNumber,
    formatPercent
  };
};

import * as XLSX from 'xlsx';

/**
 * Opções de configuração para a exportação Excel.
 */
interface ExportOptions {
  /** Nome do arquivo (sem extensão, padrão: Export_YYYY-MM-DD). */
  fileName?: string;
  /** Nome da planilha (padrão: Sheet1). */
  sheetName?: string;
}

/**
 * Hook personalizado para exportar dados para um arquivo Excel (.xlsx).
 * 
 * @returns Objeto contendo a função `exportToExcel`.
 */
export const useExcelExport = () => {
  /**
   * Exporta uma lista de dados para um arquivo Excel.
   * 
   * @template T - Tipo dos itens nos dados originais.
   * @param {T[]} data - A lista de dados a serem exportados.
   * @param {(item: T) => Record<string, any>} mapper - Uma função que transforma cada item dos dados originais em um objeto onde as chaves são os cabeçalhos das colunas e os valores são os dados das células.
   * @param {ExportOptions} options - Opções de configuração para o nome do arquivo e da planilha.
   * @returns {boolean} - Retorna true se a exportação foi bem-sucedida, false caso contrário.
   */
  const exportToExcel = <T>(
    data: T[],
    mapper: (item: T) => Record<string, any>,
    options: ExportOptions = {}
  ): boolean => {
    try {
      // Define nomes padrão se não forem fornecidos
      const { 
        fileName = `Export_${new Date().toISOString().split('T')[0]}`, 
        sheetName = 'Sheet1' 
      } = options;
      
      // Mapeia os dados para o formato desejado usando a função mapper
      const mappedData = data.map(mapper);
      
      // Verifica se há dados para exportar após o mapeamento
      if (mappedData.length === 0) {
        console.warn('Nenhum dado para exportar após o mapeamento.');
        // Pode-se optar por retornar true ou false aqui, ou lançar um erro.
        // Retornar true pode ser interpretado como "operação concluída sem erros", mesmo sem arquivo.
        return true; 
      }
      
      // Cria a planilha a partir dos dados mapeados
      const worksheet = XLSX.utils.json_to_sheet(mappedData);
      
      // Cria um novo workbook
      const workbook = XLSX.utils.book_new();
      
      // Adiciona a planilha ao workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      
      // Escreve o workbook para um arquivo e dispara o download
      // O nome do arquivo incluirá a extensão .xlsx automaticamente
      XLSX.writeFile(workbook, `${fileName}.xlsx`);
      
      return true; // Indica sucesso
    } catch (error) {
      console.error('Erro ao exportar para Excel:', error);
      return false; // Indica falha
    }
  };
  
  return { exportToExcel };
};

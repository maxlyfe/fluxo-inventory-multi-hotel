import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';

interface ProductImport {
  nome: string;
  categoria: string;
  quantidade: number;
  minimo: number;
  maximo: number;
  descricao?: string;
  imagem_url?: string;
}

export const validateImportData = (data: any[]): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!Array.isArray(data) || data.length === 0) {
    return { isValid: false, errors: ['Planilha vazia ou formato inválido'] };
  }

  data.forEach((row, index) => {
    const lineNumber = index + 2; // +2 porque linha 1 é o cabeçalho

    if (!row.nome) {
      errors.push(`Linha ${lineNumber}: Nome é obrigatório`);
    }

    if (!row.categoria) {
      errors.push(`Linha ${lineNumber}: Categoria é obrigatória`);
    }

    if (typeof row.quantidade !== 'number' || row.quantidade < 0) {
      errors.push(`Linha ${lineNumber}: Quantidade deve ser um número maior ou igual a 0`);
    }

    if (typeof row.minimo !== 'number' || row.minimo < 0) {
      errors.push(`Linha ${lineNumber}: Quantidade mínima deve ser um número maior ou igual a 0`);
    }

    if (typeof row.maximo !== 'number' || row.maximo <= 0) {
      errors.push(`Linha ${lineNumber}: Quantidade máxima deve ser um número maior que 0`);
    }

    if (row.maximo <= row.minimo) {
      errors.push(`Linha ${lineNumber}: Quantidade máxima deve ser maior que a mínima`);
    }

    if (row.imagem_url && typeof row.imagem_url === 'string') {
      try {
        new URL(row.imagem_url);
      } catch {
        errors.push(`Linha ${lineNumber}: URL da imagem inválida`);
      }
    }
  });

  return { isValid: errors.length === 0, errors };
};

export const importInventory = async (file: File): Promise<{ success: boolean; message: string }> => {
  try {
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          // Validate data
          const validation = validateImportData(jsonData);
          if (!validation.isValid) {
            return resolve({
              success: false,
              message: `Erros encontrados:\n${validation.errors.join('\n')}`
            });
          }

          // Import products
          const { error } = await supabase
            .from('products')
            .insert(
              jsonData.map((row: ProductImport) => ({
                name: row.nome,
                category: row.categoria,
                quantity: row.quantidade,
                min_quantity: row.minimo,
                max_quantity: row.maximo,
                description: row.descricao,
                image_url: row.imagem_url
              }))
            );

          if (error) throw error;

          return resolve({
            success: true,
            message: `${jsonData.length} produtos importados com sucesso!`
          });
        } catch (err) {
          console.error('Error processing file:', err);
          return resolve({
            success: false,
            message: 'Erro ao processar arquivo. Verifique o formato e tente novamente.'
          });
        }
      };

      reader.onerror = () => {
        return resolve({
          success: false,
          message: 'Erro ao ler arquivo.'
        });
      };

      reader.readAsArrayBuffer(file);
    });
  } catch (err) {
    console.error('Import error:', err);
    return {
      success: false,
      message: 'Erro ao importar produtos. Por favor, tente novamente.'
    };
  }
};
import React, { useState } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';

interface ImportInventoryProps {
  onImportComplete: () => void;
}

const ImportInventory: React.FC<ImportInventoryProps> = ({ onImportComplete }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selectedHotel } = useHotel();

  const validateData = (data: any[]): { isValid: boolean; errors: string[] } => {
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

      if (typeof row.quantidade !== 'number' || isNaN(row.quantidade)) {
        errors.push(`Linha ${lineNumber}: Quantidade deve ser um número`);
      }

      if (typeof row.minimo !== 'number' || isNaN(row.minimo)) {
        errors.push(`Linha ${lineNumber}: Quantidade mínima deve ser um número`);
      }

      if (typeof row.maximo !== 'number' || isNaN(row.maximo)) {
        errors.push(`Linha ${lineNumber}: Quantidade máxima deve ser um número`);
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!selectedHotel?.id) {
        throw new Error('Hotel não selecionado');
      }

      setLoading(true);
      setError(null);

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          // Validate data
          const validation = validateData(jsonData);
          if (!validation.isValid) {
            setError(`Erros encontrados:\n${validation.errors.join('\n')}`);
            return;
          }

          // Import products
          const { error: importError } = await supabase
            .from('products')
            .insert(
              jsonData.map((row: any) => ({
                name: row.nome,
                category: row.categoria,
                quantity: row.quantidade,
                min_quantity: row.minimo,
                max_quantity: row.maximo,
                description: row.descricao,
                image_url: row.imagem_url,
                supplier: row.fornecedor,
                hotel_id: selectedHotel.id
              }))
            );

          if (importError) throw importError;

          alert(`${jsonData.length} produtos importados com sucesso!`);
          onImportComplete();
        } catch (err) {
          console.error('Error processing file:', err);
          setError('Erro ao processar arquivo. Verifique o formato e tente novamente.');
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error('Import error:', err);
      setError('Erro ao importar produtos. Por favor, tente novamente.');
    } finally {
      setLoading(false);
      // Clear input
      event.target.value = '';
    }
  };

  const downloadTemplate = () => {
    const template = [
      {
        nome: 'Exemplo Produto 1',
        categoria: 'Limpeza',
        quantidade: 10,
        minimo: 5,
        maximo: 50,
        fornecedor: 'Fornecedor A',
        descricao: 'Descrição opcional do produto',
        imagem_url: 'https://exemplo.com/imagem.jpg'
      },
      {
        nome: 'Exemplo Produto 2',
        categoria: 'Material',
        quantidade: 20,
        minimo: 10,
        maximo: 100,
        fornecedor: 'Fornecedor B'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'template_inventario.xlsx');
  };

  if (!selectedHotel) {
    return (
      <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex">
          <AlertTriangle className="h-5 w-5 text-red-400 mr-2" />
          <div className="text-sm text-red-800 dark:text-red-200">
            Por favor, selecione um hotel antes de importar produtos.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={downloadTemplate}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
        >
          ↓ Baixar template da planilha
        </button>
      </div>

      <div className="relative">
        <input
          type="file"
          onChange={handleFileUpload}
          accept=".xlsx,.xls"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={loading}
        />
        <div className={`
          border-2 border-dashed rounded-lg p-6
          ${loading ? 'border-gray-400 bg-gray-50' : 'border-blue-300 hover:border-blue-400'}
          flex flex-col items-center justify-center text-center
        `}>
          <Upload className={`h-8 w-8 mb-2 ${loading ? 'text-gray-400' : 'text-blue-500'}`} />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {loading ? 'Importando...' : 'Clique ou arraste a planilha aqui'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Formato: Excel (.xlsx, .xls)
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex">
            <AlertTriangle className="h-5 w-5 text-red-400 mr-2" />
            <div className="text-sm text-red-800 dark:text-red-200 whitespace-pre-line">
              {error}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportInventory;
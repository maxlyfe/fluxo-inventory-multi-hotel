import React from 'react';
import { Truck } from 'lucide-react';
import Fornecedores from '../../components/financial/Fornecedores';

export default function FornecedoresPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Truck className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Fornecedores
        </h1>
      </div>
      <Fornecedores />
    </div>
  );
}

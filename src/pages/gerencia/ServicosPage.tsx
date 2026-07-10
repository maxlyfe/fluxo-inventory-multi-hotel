// src/pages/gerencia/ServicosPage.tsx
// Casca da página Catálogo de Serviços (padrão FornecedoresPage)

import React from 'react';
import { ConciergeBell } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import ServiceCatalog from '../../components/servicos/ServiceCatalog';

const ServicosPage: React.FC = () => {
  const { selectedHotel } = useHotel();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl">
          <ConciergeBell className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Serviços</h1>
          <p className="text-sm text-gray-500">
            {selectedHotel?.name || ''} — catálogo de serviços com tributação para emissão de NFS-e
          </p>
        </div>
      </div>
      <ServiceCatalog />
    </div>
  );
};

export default ServicosPage;

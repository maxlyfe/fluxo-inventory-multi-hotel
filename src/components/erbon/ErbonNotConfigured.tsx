import React from 'react';
import { Link2Off, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';

interface ErbonNotConfiguredProps {
  hotelName?: string;
}

const ErbonNotConfigured: React.FC<ErbonNotConfiguredProps> = ({ hotelName }) => {
  const { isAdmin } = usePermissions();

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="p-4 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
        <Link2Off className="w-12 h-12 text-gray-400 dark:text-gray-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
        Erbon PMS não configurado
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">
        {hotelName
          ? `O hotel "${hotelName}" não possui integração com o Erbon PMS ativa.`
          : 'Este hotel não possui integração com o Erbon PMS ativa.'
        }
        {' '}Os dados desta página dependem da conexão com o sistema de gestão hoteleira.
      </p>
      {isAdmin && (
        <Link
          to="/admin/erbon"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <Settings className="w-4 h-4" />
          Configurar Erbon PMS
        </Link>
      )}
    </div>
  );
};

export default ErbonNotConfigured;

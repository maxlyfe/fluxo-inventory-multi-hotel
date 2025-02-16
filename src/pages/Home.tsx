import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, BarChart3, Building2 } from 'lucide-react';

const Home = () => {
  const [sectors, setSectors] = React.useState([]);

  React.useEffect(() => {
    const fetchSectors = async () => {
      const { data } = await supabase
        .from('sectors')
        .select('*')
        .neq('role', 'management')
        .neq('role', 'inventory');
      if (data) setSectors(data);
    };
    fetchSectors();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-8">Setores</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sectors.map((sector) => (
            <Link
              key={sector.id}
              to={`/sector/${sector.id}`}
              className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center space-x-3">
                <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <div>
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-white">{sector.name}</h2>
                  <p className="text-gray-600 dark:text-gray-300 mt-1">Ver requisições</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Área Administrativa</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            to="/admin"
            className="bg-blue-600 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center space-x-3">
              <Package className="h-6 w-6 text-white" />
              <div>
                <h2 className="text-xl font-semibold text-white">Estoque</h2>
                <p className="text-blue-100">Gerenciar requisições</p>
              </div>
            </div>
          </Link>
          <Link
            to="/management"
            className="bg-green-600 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center space-x-3">
              <BarChart3 className="h-6 w-6 text-white" />
              <div>
                <h2 className="text-xl font-semibold text-white">Gerência</h2>
                <p className="text-green-100">Relatórios e análises</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Home;
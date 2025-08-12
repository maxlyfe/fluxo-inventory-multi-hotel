import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';

/**
 * Interface para definir a estrutura de um objeto Hotel,
 * correspondendo à tabela 'hotels' no Supabase.
 */
interface Hotel {
  id: string;
  name: string;
  code: string;
  address: string | null;
  image_url: string | null;
  description: string | null;
}

const HotelSelection = () => {
  const navigate = useNavigate();
  const { setSelectedHotel } = useHotel();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Efeito para buscar a lista de hotéis do Supabase quando o componente é montado.
   */
  useEffect(() => {
    const fetchHotels = async () => {
      try {
        setLoading(true);
        setError(null);

        // --- ALTERAÇÃO: Ordenação por ID ---
        // A consulta agora ordena os hotéis pela coluna 'id' em ordem ascendente,
        // em vez de 'name'. Isso garante uma ordem de exibição consistente e previsível.
        const { data, error: fetchError } = await supabase
          .from('hotels')
          .select('*')
          .order('id', { ascending: true });

        if (fetchError) {
          throw fetchError;
        }

        setHotels(data || []);

      } catch (err: any) {
        console.error("Erro ao buscar hotéis:", err);
        setError("Não foi possível carregar a lista de hotéis. Tente novamente mais tarde.");
      } finally {
        setLoading(false);
      }
    };

    fetchHotels();
  }, []);

  /**
   * Salva o hotel selecionado no contexto global e navega para a página inicial.
   * @param hotel - O objeto do hotel selecionado.
   */
  const handleSelectHotel = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    navigate('/');
  };

  // Renderização de estado de carregamento
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="mt-4 text-gray-600 dark:text-gray-300">Carregando unidades...</p>
      </div>
    );
  }

  // Renderização de estado de erro
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">Ocorreu um Erro</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <Building2 className="mx-auto h-12 w-12 text-blue-600 dark:text-blue-400" />
          <h1 className="mt-4 text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            Meridiana Hoteles
          </h1>
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            Selecione a unidade para continuar
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {hotels.map((hotel) => (
            <button
              key={hotel.id}
              onClick={() => handleSelectHotel(hotel)}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              <div className="relative">
                <img
                  className="h-48 w-full object-cover"
                  src={hotel.image_url || `https://placehold.co/600x400/e2e8f0/a0aec0?text=${hotel.code}`}
                  alt={`Fachada do ${hotel.name}`}
                  onError={(e) => { (e.target as HTMLImageElement).src = `https://placehold.co/600x400/e2e8f0/a0aec0?text=${hotel.code}`; }}
                />
                <div className="absolute top-0 right-0 m-3">
                  <span className="px-3 py-1 bg-black bg-opacity-50 text-white text-sm font-medium rounded-md backdrop-blur-sm">
                    {hotel.code}
                  </span>
                </div>
              </div>
              <div className="p-6 flex flex-col flex-grow">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  {hotel.name}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 flex-grow overflow-hidden">
                  {hotel.description || 'Descrição não disponível.'}
                </p>
                <div className="flex items-start space-x-2 text-gray-500 dark:text-gray-400 text-sm mb-4">
                  <MapPin className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <span className="overflow-hidden overflow-ellipsis">{hotel.address || 'Endereço não informado.'}</span>
                </div>
                <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-end text-blue-600 dark:text-blue-400">
                        <span className="font-medium text-sm">Acessar Sistema</span>
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HotelSelection;

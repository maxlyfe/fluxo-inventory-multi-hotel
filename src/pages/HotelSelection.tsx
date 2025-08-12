import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
// Importa a instância do Supabase para fazer a consulta ao banco de dados.
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';

/**
 * Interface para definir a estrutura de um objeto Hotel.
 * Estes campos correspondem às colunas da tabela 'hotels' no Supabase.
 * NOTA: As colunas 'image_url' e 'description' são esperadas pela UI.
 * É necessário adicioná-las à sua tabela 'hotels' no Supabase para que as imagens e descrições apareçam.
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

  // --- ALTERAÇÃO: Estados para gerenciar os dados dinâmicos ---
  // Estado para armazenar a lista de hotéis buscada do banco de dados.
  const [hotels, setHotels] = useState<Hotel[]>([]);
  // Estado para controlar a exibição do indicador de carregamento.
  const [loading, setLoading] = useState(true);
  // Estado para armazenar qualquer mensagem de erro que ocorra durante a busca.
  const [error, setError] = useState<string | null>(null);

  /**
   * Efeito que é executado uma vez quando o componente é montado.
   * Sua responsabilidade é buscar a lista de hotéis do Supabase.
   */
  useEffect(() => {
    // Função assíncrona para buscar os hotéis.
    const fetchHotels = async () => {
      try {
        setLoading(true);
        setError(null);

        // Consulta à tabela 'hotels' no Supabase.
        // Seleciona todas as colunas (*) e ordena os resultados pelo nome do hotel.
        const { data, error: fetchError } = await supabase
          .from('hotels')
          .select('*')
          .order('name', { ascending: true });

        // Se ocorrer um erro na consulta, ele é lançado para ser capturado pelo bloco catch.
        if (fetchError) {
          throw fetchError;
        }

        // Armazena os dados dos hotéis no estado.
        setHotels(data || []);

      } catch (err: any) {
        // Em caso de erro, exibe uma mensagem no console e atualiza o estado de erro.
        console.error("Erro ao buscar hotéis:", err);
        setError("Não foi possível carregar a lista de hotéis. Tente novamente mais tarde.");
      } finally {
        // Garante que o indicador de carregamento seja desativado ao final do processo.
        setLoading(false);
      }
    };

    fetchHotels();
  }, []); // O array vazio [] garante que este efeito rode apenas uma vez.

  /**
   * Função chamada quando o usuário clica em um card de hotel.
   * Ela salva o hotel selecionado no contexto global e navega para a página inicial.
   * @param hotel - O objeto do hotel que foi selecionado.
   */
  const handleSelectHotel = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    navigate('/');
  };

  // --- RENDERIZAÇÃO CONDICIONAL: Exibe um indicador de carregamento enquanto os dados são buscados. ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="mt-4 text-gray-600 dark:text-gray-300">Carregando unidades...</p>
      </div>
    );
  }

  // --- RENDERIZAÇÃO CONDICIONAL: Exibe uma mensagem de erro se a busca falhar. ---
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

        {/* --- ALTERAÇÃO: Mapeia a lista de hotéis vinda do estado (banco de dados) --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {hotels.map((hotel) => (
            <div
              key={hotel.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700"
            >
              <div className="relative">
                <img
                  className="h-48 w-full object-cover"
                  // Usa a imagem do banco de dados ou um placeholder se não houver imagem.
                  src={hotel.image_url || `https://placehold.co/600x400/e2e8f0/a0aec0?text=${hotel.code}`}
                  alt={`Fachada do ${hotel.name}`}
                  // Fallback para o placeholder caso a URL da imagem falhe.
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
                  {/* Usa a descrição do banco de dados ou uma mensagem padrão. */}
                  {hotel.description || 'Descrição não disponível.'}
                </p>
                <div className="flex items-start space-x-2 text-gray-500 dark:text-gray-400 text-sm mb-4">
                  <MapPin className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <span className="overflow-hidden overflow-ellipsis">{hotel.address || 'Endereço não informado.'}</span>
                </div>
                <button
                  onClick={() => handleSelectHotel(hotel)}
                  className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                >
                  <span className="font-medium">Acessar Sistema</span>
                  <ArrowRight className="ml-2 h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HotelSelection;

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, ArrowRight, Loader2, AlertTriangle, PlusCircle, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';

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

/**
 * Interface para os dados do formulário de novo hotel.
 */
interface NewHotelData {
  name: string;
  code: string;
  address: string;
  description: string;
  image_url: string;
}

const HotelSelection = () => {
  const navigate = useNavigate();
  const { setSelectedHotel } = useHotel();
  const { user } = useAuth();
  const { addNotification } = useNotification();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddHotelModal, setShowAddHotelModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newHotel, setNewHotel] = useState<NewHotelData>({
    name: '',
    code: '',
    address: '',
    description: '',
    image_url: '',
  });

  /**
   * Busca a lista de hotéis do Supabase.
   * Envolvida em useCallback para ser chamada de forma estável.
   */
  const fetchHotels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

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
  }, []);

  useEffect(() => {
    fetchHotels();
  }, [fetchHotels]);

  /**
   * Salva o hotel selecionado no contexto e navega para a home.
   */
  const handleSelectHotel = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    navigate('/');
  };

  /**
   * Lida com a mudança nos campos do formulário de novo hotel.
   */
  const handleNewHotelChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewHotel(prev => ({ ...prev, [name]: value }));
  };

  /**
   * Envia os dados do novo hotel para o Supabase.
   */
  const handleCreateHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHotel.name || !newHotel.code) {
      addNotification('error', 'Nome e Código são obrigatórios.');
      return;
    }

    setIsSaving(true);
    try {
      const { error: insertError } = await supabase
        .from('hotels')
        .insert([newHotel]);

      if (insertError) throw insertError;

      addNotification('success', 'Novo hotel adicionado com sucesso!');
      setShowAddHotelModal(false);
      setNewHotel({ name: '', code: '', address: '', description: '', image_url: '' });
      fetchHotels();

    } catch (err: any) {
      console.error("Erro ao criar hotel:", err);
      addNotification('error', `Erro ao criar hotel: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
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
    // --- ALTERAÇÃO: Adicionado 'relative' ao container principal para posicionar o botão flutuante. ---
    <div className="relative min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
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

      {/* --- ALTERAÇÃO: Botão de Adicionar Hotel movido e reestilizado --- */}
      {/* O botão agora é um Floating Action Button (FAB), posicionado no canto inferior direito. */}
      {/* Ele é mais sutil e segue um padrão de design moderno para ações de adição. */}
      {user?.role === 'admin' && (
        <button
          onClick={() => setShowAddHotelModal(true)}
          className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 flex items-center justify-center w-14 h-14 bg-green-600 text-white rounded-full shadow-lg hover:bg-green-700 transition-all duration-300 transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          aria-label="Adicionar Novo Hotel"
          title="Adicionar Novo Hotel"
        >
          <PlusCircle className="h-7 w-7" />
        </button>
      )}

      {/* O modal de adição de hotel permanece o mesmo */}
      {showAddHotelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Cadastrar Novo Hotel
              </h2>
              <button onClick={() => setShowAddHotelModal(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateHotel} className="flex-grow overflow-y-auto p-6 space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Hotel*</label>
                <input id="name" name="name" type="text" value={newHotel.name} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
              </div>
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código (Ex: CS)*</label>
                <input id="code" name="code" type="text" value={newHotel.code} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
              </div>
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endereço</label>
                <input id="address" name="address" type="text" value={newHotel.address} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
                <textarea id="description" name="description" value={newHotel.description} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" rows={3}></textarea>
              </div>
              <div>
                <label htmlFor="image_url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL da Imagem</label>
                <input id="image_url" name="image_url" type="url" value={newHotel.image_url} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" placeholder="https://..." />
              </div>
            </form>
            <div className="flex-shrink-0 flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={() => setShowAddHotelModal(false)} className="px-4 py-2 border dark:border-gray-600 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
              <button type="submit" onClick={handleCreateHotel} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center justify-center disabled:opacity-50">
                {isSaving && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                Salvar Hotel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HotelSelection;

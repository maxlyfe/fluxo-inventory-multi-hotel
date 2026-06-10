import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Building2, MapPin, ArrowRight, Loader2, AlertTriangle, PlusCircle, X, LogIn, EyeOff, Eye, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import { usePermissions } from '../hooks/usePermissions';
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
  is_active?: boolean;
  group_id?: string | null;
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
  group_id: string;
}

interface GroupOption { id: string; name: string; }

const HotelSelection = () => {
  const navigate = useNavigate();
  const { setSelectedHotel } = useHotel();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const { isDev } = usePermissions();
  const { addNotification } = useNotification();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddHotelModal, setShowAddHotelModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [busyHotelId, setBusyHotelId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Hotel | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [newHotel, setNewHotel] = useState<NewHotelData>({
    name: '',
    code: '',
    address: '',
    description: '',
    image_url: '',
    group_id: '',
  });
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);

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

  // Dev: carrega grupos para escolher ao criar hotel
  useEffect(() => {
    if (!isDev) return;
    supabase.from('groups').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setGroupOptions(data || []));
  }, [isDev]);

  /**
   * Salva o hotel selecionado no contexto.
   * - Autenticado   → dashboard (/)
   * - Não autenticado → seleção de setor público (/public/sectors)
   */
  const handleSelectHotel = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    navigate(user ? '/' : '/public/sectors');
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
    if (!newHotel.group_id) {
      addNotification('error', 'Selecione o grupo do hotel.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: newHotel.name,
        code: newHotel.code,
        address: newHotel.address || null,
        description: newHotel.description || null,
        image_url: newHotel.image_url || null,
        group_id: newHotel.group_id,
      };
      const { error: insertError } = await supabase
        .from('hotels')
        .insert([payload]);

      if (insertError) throw insertError;

      addNotification('success', 'Novo hotel adicionado com sucesso!');
      setShowAddHotelModal(false);
      setNewHotel({ name: '', code: '', address: '', description: '', image_url: '', group_id: '' });
      fetchHotels();

    } catch (err: any) {
      console.error("Erro ao criar hotel:", err);
      addNotification('error', `Erro ao criar hotel: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Ocultar / reativar hotel (soft hide — preserva histórico)
  const handleToggleActive = async (hotel: Hotel) => {
    const newActive = hotel.is_active === false; // se estava oculto, reativa
    setBusyHotelId(hotel.id);
    try {
      const { error: err } = await supabase
        .from('hotels')
        .update({ is_active: newActive })
        .eq('id', hotel.id);
      if (err) throw err;
      addNotification(newActive ? `${hotel.name} reativado.` : `${hotel.name} ocultado. O histórico foi preservado.`, 'success');
      fetchHotels();
    } catch (err: any) {
      addNotification('Erro ao atualizar hotel: ' + err.message, 'error');
    } finally {
      setBusyHotelId(null);
    }
  };

  // Exclusão definitiva (confirmada digitando o código do hotel)
  const handleDeleteHotel = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from('hotels').delete().eq('id', deleteTarget.id);
      if (err) throw err;
      addNotification(`Hotel ${deleteTarget.name} excluído definitivamente.`, 'success');
      setDeleteTarget(null);
      setDeleteConfirmCode('');
      fetchHotels();
    } catch (err: any) {
      addNotification(
        'Não foi possível excluir: ' + (err.message?.includes('foreign key') || err.code === '23503'
          ? 'há dados vinculados (funcionários, produtos, etc.). Use "Ocultar" em vez de excluir.'
          : err.message),
        'error',
      );
    } finally {
      setDeleting(false);
    }
  };

  // Usuários comuns só veem hotéis ativos; o dev vê todos (para gerenciar)
  // Filtra pelo GRUPO ATUAL (inclusive para o dev — evita misturar hotéis de
  // grupos diferentes). Mantém a regra de ocultos (dev vê ocultos do grupo).
  const groupId = currentGroup?.id;
  const visibleHotels = hotels
    .filter(h => !groupId || h.group_id === groupId)
    .filter(h => isDev ? true : h.is_active !== false);

  // Sem login → landing de marketing (anônimo não vê unidades de ninguém)
  if (!user) return <Navigate to="/" replace />;

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
            {currentGroup?.name || 'LyFe Hoteles'}
          </h1>
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            Selecione a unidade para continuar
          </p>
          {!user && (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <LogIn className="h-4 w-4" /> Entrar com conta
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visibleHotels.map((hotel) => {
            const hidden = hotel.is_active === false;
            return (
            <div
              key={hotel.id}
              className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg transition-all duration-300 flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700 ${hidden ? 'opacity-60 grayscale' : 'hover:shadow-2xl hover:-translate-y-1'}`}
            >
              {/* Área clicável (selecionar hotel) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleSelectHotel(hotel)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectHotel(hotel); } }}
                className="flex flex-col flex-grow text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
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
                  {hidden && (
                    <div className="absolute top-0 left-0 m-3">
                      <span className="px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-md flex items-center gap-1 shadow">
                        <EyeOff className="h-3 w-3" /> OCULTO
                      </span>
                    </div>
                  )}
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
              </div>

              {/* Ações do dev */}
              {isDev && (
                <div className="flex border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => handleToggleActive(hotel)}
                    disabled={busyHotelId === hotel.id}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-colors disabled:opacity-50 ${
                      hidden ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                    }`}
                  >
                    {busyHotelId === hotel.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {hidden ? 'Reativar' : 'Ocultar'}
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(hotel); setDeleteConfirmCode(''); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-l border-gray-200 dark:border-gray-700 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* --- ALTERAÇÃO: Botão de Adicionar Hotel movido e reestilizado --- */}
      {/* O botão agora é um Floating Action Button (FAB), posicionado no canto inferior direito. */}
      {/* Ele é mais sutil e segue um padrão de design moderno para ações de adição. */}
      {isDev && (
        <button
          onClick={() => setShowAddHotelModal(true)}
          className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 flex items-center justify-center w-14 h-14 bg-green-600 text-white rounded-full shadow-lg hover:bg-green-700 transition-all duration-300 transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          aria-label="Adicionar Novo Hotel"
          title="Adicionar Novo Hotel"
        >
          <PlusCircle className="h-7 w-7" />
        </button>
      )}

      {/* Modal — confirmação de exclusão definitiva */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Excluir {deleteTarget.name}?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  Esta ação é <strong>definitiva e irreversível</strong>. Todo o histórico vinculado pode ser perdido.
                  Se quer apenas tirar o acesso, use <strong>Ocultar</strong>.
                </p>
              </div>
            </div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
              Digite o código <span className="font-mono font-bold text-gray-700 dark:text-gray-200">{deleteTarget.code}</span> para confirmar
            </label>
            <input
              type="text"
              value={deleteConfirmCode}
              onChange={(e) => setDeleteConfirmCode(e.target.value)}
              placeholder={deleteTarget.code}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteConfirmCode(''); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteHotel}
                disabled={deleting || deleteConfirmCode.trim().toUpperCase() !== deleteTarget.code.toUpperCase()}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
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
                <label htmlFor="group_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grupo*</label>
                <select id="group_id" name="group_id" value={newHotel.group_id} onChange={handleNewHotelChange} className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                  <option value="">Selecione o grupo…</option>
                  {groupOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {groupOptions.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">Nenhum grupo cadastrado. Crie um em Configurações → Grupos.</p>
                )}
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

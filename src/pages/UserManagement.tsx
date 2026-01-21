// Importações de bibliotecas e componentes.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Users, Key, AlertTriangle, UserCog, Bell, PlusCircle, Trash2, Edit3, XCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// --- Interfaces de Dados ---
interface User {
  id: string; 
  email: string;
  role: string; 
  last_sign_in_at: string; 
  raw_user_meta_data?: { role?: string };
}

interface NotificationType {
  id: string;
  event_key: string;
  description: string;
  icon?: string;
  requires_hotel_filter?: boolean; 
  requires_sector_filter?: boolean;
}

interface Hotel {
  id: string;
  name: string;
}

interface Sector {
  id: string;
  name: string;
  hotel_id?: string; 
}

interface UserNotificationPreference {
  id: string;
  user_id: string; 
  notification_type_id: string;
  hotel_id?: string | null;
  sector_id?: string | null;
  is_active: boolean;
  created_by?: string | null; 
  notification_types?: { 
    description: string;
    event_key: string;
  };
  hotels?: { 
    name: string;
  } | null;
  sectors?: { 
    name: string;
  } | null;
}

const ACTIVE_NOTIFICATION_TYPES = [
  'NEW_REQUEST',
  'ITEM_DELIVERED_TO_SECTOR',
  'REQUEST_REJECTED',
  'REQUEST_SUBSTITUTED',
  'NEW_BUDGET',
  'BUDGET_APPROVED',
  'BUDGET_CANCELLED',
  'EXP_CONTRACT_ENDING_SOON',
  'EXP_CONTRACT_ENDS_TODAY'
];

// --- Funções de Serviço ---
async function getNotificationTypes(): Promise<NotificationType[]> {
  const { data, error } = await supabase.from('notification_types').select('*').order('description');
  if (error) throw error;
  return (data || [])
    .filter(nt => ACTIVE_NOTIFICATION_TYPES.includes(nt.event_key))
    .map(nt => ({
      ...nt,
      requires_hotel_filter: ['NEW_REQUEST', 'ITEM_DELIVERED_TO_SECTOR', 'NEW_BUDGET', 'BUDGET_APPROVED', 'BUDGET_CANCELLED', 'EXP_CONTRACT_ENDING_SOON', 'EXP_CONTRACT_ENDS_TODAY'].includes(nt.event_key),
      requires_sector_filter: ['NEW_REQUEST', 'ITEM_DELIVERED_TO_SECTOR'].includes(nt.event_key),
    }));
}

async function getHotels(): Promise<Hotel[]> {
  const { data, error } = await supabase.from('hotels').select('id, name').order('name');
  if (error) throw error;
  return data || [];
}

async function getSectors(hotelId?: string): Promise<Sector[]> {
  let query = supabase.from('sectors').select('id, name, hotel_id').order('name');
  if (hotelId) query = query.eq('hotel_id', hotelId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getUserNotificationPreferences(userAuthId: string): Promise<UserNotificationPreference[]> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .select(`id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types (description, event_key), hotels (name), sectors (name)`)
    .eq('user_id', userAuthId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function addUserNotificationPreference(preference: any) {
  const { data, error } = await supabase.from('user_notification_preferences').insert(preference).select(`id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types (description, event_key), hotels (name), sectors (name)`).single();
  if (error) throw error;
  return data;
}

async function updateUserNotificationPreference(id: string, updates: any) {
  const { data, error } = await supabase.from('user_notification_preferences').update(updates).eq('id', id).select(`id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types (description, event_key), hotels (name), sectors (name)`).single();
  if (error) throw error;
  return data;
}

async function deleteUserNotificationPreference(id: string) {
  const { error } = await supabase.from('user_notification_preferences').delete().eq('id', id);
  if (error) throw error;
}

async function checkSupabaseAuthUserExists(userAuthId: string): Promise<boolean> {
  if (!userAuthId) return false;
  const { data, error } = await supabase.rpc('check_supabase_auth_user_exists', { p_user_id: userAuthId });
  if (error) return false; 
  return data as boolean;
}

const UserManagement = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user: adminUser, supabaseUser } = useAuth(); 
  const navigate = useNavigate();
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'inventory' });
  const [changePassword, setChangePassword] = useState({ userId: '', newPassword: '', confirmPassword: '' });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [changeRole, setChangeRole] = useState({ userId: '', email: '', currentRole: '', newRole: '' });

  const [showNotificationPrefsModal, setShowNotificationPrefsModal] = useState(false);
  const [selectedUserForNotifications, setSelectedUserForNotifications] = useState<User | null>(null);
  const [notificationTypes, setNotificationTypes] = useState<NotificationType[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [userPreferences, setUserPreferences] = useState<UserNotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [currentPreference, setCurrentPreference] = useState<Partial<UserNotificationPreference>>({});
  const [isEditingPreference, setIsEditingPreference] = useState(false);
  const [showAddPreferenceForm, setShowAddPreferenceForm] = useState(false);
  const [selectedHotelForFilter, setSelectedHotelForFilter] = useState<string | undefined>(undefined);
  const [allSectorsSelected, setAllSectorsSelected] = useState(false);

  useEffect(() => {
    const isAdmin = adminUser?.role === 'admin' || supabaseUser?.user_metadata?.role === 'admin';
    if (!adminUser || !isAdmin) {
      navigate('/');
      return;
    }
    fetchUsers();
    getNotificationTypes().then(setNotificationTypes).catch(() => setError('Falha ao carregar tipos de notificação.'));
    getHotels().then(setHotels).catch(() => setError('Falha ao carregar hotéis.'));
    getSectors().then(setSectors).catch(() => setError('Falha ao carregar setores.'));
  }, [adminUser, supabaseUser, navigate]);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase.rpc('get_all_users_with_profile');
      if (fetchError) throw fetchError;
      setUsers((data || []).map((item: any) => ({
        id: item.id,
        email: item.email,
        role: item.role || 'user',
        last_sign_in_at: item.last_sign_in_at,
        raw_user_meta_data: item.raw_user_meta_data,
      })));
    } catch (err: any) {
      setError('Erro ao carregar usuários: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newUser.email || !newUser.password || !newUser.role) {
      setError('Preencha todos os campos');
      return;
    }

    try {
      // Chama a nova RPC create_user_v2 que criamos
      const { data, error: createError } = await supabase.rpc('create_user_v2', {
        p_email: newUser.email,
        p_password: newUser.password,
        p_role: newUser.role
      });

      if (createError) throw createError;
      if (data && data.error) throw new Error(data.error);

      setNewUser({ email: '', password: '', role: 'inventory' });
      fetchUsers(); 
      alert('Usuário criado com sucesso!');
    } catch (err: any) {
      setError('Erro ao criar usuário: ' + err.message);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (changePassword.newPassword !== changePassword.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }
    try {
      // Chama a nova RPC admin_change_password que criamos
      const { data, error: pwdError } = await supabase.rpc('admin_change_password', {
        p_user_id: changePassword.userId,
        p_new_password: changePassword.newPassword
      });

      if (pwdError) throw pwdError;
      if (data && data.error) throw new Error(data.error);

      setChangePassword({ userId: '', newPassword: '', confirmPassword: '' });
      setShowChangePassword(false);
      alert('Senha alterada com sucesso!');
    } catch (err: any) {
      setError('Erro ao alterar senha: ' + err.message);
    }
  };

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { error: profileRoleError } = await supabase
        .from('profiles')
        .update({ role: changeRole.newRole })
        .eq('id', changeRole.userId); 

      if (profileRoleError) throw profileRoleError;

      await fetchUsers();
      setChangeRole({ userId: '', email: '', currentRole: '', newRole: '' });
      setShowChangeRole(false);
      alert('Função atualizada com sucesso!');
    } catch (err: any) {
      setError('Erro ao alterar função: ' + err.message);
    }
  };

  const getRoleName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'inventory': return 'Estoque';
      case 'management': return 'Gerência';
      case 'sup-governanca': return 'Supervisão de Governança';
      default: return role;
    }
  };

  const openNotificationPrefsModal = async (user: User) => {
    setSelectedUserForNotifications(user);
    setShowNotificationPrefsModal(true);
    setLoadingPrefs(true);
    setShowAddPreferenceForm(false);
    setError('');
    try {
      const prefs = await getUserNotificationPreferences(user.id);
      setUserPreferences(prefs);
    } catch (err: any) {
      setError('Falha ao carregar preferências: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleSavePreference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForNotifications || !currentPreference.notification_type_id) return;
    setLoadingPrefs(true);
    try {
      const prefToSave: any = {
        user_id: selectedUserForNotifications.id, 
        notification_type_id: currentPreference.notification_type_id,
        hotel_id: currentPreference.hotel_id || null,
        sector_id: allSectorsSelected ? null : currentPreference.sector_id || null,
        is_active: currentPreference.is_active !== false,
        created_by: supabaseUser?.id || null 
      };

      if (isEditingPreference && currentPreference.id) {
        await updateUserNotificationPreference(currentPreference.id, prefToSave);
      } else {
        await addUserNotificationPreference(prefToSave);
      }

      const prefs = await getUserNotificationPreferences(selectedUserForNotifications.id);
      setUserPreferences(prefs);
      setShowAddPreferenceForm(false);
      setCurrentPreference({});
      setIsEditingPreference(false);
    } catch (err: any) {
      setError('Erro ao salvar preferência: ' + err.message); 
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleEditPreference = (preference: UserNotificationPreference) => {
    const selectedType = notificationTypes.find(nt => nt.id === preference.notification_type_id);
    if (selectedType?.requires_hotel_filter && preference.hotel_id) {
        getSectors(preference.hotel_id).then(setSectors);
        setSelectedHotelForFilter(preference.hotel_id);
    }
    setCurrentPreference(preference);
    setIsEditingPreference(true);
    setShowAddPreferenceForm(true);
    setAllSectorsSelected(preference.hotel_id !== null && preference.sector_id === null);
  };

  const handleDeletePreference = async (id: string) => {
    if (!window.confirm('Remover esta preferência?')) return;
    try {
      await deleteUserNotificationPreference(id);
      const prefs = await getUserNotificationPreferences(selectedUserForNotifications!.id);
      setUserPreferences(prefs);
    } catch (err: any) {
      setError('Erro ao remover: ' + err.message);
    }
  };

  const handleNotificationTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const typeId = e.target.value;
    const selectedType = notificationTypes.find(nt => nt.id === typeId);
    setCurrentPreference(prev => ({ ...prev, notification_type_id: typeId }));
    if (!selectedType?.requires_hotel_filter) setSelectedHotelForFilter(undefined);
  };

  const handleHotelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const hotelId = e.target.value;
    setCurrentPreference(prev => ({ ...prev, hotel_id: hotelId, sector_id: undefined }));
    setSelectedHotelForFilter(hotelId);
    if (hotelId) getSectors(hotelId).then(setSectors);
  };

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "all_sectors") {
      setAllSectorsSelected(true);
      setCurrentPreference(prev => ({ ...prev, sector_id: undefined }));
    } else {
      setAllSectorsSelected(false);
      setCurrentPreference(prev => ({ ...prev, sector_id: val }));
    }
  };

  const getNotificationTypeDescription = (eventKey: string) => {
    switch (eventKey) {
      case 'NEW_REQUEST': return 'Nova requisição';
      case 'ITEM_DELIVERED_TO_SECTOR': return 'Item entregue';
      case 'REQUEST_REJECTED': return 'Requisição rejeitada';
      case 'REQUEST_SUBSTITUTED': return 'Requisição substituída';
      case 'NEW_BUDGET': return 'Novo orçamento';
      case 'BUDGET_APPROVED': return 'Orçamento aprovado';
      case 'BUDGET_CANCELLED': return 'Orçamento cancelado';
      case 'EXP_CONTRACT_ENDING_SOON': return 'Contrato de Experiência (5 dias)';
      case 'EXP_CONTRACT_ENDS_TODAY': return 'Contrato de Experiência (Hoje)';
      default: return eventKey;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
          <Users className="h-7 w-7 text-blue-600 dark:text-blue-400 mr-3" />
          Gerenciamento de Usuários
        </h1>
        <button onClick={() => navigate("/")} className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600">Voltar</button>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md flex items-center">
          <AlertTriangle className="h-5 w-5 mr-2" />
          <p>{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Criar Novo Usuário</h2>
        <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
            <input type="password" value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Função</label>
            <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white">
              <option value="inventory">Estoque</option>
              <option value="management">Gerência</option>
              <option value="sup-governanca">Supervisão de Governança</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Criar Usuário</button>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Usuários Cadastrados</h2>
        {loading ? (
          <div className="text-center py-4"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-300">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-300">Função</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-gray-300">Último Login</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-gray-300">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">{user.email}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">{getRoleName(user.role)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : 'Nunca'}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button onClick={() => { setChangePassword({userId: user.id, newPassword: '', confirmPassword: ''}); setShowChangePassword(true); }} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400"><Key className="h-5 w-5" /></button>
                      <button onClick={() => { setChangeRole({userId: user.id, email: user.email, currentRole: user.role, newRole: user.role}); setShowChangeRole(true); }} className="text-amber-600 hover:text-amber-900 dark:text-amber-400"><UserCog className="h-5 w-5" /></button>
                      <button onClick={() => openNotificationPrefsModal(user)} className="text-blue-600 hover:text-blue-900 dark:text-blue-400"><Bell className="h-5 w-5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modais simplificados */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md">
            <h3 className="text-lg font-medium mb-4 dark:text-white">Alterar Senha</h3>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <input type="password" placeholder="Nova Senha" value={changePassword.newPassword} onChange={(e) => setChangePassword({...changePassword, newPassword: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white" required />
              <input type="password" placeholder="Confirmar Senha" value={changePassword.confirmPassword} onChange={(e) => setChangePassword({...changePassword, confirmPassword: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white" required />
              <div className="flex justify-end space-x-2">
                <button type="button" onClick={() => setShowChangePassword(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChangeRole && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md">
            <h3 className="text-lg font-medium mb-4 dark:text-white">Alterar Função: {changeRole.email}</h3>
            <form onSubmit={handleRoleChange} className="space-y-4">
              <select value={changeRole.newRole} onChange={(e) => setChangeRole({...changeRole, newRole: e.target.value})} className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white">
                <option value="inventory">Estoque</option>
                <option value="management">Gerência</option>
                <option value="sup-governanca">Supervisão de Governança</option>
                <option value="admin">Administrador</option>
              </select>
              <div className="flex justify-end space-x-2">
                <button type="button" onClick={() => setShowChangeRole(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Notificações (Mantido o original) */}
      {showNotificationPrefsModal && selectedUserForNotifications && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-2xl my-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold dark:text-white">Notificações: {selectedUserForNotifications.email}</h3>
              <button onClick={() => setShowNotificationPrefsModal(false)}><XCircle className="h-6 w-6 text-gray-400" /></button>
            </div>
            
            {showAddPreferenceForm ? (
              <form onSubmit={handleSavePreference} className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md space-y-4 mb-6">
                <select value={currentPreference.notification_type_id || ''} onChange={handleNotificationTypeChange} className="w-full p-2 border rounded dark:bg-gray-600 dark:text-white" required>
                  <option value="">Tipo de Notificação</option>
                  {notificationTypes.map(t => <option key={t.id} value={t.id}>{getNotificationTypeDescription(t.event_key)}</option>)}
                </select>
                
                {notificationTypes.find(t => t.id === currentPreference.notification_type_id)?.requires_hotel_filter && (
                  <select value={currentPreference.hotel_id || ''} onChange={handleHotelChange} className="w-full p-2 border rounded dark:bg-gray-600 dark:text-white" required>
                    <option value="">Selecionar Hotel</option>
                    {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}

                {notificationTypes.find(t => t.id === currentPreference.notification_type_id)?.requires_sector_filter && currentPreference.hotel_id && (
                  <select value={allSectorsSelected ? "all_sectors" : (currentPreference.sector_id || '')} onChange={handleSectorChange} className="w-full p-2 border rounded dark:bg-gray-600 dark:text-white" required>
                    <option value="">Selecionar Setor</option>
                    <option value="all_sectors">Todos os setores</option>
                    {sectors.filter(s => !selectedHotelForFilter || s.hotel_id === selectedHotelForFilter).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}

                <div className="flex justify-end space-x-2">
                  <button type="button" onClick={() => setShowAddPreferenceForm(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancelar</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md">{isEditingPreference ? 'Atualizar' : 'Adicionar'}</button>
                </div>
              </form>
            ) : (
              <button onClick={() => { setCurrentPreference({}); setIsEditingPreference(false); setShowAddPreferenceForm(true); }} className="mb-4 flex items-center px-4 py-2 bg-green-600 text-white rounded-md"><PlusCircle className="h-5 w-5 mr-2" /> Nova Preferência</button>
            )}

            <div className="space-y-2">
              {userPreferences.map(p => (
                <div key={p.id} className="border p-3 rounded flex justify-between items-center dark:border-gray-700">
                  <div>
                    <p className="font-medium dark:text-white">{getNotificationTypeDescription(p.notification_types?.event_key || '')}</p>
                    <p className="text-sm text-gray-500">{p.hotels?.name} {p.sectors ? `/ ${p.sectors.name}` : (p.hotel_id ? '/ Todos os setores' : '')}</p>
                  </div>
                  <div className="flex space-x-2">
                    <button onClick={() => handleEditPreference(p)} className="text-blue-500"><Edit3 className="h-5 w-5" /></button>
                    <button onClick={() => handleDeletePreference(p.id)} className="text-red-500"><Trash2 className="h-5 w-5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;

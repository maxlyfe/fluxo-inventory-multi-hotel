// Importações de bibliotecas e componentes.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Users, Key, AlertTriangle, UserCog, Bell, PlusCircle, Trash2, Edit3, XCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// --- Interfaces de Dados ---
// Mantidas exatamente como no seu arquivo original.
interface User {
  id: string; // ID original da tabela public.auth_users
  email: string;
  role: string;
  last_login: string;
  supabase_auth_user_id: string | null; // ID da tabela auth.users (Supabase Auth)
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
  user_id: string; // Deve ser o supabase_auth_user_id
  notification_type_id: string;
  hotel_id?: string | null;
  sector_id?: string | null;
  is_active: boolean;
  created_by?: string | null; // Deve ser o supabase_auth_user_id do admin
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

// --- ALTERAÇÃO: Adicionados os novos event_keys para os contratos de experiência ---
// Lista de tipos de notificação que estão realmente integrados e funcionando.
const ACTIVE_NOTIFICATION_TYPES = [
  'NEW_REQUEST',
  'ITEM_DELIVERED_TO_SECTOR',
  'REQUEST_REJECTED',
  'REQUEST_SUBSTITUTED',
  'NEW_BUDGET',
  'BUDGET_APPROVED',
  'BUDGET_CANCELLED',
  'EXP_CONTRACT_ENDING_SOON', // Notificação de contrato vencendo em 5 dias.
  'EXP_CONTRACT_ENDS_TODAY'   // Notificação de contrato vencendo hoje.
];

// --- Funções de Serviço ---
// (As funções de serviço permanecem as mesmas do seu arquivo original)
async function getNotificationTypes(): Promise<NotificationType[]> {
  const { data, error } = await supabase.from('notification_types').select('*').order('description');
  if (error) {
    console.error('Error fetching notification types:', error);
    throw error;
  }
  
  // Filtra apenas os tipos de notificação que estão realmente integrados e funcionando
  return (data || [])
    .filter(nt => ACTIVE_NOTIFICATION_TYPES.includes(nt.event_key))
    .map(nt => ({
      ...nt,
      // --- ALTERAÇÃO: Adicionada a regra de filtro de hotel para as novas notificações ---
      requires_hotel_filter: ['NEW_REQUEST', 'ITEM_DELIVERED_TO_SECTOR', 'NEW_BUDGET', 'BUDGET_APPROVED', 'BUDGET_CANCELLED', 'EXP_CONTRACT_ENDING_SOON', 'EXP_CONTRACT_ENDS_TODAY'].includes(nt.event_key),
      requires_sector_filter: ['NEW_REQUEST', 'ITEM_DELIVERED_TO_SECTOR'].includes(nt.event_key),
    }));
}

async function getHotels(): Promise<Hotel[]> {
  const { data, error } = await supabase.from('hotels').select('id, name').order('name');
  if (error) {
    console.error('Error fetching hotels:', error);
    throw error;
  }
  return data || [];
}

async function getSectors(hotelId?: string): Promise<Sector[]> {
  let query = supabase.from('sectors').select('id, name, hotel_id').order('name');
  if (hotelId) {
    query = query.eq('hotel_id', hotelId);
  }
  const { data, error } = await query;
  if (error) {
    console.error('Error fetching sectors:', error);
    throw error;
  }
  return data || [];
}

// userAuthId é o ID da tabela auth.users
async function getUserNotificationPreferences(userAuthId: string): Promise<UserNotificationPreference[]> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .select(`
      id,
      user_id,
      notification_type_id,
      hotel_id,
      sector_id,
      is_active,
      created_by,
      notification_types (description, event_key),
      hotels (name),
      sectors (name)
    `)
    .eq('user_id', userAuthId) // Filtra pelo ID de auth.users
    .order('created_at');
  if (error) {
    console.error('Error fetching user notification preferences:', error);
    throw error;
  }
  return data || [];
}

async function addUserNotificationPreference(preference: Omit<UserNotificationPreference, 'id' | 'notification_types' | 'hotels' | 'sectors'>): Promise<UserNotificationPreference | null> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .insert(preference)
    .select(`
      id,
      user_id,
      notification_type_id,
      hotel_id,
      sector_id,
      is_active,
      created_by,
      notification_types (description, event_key),
      hotels (name),
      sectors (name)
    `)
    .single();
  if (error) {
    console.error('Error adding user notification preference:', error);
    throw error;
  }
  return data;
}

async function updateUserNotificationPreference(id: string, updates: Partial<UserNotificationPreference>): Promise<UserNotificationPreference | null> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .update(updates)
    .eq('id', id)
    .select(`
      id,
      user_id,
      notification_type_id,
      hotel_id,
      sector_id,
      is_active,
      created_by,
      notification_types (description, event_key),
      hotels (name),
      sectors (name)
    `)
    .single();
  if (error) {
    console.error('Error updating user notification preference:', error);
    throw error;
  }
  return data;
}

async function deleteUserNotificationPreference(id: string): Promise<void> {
  const { error } = await supabase.from('user_notification_preferences').delete().eq('id', id);
  if (error) {
    console.error('Error deleting user notification preference:', error);
    throw error;
  }
}

// userAuthId é o ID da tabela auth.users
async function checkSupabaseAuthUserExists(userAuthId: string): Promise<boolean> {
  if (!userAuthId) return false; // Se não houver ID de autenticação, não existe.
  const { data, error } = await supabase.rpc('check_supabase_auth_user_exists', { p_user_id: userAuthId });
  if (error) {
    console.error('Error checking user existence in Supabase Auth:', error);
    return false; 
  }
  return data as boolean;
}

const UserManagement = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user: adminUser, supabaseUser } = useAuth(); 
  const navigate = useNavigate();
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'inventory'
  });
  const [changePassword, setChangePassword] = useState({
    userId: '', 
    newPassword: '',
    confirmPassword: ''
  });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [changeRole, setChangeRole] = useState({
    userId: '', 
    email: '',
    currentRole: '',
    newRole: ''
  });

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
    getNotificationTypes().then(setNotificationTypes).catch(err => setError('Falha ao carregar tipos de notificação.'));
    getHotels().then(setHotels).catch(err => setError('Falha ao carregar hotéis.'));
    getSectors().then(setSectors).catch(err => setError('Falha ao carregar setores.'));
  }, [adminUser, supabaseUser, navigate]);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase
        .from('auth_users') 
        .select('id, email, role, last_login, supabase_auth_user_id') 
        .order('email');

      if (fetchError) throw fetchError;
      setUsers(data || []);
    } catch (err: any) {
      console.error('Error fetching users:', err);
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
      const { error: createError } = await supabase.rpc('create_user', {
        p_email: newUser.email,
        p_password: newUser.password,
        p_role: newUser.role
      });

      if (createError) throw createError;
      
      setNewUser({ email: '', password: '', role: 'inventory' });
      fetchUsers(); 
      alert('Usuário criado com sucesso! (Lembre-se de ajustar a função create_user no backend para sincronia total)');
    } catch (err: any) {
      console.error('Error creating user:', err);
      setError(err.message.includes('already exists') 
        ? 'Usuário já cadastrado no sistema' 
        : 'Erro ao criar usuário: ' + err.message);
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
      const userToChange = users.find(u => u.id === changePassword.userId);
      if (!userToChange || !userToChange.supabase_auth_user_id) {
        setError('ID de autenticação do usuário não encontrado para alteração de senha.');
        return;
      }

      const { error: pwdError } = await supabase.auth.admin.updateUserById(
        userToChange.supabase_auth_user_id, 
        { password: changePassword.newPassword }
      );

      if (pwdError) throw pwdError;
      setChangePassword({ userId: '', newPassword: '', confirmPassword: '' });
      setShowChangePassword(false);
      alert('Senha alterada com sucesso no sistema de autenticação!');
    } catch (err: any) {
      console.error('Error changing password:', err);
      setError('Erro ao alterar senha: ' + err.message);
    }
  };

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const userToChange = users.find(u => u.id === changeRole.userId);
      if (!userToChange || !userToChange.supabase_auth_user_id) {
        setError('ID de autenticação do usuário não encontrado para alteração de role.');
        return;
      }

      const { error: authRoleError } = await supabase.auth.admin.updateUserById(
        userToChange.supabase_auth_user_id,
        { user_metadata: { ...userToChange.raw_user_meta_data, role: changeRole.newRole } }
      );
      if (authRoleError) throw authRoleError;

      const { error: publicRoleError } = await supabase
        .from('auth_users')
        .update({ role: changeRole.newRole })
        .eq('id', userToChange.id); 

      if (publicRoleError) throw publicRoleError;
      
      await fetchUsers();
      setChangeRole({ userId: '', email: '', currentRole: '', newRole: '' });
      setShowChangeRole(false);
      alert('Role atualizado com sucesso!');
    } catch (err: any) {
      console.error('Error changing role:', err);
      setError('Erro ao alterar função do usuário: ' + err.message);
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
    if (!user.supabase_auth_user_id) {
      setError(`Usuário ${user.email} não possui um ID de autenticação Supabase vinculado. Não é possível gerenciar notificações.`);
      setShowNotificationPrefsModal(false);
      return;
    }
    setSelectedUserForNotifications(user);
    setShowNotificationPrefsModal(true);
    setLoadingPrefs(true);
    setShowAddPreferenceForm(false);
    setError('');
    try {
      const prefs = await getUserNotificationPreferences(user.supabase_auth_user_id);
      setUserPreferences(prefs);
    } catch (err: any) {
      setError('Falha ao carregar preferências do usuário: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleSavePreference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForNotifications || !selectedUserForNotifications.supabase_auth_user_id || !currentPreference.notification_type_id) {
      setError('Usuário ou Tipo de notificação inválido(s).');
      return;
    }
    setLoadingPrefs(true);
    setError(''); 

    try {
      const userAuthId = selectedUserForNotifications.supabase_auth_user_id;
      const userExistsInAuth = await checkSupabaseAuthUserExists(userAuthId);
      if (!userExistsInAuth) {
        setError(`O usuário ${selectedUserForNotifications.email} (ID Auth: ${userAuthId}) não existe na tabela de autenticação principal (auth.users) do Supabase. As preferências não podem ser salvas.`);
        setLoadingPrefs(false);
        return;
      }

      const adminAuthId = supabaseUser?.id;

      const prefToSave: any = {
        user_id: userAuthId, 
        notification_type_id: currentPreference.notification_type_id,
        hotel_id: currentPreference.hotel_id || null,
        sector_id: allSectorsSelected ? null : currentPreference.sector_id || null,
        is_active: currentPreference.is_active === undefined ? true : currentPreference.is_active,
        created_by: adminAuthId || null 
      };

      let savedPreference;
      if (isEditingPreference && currentPreference.id) {
        savedPreference = await updateUserNotificationPreference(currentPreference.id, prefToSave);
      } else {
        savedPreference = await addUserNotificationPreference(prefToSave);
      }

      if (savedPreference) {
        const prefs = await getUserNotificationPreferences(userAuthId);
        setUserPreferences(prefs);
      }
      setShowAddPreferenceForm(false);
      setCurrentPreference({});
      setIsEditingPreference(false);
      setAllSectorsSelected(false);
    } catch (err: any) {
      setError('Falha ao salvar preferência: ' + err.message); 
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleEditPreference = (preference: UserNotificationPreference) => {
    const selectedType = notificationTypes.find(nt => nt.id === preference.notification_type_id);
    if (selectedType?.requires_hotel_filter && preference.hotel_id) {
        getSectors(preference.hotel_id).then(setSectors);
        setSelectedHotelForFilter(preference.hotel_id);
    } else {
        getSectors().then(setSectors); 
        setSelectedHotelForFilter(undefined);
    }
    setCurrentPreference({
        ...preference,
        hotel_id: preference.hotel_id || undefined,
        sector_id: preference.sector_id || undefined,
    });
    setIsEditingPreference(true);
    setShowAddPreferenceForm(true);
    setError(''); 
    setAllSectorsSelected(preference.hotel_id !== null && preference.sector_id === null);
  };

  const handleDeletePreference = async (preferenceId: string) => {
    if (!selectedUserForNotifications || !selectedUserForNotifications.supabase_auth_user_id) return;
    if (window.confirm('Tem certeza que deseja remover esta preferência de notificação?')) {
      setLoadingPrefs(true);
      setError(''); 
      try {
        await deleteUserNotificationPreference(preferenceId);
        const prefs = await getUserNotificationPreferences(selectedUserForNotifications.supabase_auth_user_id);
        setUserPreferences(prefs);
      } catch (err: any) {
        setError('Falha ao remover preferência: ' + err.message); 
      } finally {
        setLoadingPrefs(false);
      }
    }
  };

  const handleAddNewPreference = () => {
    setCurrentPreference({});
    setIsEditingPreference(false);
    setShowAddPreferenceForm(true);
    setError(''); 
    setAllSectorsSelected(false);
  };

  const handleNotificationTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const typeId = e.target.value;
    const selectedType = notificationTypes.find(nt => nt.id === typeId);
    
    setCurrentPreference(prev => ({
      ...prev,
      notification_type_id: typeId,
      hotel_id: selectedType?.requires_hotel_filter ? prev.hotel_id : undefined,
      sector_id: selectedType?.requires_sector_filter ? prev.sector_id : undefined,
    }));
    
    if (!selectedType?.requires_hotel_filter) {
      setSelectedHotelForFilter(undefined);
    }
    
    setAllSectorsSelected(false);
  };

  const handleHotelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const hotelId = e.target.value;
    setCurrentPreference(prev => ({
      ...prev,
      hotel_id: hotelId,
      sector_id: undefined, // Reset sector when hotel changes
    }));
    setSelectedHotelForFilter(hotelId);
    if (hotelId) {
      getSectors(hotelId).then(setSectors);
    } else {
      getSectors().then(setSectors);
    }
    setAllSectorsSelected(false);
  };

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sectorId = e.target.value;
    if (sectorId === "all_sectors") {
      setAllSectorsSelected(true);
      setCurrentPreference(prev => ({
        ...prev,
        sector_id: undefined,
      }));
    } else {
      setAllSectorsSelected(false);
      setCurrentPreference(prev => ({
        ...prev,
        sector_id: sectorId,
      }));
    }
  };

  // --- ALTERAÇÃO: Adicionadas as descrições para os novos tipos de notificação ---
  const getNotificationTypeDescription = (eventKey: string) => {
    switch (eventKey) {
      case 'NEW_REQUEST': return 'Nova requisição';
      case 'ITEM_DELIVERED_TO_SECTOR': return 'Item entregue';
      case 'REQUEST_REJECTED': return 'Requisição rejeitada';
      case 'REQUEST_SUBSTITUTED': return 'Produto substituído';
      case 'NEW_BUDGET': return 'Novo orçamento';
      case 'BUDGET_APPROVED': return 'Orçamento aprovado';
      case 'BUDGET_CANCELLED': return 'Orçamento cancelado';
      // --- NOVAS DESCRIÇÕES ---
      case 'EXP_CONTRACT_ENDING_SOON': return 'Contrato de Experiência (Vence em 5 dias)';
      case 'EXP_CONTRACT_ENDS_TODAY': return 'Contrato de Experiência (Vence Hoje)';
      default: return eventKey;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
        <div className="flex items-center mb-4 md:mb-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
            <Users className="h-7 w-7 text-blue-600 dark:text-blue-400 mr-3" />
            Gerenciamento de Usuários
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            Voltar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md dark:bg-red-900 dark:text-red-200 dark:border-red-700" role="alert">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Criar Novo Usuário</h2>
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input
                type="email"
                id="email"
                value={newUser.email}
                onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
              <input
                type="password"
                id="password"
                value={newUser.password}
                onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                required
              />
            </div>
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Função</label>
              <select
                id="role"
                value={newUser.role}
                onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                required
              >
                <option value="inventory">Estoque</option>
                <option value="management">Gerência</option>
                <option value="sup-governanca">Supervisão de Governança</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Criar Usuário
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Usuários Cadastrados</h2>
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Carregando usuários...</p>
          </div>
        ) : users.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-4">Nenhum usuário encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                    Email
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                    Função
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                    Último Login
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-300">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {getRoleName(user.role)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {user.last_login ? new Date(user.last_login).toLocaleString('pt-BR') : 'Nunca'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => {
                            setChangePassword({userId: user.id, newPassword: '', confirmPassword: ''});
                            setShowChangePassword(true);
                          }}
                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                          title="Alterar senha"
                        >
                          <Key className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            setChangeRole({
                              userId: user.id, 
                              email: user.email,
                              currentRole: user.role,
                              newRole: user.role
                            });
                            setShowChangeRole(true);
                          }}
                          className="text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
                          title="Alterar função"
                        >
                          <UserCog className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openNotificationPrefsModal(user)}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Preferências de notificação"
                        >
                          <Bell className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de alteração de senha */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md mx-auto">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Alterar Senha</h3>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova Senha</label>
                <input
                  type="password"
                  id="newPassword"
                  value={changePassword.newPassword}
                  onChange={(e) => setChangePassword({...changePassword, newPassword: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar Senha</label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={changePassword.confirmPassword}
                  onChange={(e) => setChangePassword({...changePassword, confirmPassword: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowChangePassword(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de alteração de função */}
      {showChangeRole && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md mx-auto">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Alterar Função</h3>
            <form onSubmit={handleRoleChange} className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Usuário: <span className="font-medium text-gray-900 dark:text-gray-200">{changeRole.email}</span>
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Função atual: <span className="font-medium text-gray-900 dark:text-gray-200">{getRoleName(changeRole.currentRole)}</span>
                </p>
              </div>
              <div>
                <label htmlFor="newRole" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova Função</label>
                <select
                  id="newRole"
                  value={changeRole.newRole}
                  onChange={(e) => setChangeRole({...changeRole, newRole: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                  required
                >
                  <option value="inventory">Estoque</option>
                  <option value="management">Gerência</option>
                  <option value="sup-governanca">Supervisão de Governança</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowChangeRole(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de preferências de notificação */}
      {showNotificationPrefsModal && selectedUserForNotifications && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50 flex justify-center items-start px-4 py-6">
          <div className="bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-lg shadow-xl w-full max-w-2xl mx-auto my-8 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Preferências de Notificação para {selectedUserForNotifications.email}
              </h3>
              <button 
                onClick={() => setShowNotificationPrefsModal(false)} 
                className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <XCircle className="h-6 w-6" />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-1">
              {loadingPrefs ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">Carregando preferências...</p>
                </div>
              ) : (
                <>
                  {showAddPreferenceForm ? (
                    <form onSubmit={handleSavePreference} className="space-y-4 bg-gray-50 dark:bg-gray-700 p-4 rounded-md">
                      <div>
                        <label htmlFor="notificationType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Tipo de Notificação:
                        </label>
                        <select
                          id="notificationType"
                          value={currentPreference.notification_type_id || ''}
                          onChange={handleNotificationTypeChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                          required
                        >
                          <option value="">Selecione um tipo de notificação</option>
                          {notificationTypes.map(type => (
                            <option key={type.id} value={type.id}>
                              {getNotificationTypeDescription(type.event_key)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {(() => {
                        const selectedNotificationType = notificationTypes.find(nt => nt.id === currentPreference.notification_type_id);
                        
                        return (
                          <>
                            {selectedNotificationType?.requires_hotel_filter && (
                              <div>
                                <label htmlFor="hotel" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Filtrar por Hotel (Obrigatório para este tipo):
                                </label>
                                <select
                                  id="hotel"
                                  value={currentPreference.hotel_id || ''}
                                  onChange={handleHotelChange}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                                  required
                                >
                                  <option value="">Selecione um hotel</option>
                                  {hotels.map(hotel => (
                                    <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {selectedNotificationType?.requires_sector_filter && currentPreference.hotel_id && (
                              <div>
                                <label htmlFor="sector" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Filtrar por Setor (Obrigatório para este tipo):
                                </label>
                                <select
                                  id="sector"
                                  value={allSectorsSelected ? "all_sectors" : (currentPreference.sector_id || '')}
                                  onChange={handleSectorChange}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                                  required
                                >
                                  <option value="">Selecione um setor</option>
                                  <option value="all_sectors">Todos os setores</option>
                                  {sectors
                                    .filter(sector => !selectedHotelForFilter || sector.hotel_id === selectedHotelForFilter)
                                    .map(sector => (
                                      <option key={sector.id} value={sector.id}>{sector.name}</option>
                                    ))
                                  }
                                </select>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      <div className="flex items-center">
                        <input
                          id="isActive"
                          type="checkbox"
                          checked={currentPreference.is_active !== false}
                          onChange={(e) => setCurrentPreference(prev => ({...prev, is_active: e.target.checked}))}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600"
                        />
                        <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                          Ativa
                        </label>
                      </div>

                      <div className="flex justify-end space-x-3 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddPreferenceForm(false);
                            setCurrentPreference({});
                            setIsEditingPreference(false);
                            setAllSectorsSelected(false);
                          }}
                          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                        >
                          {isEditingPreference ? 'Atualizar' : 'Adicionar'} Preferência
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mb-4">
                      <button
                        onClick={handleAddNewPreference}
                        className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                      >
                        <PlusCircle className="h-5 w-5 mr-2" />
                        Adicionar Preferência
                      </button>
                    </div>
                  )}

                  <h4 className="text-lg font-medium text-gray-800 dark:text-white mt-6 mb-3">
                    Preferências Salvas:
                  </h4>
                  
                  {userPreferences.length === 0 ? (
                    <p className="text-gray-600 dark:text-gray-400 text-center py-4">
                      Nenhuma preferência de notificação configurada.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {userPreferences.map(pref => (
                        <div 
                          key={pref.id} 
                          className={`border ${pref.is_active ? 'border-green-300 dark:border-green-700' : 'border-gray-300 dark:border-gray-700'} rounded-md p-3 flex justify-between items-center`}
                        >
                          <div>
                            <div className="flex items-center">
                              {pref.is_active ? (
                                <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                              ) : (
                                <XCircle className="h-5 w-5 text-gray-400 mr-2" />
                              )}
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {getNotificationTypeDescription(pref.notification_types?.event_key || '')}
                              </span>
                            </div>
                            {pref.hotels && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                Hotel: {pref.hotels.name}
                                {pref.sectors ? ` / Setor: ${pref.sectors.name}` : (pref.hotel_id && !pref.sector_id ? ' / Todos os setores' : '')}
                              </p>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEditPreference(pref)}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                              title="Editar"
                            >
                              <Edit3 className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleDeletePreference(pref.id)}
                              className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                              title="Remover"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;

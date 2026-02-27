// src/pages/UserManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Users, Key, AlertTriangle, UserCog, Bell, PlusCircle,
  Trash2, Edit3, XCircle, CheckCircle, Shield, Clock,
  ChevronRight, RefreshCw, UserPlus, Eye, EyeOff, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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
  notification_types?: { description: string; event_key: string };
  hotels?: { name: string } | null;
  sectors?: { name: string } | null;
}

interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_NOTIFICATION_TYPES = [
  'NEW_REQUEST',
  'ITEM_DELIVERED_TO_SECTOR',
  'REQUEST_REJECTED',
  'REQUEST_SUBSTITUTED',
  'NEW_BUDGET',
  'BUDGET_APPROVED',
  'BUDGET_CANCELLED',
  'EXP_CONTRACT_ENDING_SOON',
  'EXP_CONTRACT_ENDS_TODAY',
];

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  admin:          { label: 'Administrador',          color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/40', dot: 'bg-purple-500' },
  management:     { label: 'Gerência',                color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-100 dark:bg-blue-900/40',   dot: 'bg-blue-500'   },
  inventory:      { label: 'Estoque',                 color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', dot: 'bg-green-500'  },
  'sup-governanca': { label: 'Sup. Governança',       color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40', dot: 'bg-amber-500'  },
};

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role] ?? { label: role, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', dot: 'bg-gray-400' };
}

const NOTIF_LABELS: Record<string, string> = {
  NEW_REQUEST:             '📥 Nova requisição',
  ITEM_DELIVERED_TO_SECTOR:'📦 Item entregue ao setor',
  REQUEST_REJECTED:        '❌ Requisição rejeitada',
  REQUEST_SUBSTITUTED:     '🔄 Requisição substituída',
  NEW_BUDGET:              '💰 Novo orçamento',
  BUDGET_APPROVED:         '✅ Orçamento aprovado',
  BUDGET_CANCELLED:        '🚫 Orçamento cancelado',
  EXP_CONTRACT_ENDING_SOON:'⏰ Contrato vence em 5 dias',
  EXP_CONTRACT_ENDS_TODAY: '🔔 Contrato vence hoje',
};

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

async function getNotificationTypes(): Promise<NotificationType[]> {
  const { data, error } = await supabase.from('notification_types').select('*').order('description');
  if (error) throw error;
  return (data || [])
    .filter(nt => ACTIVE_NOTIFICATION_TYPES.includes(nt.event_key))
    .map(nt => ({
      ...nt,
      requires_hotel_filter: ['NEW_REQUEST','ITEM_DELIVERED_TO_SECTOR','NEW_BUDGET','BUDGET_APPROVED','BUDGET_CANCELLED','EXP_CONTRACT_ENDING_SOON','EXP_CONTRACT_ENDS_TODAY'].includes(nt.event_key),
      requires_sector_filter: ['NEW_REQUEST','ITEM_DELIVERED_TO_SECTOR'].includes(nt.event_key),
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
    .select('id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types(description, event_key), hotels(name), sectors(name)')
    .eq('user_id', userAuthId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function addUserNotificationPreference(preference: Omit<UserNotificationPreference, 'id' | 'notification_types' | 'hotels' | 'sectors'>): Promise<UserNotificationPreference | null> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .insert(preference)
    .select('id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types(description, event_key), hotels(name), sectors(name)')
    .single();
  if (error) throw error;
  return data;
}

async function updateUserNotificationPreference(id: string, updates: Partial<UserNotificationPreference>): Promise<UserNotificationPreference | null> {
  const { data, error } = await supabase
    .from('user_notification_preferences')
    .update(updates)
    .eq('id', id)
    .select('id, user_id, notification_type_id, hotel_id, sector_id, is_active, created_by, notification_types(description, event_key), hotels(name), sectors(name)')
    .single();
  if (error) throw error;
  return data;
}

async function deleteUserNotificationPreference(id: string): Promise<void> {
  const { error } = await supabase.from('user_notification_preferences').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: string }) {
  const cfg = getRoleConfig(role);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color} ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border pointer-events-auto
            ${t.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/80 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-800 dark:text-red-200'
            }`}
        >
          {t.type === 'success' ? <CheckCircle className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          <span className="text-sm font-medium">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const UserManagement = () => {
  const { user: adminUser } = useAuth();
  const navigate = useNavigate();

  // --- State ---
  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [toasts, setToasts]       = useState<Toast[]>([]);
  const [toastCounter, setToastCounter] = useState(0);

  // New user form
  const [newUser, setNewUser]     = useState({ email: '', password: '', role: 'inventory' });
  const [showPassword, setShowPassword] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Change password modal
  const [showChangePassword, setShowChangePassword]   = useState(false);
  const [changePwdShowNew, setChangePwdShowNew]       = useState(false);
  const [changePassword, setChangePassword]           = useState({ userId: '', newPassword: '', confirmPassword: '' });

  // Change role modal
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [changeRole, setChangeRole]         = useState({ userId: '', email: '', currentRole: '', newRole: '' });

  // Notification prefs modal
  const [showNotifModal, setShowNotifModal]           = useState(false);
  const [selectedUserForNotif, setSelectedUserForNotif] = useState<User | null>(null);
  const [notifTypes, setNotifTypes]                   = useState<NotificationType[]>([]);
  const [hotels, setHotels]                           = useState<Hotel[]>([]);
  const [sectors, setSectors]                         = useState<Sector[]>([]);
  const [userPrefs, setUserPrefs]                     = useState<UserNotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs]               = useState(false);
  const [currentPref, setCurrentPref]                 = useState<Partial<UserNotificationPreference>>({});
  const [isEditingPref, setIsEditingPref]             = useState(false);
  const [showPrefForm, setShowPrefForm]               = useState(false);
  const [selectedHotelFilter, setSelectedHotelFilter] = useState<string | undefined>(undefined);
  const [allSectors, setAllSectors]                   = useState(false);

  // ---------------------------------------------------------------------------
  // Toast helpers
  // ---------------------------------------------------------------------------

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setToastCounter(c => c + 1);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminUser || adminUser.role !== 'admin') {
      navigate('/');
      return;
    }
    fetchUsers();
    getNotificationTypes().then(setNotifTypes).catch(() => showToast('error', 'Falha ao carregar tipos de notificação.'));
    getHotels().then(setHotels).catch(() => showToast('error', 'Falha ao carregar hotéis.'));
    getSectors().then(setSectors).catch(() => showToast('error', 'Falha ao carregar setores.'));
  }, [adminUser, navigate]);

  // ---------------------------------------------------------------------------
  // Fetch users — via RPC que cruza auth.users + public.profiles
  // ---------------------------------------------------------------------------

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase.rpc('get_all_users_with_profile');
      if (fetchError) throw fetchError;
      setUsers((data || []).map((item: any) => ({
        id: item.id,
        email: item.email,
        role: item.role || 'inventory',
        last_sign_in_at: item.last_sign_in_at,
        raw_user_meta_data: item.raw_user_meta_data,
      })));
    } catch (err: any) {
      showToast('error', 'Erro ao carregar usuários: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Create user — CORRIGIDO: usa supabase.auth.admin.createUser()
  // ---------------------------------------------------------------------------

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password || !newUser.role) {
      showToast('error', 'Preencha todos os campos.');
      return;
    }
    if (newUser.password.length < 6) {
      showToast('error', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setCreating(true);
    try {
      // 1. Cria o usuário no Supabase Auth (a única forma que funciona)
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: newUser.email,
        password: newUser.password,
        email_confirm: true,                         // confirma e-mail automaticamente
        user_metadata: { role: newUser.role },       // salva role no metadata como backup
      });

      if (authError) throw authError;
      if (!authData?.user) throw new Error('Usuário não retornado após criação.');

      // 2. Garante que o role está certo em public.profiles
      //    (o trigger handle_new_user já faz isso, mas explicitamos para certeza)
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: authData.user.id, role: newUser.role, updated_at: new Date().toISOString() });
      if (profileError) console.warn('Aviso: falha ao sincronizar profiles:', profileError);

      setNewUser({ email: '', password: '', role: 'inventory' });
      setShowCreateForm(false);
      await fetchUsers();
      showToast('success', `Usuário ${newUser.email} criado com sucesso!`);
    } catch (err: any) {
      const msg = err.message?.includes('already registered')
        ? 'Este e-mail já está cadastrado.'
        : 'Erro ao criar usuário: ' + err.message;
      showToast('error', msg);
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Change password
  // ---------------------------------------------------------------------------

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changePassword.newPassword !== changePassword.confirmPassword) {
      showToast('error', 'As senhas não coincidem.');
      return;
    }
    if (changePassword.newPassword.length < 6) {
      showToast('error', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    try {
      const { error } = await supabase.auth.admin.updateUserById(changePassword.userId, {
        password: changePassword.newPassword,
      });
      if (error) throw error;
      setChangePassword({ userId: '', newPassword: '', confirmPassword: '' });
      setShowChangePassword(false);
      showToast('success', 'Senha alterada com sucesso!');
    } catch (err: any) {
      showToast('error', 'Erro ao alterar senha: ' + err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Change role
  // ---------------------------------------------------------------------------

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userToChange = users.find(u => u.id === changeRole.userId);
      if (!userToChange) { showToast('error', 'Usuário não encontrado.'); return; }

      // 1. Atualiza em public.profiles (fonte da verdade)
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ role: changeRole.newRole, updated_at: new Date().toISOString() })
        .eq('id', userToChange.id);
      if (profileErr) throw profileErr;

      // 2. Sincroniza user_metadata para compatibilidade
      const { error: authErr } = await supabase.auth.admin.updateUserById(userToChange.id, {
        user_metadata: { ...userToChange.raw_user_meta_data, role: changeRole.newRole },
      });
      if (authErr) console.warn('Aviso: falha ao atualizar metadata:', authErr);

      await fetchUsers();
      setShowChangeRole(false);
      showToast('success', `Função de ${changeRole.email} atualizada para ${getRoleConfig(changeRole.newRole).label}.`);
    } catch (err: any) {
      showToast('error', 'Erro ao alterar função: ' + err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Notification preferences
  // ---------------------------------------------------------------------------

  const openNotifModal = async (user: User) => {
    setSelectedUserForNotif(user);
    setShowNotifModal(true);
    setLoadingPrefs(true);
    setShowPrefForm(false);
    setCurrentPref({});
    try {
      const prefs = await getUserNotificationPreferences(user.id);
      setUserPrefs(prefs);
    } catch (err: any) {
      showToast('error', 'Erro ao carregar preferências: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleSavePref = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForNotif || !currentPref.notification_type_id) {
      showToast('error', 'Selecione um tipo de notificação.');
      return;
    }
    setLoadingPrefs(true);
    try {
      const prefToSave: any = {
        user_id: selectedUserForNotif.id,
        notification_type_id: currentPref.notification_type_id,
        hotel_id: currentPref.hotel_id || null,
        sector_id: allSectors ? null : currentPref.sector_id || null,
        is_active: currentPref.is_active ?? true,
        created_by: adminUser?.id || null,
      };

      if (isEditingPref && currentPref.id) {
        await updateUserNotificationPreference(currentPref.id, prefToSave);
      } else {
        await addUserNotificationPreference(prefToSave);
      }

      const prefs = await getUserNotificationPreferences(selectedUserForNotif.id);
      setUserPrefs(prefs);
      setShowPrefForm(false);
      setCurrentPref({});
      setIsEditingPref(false);
      setAllSectors(false);
      showToast('success', isEditingPref ? 'Preferência atualizada!' : 'Preferência adicionada!');
    } catch (err: any) {
      showToast('error', 'Erro ao salvar preferência: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleEditPref = (pref: UserNotificationPreference) => {
    const selType = notifTypes.find(nt => nt.id === pref.notification_type_id);
    if (selType?.requires_hotel_filter && pref.hotel_id) {
      getSectors(pref.hotel_id).then(setSectors);
      setSelectedHotelFilter(pref.hotel_id);
    }
    setCurrentPref({ ...pref, hotel_id: pref.hotel_id || undefined, sector_id: pref.sector_id || undefined });
    setIsEditingPref(true);
    setShowPrefForm(true);
    setAllSectors(!!pref.hotel_id && !pref.sector_id);
  };

  const handleDeletePref = async (prefId: string) => {
    if (!selectedUserForNotif) return;
    if (!window.confirm('Remover esta preferência de notificação?')) return;
    setLoadingPrefs(true);
    try {
      await deleteUserNotificationPreference(prefId);
      const prefs = await getUserNotificationPreferences(selectedUserForNotif.id);
      setUserPrefs(prefs);
      showToast('success', 'Preferência removida.');
    } catch (err: any) {
      showToast('error', 'Erro ao remover: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleNotifTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const typeId = e.target.value;
    const selType = notifTypes.find(nt => nt.id === typeId);
    setCurrentPref(prev => ({
      ...prev,
      notification_type_id: typeId,
      hotel_id: selType?.requires_hotel_filter ? prev.hotel_id : undefined,
      sector_id: selType?.requires_sector_filter ? prev.sector_id : undefined,
    }));
    if (!selType?.requires_hotel_filter) setSelectedHotelFilter(undefined);
    setAllSectors(false);
  };

  const handleHotelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const hotelId = e.target.value;
    setCurrentPref(prev => ({ ...prev, hotel_id: hotelId, sector_id: undefined }));
    setSelectedHotelFilter(hotelId);
    if (hotelId) getSectors(hotelId).then(setSectors);
    else getSectors().then(setSectors);
    setAllSectors(false);
  };

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'all_sectors') {
      setAllSectors(true);
      setCurrentPref(prev => ({ ...prev, sector_id: undefined }));
    } else {
      setAllSectors(false);
      setCurrentPref(prev => ({ ...prev, sector_id: val }));
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatLastLogin(ts: string) {
    if (!ts) return 'Nunca';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Agora';
    if (mins < 60) return `${mins}m atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d atrás`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  const selectedNotifType = notifTypes.find(nt => nt.id === currentPref.notification_type_id);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200 dark:shadow-blue-900/40">
              <Users className="h-5 w-5 text-white" />
            </div>
            Usuários
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            {users.length} {users.length === 1 ? 'usuário cadastrado' : 'usuários cadastrados'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-600 transition-all"
            title="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowCreateForm(f => !f); setNewUser({ email: '', password: '', role: 'inventory' }); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-none"
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo usuário</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* ── Create user form (collapsible) ── */}
      {showCreateForm && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-2xl border border-blue-100 dark:border-blue-900/50 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600" />
              Criar novo usuário
            </h2>
            <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleCreateUser} className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  E-mail
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="email@empresa.com"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
              </div>
              {/* Senha */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {/* Função */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Função
                </label>
                <select
                  value={newUser.role}
                  onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  <option value="inventory">Estoque</option>
                  <option value="management">Gerência</option>
                  <option value="sup-governanca">Sup. Governança</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl transition-colors"
              >
                {creating
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Criando...</>
                  : <><CheckCircle className="h-3.5 w-3.5" />Criar usuário</>
                }
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Users list ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-3 border-blue-200 dark:border-blue-900 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Carregando usuários...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500">
            <Users className="h-10 w-10 opacity-40" />
            <p className="text-sm">Nenhum usuário encontrado.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:bg-gray-50/70 dark:hover:bg-gray-700/30 transition-colors group"
              >
                {/* Avatar */}
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 shadow-sm">
                  {user.email[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {user.email}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <RoleBadge role={user.role} />
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatLastLogin(user.last_sign_in_at)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  <ActionButton
                    title="Alterar senha"
                    icon={<Key className="h-4 w-4" />}
                    color="text-indigo-600 dark:text-indigo-400"
                    onClick={() => {
                      setChangePassword({ userId: user.id, newPassword: '', confirmPassword: '' });
                      setChangePwdShowNew(false);
                      setShowChangePassword(true);
                    }}
                  />
                  <ActionButton
                    title="Alterar função"
                    icon={<UserCog className="h-4 w-4" />}
                    color="text-amber-600 dark:text-amber-400"
                    onClick={() => {
                      setChangeRole({ userId: user.id, email: user.email, currentRole: user.role, newRole: user.role });
                      setShowChangeRole(true);
                    }}
                  />
                  <ActionButton
                    title="Notificações"
                    icon={<Bell className="h-4 w-4" />}
                    color="text-blue-600 dark:text-blue-400"
                    onClick={() => openNotifModal(user)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════
          Modal — Alterar Senha
      ══════════════════════════════════════════════ */}
      {showChangePassword && (
        <Modal title="Alterar Senha" onClose={() => setShowChangePassword(false)}>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <FormField label="Nova Senha">
              <div className="relative">
                <input
                  type={changePwdShowNew ? 'text' : 'password'}
                  value={changePassword.newPassword}
                  onChange={e => setChangePassword({ ...changePassword, newPassword: e.target.value })}
                  className={inputClass}
                  required minLength={6}
                  placeholder="Mínimo 6 caracteres"
                />
                <button type="button" onClick={() => setChangePwdShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  {changePwdShowNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormField>
            <FormField label="Confirmar Senha">
              <input
                type="password"
                value={changePassword.confirmPassword}
                onChange={e => setChangePassword({ ...changePassword, confirmPassword: e.target.value })}
                className={inputClass}
                required
                placeholder="Repita a senha"
              />
            </FormField>
            {changePassword.newPassword && changePassword.confirmPassword &&
              changePassword.newPassword !== changePassword.confirmPassword && (
              <p className="text-xs text-red-500">As senhas não coincidem.</p>
            )}
            <ModalActions onCancel={() => setShowChangePassword(false)} submitLabel="Salvar senha" />
          </form>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════
          Modal — Alterar Função
      ══════════════════════════════════════════════ */}
      {showChangeRole && (
        <Modal title="Alterar Função" onClose={() => setShowChangeRole(false)}>
          <form onSubmit={handleRoleChange} className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                {changeRole.email[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{changeRole.email}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Função atual: <RoleBadge role={changeRole.currentRole} /></p>
              </div>
            </div>
            <FormField label="Nova Função">
              <select
                value={changeRole.newRole}
                onChange={e => setChangeRole({ ...changeRole, newRole: e.target.value })}
                className={inputClass}
              >
                <option value="inventory">Estoque</option>
                <option value="management">Gerência</option>
                <option value="sup-governanca">Sup. Governança</option>
                <option value="admin">Administrador</option>
              </select>
            </FormField>
            <ModalActions onCancel={() => setShowChangeRole(false)} submitLabel="Salvar função" />
          </form>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════
          Modal — Preferências de Notificação
      ══════════════════════════════════════════════ */}
      {showNotifModal && selectedUserForNotif && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Drag handle — mobile */}
          <div className="sm:hidden absolute top-0 inset-x-0 flex justify-center pt-2 pointer-events-none">
            <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>

          <div className="bg-white dark:bg-gray-900 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh] overflow-hidden shadow-2xl">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {selectedUserForNotif.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedUserForNotif.email}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Preferências de notificação · <span className="font-medium text-blue-600 dark:text-blue-400">{userPrefs.length} configurada{userPrefs.length !== 1 ? 's' : ''}</span>
                </p>
              </div>
              <button
                onClick={() => setShowNotifModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingPrefs ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-7 h-7 border-2 border-blue-200 dark:border-blue-900 border-t-blue-600 rounded-full animate-spin" />
                  <p className="text-sm text-gray-400">Carregando...</p>
                </div>
              ) : (
                <>
                  {/* Add / Edit form */}
                  {showPrefForm ? (
                    <form onSubmit={handleSavePref} className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-4 space-y-3 border border-gray-100 dark:border-gray-700/60">
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-white mb-1">
                        {isEditingPref ? 'Editar preferência' : 'Nova preferência'}
                      </h4>

                      {/* Tipo de notificação */}
                      <FormField label="Tipo de notificação">
                        <select
                          value={currentPref.notification_type_id || ''}
                          onChange={handleNotifTypeChange}
                          className={inputClass}
                          required
                        >
                          <option value="">Selecione...</option>
                          {notifTypes.map(t => (
                            <option key={t.id} value={t.id}>
                              {NOTIF_LABELS[t.event_key] || t.event_key}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      {/* Hotel filter */}
                      {selectedNotifType?.requires_hotel_filter && (
                        <FormField label="Hotel">
                          <select
                            value={currentPref.hotel_id || ''}
                            onChange={handleHotelChange}
                            className={inputClass}
                            required
                          >
                            <option value="">Selecione um hotel...</option>
                            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                          </select>
                        </FormField>
                      )}

                      {/* Sector filter */}
                      {selectedNotifType?.requires_sector_filter && currentPref.hotel_id && (
                        <FormField label="Setor">
                          <select
                            value={allSectors ? 'all_sectors' : (currentPref.sector_id || '')}
                            onChange={handleSectorChange}
                            className={inputClass}
                            required
                          >
                            <option value="">Selecione um setor...</option>
                            <option value="all_sectors">📋 Todos os setores</option>
                            {sectors
                              .filter(s => !selectedHotelFilter || s.hotel_id === selectedHotelFilter)
                              .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                            }
                          </select>
                        </FormField>
                      )}

                      {/* Ativa toggle */}
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div
                          onClick={() => setCurrentPref(p => ({ ...p, is_active: !(p.is_active ?? true) }))}
                          className={`relative w-9 h-5 rounded-full transition-colors ${
                            (currentPref.is_active ?? true) ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                            (currentPref.is_active ?? true) ? 'left-4' : 'left-0.5'
                          }`} />
                        </div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">Ativa</span>
                      </label>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => { setShowPrefForm(false); setCurrentPref({}); setIsEditingPref(false); setAllSectors(false); }}
                          className="px-3.5 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={loadingPrefs}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-60"
                        >
                          {loadingPrefs
                            ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <CheckCircle className="h-3.5 w-3.5" />
                          }
                          {isEditingPref ? 'Atualizar' : 'Adicionar'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setCurrentPref({}); setIsEditingPref(false); setShowPrefForm(true); setAllSectors(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700/60 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                      <PlusCircle className="h-4 w-4" />
                      Adicionar preferência
                    </button>
                  )}

                  {/* Prefs list */}
                  {userPrefs.length === 0 && !showPrefForm ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400">
                      <Bell className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Nenhuma preferência configurada.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userPrefs.map(pref => (
                        <div
                          key={pref.id}
                          className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${
                            pref.is_active
                              ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10'
                              : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pref.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                              {NOTIF_LABELS[pref.notification_types?.event_key || ''] || pref.notification_types?.event_key || '—'}
                            </p>
                            {(pref.hotels || pref.sectors) && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                                <ChevronRight className="h-2.5 w-2.5" />
                                {pref.hotels?.name}
                                {pref.sectors ? ` · ${pref.sectors.name}` : pref.hotel_id && !pref.sector_id ? ' · Todos os setores' : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <ActionButton
                              title="Editar"
                              icon={<Edit3 className="h-3.5 w-3.5" />}
                              color="text-blue-600 dark:text-blue-400"
                              onClick={() => handleEditPref(pref)}
                            />
                            <ActionButton
                              title="Remover"
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              color="text-red-500 dark:text-red-400"
                              onClick={() => handleDeletePref(pref.id)}
                            />
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

// ---------------------------------------------------------------------------
// Small reusable components
// ---------------------------------------------------------------------------

const inputClass = 'w-full px-3.5 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all';

function ActionButton({ title, icon, color, onClick }: {
  title: string; icon: React.ReactNode; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all ${color}`}
    >
      {icon}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel}
        className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
        Cancelar
      </button>
      <button type="submit"
        className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors">
        <CheckCircle className="h-3.5 w-3.5" />
        {submitLabel}
      </button>
    </div>
  );
}

export default UserManagement;

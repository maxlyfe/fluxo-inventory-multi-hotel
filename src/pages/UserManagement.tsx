// src/pages/UserManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Users, Key, AlertTriangle, UserCog, Bell, PlusCircle,
  Trash2, Edit3, XCircle, CheckCircle, Clock,
  ChevronRight, RefreshCw, UserPlus, Eye, EyeOff, X,
  ShieldOff, ShieldCheck, UserX, Loader2, LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface User {
  id:                string;
  email:             string;
  role:              string;
  custom_role_id:    string | null;
  custom_role_name:  string | null;  // nome vindo direto do JOIN com custom_roles
  last_sign_in_at:   string;
  raw_user_meta_data?: { role?: string };
  banned_until?:     string | null;
  photo_url?:        string | null;
}

interface CustomRole {
  id: string;
  name: string;
  color: string;
  is_system: boolean;
}

interface NotificationType {
  id: string;
  event_key: string;
  description: string;
  requires_hotel_filter?: boolean;
  requires_sector_filter?: boolean;
}

interface Hotel  { id: string; name: string; }
interface Sector { id: string; name: string; hotel_id?: string; }

interface UserNotificationPreference {
  id: string;
  user_id: string;
  notification_type_id: string;
  hotel_id?: string | null;
  sector_id?: string | null;
  is_active: boolean;
  created_by?: string | null;
  notification_types?: { description: string; event_key: string };
  hotels?:  { name: string } | null;
  sectors?: { name: string } | null;
}

interface Toast { id: number; type: 'success' | 'error'; message: string; }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_NOTIFICATION_TYPES = [
  'NEW_REQUEST','ITEM_DELIVERED_TO_SECTOR','REQUEST_REJECTED',
  'REQUEST_SUBSTITUTED','NEW_BUDGET','BUDGET_APPROVED','BUDGET_CANCELLED',
  'EXP_CONTRACT_ENDING_SOON','EXP_CONTRACT_ENDS_TODAY',
];

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  admin:            { label: 'Administrador',    color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/40', dot: 'bg-purple-500' },
  management:       { label: 'Gerência',          color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-100 dark:bg-blue-900/40',   dot: 'bg-blue-500'   },
  inventory:        { label: 'Estoque',           color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', dot: 'bg-green-500'  },
  'sup-governanca': { label: 'Sup. Governança',   color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40', dot: 'bg-amber-500'  },
};

/**
 * Retorna a config de exibição de um role.
 * Prioridade: ROLE_CONFIG estático → custom role do banco → fallback cinza.
 */
function getRoleConfig(
  role: string,
  customRoles?: CustomRole[],
  customRoleId?: string | null,
  customRoleName?: string | null,
) {
  // Se há um custom role vinculado, usa ele com prioridade máxima
  if (customRoleId) {
    // Tenta pegar a cor da lista (mais atualizada)
    const cr = customRoles?.find(r => r.id === customRoleId);
    const name  = customRoleName || cr?.name || role;
    const color = cr?.color || '#6b7280';
    return {
      label: name,
      color: 'text-gray-700 dark:text-gray-200',
      bg:    'bg-gray-100 dark:bg-gray-700',
      dot:   color,
    };
  }

  // Role de sistema legado (admin, management, inventory...)
  if (ROLE_CONFIG[role]) return ROLE_CONFIG[role];

  // Fallback
  return { label: role, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', dot: 'bg-gray-400' };
}

const NOTIF_LABELS: Record<string, string> = {
  NEW_REQUEST:              '📥 Nova requisição',
  ITEM_DELIVERED_TO_SECTOR: '📦 Item entregue ao setor',
  REQUEST_REJECTED:         '❌ Requisição rejeitada',
  REQUEST_SUBSTITUTED:      '🔄 Requisição substituída',
  NEW_BUDGET:               '💰 Novo orçamento',
  BUDGET_APPROVED:          '✅ Orçamento aprovado',
  BUDGET_CANCELLED:         '🚫 Orçamento cancelado',
  EXP_CONTRACT_ENDING_SOON: '⏰ Contrato vence em 5 dias',
  EXP_CONTRACT_ENDS_TODAY:  '🔔 Contrato vence hoje',
};

// ---------------------------------------------------------------------------
// Edge Function caller — todas as ações admin passam por aqui
// ---------------------------------------------------------------------------

async function callAdminAction(
  session: any,
  payload: Record<string, unknown>
): Promise<{ success: boolean; message?: string; error?: string; [key: string]: any }> {
  const { data, error } = await supabase.functions.invoke('admin-user-actions', {
    body: payload,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error(error.message || 'Erro na Edge Function.');
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------------------
// Service functions (read-only — anon key é suficiente)
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
  let q = supabase.from('sectors').select('id, name, hotel_id').order('name');
  if (hotelId) q = q.eq('hotel_id', hotelId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

const PREF_SELECT = 'id,user_id,notification_type_id,hotel_id,sector_id,is_active,created_by,notification_types(description,event_key),hotels(name),sectors(name)';

async function getUserNotifPrefs(userId: string): Promise<UserNotificationPreference[]> {
  const { data, error } = await supabase.from('user_notification_preferences')
    .select(PREF_SELECT).eq('user_id', userId).order('created_at');
  if (error) throw error;
  return data || [];
}

async function addPref(p: Omit<UserNotificationPreference,'id'|'notification_types'|'hotels'|'sectors'>) {
  const { data, error } = await supabase.from('user_notification_preferences').insert(p).select(PREF_SELECT).single();
  if (error) throw error;
  return data;
}

async function updatePref(id: string, updates: Partial<UserNotificationPreference>) {
  const { data, error } = await supabase.from('user_notification_preferences').update(updates).eq('id', id).select(PREF_SELECT).single();
  if (error) throw error;
  return data;
}

async function deletePref(id: string) {
  const { error } = await supabase.from('user_notification_preferences').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUserDisabled(user: User): boolean {
  if (!user.banned_until) return false;
  return new Date(user.banned_until) > new Date();
}

function formatLastLogin(ts: string) {
  if (!ts) return 'Nunca';
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Agora';
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d atrás`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RoleBadge({ role, customRoles, customRoleId, customRoleName }: {
  role: string;
  customRoles?: CustomRole[];
  customRoleId?: string | null;
  customRoleName?: string | null;
}) {
  const c = getRoleConfig(role, customRoles, customRoleId, customRoleName);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.color} ${c.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border pointer-events-auto
          ${t.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/80 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200'
            : 'bg-red-50 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-800 dark:text-red-200'}`}>
          {t.type === 'success' ? <CheckCircle className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          <span className="text-sm font-medium">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

function ActionButton({ title, icon, color, onClick, disabled }: {
  title: string; icon: React.ReactNode; color: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all ${color} disabled:opacity-30 disabled:cursor-not-allowed`}>
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
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all';

function ModalActions({ onCancel, submitLabel, submitColor = 'bg-blue-600 hover:bg-blue-700', submitting }: {
  onCancel: () => void; submitLabel: string; submitColor?: string; submitting?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel}
        className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
        Cancelar
      </button>
      <button type="submit" disabled={submitting}
        className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-60 ${submitColor}`}>
        {submitting
          ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <CheckCircle className="h-3.5 w-3.5" />
        }
        {submitLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const UserManagement = () => {
  const { user: adminUser, session, forceSignOut } = useAuth();
  const { isAdmin, isDev, can } = usePermissions();
  const navigate = useNavigate();

  const [users, setUsers]     = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts]   = useState<Toast[]>([]);

  // Create user
  const [showCreate, setShowCreate]   = useState(false);
  const [newUser, setNewUser]         = useState({ email: '', password: '', role: 'inventory' });
  const [showPwd, setShowPwd]         = useState(false);
  const [creating, setCreating]       = useState(false);

  // Change password
  const [showChangePwd, setShowChangePwd]   = useState(false);
  const [changePwd, setChangePwd]           = useState({ userId: '', newPassword: '', confirmPassword: '' });
  const [changingPwd, setChangingPwd]       = useState(false);
  const [showNewPwd, setShowNewPwd]         = useState(false);

  // Change role
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [changeRole, setChangeRole]         = useState({ userId: '', email: '', currentRole: '', newRole: '' });
  const [changingRole, setChangingRole]     = useState(false);

  // Custom roles do banco
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);

  // Toggle ban
  const [togglingBan,   setTogglingBan]   = useState<string | null>(null);
  const [forcingLogout, setForcingLogout] = useState<string | null>(null);

  // Notification prefs
  const [showNotif, setShowNotif]             = useState(false);
  const [selUserNotif, setSelUserNotif]       = useState<User | null>(null);
  const [notifTypes, setNotifTypes]           = useState<NotificationType[]>([]);
  const [hotels, setHotels]                   = useState<Hotel[]>([]);
  const [sectors, setSectors]                 = useState<Sector[]>([]);
  const [userPrefs, setUserPrefs]             = useState<UserNotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs]       = useState(false);
  const [currentPref, setCurrentPref]         = useState<Partial<UserNotificationPreference>>({});
  const [isEditingPref, setIsEditingPref]     = useState(false);
  const [showPrefForm, setShowPrefForm]       = useState(false);
  const [selHotelFilter, setSelHotelFilter]   = useState<string | undefined>(undefined);
  const [allSectors, setAllSectors]           = useState(false);
  const [showInactive, setShowInactive]       = useState(false); // lista de inativos colapsada por defeito

  // ---------------------------------------------------------------------------
  // Toast helpers
  // ---------------------------------------------------------------------------

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminUser || (!isAdmin && !isDev)) { navigate('/'); return; }
    fetchUsers();
    fetchCustomRoles();
    getNotificationTypes().then(setNotifTypes).catch(() => showToast('error', 'Erro ao carregar tipos de notificação.'));
    getHotels().then(setHotels).catch(() => showToast('error', 'Erro ao carregar hotéis.'));
    getSectors().then(setSectors).catch(() => showToast('error', 'Erro ao carregar setores.'));
  }, [adminUser]);

  // ---------------------------------------------------------------------------
  // Fetch custom roles
  // ---------------------------------------------------------------------------

  const fetchCustomRoles = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_roles')
        .select('id, name, color, is_system')
        .order('name');
      if (error) throw error;
      setCustomRoles(data || []);
    } catch (err: any) {
      showToast('error', 'Erro ao carregar funções: ' + err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Fetch users
  // ---------------------------------------------------------------------------

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_users_with_profile');
      if (error) throw error;
      setUsers((data || []).map((u: any) => ({
        id:                 u.id,
        email:              u.email,
        role:               u.role || 'guest',
        custom_role_id:     u.custom_role_id     || null,
        custom_role_name:   u.custom_role_name   || null,
        last_sign_in_at:    u.last_sign_in_at,
        raw_user_meta_data: u.raw_user_meta_data,
        banned_until:       u.banned_until,
        photo_url:          u.photo_url          || null,
      })));
    } catch (err: any) {
      showToast('error', 'Erro ao carregar usuários: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Create user — via Edge Function
  // ---------------------------------------------------------------------------

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.password || newUser.password.length < 6) { showToast('error', 'Senha deve ter pelo menos 6 caracteres.'); return; }
    if (!session) { showToast('error', 'Sessão expirada. Faça login novamente.'); return; }

    setCreating(true);
    try {
      const selectedRole = customRoles.find(r => r.id === newUser.role);
      const systemRole   = selectedRole?.is_system ? 'admin' : 'guest';

      await callAdminAction(session, {
        action:         'create_user',
        email:          newUser.email,
        password:       newUser.password,
        role:           systemRole,
        custom_role_id: selectedRole?.id ?? null,
      });
      setNewUser({ email: '', password: '', role: 'inventory' });
      setShowCreate(false);
      await fetchUsers();
      showToast('success', `Usuário ${newUser.email} criado com sucesso!`);
    } catch (err: any) {
      showToast('error', err.message.includes('already') ? 'Este e-mail já está cadastrado.' : err.message);
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Change password — via Edge Function
  // ---------------------------------------------------------------------------

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changePwd.newPassword !== changePwd.confirmPassword) { showToast('error', 'As senhas não coincidem.'); return; }
    if (!session) { showToast('error', 'Sessão expirada.'); return; }

    setChangingPwd(true);
    try {
      await callAdminAction(session, { action: 'change_password', target_user_id: changePwd.userId, new_password: changePwd.newPassword });
      setShowChangePwd(false);
      setChangePwd({ userId: '', newPassword: '', confirmPassword: '' });
      showToast('success', 'Senha alterada com sucesso!');
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setChangingPwd(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Change role — via Edge Function
  // ---------------------------------------------------------------------------

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) { showToast('error', 'Sessão expirada.'); return; }

    setChangingRole(true);
    try {
      // Todos os roles vêm do custom_roles
      const selectedRole = customRoles.find(r => r.id === changeRole.newRole);
      if (!selectedRole) throw new Error('Perfil não encontrado.');

      // is_system = true (ex: Admin) → também seta role='admin' para RLS funcionar
      const systemRole = selectedRole.is_system ? 'admin' : 'guest';

      await supabase.from('profiles').update({
        custom_role_id: selectedRole.id,
        role: systemRole,
      }).eq('id', changeRole.userId);

      // Sincroniza metadata do auth.users e custom_role_id via Edge Function
      await callAdminAction(session, {
        action:         'change_role',
        target_user_id: changeRole.userId,
        new_role:       systemRole,
        custom_role_id: selectedRole.id,
      });

      await fetchUsers();
      setShowChangeRole(false);
      showToast('success', `Perfil de ${changeRole.email} atualizado para ${selectedRole.name}.`);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setChangingRole(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Toggle ban — via Edge Function
  // ---------------------------------------------------------------------------

  const handleToggleBan = async (user: User) => {
    const disabled = isUserDisabled(user);
    const action   = disabled ? 'habilitar' : 'desabilitar';
    if (!window.confirm(`Tem certeza que deseja ${action} o acesso de ${user.email}?`)) return;
    if (!session) { showToast('error', 'Sessão expirada.'); return; }

    setTogglingBan(user.id);
    try {
      await callAdminAction(session, { action: 'toggle_ban', target_user_id: user.id, disable: !disabled });
      await fetchUsers();
      showToast('success', disabled ? `${user.email} foi habilitado.` : `${user.email} foi desabilitado e suas sessões foram encerradas.`);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setTogglingBan(null);
    }
  };

  const handleRemovePhoto = async (user: User) => {
    if (!window.confirm(`Remover foto de perfil de ${user.email}?`)) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ photo_url: null })
        .eq('id', user.id);
      if (error) throw error;
      showToast('success', 'Foto removida com sucesso.');
      fetchUsers();
    } catch (err: any) {
      showToast('error', 'Erro ao remover foto: ' + err.message);
    }
  };

  const canManagePhotos = isDev || isAdmin || can('diretoria');

  // ---------------------------------------------------------------------------
  // Notification preferences
  // ---------------------------------------------------------------------------

  const openNotifModal = async (user: User) => {
    setSelUserNotif(user);
    setShowNotif(true);
    setLoadingPrefs(true);
    setShowPrefForm(false);
    setCurrentPref({});
    try {
      setUserPrefs(await getUserNotifPrefs(user.id));
    } catch (err: any) {
      showToast('error', 'Erro ao carregar preferências: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleSavePref = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selUserNotif || !currentPref.notification_type_id) { showToast('error', 'Selecione um tipo de notificação.'); return; }
    setLoadingPrefs(true);
    try {
      const payload: any = {
        user_id: selUserNotif.id,
        notification_type_id: currentPref.notification_type_id,
        hotel_id: currentPref.hotel_id || null,
        sector_id: allSectors ? null : currentPref.sector_id || null,
        is_active: currentPref.is_active ?? true,
        created_by: adminUser?.id || null,
      };
      if (isEditingPref && currentPref.id) await updatePref(currentPref.id, payload);
      else await addPref(payload);
      setUserPrefs(await getUserNotifPrefs(selUserNotif.id));
      setShowPrefForm(false); setCurrentPref({}); setIsEditingPref(false); setAllSectors(false);
      showToast('success', isEditingPref ? 'Preferência atualizada!' : 'Preferência adicionada!');
    } catch (err: any) {
      showToast('error', 'Erro ao salvar preferência: ' + err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleEditPref = (pref: UserNotificationPreference) => {
    const t = notifTypes.find(nt => nt.id === pref.notification_type_id);
    if (t?.requires_hotel_filter && pref.hotel_id) { getSectors(pref.hotel_id).then(setSectors); setSelHotelFilter(pref.hotel_id); }
    setCurrentPref({ ...pref, hotel_id: pref.hotel_id || undefined, sector_id: pref.sector_id || undefined });
    setIsEditingPref(true); setShowPrefForm(true); setAllSectors(!!pref.hotel_id && !pref.sector_id);
  };

  const handleDeletePref = async (prefId: string) => {
    if (!selUserNotif || !window.confirm('Remover esta preferência?')) return;
    setLoadingPrefs(true);
    try {
      await deletePref(prefId);
      setUserPrefs(await getUserNotifPrefs(selUserNotif.id));
      showToast('success', 'Preferência removida.');
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const handleNotifTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const typeId = e.target.value;
    const t = notifTypes.find(nt => nt.id === typeId);
    setCurrentPref(prev => ({ ...prev, notification_type_id: typeId, hotel_id: t?.requires_hotel_filter ? prev.hotel_id : undefined, sector_id: t?.requires_sector_filter ? prev.sector_id : undefined }));
    if (!t?.requires_hotel_filter) setSelHotelFilter(undefined);
    setAllSectors(false);
  };

  const handleHotelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const hid = e.target.value;
    setCurrentPref(prev => ({ ...prev, hotel_id: hid, sector_id: undefined }));
    setSelHotelFilter(hid);
    if (hid) getSectors(hid).then(setSectors); else getSectors().then(setSectors);
    setAllSectors(false);
  };

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'all_sectors') { setAllSectors(true); setCurrentPref(prev => ({ ...prev, sector_id: undefined })); }
    else { setAllSectors(false); setCurrentPref(prev => ({ ...prev, sector_id: val })); }
  };

  const selNotifType = notifTypes.find(nt => nt.id === currentPref.notification_type_id);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <ToastContainer toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />

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
            {users.filter(u => isUserDisabled(u)).length > 0 && (
              <span className="ml-2 text-red-500 dark:text-red-400 font-medium">
                · {users.filter(u => isUserDisabled(u)).length} desabilitado{users.filter(u => isUserDisabled(u)).length > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchUsers} className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-600 transition-all" title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowCreate(v => !v); setNewUser({ email: '', password: '', role: 'inventory' }); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo usuário</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* ── Create user form ── */}
      {showCreate && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-2xl border border-blue-100 dark:border-blue-900/50 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600" />Criar novo usuário
            </h2>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"><X className="h-4 w-4" /></button>
          </div>
          <form onSubmit={handleCreateUser} className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <FormField label="E-mail">
                <input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="email@empresa.com" className={inputCls} required />
              </FormField>
              <FormField label="Senha">
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Mínimo 6 caracteres" className={inputCls} required minLength={6} />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>
              <FormField label="Função">
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className={inputCls}>
                  <option value="">Selecionar perfil...</option>
                  {customRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">Cancelar</button>
              <button type="submit" disabled={creating} className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl transition-colors">
                {creating ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Criando...</> : <><CheckCircle className="h-3.5 w-3.5" />Criar usuário</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Users list ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-2 border-blue-200 dark:border-blue-900 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Carregando usuários...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400"><Users className="h-10 w-10 opacity-40" /><p className="text-sm">Nenhum usuário encontrado.</p></div>
        ) : (
          <>
            {/* ── Ativos ── */}
            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {users.filter(u => !isUserDisabled(u)).map(user => {
              const disabled = isUserDisabled(user);
              const isMe = user.id === adminUser?.id;
              const isBanning = togglingBan === user.id;
              return (
                <div key={user.id} className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 transition-colors group ${disabled ? 'bg-red-50/30 dark:bg-red-900/5' : 'hover:bg-gray-50/70 dark:hover:bg-gray-700/30'}`}>
                  {/* Avatar */}
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 shadow-sm overflow-hidden ${disabled ? 'bg-gray-400 dark:bg-gray-600' : 'bg-gradient-to-br from-blue-400 to-indigo-600'}`}>
                    {user.photo_url ? (
                      <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      user.email[0].toUpperCase()
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium truncate ${disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                        {user.email}
                      </p>
                      {disabled && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                          <ShieldOff className="h-3 w-3" />Desabilitado
                        </span>
                      )}
                      {isMe && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                          Você
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <RoleBadge role={user.role} customRoles={customRoles} customRoleId={user.custom_role_id} customRoleName={user.custom_role_name} />
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" />{formatLastLogin(user.last_sign_in_at)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {user.photo_url && canManagePhotos && (
                      <ActionButton title="Remover foto" icon={<Camera className="h-4 w-4 text-red-500" />} color="hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => handleRemovePhoto(user)} />
                    )}
                    <ActionButton title="Alterar senha" icon={<Key className="h-4 w-4" />} color="text-indigo-600 dark:text-indigo-400"
                      disabled={disabled} onClick={() => { setChangePwd({ userId: user.id, newPassword: '', confirmPassword: '' }); setShowNewPwd(false); setShowChangePwd(true); }} />
                    <ActionButton title="Alterar função" icon={<UserCog className="h-4 w-4" />} color="text-amber-600 dark:text-amber-400"
                      disabled={disabled || isMe} onClick={() => {
                        const currentVal = user.custom_role_id
                          ? user.custom_role_id
                          : user.role;
                        setChangeRole({ userId: user.id, email: user.email, currentRole: user.role, newRole: currentVal });
                        setShowChangeRole(true);
                      }} />
                    <ActionButton title="Notificações" icon={<Bell className="h-4 w-4" />} color="text-blue-600 dark:text-blue-400"
                      onClick={() => openNotifModal(user)} />
                    <ActionButton
                      title={disabled ? 'Habilitar acesso' : 'Desabilitar acesso'}
                      icon={isBanning
                        ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                        : disabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />
                      }
                      color={disabled ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}
                      disabled={isMe || isBanning}
                      onClick={() => handleToggleBan(user)}
                    />
                    <ActionButton
                      title="Forçar logout de todos os dispositivos"
                      icon={forcingLogout === user.id
                        ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                        : <LogOut className="h-4 w-4" />
                      }
                      color="text-orange-500 dark:text-orange-400"
                      disabled={isMe || forcingLogout === user.id || disabled}
                      onClick={async () => {
                        if (!window.confirm(`Desconectar ${user.email} de todos os dispositivos?`)) return;
                        setForcingLogout(user.id);
                        try {
                          const result = await forceSignOut(user.id);
                          if (result.success) showToast('success', `${user.email} foi desconectado.`);
                          else showToast('error', result.message || 'Erro ao forçar logout.');
                        } finally {
                          setForcingLogout(null);
                        }
                      }}
                    />
                  </div>
                </div>
              );
              })}
            </div>

            {/* ── Inativos (colapsável) ── */}
            {users.filter(u => isUserDisabled(u)).length > 0 && (
              <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-700 mt-1">
                <button
                  onClick={() => setShowInactive(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors select-none"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                    Inativos — {users.filter(u => isUserDisabled(u)).length} utilizador{users.filter(u => isUserDisabled(u)).length !== 1 ? 'es' : ''}
                  </span>
                  <span className="text-xs tracking-wide">{showInactive ? '▲ Ocultar' : '▼ Mostrar'}</span>
                </button>
                {showInactive && (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/60 bg-gray-50/30 dark:bg-gray-900/20">
                    {users.filter(u => isUserDisabled(u)).map(user => {
                      const disabled = isUserDisabled(user);
                      const isMe = user.id === adminUser?.id;
                      const isBanning = togglingBan === user.id;
                      return (
                        <div key={user.id} className="px-4 py-4 opacity-60 hover:opacity-80 transition-opacity">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                              <UserX className="h-4 w-4 text-red-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{user.email}</p>
                              <p className="text-xs text-red-400 font-medium">Desabilitado</p>
                            </div>
                            <button
                              disabled={isBanning}
                              onClick={async () => {
                                if (!session) return;
                                setTogglingBan(user.id);
                                try {
                                  await callAdminAction(session, { action: 'toggle_ban', target_user_id: user.id, disable: false });
                                  await fetchUsers();
                                  showToast('success', `${user.email} reativado.`);
                                } catch (e: any) {
                                  showToast('error', e.message);
                                } finally {
                                  setTogglingBan(null);
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
                            >
                              {isBanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              Reativar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ Modal — Alterar Senha ══ */}
      {showChangePwd && (
        <Modal title="Alterar Senha" onClose={() => setShowChangePwd(false)}>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <FormField label="Nova Senha">
              <div className="relative">
                <input type={showNewPwd ? 'text' : 'password'} value={changePwd.newPassword}
                  onChange={e => setChangePwd({ ...changePwd, newPassword: e.target.value })}
                  className={inputCls} required minLength={6} placeholder="Mínimo 6 caracteres" />
                <button type="button" onClick={() => setShowNewPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormField>
            <FormField label="Confirmar Senha">
              <input type="password" value={changePwd.confirmPassword}
                onChange={e => setChangePwd({ ...changePwd, confirmPassword: e.target.value })}
                className={inputCls} required placeholder="Repita a senha" />
            </FormField>
            {changePwd.newPassword && changePwd.confirmPassword && changePwd.newPassword !== changePwd.confirmPassword && (
              <p className="text-xs text-red-500 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" />As senhas não coincidem.</p>
            )}
            <ModalActions onCancel={() => setShowChangePwd(false)} submitLabel="Salvar senha" submitting={changingPwd} />
          </form>
        </Modal>
      )}

      {/* ══ Modal — Alterar Função ══ */}
      {showChangeRole && (
        <Modal title="Alterar Função" onClose={() => setShowChangeRole(false)}>
          <form onSubmit={handleRoleChange} className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                {changeRole.email[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{changeRole.email}</p>
                <div className="mt-0.5"><RoleBadge role={changeRole.currentRole} customRoles={customRoles} /></div>
              </div>
            </div>
            <FormField label="Nova Função">
              <select value={changeRole.newRole} onChange={e => setChangeRole({ ...changeRole, newRole: e.target.value })} className={inputCls}>
                <option value="">Selecionar perfil...</option>
                {customRoles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </FormField>
            <ModalActions onCancel={() => setShowChangeRole(false)} submitLabel="Salvar função" submitting={changingRole} />
          </form>
        </Modal>
      )}

      {/* ══ Modal — Preferências de Notificação ══ */}
      {showNotif && selUserNotif && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-900 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh] overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {selUserNotif.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selUserNotif.email}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Preferências de notificação · <span className="font-medium text-blue-600 dark:text-blue-400">{userPrefs.length} configurada{userPrefs.length !== 1 ? 's' : ''}</span>
                </p>
              </div>
              <button onClick={() => setShowNotif(false)} className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">
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
                  {showPrefForm ? (
                    <form onSubmit={handleSavePref} className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-4 space-y-3 border border-gray-100 dark:border-gray-700/60">
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-white">{isEditingPref ? 'Editar preferência' : 'Nova preferência'}</h4>

                      <FormField label="Tipo de notificação">
                        <select value={currentPref.notification_type_id || ''} onChange={handleNotifTypeChange} className={inputCls} required>
                          <option value="">Selecione...</option>
                          {notifTypes.map(t => <option key={t.id} value={t.id}>{NOTIF_LABELS[t.event_key] || t.event_key}</option>)}
                        </select>
                      </FormField>

                      {selNotifType?.requires_hotel_filter && (
                        <FormField label="Hotel">
                          <select value={currentPref.hotel_id || ''} onChange={handleHotelChange} className={inputCls} required>
                            <option value="">Selecione um hotel...</option>
                            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                          </select>
                        </FormField>
                      )}

                      {selNotifType?.requires_sector_filter && currentPref.hotel_id && (
                        <FormField label="Setor">
                          <select value={allSectors ? 'all_sectors' : (currentPref.sector_id || '')} onChange={handleSectorChange} className={inputCls} required>
                            <option value="">Selecione um setor...</option>
                            <option value="all_sectors">📋 Todos os setores</option>
                            {sectors.filter(s => !selHotelFilter || s.hotel_id === selHotelFilter).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </FormField>
                      )}

                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div onClick={() => setCurrentPref(p => ({ ...p, is_active: !(p.is_active ?? true) }))}
                          className={`relative w-9 h-5 rounded-full transition-colors ${(currentPref.is_active ?? true) ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${(currentPref.is_active ?? true) ? 'left-4' : 'left-0.5'}`} />
                        </div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">Ativa</span>
                      </label>

                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => { setShowPrefForm(false); setCurrentPref({}); setIsEditingPref(false); setAllSectors(false); }}
                          className="px-3.5 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">Cancelar</button>
                        <button type="submit" disabled={loadingPrefs}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-60">
                          {loadingPrefs ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          {isEditingPref ? 'Atualizar' : 'Adicionar'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button onClick={() => { setCurrentPref({}); setIsEditingPref(false); setShowPrefForm(true); setAllSectors(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700/60 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <PlusCircle className="h-4 w-4" />Adicionar preferência
                    </button>
                  )}

                  {userPrefs.length === 0 && !showPrefForm ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400">
                      <Bell className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Nenhuma preferência configurada.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userPrefs.map(pref => (
                        <div key={pref.id} className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${pref.is_active ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30'}`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pref.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                              {NOTIF_LABELS[pref.notification_types?.event_key || ''] || pref.notification_types?.event_key || '—'}
                            </p>
                            {(pref.hotels || pref.sectors) && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                                <ChevronRight className="h-2.5 w-2.5" />
                                {pref.hotels?.name}{pref.sectors ? ` · ${pref.sectors.name}` : pref.hotel_id && !pref.sector_id ? ' · Todos os setores' : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <ActionButton title="Editar" icon={<Edit3 className="h-3.5 w-3.5" />} color="text-blue-600 dark:text-blue-400" onClick={() => handleEditPref(pref)} />
                            <ActionButton title="Remover" icon={<Trash2 className="h-3.5 w-3.5" />} color="text-red-500 dark:text-red-400" onClick={() => handleDeletePref(pref.id)} />
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
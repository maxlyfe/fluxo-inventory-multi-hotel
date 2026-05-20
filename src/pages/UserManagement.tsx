// src/pages/UserManagement.tsx
import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import {
  Users, Key, AlertTriangle, UserCog, Bell, PlusCircle,
  Trash2, Edit3, XCircle, CheckCircle, Clock,
  ChevronRight, RefreshCw, UserPlus, Eye, EyeOff, X,
  ShieldOff, ShieldCheck, UserX, Loader2, LogOut,
  Search, MoreVertical, Camera, Package, RotateCcw,
  BadgeCheck, BellOff, BellRing, ChevronDown,
  Inbox, DollarSign, Ban, Wrench, Sparkles, Hotel,
  Receipt, ArrowLeftRight, MapPin, Building2, Filter,
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
  custom_role_name:  string | null;
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
  'room_needs_maintenance','room_dirty','room_clean','room_maint_ok',
];

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  admin:            { label: 'Administrador',    color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/40', dot: 'bg-purple-500' },
  management:       { label: 'Gerência',          color: 'text-blue-700 dark:text-blue-300',   bg: 'bg-blue-100 dark:bg-blue-900/40',   dot: 'bg-blue-500'   },
  inventory:        { label: 'Estoque',           color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', dot: 'bg-green-500'  },
  'sup-governanca': { label: 'Sup. Governança',   color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40', dot: 'bg-amber-500'  },
};

function getRoleConfig(
  role: string,
  customRoles?: CustomRole[],
  customRoleId?: string | null,
  customRoleName?: string | null,
) {
  if (customRoleId) {
    const cr = customRoles?.find(r => r.id === customRoleId);
    const name  = customRoleName || cr?.name || role;
    const color = cr?.color || '#6b7280';
    return { label: name, color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-100 dark:bg-gray-700', dot: color };
  }
  if (ROLE_CONFIG[role]) return ROLE_CONFIG[role];
  return { label: role, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', dot: 'bg-gray-400' };
}

interface NotifConfig { label: string; icon: React.ElementType; iconColor: string; iconBg: string; }
const NOTIF_CONFIG: Record<string, NotifConfig> = {
  NEW_REQUEST:              { label: 'Nova requisição',                   icon: Inbox,          iconColor: 'text-blue-600 dark:text-blue-400',    iconBg: 'bg-blue-100 dark:bg-blue-900/40' },
  ITEM_DELIVERED_TO_SECTOR: { label: 'Item entregue ao setor',           icon: Package,        iconColor: 'text-green-600 dark:text-green-400',  iconBg: 'bg-green-100 dark:bg-green-900/40' },
  REQUEST_REJECTED:         { label: 'Requisição rejeitada',             icon: XCircle,        iconColor: 'text-red-600 dark:text-red-400',      iconBg: 'bg-red-100 dark:bg-red-900/40' },
  REQUEST_SUBSTITUTED:      { label: 'Requisição substituída',           icon: ArrowLeftRight, iconColor: 'text-orange-600 dark:text-orange-400',iconBg: 'bg-orange-100 dark:bg-orange-900/40' },
  NEW_BUDGET:               { label: 'Novo orçamento',                   icon: Receipt,        iconColor: 'text-violet-600 dark:text-violet-400',iconBg: 'bg-violet-100 dark:bg-violet-900/40' },
  BUDGET_APPROVED:          { label: 'Orçamento aprovado',               icon: CheckCircle,    iconColor: 'text-emerald-600 dark:text-emerald-400',iconBg: 'bg-emerald-100 dark:bg-emerald-900/40' },
  BUDGET_CANCELLED:         { label: 'Orçamento cancelado',              icon: Ban,            iconColor: 'text-red-600 dark:text-red-400',      iconBg: 'bg-red-100 dark:bg-red-900/40' },
  EXP_CONTRACT_ENDING_SOON: { label: 'Contrato vence em 5 dias',         icon: Clock,          iconColor: 'text-amber-600 dark:text-amber-400',  iconBg: 'bg-amber-100 dark:bg-amber-900/40' },
  EXP_CONTRACT_ENDS_TODAY:  { label: 'Contrato vence hoje',              icon: AlertTriangle,  iconColor: 'text-red-600 dark:text-red-400',      iconBg: 'bg-red-100 dark:bg-red-900/40' },
  room_needs_maintenance:   { label: 'UH — Solicita vistoria',           icon: Wrench,         iconColor: 'text-orange-600 dark:text-orange-400',iconBg: 'bg-orange-100 dark:bg-orange-900/40' },
  room_dirty:               { label: 'UH — Ficou suja',                  icon: Hotel,          iconColor: 'text-amber-600 dark:text-amber-400',  iconBg: 'bg-amber-100 dark:bg-amber-900/40' },
  room_clean:               { label: 'UH — Ficou limpa',                 icon: Sparkles,       iconColor: 'text-teal-600 dark:text-teal-400',    iconBg: 'bg-teal-100 dark:bg-teal-900/40' },
  room_maint_ok:            { label: 'UH — Liberada pela manutenção',    icon: ShieldCheck,    iconColor: 'text-green-600 dark:text-green-400',  iconBg: 'bg-green-100 dark:bg-green-900/40' },
};
// Compat helper
const notifLabel = (key: string) => NOTIF_CONFIG[key]?.label || key;

// ---------------------------------------------------------------------------
// Edge Function caller
// ---------------------------------------------------------------------------

async function callAdminAction(
  payload: Record<string, unknown>
): Promise<{ success: boolean; message?: string; error?: string; [key: string]: any }> {
  // Let the Supabase client handle auth automatically — it always uses the
  // most current access_token (including after silent token refreshes),
  // avoiding 401s caused by a stale token in React state.
  const { data, error } = await supabase.functions.invoke('admin-user-actions', {
    body: payload,
  });
  if (error) {
    // error.context contains the parsed response body from the Edge Function
    const ctx = (error as any).context;
    const msg = ctx?.error ?? ctx?.message ?? error.message ?? 'Erro na Edge Function.';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

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
      requires_hotel_filter: [
        'NEW_REQUEST','ITEM_DELIVERED_TO_SECTOR','NEW_BUDGET','BUDGET_APPROVED','BUDGET_CANCELLED',
        'EXP_CONTRACT_ENDING_SOON','EXP_CONTRACT_ENDS_TODAY',
        'room_needs_maintenance','room_dirty','room_clean','room_maint_ok',
      ].includes(nt.event_key),
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

function getInitials(email: string) {
  return email[0]?.toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RoleBadge({ role, customRoles, customRoleId, customRoleName }: {
  role: string; customRoles?: CustomRole[]; customRoleId?: string | null; customRoleName?: string | null;
}) {
  const c = getRoleConfig(role, customRoles, customRoleId, customRoleName);
  const isDotColor = c.dot.startsWith('#') || c.dot.startsWith('rgb');
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.color} ${c.bg}`}>
      {isDotColor
        ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
        : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      }
      {c.label}
    </span>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4 sm:px-0">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border pointer-events-auto animate-in slide-in-from-right-4 duration-200
          ${t.type === 'success'
            ? 'bg-white dark:bg-slate-800 border-green-200 dark:border-green-800 text-slate-800 dark:text-slate-100'
            : 'bg-white dark:bg-slate-800 border-red-200 dark:border-red-800 text-slate-800 dark:text-slate-100'}`}>
          <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${t.type === 'success' ? 'bg-green-100 dark:bg-green-900/50' : 'bg-red-100 dark:bg-red-900/50'}`}>
            {t.type === 'success'
              ? <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
              : <AlertTriangle className="h-3 w-3 text-red-500 dark:text-red-400" />
            }
          </div>
          <span className="text-sm font-medium flex-1 leading-relaxed">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="mt-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex-shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// Confirmation dialog — replaces window.confirm()
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
function ConfirmDialog({ title, message, confirmLabel, confirmColor = 'bg-red-600 hover:bg-red-700', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-700
        animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${confirmColor}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Generic modal — sheet on mobile, centered on desktop
function Modal({ title, subtitle, onClose, children, maxWidth = 'max-w-md' }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className={`bg-white dark:bg-slate-900 w-full ${maxWidth} rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700
        animate-in slide-in-from-bottom sm:zoom-in-95 duration-200`}>
        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[75dvh] sm:max-h-none">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-3 text-sm border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 min-h-[44px]';

function ModalActions({ onCancel, submitLabel, submitColor = 'bg-blue-600 hover:bg-blue-700', submitting }: {
  onCancel: () => void; submitLabel: string; submitColor?: string; submitting?: boolean;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button type="button" onClick={onCancel}
        className="flex-1 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors min-h-[44px]">
        Cancelar
      </button>
      <button type="submit" disabled={submitting}
        className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-60 min-h-[44px] ${submitColor}`}>
        {submitting
          ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</>
          : <><CheckCircle className="h-4 w-4" />{submitLabel}</>
        }
      </button>
    </div>
  );
}

// User avatar
function UserAvatar({ user, size = 'md' }: { user: User; size?: 'sm' | 'md' | 'lg' }) {
  const disabled = isUserDisabled(user);
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-2xl flex items-center justify-center font-bold flex-shrink-0 overflow-hidden shadow-sm
      ${disabled ? 'bg-slate-300 dark:bg-slate-600' : 'bg-gradient-to-br from-blue-400 to-indigo-600'} text-white`}>
      {user.photo_url
        ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
        : getInitials(user.email)
      }
    </div>
  );
}

// Stat chip for the header
function StatChip({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${color}`}>
      <span className="text-lg font-black leading-none">{value}</span>
      <span className="text-xs font-medium opacity-80 leading-tight">{label}</span>
    </div>
  );
}

// Context menu for user actions on mobile
function UserActionsMenu({ user, isMe, disabled, isBanning, forcingLogout, canManagePhotos, onChangePassword, onChangeRole, onNotifications, onToggleBan, onForceLogout, onRemovePhoto }: {
  user: User; isMe: boolean; disabled: boolean; isBanning: boolean; forcingLogout: boolean;
  canManagePhotos: boolean;
  onChangePassword: () => void; onChangeRole: () => void; onNotifications: () => void;
  onToggleBan: () => void; onForceLogout: () => void; onRemovePhoto: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Calcula posição do dropdown relativa ao viewport ao abrir
  // (renderiza via Portal → escapa do overflow-hidden do card pai)
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setCoords({
      top:   r.bottom + 6,
      right: window.innerWidth - r.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      // Fecha se clicou fora do botão E fora do menu portalado
      if (
        buttonRef.current && !buttonRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();

    const tm = setTimeout(() => document.addEventListener('mousedown', handler), 60);
    window.addEventListener('scroll',  onScroll, true);
    window.addEventListener('resize',  onResize);
    return () => {
      clearTimeout(tm);
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll',  onScroll, true);
      window.removeEventListener('resize',  onResize);
    };
  }, [open, updatePosition]);

  const item = (label: string, icon: React.ReactNode, onClick: () => void, cls = 'text-slate-700 dark:text-slate-200', isDisabled = false) => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      disabled={isDisabled}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors rounded-xl disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
        aria-label="Ações do usuário"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top:   coords.top,
            right: coords.right,
            zIndex: 9999,
            width: 224, // = w-56
          }}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1.5 overflow-hidden"
        >
          {item('Alterar senha', <Key className="h-4 w-4 text-indigo-500" />, onChangePassword, undefined, disabled)}
          {item('Alterar função', <UserCog className="h-4 w-4 text-amber-500" />, onChangeRole, undefined, disabled || isMe)}
          {item('Notificações', <Bell className="h-4 w-4 text-blue-500" />, onNotifications)}
          {user.photo_url && canManagePhotos && (
            item('Remover foto', <Camera className="h-4 w-4 text-slate-400" />, onRemovePhoto)
          )}
          <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-700 mx-3" />
          {!isMe && (
            item(
              disabled ? 'Habilitar acesso' : 'Desabilitar acesso',
              isBanning
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : disabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />,
              onToggleBan,
              disabled ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400',
              isBanning
            )
          )}
          {!isMe && !disabled && (
            item(
              'Forçar logout',
              forcingLogout ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />,
              onForceLogout,
              'text-orange-500 dark:text-orange-400',
              forcingLogout
            )
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const UserManagement = () => {
  const { user: adminUser, session, forceSignOut, refreshProfile } = useAuth();
  const { isAdmin, isDev, can } = usePermissions();
  const navigate = useNavigate();

  const [users, setUsers]     = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts]   = useState<Toast[]>([]);
  const [search, setSearch]   = useState('');

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    title: string; message: string; label: string; color?: string; onConfirm: () => void;
  } | null>(null);

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

  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
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
  const [showInactive, setShowInactive]       = useState(false);
  const [selectedRole, setSelectedRole]       = useState<string | null>(null); // null = todos

  // ---------------------------------------------------------------------------
  // Toast helpers
  // ---------------------------------------------------------------------------

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const askConfirm = (title: string, message: string, label: string, onConfirm: () => void, color?: string) => {
    setConfirm({ title, message, label, color, onConfirm });
  };

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
  // Fetch data
  // ---------------------------------------------------------------------------

  const fetchCustomRoles = async () => {
    try {
      const { data, error } = await supabase.from('custom_roles').select('id, name, color, is_system').order('name');
      if (error) throw error;
      setCustomRoles(data || []);
    } catch (err: any) {
      showToast('error', 'Erro ao carregar funções: ' + err.message);
    }
  };

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
  // Create user
  // ---------------------------------------------------------------------------

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.password || newUser.password.length < 6) { showToast('error', 'Senha deve ter pelo menos 6 caracteres.'); return; }
    if (!session) { showToast('error', 'Sessão expirada. Faça login novamente.'); return; }
    setCreating(true);
    try {
      const selectedRole = customRoles.find(r => r.id === newUser.role);
      const systemRole   = selectedRole?.is_system ? 'admin' : 'guest';
      await callAdminAction({
        action: 'create_user', email: newUser.email, password: newUser.password,
        role: systemRole, custom_role_id: selectedRole?.id ?? null,
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
  // Change password
  // ---------------------------------------------------------------------------

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changePwd.newPassword !== changePwd.confirmPassword) { showToast('error', 'As senhas não coincidem.'); return; }
    if (!session) { showToast('error', 'Sessão expirada.'); return; }
    setChangingPwd(true);
    try {
      await callAdminAction({ action: 'change_password', target_user_id: changePwd.userId, new_password: changePwd.newPassword });
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
  // Change role
  // ---------------------------------------------------------------------------

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) { showToast('error', 'Sessão expirada.'); return; }
    setChangingRole(true);
    try {
      const selectedRole = customRoles.find(r => r.id === changeRole.newRole);
      if (!selectedRole) throw new Error('Perfil não encontrado.');
      const systemRole = selectedRole.is_system ? 'admin' : 'guest';
      await supabase.from('profiles').update({ custom_role_id: selectedRole.id, role: systemRole }).eq('id', changeRole.userId);
      await callAdminAction({ action: 'change_role', target_user_id: changeRole.userId, new_role: systemRole, custom_role_id: selectedRole.id });
      await fetchUsers();
      setShowChangeRole(false);
      if (changeRole.userId === adminUser?.id) {
        await refreshProfile();
        showToast('success', `Seu perfil foi atualizado para ${selectedRole.name}.`);
      } else {
        showToast('success', `Função de ${changeRole.email} atualizada para ${selectedRole.name}.`);
      }
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setChangingRole(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Toggle ban
  // ---------------------------------------------------------------------------

  const handleToggleBan = async (user: User) => {
    const disabled = isUserDisabled(user);
    if (!session) { showToast('error', 'Sessão expirada.'); return; }
    setTogglingBan(user.id);
    try {
      await callAdminAction({ action: 'toggle_ban', target_user_id: user.id, disable: !disabled });
      await fetchUsers();
      showToast('success', disabled ? `${user.email} foi habilitado.` : `${user.email} foi desabilitado.`);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setTogglingBan(null);
    }
  };

  const handleRemovePhoto = async (user: User) => {
    try {
      const { error } = await supabase.from('profiles').update({ photo_url: null }).eq('id', user.id);
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
    setSelUserNotif(user); setShowNotif(true); setLoadingPrefs(true); setShowPrefForm(false); setCurrentPref({});
    try { setUserPrefs(await getUserNotifPrefs(user.id)); }
    catch (err: any) { showToast('error', 'Erro ao carregar preferências: ' + err.message); }
    finally { setLoadingPrefs(false); }
  };

  const handleSavePref = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selUserNotif || !currentPref.notification_type_id) { showToast('error', 'Selecione um tipo de notificação.'); return; }
    setLoadingPrefs(true);
    try {
      const payload: any = {
        user_id: selUserNotif.id, notification_type_id: currentPref.notification_type_id,
        hotel_id: currentPref.hotel_id || null,
        sector_id: allSectors ? null : currentPref.sector_id || null,
        is_active: currentPref.is_active ?? true, created_by: adminUser?.id || null,
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
    if (!selUserNotif) return;
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
  // Filtered users
  // ---------------------------------------------------------------------------

  const q = search.trim().toLowerCase();

  // Role filter chips — construídos dinamicamente a partir dos customRoles presentes nos usuários
  const roleChips = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>();
    users.filter(u => !isUserDisabled(u)).forEach(u => {
      const key  = u.custom_role_id || u.role;
      const name = u.custom_role_name || customRoles.find(r => r.id === u.custom_role_id)?.name || u.role;
      const color = customRoles.find(r => r.id === u.custom_role_id)?.color || '#6b7280';
      if (map.has(key)) { map.get(key)!.count++; }
      else { map.set(key, { id: key, name, color, count: 1 }); }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [users, customRoles]);

  const activeUsers   = users
    .filter(u => !isUserDisabled(u))
    .filter(u => !selectedRole || (u.custom_role_id || u.role) === selectedRole)
    .filter(u => !q || u.email.toLowerCase().includes(q) || (u.custom_role_name || u.role).toLowerCase().includes(q));
  const inactiveUsers = users.filter(u =>  isUserDisabled(u)).filter(u => !q || u.email.toLowerCase().includes(q));
  const totalActive   = users.filter(u => !isUserDisabled(u)).length;
  const totalInactive = users.filter(u =>  isUserDisabled(u)).length;

  // ---------------------------------------------------------------------------
  // Skeleton loader
  // ---------------------------------------------------------------------------
  const SkeletonRow = () => (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 dark:border-slate-700/50">
      <div className="w-10 h-10 rounded-2xl bg-slate-200 dark:bg-slate-700 animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-48 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
        <div className="h-3 w-24 bg-slate-100 dark:bg-slate-700/60 rounded-full animate-pulse" />
      </div>
      <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse flex-shrink-0" />
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-5">
      <ToastContainer toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          confirmColor={confirm.color}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200 dark:shadow-blue-900/40 flex-shrink-0">
              <Users className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Usuários</h1>
          </div>
          {!loading && (
            <div className="flex items-center gap-2 ml-[52px] flex-wrap">
              <StatChip value={totalActive} label="ativos" color="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" />
              {totalInactive > 0 && (
                <StatChip value={totalInactive} label="desabilitados" color="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={fetchUsers}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-600 transition-all"
            title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowCreate(v => !v); setNewUser({ email: '', password: '', role: 'inventory' }); }}
            className="flex items-center gap-2 h-10 px-4 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-semibold rounded-xl transition-all shadow-sm shadow-blue-200 dark:shadow-blue-900/40">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo usuário</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* ── Create user panel ──────────────────────────────────────────── */}
      {showCreate && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-blue-200 dark:border-blue-800/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-blue-50/50 dark:bg-blue-900/10">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Criar novo usuário
            </h2>
            <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all">
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleCreateUser} className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <FormField label="E-mail" required>
                <input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="email@empresa.com" className={inputCls} required autoComplete="email" />
              </FormField>
              <FormField label="Senha" required>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Mínimo 6 caracteres" className={inputCls} required minLength={6} />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1">
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>
              <FormField label="Função" required>
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className={inputCls}>
                  <option value="">Selecionar perfil...</option>
                  {customRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </FormField>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)}
                className="h-11 px-5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={creating}
                className="h-11 flex items-center gap-2 px-6 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl transition-colors">
                {creating ? <><Loader2 className="h-4 w-4 animate-spin" />Criando...</> : <><CheckCircle className="h-4 w-4" />Criar usuário</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Role filter chips ──────────────────────────────────────────── */}
      {!loading && roleChips.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar" style={{ touchAction: 'pan-x' }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 flex-shrink-0">
            <Filter className="h-3 w-3" />
          </div>
          {/* Chip "Todos" */}
          <button
            onClick={() => setSelectedRole(null)}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold flex-shrink-0 transition-all border ${
              selectedRole === null
                ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-transparent shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            Todos
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${
              selectedRole === null ? 'bg-white/20 dark:bg-black/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
            }`}>{totalActive}</span>
          </button>
          {roleChips.map(chip => (
            <button
              key={chip.id}
              onClick={() => setSelectedRole(prev => prev === chip.id ? null : chip.id)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold flex-shrink-0 transition-all border ${
                selectedRole === chip.id
                  ? 'border-transparent shadow-sm text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
              style={selectedRole === chip.id ? { backgroundColor: chip.color, borderColor: chip.color } : {}}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedRole === chip.id ? 'rgba(255,255,255,0.7)' : chip.color }}
              />
              {chip.name}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${
                selectedRole === chip.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>{chip.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Buscar por e-mail ou função..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Users list ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <>
            <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
          </>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              <Users className="h-8 w-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">Nenhum usuário encontrado.</p>
          </div>
        ) : (
          <>
            {/* Ativos */}
            {activeUsers.length === 0 && q ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                <Search className="h-7 w-7 opacity-30" />
                <p className="text-sm">Nenhum resultado para "{search}"</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {activeUsers.map(user => {
                  const disabled = isUserDisabled(user);
                  const isMe = user.id === adminUser?.id;
                  const isBanning = togglingBan === user.id;
                  const isForcing = forcingLogout === user.id;
                  return (
                    <div key={user.id}
                      className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-700/20 transition-colors group">
                      {/* Avatar */}
                      <UserAvatar user={user} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px] sm:max-w-none">
                            {user.email}
                          </p>
                          {isMe && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                              <BadgeCheck className="h-2.5 w-2.5" />Você
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <RoleBadge role={user.role} customRoles={customRoles} customRoleId={user.custom_role_id} customRoleName={user.custom_role_name} />
                          <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                            <Clock className="h-3 w-3" />{formatLastLogin(user.last_sign_in_at)}
                          </span>
                        </div>
                      </div>

                      {/* Actions menu */}
                      <UserActionsMenu
                        user={user} isMe={isMe} disabled={disabled}
                        isBanning={isBanning} forcingLogout={isForcing}
                        canManagePhotos={canManagePhotos}
                        onChangePassword={() => { setChangePwd({ userId: user.id, newPassword: '', confirmPassword: '' }); setShowNewPwd(false); setShowChangePwd(true); }}
                        onChangeRole={() => {
                          const currentVal = user.custom_role_id || user.role;
                          setChangeRole({ userId: user.id, email: user.email, currentRole: user.role, newRole: currentVal });
                          setShowChangeRole(true);
                        }}
                        onNotifications={() => openNotifModal(user)}
                        onToggleBan={() => askConfirm(
                          disabled ? 'Habilitar acesso' : 'Desabilitar acesso',
                          disabled
                            ? `Deseja reativar o acesso de ${user.email}?`
                            : `Deseja desabilitar o acesso de ${user.email}? Suas sessões serão encerradas.`,
                          disabled ? 'Habilitar' : 'Desabilitar',
                          () => handleToggleBan(user),
                          disabled ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                        )}
                        onForceLogout={() => askConfirm(
                          'Forçar logout',
                          `Desconectar ${user.email} de todos os dispositivos imediatamente?`,
                          'Desconectar',
                          async () => {
                            setForcingLogout(user.id);
                            try {
                              const result = await forceSignOut(user.id);
                              if (result.success) showToast('success', `${user.email} foi desconectado.`);
                              else showToast('error', result.message || 'Erro ao forçar logout.');
                            } finally { setForcingLogout(null); }
                          }
                        )}
                        onRemovePhoto={() => askConfirm(
                          'Remover foto',
                          `Remover a foto de perfil de ${user.email}?`,
                          'Remover',
                          () => handleRemovePhoto(user)
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inativos (colapsável) */}
            {inactiveUsers.length > 0 && (
              <div className="border-t-2 border-dashed border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setShowInactive(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-bold text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors select-none"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                    Desabilitados — {inactiveUsers.length} {inactiveUsers.length !== 1 ? 'usuários' : 'usuário'}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showInactive ? 'rotate-180' : ''}`} />
                </button>

                {showInactive && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-red-50/20 dark:bg-red-900/5">
                    {inactiveUsers.map(user => {
                      const isBanning = togglingBan === user.id;
                      return (
                        <div key={user.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4">
                          <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                            <UserX className="h-5 w-5 text-red-500 dark:text-red-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 truncate">{user.email}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                              <span className="text-xs text-red-500 dark:text-red-400 font-medium">Desabilitado</span>
                            </div>
                          </div>
                          <button
                            disabled={isBanning}
                            onClick={() => askConfirm(
                              'Reativar usuário',
                              `Deseja reativar o acesso de ${user.email}?`,
                              'Reativar',
                              async () => {
                                if (!session) return;
                                setTogglingBan(user.id);
                                try {
                                  await callAdminAction({ action: 'toggle_ban', target_user_id: user.id, disable: false });
                                  await fetchUsers();
                                  showToast('success', `${user.email} reativado.`);
                                } catch (e: any) { showToast('error', e.message); }
                                finally { setTogglingBan(null); }
                              },
                              'bg-green-600 hover:bg-green-700'
                            )}
                            className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            {isBanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Reativar
                          </button>
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
        <Modal title="Alterar Senha" subtitle="A senha será atualizada imediatamente" onClose={() => setShowChangePwd(false)}>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <FormField label="Nova Senha" required>
              <div className="relative">
                <input type={showNewPwd ? 'text' : 'password'} value={changePwd.newPassword}
                  onChange={e => setChangePwd({ ...changePwd, newPassword: e.target.value })}
                  className={inputCls} required minLength={6} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
                <button type="button" onClick={() => setShowNewPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1">
                  {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormField>
            <FormField label="Confirmar Senha" required>
              <input type="password" value={changePwd.confirmPassword}
                onChange={e => setChangePwd({ ...changePwd, confirmPassword: e.target.value })}
                className={inputCls} required placeholder="Repita a senha" autoComplete="new-password" />
            </FormField>
            {changePwd.newPassword && changePwd.confirmPassword && changePwd.newPassword !== changePwd.confirmPassword && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800/50">
                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">As senhas não coincidem.</p>
              </div>
            )}
            <ModalActions onCancel={() => setShowChangePwd(false)} submitLabel="Salvar senha" submitting={changingPwd} />
          </form>
        </Modal>
      )}

      {/* ══ Modal — Alterar Função ══ */}
      {showChangeRole && (
        <Modal title="Alterar Função" subtitle={`Usuário: ${changeRole.email}`} onClose={() => setShowChangeRole(false)}>
          <form onSubmit={handleRoleChange} className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-700">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {changeRole.email[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{changeRole.email}</p>
                <div className="mt-1">
                  <RoleBadge role={changeRole.currentRole} customRoles={customRoles} />
                </div>
              </div>
            </div>
            <FormField label="Nova Função" required>
              <select value={changeRole.newRole} onChange={e => setChangeRole({ ...changeRole, newRole: e.target.value })} className={inputCls} required>
                <option value="">Selecionar perfil...</option>
                {customRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </FormField>
            <ModalActions onCancel={() => setShowChangeRole(false)} submitLabel="Salvar função" submitting={changingRole} submitColor="bg-amber-500 hover:bg-amber-600" />
          </form>
        </Modal>
      )}

      {/* ══ Modal — Preferências de Notificação ══ */}
      {showNotif && selUserNotif && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">

            {/* Drag handle on mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
              <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
              <UserAvatar user={selUserNotif} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{selUserNotif.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Notificações</span>
                  {userPrefs.length > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                      {userPrefs.length} ativa{userPrefs.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setShowNotif(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {loadingPrefs ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-7 w-7 text-blue-500 animate-spin" />
                  <p className="text-sm text-slate-400">Carregando preferências...</p>
                </div>
              ) : (
                <>
                  {/* Add / Edit form */}
                  {showPrefForm ? (
                    <form onSubmit={handleSavePref}
                      className="bg-blue-50/60 dark:bg-slate-800/80 rounded-2xl p-4 space-y-3.5 border border-blue-100 dark:border-slate-700">
                      <p className="text-sm font-bold text-slate-800 dark:text-white">
                        {isEditingPref ? 'Editar preferência' : 'Nova preferência'}
                      </p>

                      <FormField label="Tipo de notificação" required>
                        <select value={currentPref.notification_type_id || ''} onChange={handleNotifTypeChange} className={inputCls} required>
                          <option value="">Selecione...</option>
                          {notifTypes.map(t => <option key={t.id} value={t.id}>{notifLabel(t.event_key)}</option>)}
                        </select>
                      </FormField>

                      {selNotifType?.requires_hotel_filter && (
                        <FormField label="Hotel" required>
                          <select value={currentPref.hotel_id || ''} onChange={handleHotelChange} className={inputCls} required>
                            <option value="">Selecione um hotel...</option>
                            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                          </select>
                        </FormField>
                      )}

                      {selNotifType?.requires_sector_filter && currentPref.hotel_id && (
                        <FormField label="Setor" required>
                          <select value={allSectors ? 'all_sectors' : (currentPref.sector_id || '')} onChange={handleSectorChange} className={inputCls} required>
                            <option value="">Selecione um setor...</option>
                            <option value="all_sectors">Todos os setores</option>
                            {sectors.filter(s => !selHotelFilter || s.hotel_id === selHotelFilter).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </FormField>
                      )}

                      {/* Toggle ativo */}
                      <label className="flex items-center gap-3 cursor-pointer select-none p-1">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={currentPref.is_active ?? true}
                          onClick={() => setCurrentPref(p => ({ ...p, is_active: !(p.is_active ?? true) }))}
                          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                            ${(currentPref.is_active ?? true) ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all
                            ${(currentPref.is_active ?? true) ? 'left-5' : 'left-1'}`} />
                        </button>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {(currentPref.is_active ?? true) ? 'Ativa' : 'Inativa'}
                        </span>
                      </label>

                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setShowPrefForm(false); setCurrentPref({}); setIsEditingPref(false); setAllSectors(false); }}
                          className="flex-1 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-xl border border-slate-200 dark:border-slate-600 transition-colors">
                          Cancelar
                        </button>
                        <button type="submit" disabled={loadingPrefs}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-60">
                          {loadingPrefs ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                          {isEditingPref ? 'Atualizar' : 'Adicionar'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button onClick={() => { setCurrentPref({}); setIsEditingPref(false); setShowPrefForm(true); setAllSectors(false); }}
                      className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-blue-600 dark:text-blue-400 border-2 border-dashed border-blue-200 dark:border-blue-800/60 rounded-2xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors min-h-[44px]">
                      <PlusCircle className="h-4 w-4" />
                      Adicionar preferência
                    </button>
                  )}

                  {/* Preferences list */}
                  {userPrefs.length === 0 && !showPrefForm ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <BellOff className="h-7 w-7 opacity-40" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">Nenhuma preferência</p>
                        <p className="text-xs text-slate-400 mt-0.5">Adicione para receber notificações configuradas.</p>
                      </div>
                    </div>
                  ) : userPrefs.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {userPrefs.map(pref => {
                        const eventKey = pref.notification_types?.event_key || '';
                        const cfg = NOTIF_CONFIG[eventKey];
                        const IconComp = cfg?.icon || Bell;
                        return (
                        <div key={pref.id}
                          className={`relative flex flex-col gap-2.5 p-4 rounded-2xl border transition-colors
                            ${pref.is_active
                              ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 opacity-60'}`}>

                          {/* Active indicator top-right */}
                          <div className={`absolute top-3 right-3 w-2 h-2 rounded-full flex-shrink-0 ${pref.is_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />

                          {/* Icon + label */}
                          <div className="flex items-start gap-3 pr-4">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg?.iconBg || 'bg-slate-100 dark:bg-slate-700'}`}>
                              <IconComp className={`h-4.5 w-4.5 ${cfg?.iconColor || 'text-slate-500'}`} style={{ width: 18, height: 18 }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug">
                                {notifLabel(eventKey) || '—'}
                              </p>
                              {(pref.hotels || pref.sectors) && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-0.5">
                                  <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                                  {pref.hotels?.name}
                                  {pref.sectors ? ` · ${pref.sectors.name}` : pref.hotel_id && !pref.sector_id ? ' · Todos os setores' : ''}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 border-t border-slate-100 dark:border-slate-700 pt-2.5 -mb-1">
                            <span className={`flex-1 text-[10px] font-semibold ${pref.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                              {pref.is_active ? 'Ativa' : 'Inativa'}
                            </span>
                            <button onClick={() => handleEditPref(pref)} title="Editar"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setConfirm({
                                  title: 'Remover preferência',
                                  message: 'Deseja remover esta configuração de notificação?',
                                  label: 'Remover',
                                  onConfirm: () => handleDeletePref(pref.id),
                                });
                              }}
                              title="Remover"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
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

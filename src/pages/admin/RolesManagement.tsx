// src/pages/admin/RolesManagement.tsx
// Gestão de perfis de acesso — criar, editar, excluir, atribuir a utilizadores

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { usePermissions, MODULES, MODULE_GROUPS, buildSectorModules, buildContactCategoryModules, type Module } from '../../hooks/usePermissions';
import {
  Plus, Loader2, AlertTriangle, Edit2, Trash2, X, Check,
  Shield, UserCog, Users, ChevronDown, ChevronRight, Info,
  Wrench, Package, ClipboardList, ShoppingCart, BarChart2,
  ShieldCheck, LayoutGrid, Building2, UserCheck, Boxes, Search,
  AlertCircle, Code2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CustomRole {
  id:          string;
  name:        string;
  description: string | null;
  permissions: string[];
  color:       string;
  is_system:   boolean;
  created_at:  string;
  _user_count?: number;
}

interface Sector {
  id:   string;
  name: string;
}

interface UserProfile {
  id:             string;
  display_name:   string;   // resolvido: employee.name > full_name > email > id parcial
  email:          string | null;
  role:           string | null;    // 'admin' | 'dev' | 'guest' | ...
  custom_role_id: string | null;
}

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench: Wrench, Package: Package, ClipboardList: ClipboardList,
  Boxes: Boxes, ShoppingCart: ShoppingCart, Users: Users,
  ShieldCheck: ShieldCheck, BarChart2: BarChart2,
  UserCog: UserCog, LayoutGrid: LayoutGrid,
  Building2: Building2, UserCheck: UserCheck,
};

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16',
  '#22c55e','#10b981','#14b8a6','#06b6d4','#3b82f6',
  '#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e',
  '#64748b','#374151',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;
const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function RolesManagement() {
  const { isAdmin, isDev } = usePermissions();

  const [roles, setRoles]               = useState<CustomRole[]>([]);
  const [users, setUsers]               = useState<UserProfile[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

  // Form state
  const [showForm, setShowForm]         = useState(false);
  const [editId, setEditId]             = useState<string | null>(null);
  const [formName, setFormName]         = useState('');
  const [formDesc, setFormDesc]         = useState('');
  const [formColor, setFormColor]       = useState('#6366f1');
  const [formPerms, setFormPerms]       = useState<string[]>([]);
  const [formError, setFormError]       = useState('');
  const [saving, setSaving]             = useState(false);

  // Delete
  const [deleteId, setDeleteId]         = useState<string | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // Users panel
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [searchUser, setSearchUser]     = useState('');
  const [assigningUser, setAssigningUser] = useState<string | null>(null);

  // Collapsed groups
  const [collapsedGroups,  setCollapsedGroups]  = useState<string[]>([]);
  const [sectorModules,    setSectorModules]    = useState<Module[]>([]);
  const [contactCatModules, setContactCatModules] = useState<Module[]>([]);

  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Busca roles + setores + categorias de contato em paralelo
      const [rolesRes, sectorsRes, categoriesRes] = await Promise.all([
        supabase.from('custom_roles').select('*').order('is_system', { ascending: false }).order('name'),
        supabase.from('sectors').select('id, name, hotels(name)').eq('has_stock', true).order('display_order', { ascending: true }),
        supabase.from('contact_categories').select('id, name, color').eq('is_active', true).order('name'),
      ]);

      if (rolesRes.error) throw rolesRes.error;

      // Atualiza módulos dinâmicos de setor
      if (sectorsRes.data) {
        const sectorsWithHotel = sectorsRes.data.map((s: any) => ({
          id:        s.id,
          name:      s.name,
          hotelName: s.hotels?.name ?? null,
        }));
        setSectorModules(buildSectorModules(sectorsWithHotel));
      }

      // Atualiza módulos dinâmicos de categorias de contato
      if (categoriesRes.data) {
        setContactCatModules(buildContactCategoryModules(categoriesRes.data));
      }

      // Busca profiles — tenta com custom_role_id, cai em fallback se coluna não existir
      // RPC resolve: employee.name > profile.full_name > email > id parcial
      let usersData: UserProfile[] = [];
      const usersRes = await supabase.rpc('get_users_for_roles_management');
      if (!usersRes.error) {
        usersData = (usersRes.data || []) as UserProfile[];
      }

      // Conta utilizadores por role
      const roleCounts: Record<string, number> = {};
      usersData.forEach(u => {
        if (u.custom_role_id) roleCounts[u.custom_role_id] = (roleCounts[u.custom_role_id] || 0) + 1;
      });

      setRoles((rolesRes.data || []).map((r: any) => ({
        ...r,
        permissions: Array.isArray(r.permissions) ? r.permissions : [],
        _user_count: roleCounts[r.id] || 0,
      })));
      setUsers(usersData);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar perfis.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---------------------------------------------------------------------------
  const openNew = () => {
    setEditId(null);
    setFormName(''); setFormDesc(''); setFormColor('#6366f1'); setFormPerms([]);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (role: CustomRole) => {
    setEditId(role.id);
    setFormName(role.name);
    setFormDesc(role.description || '');
    setFormColor(role.color);
    setFormPerms([...role.permissions]);
    setFormError('');
    setShowForm(true);
  };

  const togglePerm = (key: string) =>
    setFormPerms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // Todos os módulos disponíveis (fixos + dinâmicos de setor)
  const allModules = [...MODULES, ...sectorModules, ...contactCatModules];
  const allGroups  = [
    ...MODULE_GROUPS,
    ...(sectorModules.length > 0 ? ['Stock por Setor'] : []),
    ...(contactCatModules.length > 0 ? ['Agenda de Contatos'] : []),
  ];

  const toggleGroup = (group: string) => {
    const keys = allModules.filter(m => m.group === group).map(m => m.key);
    const allChecked = keys.every(k => formPerms.includes(k));
    if (allChecked) {
      setFormPerms(prev => prev.filter(k => !keys.includes(k)));
    } else {
      setFormPerms(prev => [...new Set([...prev, ...keys])]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formName.trim()) { setFormError('Nome obrigatório.'); return; }

    setSaving(true);
    try {
      const payload = {
        name:        formName.trim(),
        description: formDesc.trim() || null,
        color:       formColor,
        permissions: formPerms,
      };

      if (editId) {
        const { error } = await supabase.from('custom_roles').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('custom_roles').insert(payload);
        if (error) throw error;
      }
      setShowForm(false);
      await fetchData();
    } catch (e: any) {
      setFormError(e.message?.includes('unique') ? 'Já existe um perfil com esse nome.' : (e.message || 'Erro ao salvar.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      // Desatribui utilizadores desse role primeiro
      await supabase.from('profiles').update({ custom_role_id: null }).eq('custom_role_id', deleteId);
      const { error } = await supabase.from('custom_roles').delete().eq('id', deleteId);
      if (error) throw error;
      setDeleteId(null);
      await fetchData();
    } catch (e: any) {
      setError(e.message || 'Erro ao excluir.');
    } finally {
      setDeleting(false);
    }
  };

  const assignRole = async (userId: string, roleId: string | null) => {
    setAssigningUser(userId);
    try {
      await supabase.from('profiles').update({ custom_role_id: roleId }).eq('id', userId);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, custom_role_id: roleId } : u));
      // update counts
      setRoles(prev => prev.map(r => ({
        ...r,
        _user_count: users.filter(u => u.id !== userId ? u.custom_role_id === r.id : roleId === r.id).length,
      })));
      await fetchData();
    } catch (e: any) {
      setError(e.message || 'Erro ao atribuir perfil.');
    } finally {
      setAssigningUser(null);
    }
  };

  // Toggle dev role (só dev pode)
  const toggleDevRole = async (userId: string, currentRole: string | null) => {
    setAssigningUser(userId);
    try {
      const newRole = currentRole === 'dev' ? 'admin' : 'dev';
      await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (e: any) {
      setError(e.message || 'Erro ao alterar role dev.');
    } finally {
      setAssigningUser(null);
    }
  };

  // ---------------------------------------------------------------------------
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
      <ShieldCheck className="h-10 w-10 opacity-30" />
      <p className="text-sm">Acesso restrito a administradores.</p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );

  // Oculta usuários dev para não-devs
  const availableUsers = isDev ? users : users.filter(u => u.role !== 'dev');

  const filteredUsers = searchUser.trim()
    ? availableUsers.filter(u =>
        u.display_name.toLowerCase().includes(searchUser.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchUser.toLowerCase())
      )
    : availableUsers;

  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserCog className="h-6 w-6 text-blue-500" />Gestão de Perfis
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Crie perfis personalizados e controle o acesso a cada módulo</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-2xl shadow-sm shadow-blue-200 dark:shadow-blue-900/30 transition-all hover:scale-105 active:scale-95">
          <Plus className="h-4 w-4" />Novo perfil
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
          <button onClick={() => setError('')} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Dev panel — só visível para devs */}
      {isDev && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Code2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-sm font-bold text-purple-700 dark:text-purple-300">Acesso Dev</h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400">
              Visível apenas para Dev
            </span>
          </div>
          <p className="text-xs text-purple-500 dark:text-purple-400 mb-3">
            Usuários Dev têm acesso total ao sistema, incluindo edição de perfis de sistema.
          </p>
          <div className="space-y-2">
            {users.map(u => {
              const isDevUser = u.role === 'dev';
              const isAssigning = assigningUser === u.id;
              return (
                <div key={u.id} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{u.display_name}</p>
                    {u.email && <p className="text-[11px] text-gray-400 truncate">{u.email}</p>}
                  </div>
                  <button
                    disabled={isAssigning}
                    onClick={() => toggleDevRole(u.id, u.role)}
                    className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isDevUser
                        ? 'bg-purple-500 text-white hover:bg-red-500'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600'
                    }`}>
                    {isAssigning
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : isDevUser
                      ? <><Code2 className="h-3 w-3" />Dev</>
                      : <>Promover</>
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Roles grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {roles.map(role => {
          const isExpanded = expandedRole === role.id;
          const roleUsers  = availableUsers.filter(u => u.custom_role_id === role.id);

          return (
            <div key={role.id}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm hover:shadow-md transition-shadow">

              {/* Color bar */}
              <div className="h-1.5" style={{ background: role.color }} />

              <div className="p-5">
                {/* Title row */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: hexToRgba(role.color, 0.12) }}>
                    <Shield className="h-5 w-5" style={{ color: role.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{role.name}</h3>
                      {role.is_system && (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-md">SISTEMA</span>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{role.description}</p>
                    )}
                  </div>
                </div>

                {/* Permissions summary */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {role.permissions.length === 0 ? (
                    <span className="text-xs text-gray-400 italic">Nenhum módulo liberado</span>
                  ) : role.permissions.slice(0, 5).map(perm => {
                    const mod = allModules.find(m => m.key === perm);
                    if (!mod) return null;
                    return (
                      <span key={perm}
                        className="text-[11px] font-semibold px-2 py-1 rounded-lg"
                        style={{ background: hexToRgba(role.color, 0.1), color: role.color }}>
                        {mod.label}
                      </span>
                    );
                  })}
                  {role.permissions.length > 5 && (
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500">
                      +{role.permissions.length - 5}
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {roleUsers.length} utilizador{roleUsers.length !== 1 ? 'es' : ''}
                  </span>
                  <span>{role.permissions.length} módulo{role.permissions.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <button
                    onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 rounded-xl transition-all">
                    <Users className="h-3.5 w-3.5" />
                    Utilizadores
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>

                  {(!role.is_system || isDev) && (
                    <>
                      <button onClick={() => openEdit(role)}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {!role.is_system && (
                        <button onClick={() => setDeleteId(role.id)}
                          className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Expanded users panel */}
              {isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2">
                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                    <input
                      value={searchUser} onChange={e => setSearchUser(e.target.value)}
                      placeholder="Buscar utilizador..."
                      className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>

                  {filteredUsers.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">Nenhum utilizador encontrado.</p>
                  )}

                  {filteredUsers.map(u => {
                    const hasThisRole = u.custom_role_id === role.id;
                    const isAssigning = assigningUser === u.id;
                    return (
                      <div key={u.id} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                            {u.display_name}
                          </p>
                          {u.email && u.display_name !== u.email && (
                            <p className="text-[11px] text-gray-400 truncate">{u.email}</p>
                          )}
                        </div>
                        <button
                          disabled={isAssigning}
                          onClick={() => assignRole(u.id, hasThisRole ? null : role.id)}
                          className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            hasThisRole
                              ? 'bg-blue-500 text-white hover:bg-red-500'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600'
                          }`}>
                          {isAssigning
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : hasThisRole
                            ? <><Check className="h-3 w-3" />Atribuído</>
                            : <>Atribuir</>
                          }
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {roles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Shield className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum perfil criado ainda.</p>
          <button onClick={openNew} className="text-sm text-blue-500 hover:underline">Criar primeiro perfil</button>
        </div>
      )}

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full sm:max-w-2xl bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">

            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {editId ? 'Editar perfil' : 'Novo perfil de acesso'}
              </h2>
              <button onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-6">
              {/* Nome + Cor */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome do perfil *</label>
                  <input value={formName} onChange={e => setFormName(e.target.value)}
                    placeholder="Ex: Supervisor Manutenção"
                    className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>Cor</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setFormColor(c)}
                        className={`w-7 h-7 rounded-lg transition-transform hover:scale-110 ${formColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className={labelCls}>Descrição</label>
                <input value={formDesc} onChange={e => setFormDesc(e.target.value)}
                  placeholder="Breve descrição do perfil..." className={inputCls} />
              </div>

              {/* Permissões */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className={labelCls}>Módulos com acesso</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setFormPerms(allModules.map(m => m.key))}
                      className="text-xs text-blue-500 hover:underline">Todos</button>
                    <button type="button" onClick={() => setFormPerms([])}
                      className="text-xs text-gray-400 hover:underline">Nenhum</button>
                  </div>
                </div>

                <div className="space-y-3">
                  {allGroups.map(group => {
                    const groupModules  = allModules.filter(m => m.group === group);
                    const checkedCount  = groupModules.filter(m => formPerms.includes(m.key)).length;
                    const allChecked    = checkedCount === groupModules.length;
                    const someChecked   = checkedCount > 0 && !allChecked;
                    const isCollapsed   = collapsedGroups.includes(group);

                    return (
                      <div key={group} className="border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden">
                        {/* Group header */}
                        <div
                          onClick={() => setCollapsedGroups(prev =>
                            prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]
                          )}
                          className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          {/* Group checkbox */}
                          <button type="button"
                            onClick={e => { e.stopPropagation(); toggleGroup(group); }}
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                              allChecked
                                ? 'bg-blue-500 border-blue-500'
                                : someChecked
                                ? 'bg-blue-100 border-blue-400'
                                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                            }`}>
                            {allChecked && <Check className="h-3 w-3 text-white" />}
                            {someChecked && <div className="w-2 h-2 rounded-sm bg-blue-500" />}
                          </button>
                          <span className="flex-1 text-sm font-bold text-gray-700 dark:text-gray-200">{group}</span>
                          <span className="text-xs text-gray-400">{checkedCount}/{groupModules.length}</span>
                          {isCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                        </div>

                        {/* Module list */}
                        {!isCollapsed && (
                          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                            {groupModules.map(mod => {
                              const Icon = ICON_MAP[mod.icon] || Shield;
                              const checked = formPerms.includes(mod.key);
                              return (
                                <label key={mod.key}
                                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                                    checked ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                                  }`}>
                                  {/* Checkbox */}
                                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                                    checked ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                  }`}>
                                    {checked && <Check className="h-3 w-3 text-white" />}
                                  </div>
                                  <input type="checkbox" checked={checked}
                                    onChange={() => togglePerm(mod.key)} className="sr-only" />
                                  {/* Icon */}
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    checked ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'
                                  }`}>
                                    <Icon className={`h-4 w-4 ${checked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${checked ? 'text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                      {mod.label}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-0.5">{mod.description}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview badge */}
              {formName && (
                <div className="flex items-center gap-3 p-4 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                  <Info className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <p className="text-xs text-gray-500">Preview do badge:</p>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
                    style={{ background: formColor }}>
                    <Shield className="h-3 w-3" />
                    {formName}
                  </span>
                  <span className="text-xs text-gray-400">{formPerms.length} módulos</span>
                </div>
              )}

              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />{formError}
                </div>
              )}

              <div className="flex gap-3 pb-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : <><Check className="h-4 w-4" />Salvar perfil</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (() => {
        const role = roles.find(r => r.id === deleteId);
        const affected = users.filter(u => u.custom_role_id === deleteId).length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
            <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-6">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white text-center mb-2">
                Excluir perfil "{role?.name}"?
              </h3>
              {affected > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl mb-4">
                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {affected} utilizador{affected > 1 ? 'es' : ''} com este perfil ficarão sem acesso.
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-500 text-center mb-5">Esta ação não pode ser desfeita.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteId(null)}
                  className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl disabled:opacity-60 transition-colors">
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Excluir
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
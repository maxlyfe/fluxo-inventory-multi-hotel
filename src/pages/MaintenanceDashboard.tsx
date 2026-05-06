// src/pages/MaintenanceDashboard.tsx
// Painel principal de manutenções — roles: admin, management, sup-governanca

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';
import {
  Wrench, Plus, Filter, RefreshCw, Clock, CheckCircle,
  AlertTriangle, Zap, User, MapPin, ChevronRight, Search,
  Settings, Package, Building2, X, Loader2, BedDouble,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ticket {
  id: string;
  hotel_id: string;
  title: string;
  description: string;
  priority: 'low'|'medium'|'high'|'urgent';
  status: 'open'|'assigned'|'in_progress'|'waiting_material'|'resolved'|'cancelled';
  location_type: string;
  location_detail: string;
  opened_by_name: string;
  opened_by_role: string;
  assigned_to: string | null;
  under_warranty: boolean;
  created_at: string;
  updated_at: string;
  hotels?: { name: string };
  assignee?: { email: string } | null;
  ticket_photos?: { photo_url: string; phase: string }[];
}

interface Stats {
  open: number;
  assigned: number;
  in_progress: number;
  waiting_material: number;
  resolved: number;
  urgent: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  open:             { label: 'Aberto',          color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-200 dark:border-blue-800',   dot: 'bg-blue-500',   icon: Clock       },
  assigned:         { label: 'Atribuído',        color: 'text-purple-600 dark:text-purple-400',bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800',dot: 'bg-purple-500', icon: User        },
  in_progress:      { label: 'Em Andamento',     color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20',   border: 'border-amber-200 dark:border-amber-800',  dot: 'bg-amber-500',  icon: Wrench      },
  waiting_material: { label: 'Aguard. Material', color: 'text-orange-600 dark:text-orange-400',bg: 'bg-orange-50 dark:bg-orange-900/20',border: 'border-orange-200 dark:border-orange-800',dot: 'bg-orange-500', icon: Package     },
  resolved:         { label: 'Resolvido',        color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20',   border: 'border-green-200 dark:border-green-800',  dot: 'bg-green-500',  icon: CheckCircle },
  cancelled:        { label: 'Cancelado',        color: 'text-gray-500 dark:text-gray-400',   bg: 'bg-gray-50 dark:bg-gray-800',        border: 'border-gray-200 dark:border-gray-700',    dot: 'bg-gray-400',   icon: X           },
};

const PRIORITY_CONFIG = {
  low:    { label: 'Baixa',   dot: 'bg-blue-400',   text: 'text-blue-500'   },
  medium: { label: 'Média',   dot: 'bg-amber-400',  text: 'text-amber-500'  },
  high:   { label: 'Alta',    dot: 'bg-orange-500', text: 'text-orange-500' },
  urgent: { label: 'Urgente', dot: 'bg-red-500',    text: 'text-red-500'    },
};

const LOCATION_LABELS: Record<string, string> = {
  room: 'Quarto', common: 'Área Comum', sector: 'Setor', free: 'Local',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon: Icon, color, onClick, active }: {
  label: string; value: number; icon: any; color: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left w-full
      ${active ? `${color} border-current/30 shadow-sm` : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? 'bg-white/40' : 'bg-gray-50 dark:bg-gray-700'}`}>
        <Icon className={`h-5 w-5 ${active ? 'text-current' : 'text-gray-500 dark:text-gray-400'}`} />
      </div>
      <div>
        <p className={`text-2xl font-bold leading-none ${active ? 'text-current' : 'text-gray-900 dark:text-white'}`}>{value}</p>
        <p className={`text-xs mt-0.5 ${active ? 'text-current/70' : 'text-gray-500 dark:text-gray-400'}`}>{label}</p>
      </div>
    </button>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function TicketCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const isUrgent = ticket.priority === 'urgent';
  return (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-2xl border transition-all hover:shadow-md group
      ${isUrgent
        ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50 hover:border-red-300'
        : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}>
      <div className="flex items-start gap-3">
        {/* Foto thumbnail se houver */}
        {ticket.ticket_photos && ticket.ticket_photos.length > 0 ? (
          <img src={ticket.ticket_photos[0].photo_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-gray-100 dark:border-gray-700" />
        ) : (
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isUrgent ? 'bg-red-100 dark:bg-red-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
            <Wrench className={`h-5 w-5 ${isUrgent ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.under_warranty && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-3 w-3" />Garantia
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
            {ticket.title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            {LOCATION_LABELS[ticket.location_type] || ticket.location_type}: {ticket.location_detail}
            {ticket.hotels && <span className="ml-1 text-gray-400">· {ticket.hotels.name}</span>}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{ticket.opened_by_name}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(ticket.created_at), { locale: ptBR, addSuffix: true })}</span>
          </div>
        </div>

        <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-1 group-hover:text-orange-400 transition-colors" />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function MaintenanceDashboard() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const navigate  = useNavigate();

  const canChangeHotel = ['admin', 'management'].includes(user?.role || '');
  const defaultHotelId = selectedHotel?.id || '';

  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterHotel, setFilterHotel]   = useState<string>(defaultHotelId);
  const [hotels, setHotels]         = useState<{id:string;name:string}[]>([]);
  const [stats, setStats]           = useState<Stats>({ open:0, assigned:0, in_progress:0, waiting_material:0, resolved:0, urgent:0 });

  // ---------------------------------------------------------------------------
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('maintenance_tickets')
        .select(`*, hotels(name), ticket_photos(photo_url, phase)`)
        .order('created_at', { ascending: false });

      // Admin/management podem ver todos ou filtrar; outros sempre veem só o hotel selecionado
      const effectiveHotel = canChangeHotel ? filterHotel : defaultHotelId;
      if (effectiveHotel) q = q.eq('hotel_id', effectiveHotel);
      if (filterStatus)   q = q.eq('status', filterStatus);

      const { data, error } = await q;
      if (error) throw error;

      const all = (data || []) as Ticket[];
      setTickets(all);
      setStats({
        open:             all.filter(t => t.status === 'open').length,
        assigned:         all.filter(t => t.status === 'assigned').length,
        in_progress:      all.filter(t => t.status === 'in_progress').length,
        waiting_material: all.filter(t => t.status === 'waiting_material').length,
        resolved:         all.filter(t => t.status === 'resolved').length,
        urgent:           all.filter(t => t.priority === 'urgent' && t.status !== 'resolved' && t.status !== 'cancelled').length,
      });
    } catch (err) {
      console.error('Erro ao carregar tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterHotel, canChangeHotel, defaultHotelId]);

  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => setHotels(data || []));
  }, []);

  // Atualiza filtro de hotel quando o usuário troca de unidade
  useEffect(() => {
    if (!canChangeHotel && selectedHotel?.id) {
      setFilterHotel(selectedHotel.id);
    }
  }, [selectedHotel?.id]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Realtime
  useEffect(() => {
    const channel = supabase.channel('maintenance_tickets_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_tickets' }, fetchTickets)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTickets]);

  // Filtered tickets
  const filtered = tickets.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.location_detail.toLowerCase().includes(q) ||
      t.opened_by_name.toLowerCase().includes(q)
    );
  });

  const activeTickets   = filtered.filter(t => !['resolved','cancelled'].includes(t.status));
  const resolvedTickets = filtered.filter(t => ['resolved','cancelled'].includes(t.status));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200 dark:shadow-orange-900/40">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            Manutenções
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} registrado{tickets.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchTickets} title="Atualizar"
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-orange-600 hover:border-orange-300 transition-all">
            <RefreshCw className="h-4 w-4" />
          </button>
          <Link to="/maintenance/equipment"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:border-orange-300 hover:text-orange-600 transition-all">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Equipamentos</span>
          </Link>
          <Link to="/maintenance/ticket/new"
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo Ticket</span>
            <span className="sm:hidden">Novo</span>
          </Link>
        </div>
      </div>

      {/* Ações Rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link
          to="/maintenance/rack"
          className="flex items-center gap-4 p-6 bg-orange-600 hover:bg-orange-700 text-white rounded-3xl shadow-lg shadow-orange-200 dark:shadow-orange-900/20 transition-all group"
        >
          <div className="p-3 rounded-2xl bg-white/20 group-hover:scale-110 transition-transform">
            <BedDouble className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-80">Vistoria Matinal</p>
            <p className="text-lg font-black tracking-tight text-white">Rack de UHs</p>
          </div>
        </Link>

        <Link
          to="/maintenance/ticket/new"
          className="flex items-center gap-4 p-6 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:border-orange-500 rounded-3xl shadow-sm transition-all group"
        >
          <div className="p-3 rounded-2xl bg-orange-50 dark:bg-orange-900/20 group-hover:scale-110 transition-transform text-orange-600 dark:text-orange-400">
            <Plus className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Novo Chamado</p>
            <p className="text-lg font-black tracking-tight text-gray-900 dark:text-white">Abrir Ticket</p>
          </div>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
        {[
          { key: 'open',             label: 'Abertos',    icon: Clock,        color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'   },
          { key: 'assigned',         label: 'Atribuídos', icon: User,         color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600'                },
          { key: 'in_progress',      label: 'Em andamento',icon: Wrench,      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600'                   },
          { key: 'waiting_material', label: 'Aguard. mat.',icon: Package,     color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600'                },
          { key: 'resolved',         label: 'Resolvidos', icon: CheckCircle,  color: 'bg-green-50 dark:bg-green-900/20 text-green-600'                   },
          { key: 'urgent',           label: 'Urgentes',   icon: Zap,          color: 'bg-red-50 dark:bg-red-900/20 text-red-600'                        },
        ].map(s => (
          <StatCard key={s.key} label={s.label} value={stats[s.key as keyof Stats]} icon={s.icon}
            color={s.color} active={filterStatus === s.key}
            onClick={() => setFilterStatus(prev => prev === s.key ? '' : s.key)} />
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tickets..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all placeholder:text-gray-400" />
        </div>
        {canChangeHotel && hotels.length > 1 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <select value={filterHotel} onChange={e => setFilterHotel(e.target.value)}
              className="pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none">
              <option value="">Todas as unidades</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}
        {(filterStatus || search || (canChangeHotel && filterHotel !== defaultHotelId)) && (
          <button onClick={() => { setFilterStatus(''); setSearch(''); if (canChangeHotel) setFilterHotel(defaultHotelId); }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
            <X className="h-3.5 w-3.5" />Limpar
          </button>
        )}
      </div>

      {/* Tickets list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Carregando tickets...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Wrench className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum ticket encontrado.</p>
          <Link to="/maintenance/ticket/new" className="text-sm text-orange-500 hover:underline">Abrir o primeiro ticket</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTickets.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Ativos · {activeTickets.length}
              </h2>
              <div className="space-y-2">
                {activeTickets.map(t => (
                  <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/maintenance/ticket/${t.id}`)} />
                ))}
              </div>
            </div>
          )}
          {resolvedTickets.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Concluídos · {resolvedTickets.length}
              </h2>
              <div className="space-y-2 opacity-70">
                {resolvedTickets.map(t => (
                  <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/maintenance/ticket/${t.id}`)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
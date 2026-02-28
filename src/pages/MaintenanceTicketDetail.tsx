// src/pages/MaintenanceTicketDetail.tsx
// Detalhe do ticket — linha do tempo, atribuição, conclusão

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Wrench, MapPin, User, Clock, CheckCircle, AlertTriangle,
  Package, Camera, Send, Loader2, X, ChevronDown, Shield,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ticket {
  id: string; hotel_id: string; equipment_id: string | null;
  location_type: string; location_detail: string;
  title: string; description: string;
  priority: string; status: string;
  opened_by_user: string | null; opened_by_name: string; opened_by_role: string;
  assigned_to: string | null; assigned_by: string | null; assigned_at: string | null;
  resolution_notes: string | null; resolved_at: string | null;
  under_warranty: boolean; warranty_service_provider: string | null; warranty_new_expiry: string | null;
  created_at: string; updated_at: string;
  hotels?: { name: string };
  maintenance_equipment?: { name: string; brand: string; model: string } | null;
  ticket_photos?: { id: string; photo_url: string; phase: string }[];
}

interface TicketUpdate {
  id: string; ticket_id: string; update_type: string;
  content: string; metadata: any; created_by_name: string; created_at: string;
}

interface AppUser { id: string; email: string; role: string; }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  open:             { label: 'Aberto',          color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-200 dark:border-blue-800',   icon: Clock        },
  assigned:         { label: 'Atribuído',        color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800',icon: User         },
  in_progress:      { label: 'Em Andamento',     color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20',   border: 'border-amber-200 dark:border-amber-800',  icon: Wrench       },
  waiting_material: { label: 'Aguard. Material', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800',icon: Package      },
  resolved:         { label: 'Resolvido',        color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20',   border: 'border-green-200 dark:border-green-800',  icon: CheckCircle  },
  cancelled:        { label: 'Cancelado',        color: 'text-gray-500',   bg: 'bg-gray-50 dark:bg-gray-800',        border: 'border-gray-200 dark:border-gray-700',    icon: X            },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  low:    { label: 'Baixa',   color: 'text-blue-600',   dot: 'bg-blue-400'   },
  medium: { label: 'Média',   color: 'text-amber-600',  dot: 'bg-amber-400'  },
  high:   { label: 'Alta',    color: 'text-orange-600', dot: 'bg-orange-500' },
  urgent: { label: 'Urgente', color: 'text-red-600',    dot: 'bg-red-500'    },
};

const LOCATION_LABELS: Record<string, string> = {
  room: 'Quarto', common: 'Área Comum', sector: 'Setor', free: 'Local',
};

const UPDATE_ICONS: Record<string, any> = {
  comment: Send, status_change: Clock, assignment: User,
  material_request: Package, resolution: CheckCircle, photo: Camera,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isManager = (role?: string) =>
  ['admin','management','sup-governanca'].includes(role || '');

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function MaintenanceTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [ticket, setTicket]   = useState<Ticket | null>(null);
  const [updates, setUpdates] = useState<TicketUpdate[]>([]);
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Action state
  const [comment, setComment]           = useState('');
  const [materialNote, setMaterialNote] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [assignTo, setAssignTo]         = useState('');
  const [warrantyProvider, setWarrantyProvider] = useState('');
  const [warrantyExpiry, setWarrantyExpiry]     = useState('');
  const [actionPhoto, setActionPhoto]   = useState<File | null>(null);
  const [actionPhotoPreview, setActionPhotoPreview] = useState('');
  const [activeAction, setActiveAction] = useState<'comment'|'material'|'resolve'|'assign'|null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');
  const [lightbox, setLightbox]         = useState<string | null>(null); // URL da foto em destaque
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [ticketRes, updatesRes, photosRes] = await Promise.all([
        supabase
          .from('maintenance_tickets')
          .select('*, hotels(name), maintenance_equipment(name, brand, model)')
          .eq('id', id)
          .single(),
        supabase
          .from('ticket_updates')
          .select('*')
          .eq('ticket_id', id)
          .order('created_at'),
        // Fotos buscadas separadamente — garante chegada mesmo se join falhar
        supabase
          .from('ticket_photos')
          .select('id, photo_url, phase, created_at')
          .eq('ticket_id', id)
          .order('created_at'),
      ]);

      if (ticketRes.data) {
        const t = ticketRes.data as Ticket;
        t.ticket_photos = (photosRes.data || []) as { id: string; photo_url: string; phase: string }[];
        setTicket(t);
      }
      setUpdates((updatesRes.data || []) as TicketUpdate[]);
    } catch (err) {
      console.error('Erro ao carregar ticket:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);

  useEffect(() => {
    supabase.rpc('get_all_users_with_profile').then(({ data }) => setUsers((data || []) as AppUser[]));
  }, []);

  // ---------------------------------------------------------------------------
  // Photo handling
  // ---------------------------------------------------------------------------
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionPhoto(file);
    const reader = new FileReader();
    reader.onload = ev => setActionPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const uploadPhoto = async (file: File, ticketId: string, phase: string): Promise<string | null> => {
    const ext  = file.name.split('.').pop();
    const path = `tickets/${ticketId}/${phase}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('maintenance').upload(path, file, { upsert: true });
    if (error) return null;
    return supabase.storage.from('maintenance').getPublicUrl(path).data.publicUrl;
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const addUpdate = async (type: string, content: string, metadata: any = {}, photoPhase?: string) => {
    if (!ticket || !user) return;
    setSubmitting(true);
    setError('');
    try {
      let photoUrl: string | null = null;
      if (actionPhoto && photoPhase) {
        photoUrl = await uploadPhoto(actionPhoto, ticket.id, photoPhase);
        if (photoUrl) {
          await supabase.from('ticket_photos').insert({ ticket_id: ticket.id, photo_url: photoUrl, phase: photoPhase, uploaded_by: user.id });
        }
      }

      await supabase.from('ticket_updates').insert({
        ticket_id: ticket.id, update_type: type, content,
        metadata: { ...metadata, ...(photoUrl ? { photo_url: photoUrl } : {}) },
        created_by_user: user.id, created_by_name: user.email,
      });

      setComment(''); setMaterialNote(''); setResolutionNote('');
      setActionPhoto(null); setActionPhotoPreview(''); setActiveAction(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!ticket || !user) return;
    await supabase.from('maintenance_tickets').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', ticket.id);
    await addUpdate('status_change', `Status alterado para: ${STATUS_CONFIG[newStatus]?.label || newStatus}`, { from: ticket.status, to: newStatus });
  };

  const handleAssign = async () => {
    if (!ticket || !user || !assignTo) return;
    const assignee = users.find(u => u.id === assignTo);
    await supabase.from('maintenance_tickets').update({
      assigned_to: assignTo, assigned_by: user.id, assigned_at: new Date().toISOString(),
      status: 'assigned', updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);
    await addUpdate('assignment', `Ticket atribuído para ${assignee?.email || assignTo}`, { assigned_to: assignTo });
    setAssignTo('');
  };

  const handleComment = () => {
    if (!comment.trim()) return;
    addUpdate('comment', comment.trim(), {}, 'update');
  };

  const handleMaterial = () => {
    if (!materialNote.trim()) return;
    supabase.from('maintenance_tickets').update({ status: 'waiting_material', updated_at: new Date().toISOString() }).eq('id', ticket!.id);
    addUpdate('material_request', materialNote.trim(), { status: 'waiting_material' });
  };

  const handleResolve = async () => {
    if (!resolutionNote.trim()) { setError('Descreva o que foi feito.'); return; }
    if (!ticket || !user) return;
    await supabase.from('maintenance_tickets').update({
      status: 'resolved', resolution_notes: resolutionNote.trim(),
      resolved_by: user.id, resolved_at: new Date().toISOString(),
      warranty_service_provider: warrantyProvider || null,
      warranty_new_expiry: warrantyExpiry || null,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);
    await addUpdate('resolution', resolutionNote.trim(), {
      warranty_provider: warrantyProvider, warranty_expiry: warrantyExpiry,
    }, 'resolution');
  };

  // ---------------------------------------------------------------------------
  // Loading / Not found
  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
    </div>
  );

  if (!ticket) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-gray-400">
      <AlertTriangle className="h-10 w-10 opacity-30" />
      <p>Ticket não encontrado.</p>
      <button onClick={() => navigate('/maintenance')} className="text-orange-500 hover:underline text-sm">Voltar</button>
    </div>
  );

  const statusCfg  = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
  const priorityCfg = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.medium;
  const StatusIcon = statusCfg.icon;
  const manager    = isManager(user?.role);
  const isAssignee = user?.id === ticket.assigned_to;
  const canAct     = manager || isAssignee;
  const isResolved = ['resolved','cancelled'].includes(ticket.status);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

      {/* Back */}
      <button onClick={() => navigate('/maintenance')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-orange-600 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />Voltar ao painel
      </button>

      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6 mb-5 shadow-sm">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {/* Status badge */}
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${statusCfg.color} ${statusCfg.bg} ${statusCfg.border}`}>
                <StatusIcon className="h-3.5 w-3.5" />{statusCfg.label}
              </span>
              {/* Priority */}
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${priorityCfg.color}`}>
                <span className={`w-2 h-2 rounded-full ${priorityCfg.dot}`} />{priorityCfg.label}
              </span>
              {ticket.under_warranty && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                  <Shield className="h-3 w-3" />Garantia
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{ticket.title}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{LOCATION_LABELS[ticket.location_type]}: {ticket.location_detail}</span>
              {ticket.hotels && <span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />{ticket.hotels.name}</span>}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-4 leading-relaxed">{ticket.description}</p>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-2xl p-3">
            <p className="text-xs text-gray-400 mb-0.5">Aberto por</p>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{ticket.opened_by_name}</p>
            <p className="text-xs text-gray-400">{ticket.opened_by_role}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-2xl p-3">
            <p className="text-xs text-gray-400 mb-0.5">Data</p>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {format(new Date(ticket.created_at), "dd/MM/yy HH:mm")}
            </p>
            <p className="text-xs text-gray-400">{formatDistanceToNow(new Date(ticket.created_at), { locale: ptBR, addSuffix: true })}</p>
          </div>
          {ticket.maintenance_equipment && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-2xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Equipamento</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{ticket.maintenance_equipment.name}</p>
              <p className="text-xs text-gray-400">{ticket.maintenance_equipment.brand} {ticket.maintenance_equipment.model}</p>
            </div>
          )}
        </div>

        {/* Fotos por fase — abertura, atualização, resolução */}
        {ticket.ticket_photos && ticket.ticket_photos.length > 0 && (() => {
          const byPhase: Record<string, { id: string; photo_url: string; phase: string }[]> = {};
          ticket.ticket_photos!.forEach(p => {
            const label = p.phase === 'opening' ? 'Abertura' : p.phase === 'resolution' ? 'Resolução' : 'Atualização';
            if (!byPhase[label]) byPhase[label] = [];
            byPhase[label].push(p);
          });
          return (
            <div className="mt-4 space-y-3">
              {Object.entries(byPhase).map(([phase, photos]) => (
                <div key={phase}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    📷 Fotos · {phase}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {photos.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setLightbox(p.photo_url)}
                        className="relative group focus:outline-none"
                      >
                        <img
                          src={p.photo_url}
                          alt={`Foto ${phase}`}
                          className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-2xl border border-gray-100 dark:border-gray-700 group-hover:opacity-80 group-hover:scale-105 transition-all duration-150 shadow-sm"
                        />
                        <div className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-bold transition-opacity">Ver</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Actions (só para quem pode agir e ticket não resolvido) */}
      {canAct && !isResolved && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-5 mb-5 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ações</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveAction(a => a === 'comment' ? null : 'comment')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 transition-all">
              <Send className="h-4 w-4" />Comentar
            </button>
            <button onClick={() => setActiveAction(a => a === 'material' ? null : 'material')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-orange-400 hover:text-orange-600 transition-all">
              <Package className="h-4 w-4" />Pedir material
            </button>
            {manager && (
              <button onClick={() => setActiveAction(a => a === 'assign' ? null : 'assign')}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-purple-400 hover:text-purple-600 transition-all">
                <User className="h-4 w-4" />Atribuir
              </button>
            )}
            <button onClick={() => setActiveAction(a => a === 'resolve' ? null : 'resolve')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-100 transition-all">
              <CheckCircle className="h-4 w-4" />Concluir
            </button>
          </div>

          {/* Comment form */}
          {activeAction === 'comment' && (
            <div className="mt-4 space-y-3">
              <textarea value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Escreva um comentário ou atualização..." rows={3}
                className={`${inputCls} resize-none`} />
              {/* Photo */}
              {actionPhotoPreview ? (
                <div className="relative w-20 h-20">
                  <img src={actionPhotoPreview} alt="" className="w-full h-full object-cover rounded-xl border border-gray-100 dark:border-gray-700" />
                  <button type="button" onClick={() => { setActionPhoto(null); setActionPhotoPreview(''); }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-orange-600 transition-colors">
                  <Camera className="h-4 w-4" />Anexar foto
                </button>
              )}
              <button onClick={handleComment} disabled={submitting || !comment.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar comentário
              </button>
            </div>
          )}

          {/* Material request */}
          {activeAction === 'material' && (
            <div className="mt-4 space-y-3">
              <textarea value={materialNote} onChange={e => setMaterialNote(e.target.value)}
                placeholder="Descreva o material necessário..." rows={3}
                className={`${inputCls} resize-none`} />
              <button onClick={handleMaterial} disabled={submitting || !materialNote.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                Registrar pedido
              </button>
            </div>
          )}

          {/* Assign */}
          {activeAction === 'assign' && manager && (
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                  className={`${inputCls} pl-10 appearance-none`}>
                  <option value="">Selecionar usuário...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.email} ({u.role})</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
              <button onClick={handleAssign} disabled={submitting || !assignTo}
                className="px-4 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                Atribuir
              </button>
            </div>
          )}

          {/* Resolve */}
          {activeAction === 'resolve' && (
            <div className="mt-4 space-y-3">
              <textarea value={resolutionNote} onChange={e => setResolutionNote(e.target.value)}
                placeholder="Descreva o que foi feito para resolver o problema..." rows={3}
                className={`${inputCls} resize-none`} />
              {ticket.under_warranty && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800">
                  <div>
                    <label className="block text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">Empresa que realizou</label>
                    <input type="text" value={warrantyProvider} onChange={e => setWarrantyProvider(e.target.value)}
                      placeholder="Nome da empresa..." className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">Nova garantia até</label>
                    <input type="date" value={warrantyExpiry} onChange={e => setWarrantyExpiry(e.target.value)}
                      className={inputCls} />
                  </div>
                </div>
              )}
              {/* Photo */}
              {actionPhotoPreview ? (
                <div className="relative w-20 h-20">
                  <img src={actionPhotoPreview} alt="" className="w-full h-full object-cover rounded-xl border border-gray-100 dark:border-gray-700" />
                  <button type="button" onClick={() => { setActionPhoto(null); setActionPhotoPreview(''); }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-orange-600 transition-colors">
                  <Camera className="h-4 w-4" />Foto da resolução (opcional)
                </button>
              )}
              <button onClick={handleResolve} disabled={submitting || !resolutionNote.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Concluir ticket
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 mt-3 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
            </div>
          )}
        </div>
      )}

      {/* Status change quick buttons (manager) */}
      {manager && !isResolved && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-5 mb-5 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Alterar status</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_CONFIG).filter(([k]) => k !== ticket.status && k !== 'cancelled').map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button key={key} onClick={() => handleStatusChange(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                  <Icon className="h-3.5 w-3.5" />{cfg.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Histórico</h2>
        {updates.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhuma atualização ainda.</p>
        ) : (
          <div className="space-y-4">
            {updates.map((u, i) => {
              const Icon = UPDATE_ICONS[u.update_type] || Send;
              const isLast = i === updates.length - 1;
              return (
                <div key={u.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                    </div>
                    {!isLast && <div className="w-px flex-1 bg-gray-100 dark:bg-gray-700 mt-1" />}
                  </div>
                  <div className={`flex-1 ${!isLast ? 'pb-4' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{u.created_by_name}</span>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(u.created_at), { locale: ptBR, addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{u.content}</p>
                    {u.metadata?.photo_url && (
                      <button
                        onClick={() => setLightbox(u.metadata.photo_url)}
                        className="mt-2 inline-block group focus:outline-none"
                      >
                        <img
                          src={u.metadata.photo_url}
                          alt="Foto"
                          className="w-24 h-24 object-cover rounded-xl border border-gray-100 dark:border-gray-700 group-hover:opacity-80 group-hover:scale-105 transition-all duration-150 shadow-sm"
                        />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />

      {/* Lightbox — visualização em tela cheia */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt="Foto ampliada"
            className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
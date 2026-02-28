// src/pages/MaintenanceEquipmentDetail.tsx
// Ficha do equipamento acessada via QR Code
// Sem login → redireciona para /login?redirect=...
// Com login → mostra ficha completa + histórico de tickets

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Wrench, Shield, Calendar, Hash, Tag, Building2,
  MapPin, Plus, Clock, CheckCircle, AlertTriangle, Loader2, Package,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Equipment {
  id: string; name: string; category: string;
  brand: string | null; model: string | null; serial_number: string | null;
  purchase_date: string | null; warranty_months: number | null;
  location_detail: string | null; status: string; notes: string | null;
  qr_code_id: string; hotels?: { id: string; name: string };
}

interface Ticket {
  id: string; title: string; status: string; priority: string;
  opened_by_name: string; created_at: string; resolved_at: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo', available: 'Disponível', loaned: 'Emprestado', inactive: 'Inativo',
};

const TICKET_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  open:             { label: 'Aberto',      color: 'text-blue-600',   icon: Clock       },
  assigned:         { label: 'Atribuído',   color: 'text-purple-600', icon: Clock       },
  in_progress:      { label: 'Em andamento',color: 'text-amber-600',  icon: Wrench      },
  waiting_material: { label: 'Aguard. mat.',color: 'text-orange-600', icon: Package     },
  resolved:         { label: 'Resolvido',   color: 'text-green-600',  icon: CheckCircle },
  cancelled:        { label: 'Cancelado',   color: 'text-gray-500',   icon: AlertTriangle },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function MaintenanceEquipmentDetail() {
  const { qrId } = useParams<{ qrId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [tickets, setTickets]     = useState<Ticket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);

  // ---------------------------------------------------------------------------
  // Redirect if not logged in
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/maintenance/equipment/${qrId}`, { replace: true });
    }
  }, [user, authLoading, qrId]);

  // ---------------------------------------------------------------------------
  // Fetch equipment data diretamente do Supabase (usuário já está logado)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!qrId || !user) return;

    const fetchData = async () => {
      setLoading(true);
      setNotFound(false);

      try {
        // Busca equipamento pelo qr_code_id
        const { data: eq, error: eqErr } = await supabase
          .from('maintenance_equipment')
          .select('*, hotels:hotel_id(id, name)')
          .eq('qr_code_id', qrId)
          .maybeSingle();

        if (eqErr) {
          console.error('Erro ao buscar equipamento:', eqErr);
          setNotFound(true);
          return;
        }

        if (!eq) {
          console.warn('Equipamento não encontrado para qr_code_id:', qrId);
          setNotFound(true);
          return;
        }

        setEquipment(eq as Equipment);

        // Busca tickets deste equipamento
        const { data: tks, error: tkErr } = await supabase
          .from('maintenance_tickets')
          .select('id, title, status, priority, opened_by_name, created_at, resolved_at')
          .eq('equipment_id', eq.id)
          .order('created_at', { ascending: false });

        if (tkErr) console.error('Erro ao buscar tickets:', tkErr);
        setTickets((tks || []) as Ticket[]);

      } catch (err) {
        console.error('Erro inesperado:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [qrId, user]);

  // ---------------------------------------------------------------------------
  // Warranty helpers
  // ---------------------------------------------------------------------------
  const wExpires = (() => {
    if (!equipment?.purchase_date || !equipment?.warranty_months) return null;
    const d = new Date(equipment.purchase_date);
    d.setMonth(d.getMonth() + equipment.warranty_months);
    return d;
  })();

  const wStatus = (() => {
    if (!wExpires) return 'none';
    const days = (wExpires.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'active';
  })();

  const totalTickets    = tickets.length;
  const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;
  const openTickets     = tickets.filter(t => !['resolved','cancelled'].includes(t.status)).length;

  // ---------------------------------------------------------------------------
  // Loading / Not found
  // ---------------------------------------------------------------------------
  if (authLoading || (loading && user)) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Carregando equipamento...</p>
      </div>
    </div>
  );

  if (notFound) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-gray-400 bg-gray-50 dark:bg-gray-950">
      <AlertTriangle className="h-12 w-12 opacity-30" />
      <p className="text-lg font-semibold text-gray-600 dark:text-gray-300">Equipamento não encontrado</p>
      <p className="text-sm">O QR Code pode estar desatualizado ou o equipamento foi removido.</p>
      <Link to="/maintenance" className="text-orange-500 hover:underline text-sm">Ir para o painel</Link>
    </div>
  );

  if (!equipment) return null;

  const infoItems = [
    equipment.brand || equipment.model
      ? { icon: Tag,      label: 'Marca / Modelo', value: [equipment.brand, equipment.model].filter(Boolean).join(' ') }
      : null,
    equipment.serial_number
      ? { icon: Hash,     label: 'Nº de Série',    value: equipment.serial_number }
      : null,
    equipment.purchase_date
      ? { icon: Calendar, label: 'Data de compra',  value: format(new Date(equipment.purchase_date), "dd/MM/yyyy") }
      : null,
    equipment.location_detail
      ? { icon: MapPin,   label: 'Localização',     value: equipment.location_detail }
      : null,
    equipment.hotels
      ? { icon: Building2,label: 'Hotel',           value: equipment.hotels.name }
      : null,
  ].filter(Boolean) as { icon: any; label: string; value: string }[];

  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Orange header */}
      <div className="bg-gradient-to-br from-orange-500 to-amber-500 text-white px-4 py-8 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4 opacity-80">
            <Wrench className="h-5 w-5" />
            <span className="text-sm font-medium">{equipment.category}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
            <span className="text-sm font-medium">{STATUS_LABELS[equipment.status] || equipment.status}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">{equipment.name}</h1>
          {equipment.hotels && <p className="text-sm opacity-80">{equipment.hotels.name}</p>}

          {/* Warranty banner */}
          {wExpires && (
            <div className={`mt-4 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold
              ${wStatus === 'active'   ? 'bg-white/20 text-white' :
                wStatus === 'expiring' ? 'bg-amber-900/30 text-amber-100' :
                'bg-red-900/30 text-red-100'}`}>
              <Shield className="h-4 w-4 flex-shrink-0" />
              {wStatus === 'active'   && `Garantia ativa até ${wExpires.toLocaleDateString('pt-BR')}`}
              {wStatus === 'expiring' && `⚠️ Garantia expira em ${wExpires.toLocaleDateString('pt-BR')}`}
              {wStatus === 'expired'  && `Garantia expirou em ${wExpires.toLocaleDateString('pt-BR')}`}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total', value: totalTickets,    color: 'text-gray-900 dark:text-white'   },
            { label: 'Abertos', value: openTickets,   color: 'text-amber-600 dark:text-amber-400' },
            { label: 'Resolvidos', value: resolvedTickets, color: 'text-green-600 dark:text-green-400' },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Info card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Informações</h2>
          <div className="space-y-3">
            {infoItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {equipment.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Observações</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{equipment.notes}</p>
            </div>
          )}
        </div>

        {/* Open ticket CTA */}
        <Link to={`/maintenance/ticket/new?equipment_id=${equipment.id}&hotel_id=${(equipment.hotels as any)?.id || equipment.hotels?.id || ''}`}
          className="flex items-center justify-center gap-3 w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl transition-colors shadow-lg shadow-orange-200 dark:shadow-orange-900/30">
          <Plus className="h-5 w-5" />
          Abrir Chamado para este Equipamento
        </Link>

        {/* Ticket history */}
        {tickets.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Histórico de Manutenções · {tickets.length}
            </h2>
            <div className="space-y-3">
              {tickets.map(t => {
                const cfg = TICKET_STATUS[t.status] ?? TICKET_STATUS.open;
                const Icon = cfg.icon;
                return (
                  <Link key={t.id} to={`/maintenance/ticket/${t.id}`}
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                    <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <Icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                        {t.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span className={cfg.color + ' font-medium'}>{cfg.label}</span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(t.created_at), { locale: ptBR, addSuffix: true })}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
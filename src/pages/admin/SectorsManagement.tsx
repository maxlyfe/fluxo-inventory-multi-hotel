// src/pages/admin/SectorsManagement.tsx
// Gestão de setores por hotel — criar, editar, reordenar, excluir
// Cada setor pode ter stock independente (has_stock)

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { usePermissions } from '../../hooks/usePermissions';
import {
  Plus, Loader2, AlertTriangle, Edit2, Trash2, X, Check,
  Building2, LayoutGrid, Package, GripVertical, AlertCircle,
  ChevronUp, ChevronDown, Boxes, ArrowRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Hotel { id: string; name: string; }

interface Sector {
  id:            string;
  hotel_id:      string;
  name:          string;
  has_stock:     boolean;
  color:         string;
  display_order: number;
  created_at:    string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SECTOR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#f59e0b','#22c55e','#10b981','#14b8a6','#06b6d4',
  '#3b82f6','#64748b','#374151',
];

const inputCls = `w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  placeholder:text-gray-400 transition-all`;
const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// Transfer Stock Modal
// ---------------------------------------------------------------------------
interface TransferModalProps {
  sector:   Sector;
  sectors:  Sector[];
  hotelId:  string;
  onClose:  () => void;
}

function TransferStockModal({ sector, sectors, hotelId, onClose }: TransferModalProps) {
  const [targetId, setTargetId]   = useState('');
  const [transferring, setTr]     = useState(false);
  const [done, setDone]           = useState(false);
  const [transferCount, setCount] = useState(0);
  const [error, setError]         = useState('');

  const targets = sectors.filter(s => s.id !== sector.id && s.has_stock);

  const handleTransfer = async () => {
    if (!targetId) { setError('Selecione o setor destino.'); return; }
    setTr(true); setError('');
    try {
      // Fetch stock items from source sector
      const { data: items, error: fetchErr } = await supabase
        .from('stock_items')
        .select('*')
        .eq('sector_id', sector.id)
        .eq('hotel_id', hotelId);
      if (fetchErr) throw fetchErr;
      if (!items || items.length === 0) {
        setError('Este setor não possui itens de stock para transferir.');
        setTr(false);
        return;
      }

      // Update all items to new sector
      const { error: updateErr } = await supabase
        .from('stock_items')
        .update({ sector_id: targetId })
        .eq('sector_id', sector.id)
        .eq('hotel_id', hotelId);
      if (updateErr) throw updateErr;

      setCount(items.length);
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Erro ao transferir stock.');
    } finally {
      setTr(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Transferir stock</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-green-500" />
            </div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">{transferCount} iten{transferCount !== 1 ? 's' : ''} transferido{transferCount !== 1 ? 's' : ''}!</p>
            <p className="text-xs text-gray-400">
              Stock de <strong>{sector.name}</strong> movido para <strong>{sectors.find(s => s.id === targetId)?.name}</strong>.
            </p>
            <button onClick={onClose}
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl transition-colors">
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl mb-4">
              <Boxes className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Todos os itens de stock do setor <strong>{sector.name}</strong> serão movidos para o setor destino.
              </p>
            </div>

            <div className="mb-4">
              <label className={labelCls}>Setor destino *</label>
              {targets.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Nenhum outro setor com stock disponível neste hotel.</p>
              ) : (
                <select value={targetId} onChange={e => setTargetId(e.target.value)}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Selecione...</option>
                  {targets.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-xs text-red-700 dark:text-red-300 mb-4">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancelar
              </button>
              <button onClick={handleTransfer} disabled={transferring || targets.length === 0}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors">
                {transferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Transferir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function SectorsManagement() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const { isAdmin, can } = usePermissions();

  const canManage = isAdmin || can('sectors_management');
  const canChangeHotel = isAdmin || ['management'].includes(user?.role || '');

  const [hotels, setHotels]           = useState<Hotel[]>([]);
  const [filterHotel, setFilterHotel] = useState(selectedHotel?.id || '');
  const [sectors, setSectors]         = useState<Sector[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  // Form
  const [showForm, setShowForm]       = useState(false);
  const [editId, setEditId]           = useState<string | null>(null);
  const [formName, setFormName]       = useState('');
  const [formColor, setFormColor]     = useState('#6366f1');
  const [formHasStock, setFormHasStock] = useState(false);
  const [formError, setFormError]     = useState('');
  const [saving, setSaving]           = useState(false);

  // Delete
  const [deleteId, setDeleteId]       = useState<string | null>(null);
  const [deleting, setDeleting]       = useState(false);

  // Transfer
  const [transferSector, setTransferSector] = useState<Sector | null>(null);

  // ---------------------------------------------------------------------------
  useEffect(() => {
    supabase.from('hotels').select('id, name').order('name').then(({ data }) => setHotels(data || []));
  }, []);

  useEffect(() => {
    if (!canChangeHotel && selectedHotel?.id) setFilterHotel(selectedHotel.id);
  }, [selectedHotel?.id]);

  const fetchSectors = useCallback(async () => {
    if (!filterHotel) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('sectors')
        .select('*')
        .eq('hotel_id', filterHotel)
        .order('display_order')
        .order('name');
      if (err) throw err;
      setSectors((data || []) as Sector[]);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar setores.');
    } finally {
      setLoading(false);
    }
  }, [filterHotel]);

  useEffect(() => { fetchSectors(); }, [fetchSectors]);

  // ---------------------------------------------------------------------------
  const openNew = () => {
    setEditId(null);
    setFormName(''); setFormColor('#6366f1'); setFormHasStock(false);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (s: Sector) => {
    setEditId(s.id);
    setFormName(s.name);
    setFormColor(s.color);
    setFormHasStock(s.has_stock);
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formName.trim()) { setFormError('Nome obrigatório.'); return; }
    if (!filterHotel)     { setFormError('Selecione um hotel.'); return; }

    setSaving(true);
    try {
      const payload = {
        hotel_id:      filterHotel,
        name:          formName.trim(),
        color:         formColor,
        has_stock:     formHasStock,
        display_order: editId
          ? (sectors.find(s => s.id === editId)?.display_order ?? 0)
          : sectors.length,
      };

      if (editId) {
        const { error: err } = await supabase.from('sectors').update(payload).eq('id', editId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('sectors').insert(payload);
        if (err) throw err;
      }
      setShowForm(false);
      await fetchSectors();
    } catch (e: any) {
      setFormError(e.message?.includes('unique') ? 'Já existe um setor com esse nome neste hotel.' : (e.message || 'Erro ao salvar.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from('sectors').delete().eq('id', deleteId);
      if (err) throw err;
      setDeleteId(null);
      await fetchSectors();
    } catch (e: any) {
      setError(e.message || 'Erro ao excluir.');
    } finally {
      setDeleting(false);
    }
  };

  const moveOrder = async (sector: Sector, direction: 'up' | 'down') => {
    const idx     = sectors.findIndex(s => s.id === sector.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectors.length) return;

    const swap = sectors[swapIdx];
    const newSectors = [...sectors];
    newSectors[idx]     = { ...sector, display_order: swap.display_order };
    newSectors[swapIdx] = { ...swap,   display_order: sector.display_order };
    setSectors(newSectors.sort((a, b) => a.display_order - b.display_order));

    await Promise.all([
      supabase.from('sectors').update({ display_order: swap.display_order   }).eq('id', sector.id),
      supabase.from('sectors').update({ display_order: sector.display_order }).eq('id', swap.id),
    ]);
  };

  // ---------------------------------------------------------------------------
  if (!canManage) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
      <LayoutGrid className="h-10 w-10 opacity-30" />
      <p className="text-sm">Sem permissão para gerir setores.</p>
    </div>
  );

  const hotelName = hotels.find(h => h.id === filterHotel)?.name || '';

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">

      {/* Transfer modal */}
      {transferSector && (
        <TransferStockModal
          sector={transferSector}
          sectors={sectors}
          hotelId={filterHotel}
          onClose={() => { setTransferSector(null); fetchSectors(); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-blue-500" />Gestão de Setores
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Setores por hotel — defina nome, cor e se possui stock</p>
        </div>
        {filterHotel && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-2xl shadow-sm shadow-blue-200 dark:shadow-blue-900/30 transition-all hover:scale-105 active:scale-95">
            <Plus className="h-4 w-4" />Novo setor
          </button>
        )}
      </div>

      {/* Hotel selector */}
      {canChangeHotel && (
        <div className="relative">
          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <select value={filterHotel} onChange={e => setFilterHotel(e.target.value)}
            className={`${inputCls} pl-11 appearance-none`}>
            <option value="">Selecione o hotel...</option>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
          <button onClick={() => setError('')} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* No hotel */}
      {!filterHotel && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Building2 className="h-10 w-10 opacity-30" />
          <p className="text-sm">Selecione um hotel para ver e gerir os setores.</p>
        </div>
      )}

      {/* Loading */}
      {filterHotel && loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
        </div>
      )}

      {/* Sectors list */}
      {filterHotel && !loading && (
        <>
          {/* Summary bar */}
          {sectors.length > 0 && (
            <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 text-sm">
              <span className="text-gray-500">{hotelName}</span>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">{sectors.length} setor{sectors.length !== 1 ? 'es' : ''}</span>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <span className="text-gray-500">{sectors.filter(s => s.has_stock).length} com stock</span>
            </div>
          )}

          {sectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <LayoutGrid className="h-10 w-10 opacity-30" />
              <p className="text-sm">Nenhum setor cadastrado para este hotel.</p>
              <button onClick={openNew} className="text-sm text-blue-500 hover:underline">Criar primeiro setor</button>
            </div>
          ) : (
            <div className="space-y-2">
              {sectors.map((sector, idx) => (
                <div key={sector.id}
                  className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-sm transition-shadow">

                  {/* Order controls */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => moveOrder(sector, 'up')} disabled={idx === 0}
                      className="w-6 h-5 flex items-center justify-center text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => moveOrder(sector, 'down')} disabled={idx === sectors.length - 1}
                      className="w-6 h-5 flex items-center justify-center text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Color dot */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${sector.color}22` }}>
                    <div className="w-4 h-4 rounded-full" style={{ background: sector.color }} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{sector.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        sector.has_stock
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-gray-50 dark:bg-gray-700 text-gray-400'
                      }`}>
                        <Package className="h-2.5 w-2.5" />
                        {sector.has_stock ? 'Com stock' : 'Sem stock'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {sector.has_stock && (
                      <button onClick={() => setTransferSector(sector)}
                        title="Transferir stock para outro setor"
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all">
                        <ArrowRight className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Transferir</span>
                      </button>
                    )}
                    <button onClick={() => openEdit(sector)}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDeleteId(sector.id)}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-3xl">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {editId ? 'Editar setor' : 'Novo setor'}
              </h2>
              <button onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              {/* Nome */}
              <div>
                <label className={labelCls}>Nome do setor *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Cozinha, Recepção, Manutenção..."
                  className={inputCls} required />
              </div>

              {/* Cor */}
              <div>
                <label className={labelCls}>Cor de identificação</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {SECTOR_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setFormColor(c)}
                      className={`w-8 h-8 rounded-xl transition-transform hover:scale-110 ${formColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>

              {/* Preview */}
              {formName && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${formColor}22` }}>
                    <div className="w-3 h-3 rounded-full" style={{ background: formColor }} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{formName}</span>
                  {formHasStock && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                      <Package className="h-2.5 w-2.5" />Com stock
                    </span>
                  )}
                </div>
              )}

              {/* Has stock toggle */}
              <div
                onClick={() => setFormHasStock(p => !p)}
                className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                  formHasStock
                    ? 'border-green-400 bg-green-50 dark:bg-green-900/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}>
                <div className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${formHasStock ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${formHasStock ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                    {formHasStock ? 'Stock ativado' : 'Sem stock'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formHasStock
                      ? 'Este setor terá contagem e controlo de stock independente.'
                      : 'Ative para que este setor tenha gestão de stock própria.'}
                  </p>
                </div>
              </div>

              {formHasStock && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl">
                  <Boxes className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    O stock deste setor será <strong>independente</strong> de hotel para hotel. Cada unidade mantém a sua própria contagem.
                  </p>
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
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : <><Check className="h-4 w-4" />Salvar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (() => {
        const sector = sectors.find(s => s.id === deleteId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
            <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-6">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white text-center mb-2">
                Excluir setor "{sector?.name}"?
              </h3>
              {sector?.has_stock && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl mb-4">
                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Este setor tem stock ativo. Os itens de stock <strong>não serão excluídos</strong>, mas perderão a referência ao setor. Considere transferir antes de excluir.
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

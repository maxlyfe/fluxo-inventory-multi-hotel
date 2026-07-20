// src/components/servicos/ServiceCatalog.tsx
// Catálogo de Serviços do hotel: CRUD com tributação NFS-e por serviço,
// preço fixo/variável e compartilhamento com outras unidades do grupo.

import React, { useState, useEffect, useCallback } from 'react';
import {
  ConciergeBell, Plus, Search, Pencil, Share2, Loader2, X,
  AlertCircle, CheckCircle, Trash2, Power, Building2, Send, Copy,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import { useNotification } from '../../context/NotificationContext';
import { serviceCatalogService, type HotelService, type ServicePricingMode } from '../../lib/serviceCatalogService';

const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

const EXIGIBILIDADES = [
  { value: '1', label: '1 — Exigível' },
  { value: '2', label: '2 — Não incidência' },
  { value: '3', label: '3 — Isenção' },
  { value: '4', label: '4 — Exportação' },
  { value: '5', label: '5 — Imunidade' },
  { value: '6', label: '6 — Suspensa (decisão judicial)' },
  { value: '7', label: '7 — Suspensa (processo administrativo)' },
];

interface EditForm {
  id?: string;
  name: string;
  description: string;
  category: string;
  pricing_mode: ServicePricingMode;
  price: string;
  lc116_code: string;
  municipal_tax_code: string;
  cnae: string;
  iss_rate: string;
  iss_retained: boolean;
  iss_exigibilidade: string;
  nbs_code: string;
}

const EMPTY_FORM: EditForm = {
  name: '', description: '', category: '',
  pricing_mode: 'fixed', price: '',
  lc116_code: '09.01', municipal_tax_code: '', cnae: '',
  iss_rate: '5', iss_retained: false, iss_exigibilidade: '1', nbs_code: '',
};

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ServiceCatalog: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { currentGroup } = useGroup();
  const { addNotification } = useNotification();

  const [rows, setRows] = useState<HotelService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Modal criar/editar
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Modal compartilhar
  const [shareSvc, setShareSvc] = useState<HotelService | null>(null);
  const [groupHotels, setGroupHotels] = useState<Array<{ id: string; name: string }>>([]);
  const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    try {
      setRows(await serviceCatalogService.list(selectedHotel.id, true));
    } catch (err) {
      console.error('[ServiceCatalog] load:', err);
      addNotification('Erro ao carregar serviços.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, addNotification]);

  useEffect(() => { load(); }, [load]);

  // Hotéis do grupo (para compartilhar)
  useEffect(() => {
    if (!currentGroup?.id || !selectedHotel?.id) { setGroupHotels([]); return; }
    supabase
      .from('hotels')
      .select('id, name')
      .eq('group_id', currentGroup.id)
      .neq('id', selectedHotel.id)
      .order('name')
      .then(({ data }) => setGroupHotels(data ?? []));
  }, [currentGroup?.id, selectedHotel?.id]);

  const filtered = rows.filter(s => {
    if (!showInactive && !s.is_active) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q)
      || (s.category || '').toLowerCase().includes(q)
      || (s.lc116_code || '').includes(q);
  });

  // ── Edit modal ────────────────────────────────────────────────────────────

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditOpen(true);
  }

  function openEdit(s: HotelService) {
    setForm({
      id: s.id,
      name: s.name,
      description: s.description || '',
      category: s.category || '',
      pricing_mode: s.pricing_mode,
      price: s.price != null ? String(s.price) : '',
      lc116_code: s.lc116_code || '',
      municipal_tax_code: s.municipal_tax_code || '',
      cnae: s.cnae || '',
      iss_rate: s.iss_rate != null ? String(s.iss_rate) : '',
      iss_retained: s.iss_retained,
      iss_exigibilidade: s.iss_exigibilidade || '1',
      nbs_code: s.nbs_code || '',
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!selectedHotel?.id) return;
    if (!form.name.trim()) { addNotification('Nome do serviço é obrigatório.', 'error'); return; }
    const price = parseFloat(form.price.replace(',', '.'));
    if (form.pricing_mode === 'fixed' && (!Number.isFinite(price) || price < 0)) {
      addNotification('Serviço com preço fixo exige um valor válido.', 'error'); return;
    }
    setSaving(true);
    try {
      await serviceCatalogService.save({
        id: form.id,
        hotel_id: selectedHotel.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        pricing_mode: form.pricing_mode,
        price: form.pricing_mode === 'fixed' ? price : null,
        lc116_code: form.lc116_code.trim() || null,
        municipal_tax_code: form.municipal_tax_code.trim() || null,
        cnae: form.cnae.trim() || null,
        iss_rate: form.iss_rate ? parseFloat(form.iss_rate.replace(',', '.')) || null : null,
        iss_retained: form.iss_retained,
        iss_exigibilidade: form.iss_exigibilidade,
        nbs_code: form.nbs_code.trim() || null,
        is_active: true,
      });
      addNotification(form.id ? 'Serviço atualizado.' : 'Serviço criado.', 'success');
      setEditOpen(false);
      load();
    } catch (err) {
      console.error('[ServiceCatalog] save:', err);
      addNotification('Erro ao salvar serviço.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(s: HotelService) {
    try {
      await serviceCatalogService.setActive(s.id, !s.is_active);
      setRows(prev => prev.map(r => (r.id === s.id ? { ...r, is_active: !s.is_active } : r)));
    } catch {
      addNotification('Erro ao alterar status do serviço.', 'error');
    }
  }

  async function handleDelete(s: HotelService) {
    if (!window.confirm(`Excluir o serviço "${s.name}"? Mapeamentos Erbon que apontam para ele serão desvinculados.`)) return;
    try {
      await serviceCatalogService.remove(s.id);
      setRows(prev => prev.filter(r => r.id !== s.id));
      addNotification('Serviço excluído.', 'success');
    } catch {
      addNotification('Erro ao excluir — o serviço pode estar em uso em lançamentos.', 'error');
    }
  }

  // ── Share modal ───────────────────────────────────────────────────────────

  function openShare(s: HotelService) {
    setShareSvc(s);
    setShareSelected(new Set());
  }

  async function handleShare(mode: 'copy' | 'push') {
    if (!shareSvc || shareSelected.size === 0) return;
    setSharing(true);
    try {
      const r = await serviceCatalogService.shareToHotels(shareSvc, Array.from(shareSelected), mode);
      const parts: string[] = [];
      if (r.created) parts.push(`${r.created} criada(s)`);
      if (r.updated) parts.push(`${r.updated} atualizada(s)`);
      if (r.skipped) parts.push(`${r.skipped} já existia(m) — não alterada(s)`);
      addNotification(`Compartilhado: ${parts.join(', ') || 'nada a fazer'}.`, 'success');
      setShareSvc(null);
    } catch (err) {
      console.error('[ServiceCatalog] share:', err);
      addNotification('Erro ao compartilhar serviço.', 'error');
    } finally {
      setSharing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!selectedHotel) {
    return <div className="py-20 text-center text-gray-400">Selecione um hotel.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, categoria ou código LC116…"
            className={inputCls + ' pl-9'}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          Mostrar inativos
        </label>
        <button
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" /> Novo Serviço
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-6 h-6 mr-2 animate-spin" /> Carregando serviços…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ConciergeBell className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">{rows.length === 0 ? 'Nenhum serviço cadastrado ainda.' : 'Nenhum serviço encontrado.'}</p>
          {rows.length === 0 && <p className="text-sm mt-1">Crie serviços como Diária, Massagem ou Taxas para usar na emissão de NFS-e.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <div
              key={s.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${!s.is_active ? 'opacity-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-gray-900 dark:text-white">{s.name}</p>
                  {s.category && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{s.category}</span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    s.pricing_mode === 'fixed'
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                  }`}>
                    {s.pricing_mode === 'fixed' ? `Fixo ${s.price != null ? fmtBRL(s.price) : ''}` : 'Valor variável'}
                  </span>
                  {!s.is_active && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">Inativo</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  LC116 {s.lc116_code || '—'} · ISS {s.iss_rate != null ? `${s.iss_rate}%` : '—'}
                  {s.iss_retained ? ' (retido)' : ''}
                  {s.municipal_tax_code ? ` · CTISS ${s.municipal_tax_code}` : ''}
                  {s.cnae ? ` · CNAE ${s.cnae}` : ''}
                </p>
                {s.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{s.description}</p>}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {groupHotels.length > 0 && (
                  <button
                    onClick={() => openShare(s)}
                    title="Compartilhar com outras unidades do grupo"
                    className="p-2 rounded-lg text-gray-400 hover:text-violet-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => openEdit(s)}
                  title="Editar"
                  className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleToggleActive(s)}
                  title={s.is_active ? 'Desativar' : 'Reativar'}
                  className="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Power className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  title="Excluir"
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal criar/editar ── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditOpen(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <ConciergeBell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
                {form.id ? 'Editar Serviço' : 'Novo Serviço'}
              </h2>
              <button onClick={() => setEditOpen(false)} className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome do Serviço *</label>
                  <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Ex.: Diária, Massagem relaxante, Taxa de serviço" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Descrição (discriminação na NFS-e)</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={inputCls} rows={2} placeholder="Texto padrão que sai na nota (opcional — se vazio, usa o nome)" />
                </div>
                <div>
                  <label className={labelCls}>Categoria</label>
                  <input type="text" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputCls} placeholder="Hospedagem, Bem-estar, Taxas…" />
                </div>
              </div>

              {/* Preço */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preço</p>
                <div className="flex gap-2">
                  {(['fixed', 'variable'] as ServicePricingMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, pricing_mode: m }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
                        form.pricing_mode === m
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-emerald-400'
                      }`}
                    >
                      {m === 'fixed' ? 'Valor fixo' : 'Valor variável'}
                    </button>
                  ))}
                </div>
                {form.pricing_mode === 'fixed' ? (
                  <div>
                    <label className={labelCls}>Valor (R$) *</label>
                    <input type="text" inputMode="decimal" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className={inputCls} placeholder="0,00" />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    O valor é definido no lançamento (ex.: diária que flutua ou vem do canal de vendas).
                  </p>
                )}
              </div>

              {/* Tributação */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tributação NFS-e</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Item Lista de Serviços (LC 116)</label>
                    <input type="text" value={form.lc116_code} onChange={e => setForm(p => ({ ...p, lc116_code: e.target.value }))} className={inputCls} placeholder="09.01" />
                  </div>
                  <div>
                    <label className={labelCls}>Cód. Tributação Municipal (CTISS)</label>
                    <input type="text" value={form.municipal_tax_code} onChange={e => setForm(p => ({ ...p, municipal_tax_code: e.target.value }))} className={inputCls} placeholder="Opcional — conforme o município" />
                  </div>
                  <div>
                    <label className={labelCls}>CNAE</label>
                    <input type="text" value={form.cnae} onChange={e => setForm(p => ({ ...p, cnae: e.target.value }))} className={inputCls} placeholder="5510-8/01" />
                  </div>
                  <div>
                    <label className={labelCls}>Alíquota ISS (%)</label>
                    <input type="text" inputMode="decimal" value={form.iss_rate} onChange={e => setForm(p => ({ ...p, iss_rate: e.target.value }))} className={inputCls} placeholder="5" />
                  </div>
                  <div>
                    <label className={labelCls}>Exigibilidade do ISS</label>
                    <select value={form.iss_exigibilidade} onChange={e => setForm(p => ({ ...p, iss_exigibilidade: e.target.value }))} className={inputCls}>
                      {EXIGIBILIDADES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Código NBS</label>
                    <input type="text" value={form.nbs_code} onChange={e => setForm(p => ({ ...p, nbs_code: e.target.value }))} className={inputCls} placeholder="Opcional" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={form.iss_retained} onChange={e => setForm(p => ({ ...p, iss_retained: e.target.checked }))} className="rounded" />
                  ISS retido na fonte (tomador recolhe)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {form.id ? 'Salvar Alterações' : 'Criar Serviço'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal compartilhar ── */}
      {shareSvc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShareSvc(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Share2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Compartilhar Serviço</h2>
                <p className="text-xs text-gray-400">{shareSvc.name}</p>
              </div>
              <button onClick={() => setShareSvc(null)} className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Selecione as unidades. Cada unidade edita sua cópia de forma independente —
                use <span className="font-semibold">Empurrar edição</span> para sobrescrever as cópias com esta versão.
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {groupHotels.map(h => (
                  <label key={h.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-700 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={shareSelected.has(h.id)}
                      onChange={e => setShareSelected(prev => {
                        const s = new Set(prev);
                        e.target.checked ? s.add(h.id) : s.delete(h.id);
                        return s;
                      })}
                      className="rounded"
                    />
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-700 dark:text-gray-200">{h.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => handleShare('copy')}
                disabled={sharing || shareSelected.size === 0}
                title="Cria o serviço nas unidades onde ainda não existe; não altera cópias existentes"
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 text-sm font-bold hover:bg-violet-50 dark:hover:bg-violet-900/30 disabled:opacity-50"
              >
                {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                Copiar
              </button>
              <button
                onClick={() => handleShare('push')}
                disabled={sharing || shareSelected.size === 0}
                title="Cria ou SOBRESCREVE as cópias das unidades selecionadas com esta versão"
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
              >
                {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Empurrar edição
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceCatalog;

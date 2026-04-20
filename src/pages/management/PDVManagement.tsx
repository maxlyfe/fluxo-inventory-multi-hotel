// src/pages/management/PDVManagement.tsx
// Configuração completa do módulo PDV para gerentes:
// • Setores como pontos de venda
// • Produtos do estoque setorial disponíveis e preços
// • Pratos e acompanhamentos das fichas técnicas
// • Funcionários para lançamentos "Uso da Casa"

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingCart, LayoutGrid, Package, ChefHat, Users,
  ToggleLeft, ToggleRight, Loader2, AlertCircle, CheckCircle,
  Edit2, Save, X, Plus, Trash2, Search, RefreshCw,
  Link2, Unlink, ChevronDown, UserCheck, UserX, Zap,
  BookOpen, UtensilsCrossed, DollarSign, Tag, Building2,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import {
  getSectorsWithPDVStatus,
  toggleSectorPDV,
  getProductsForPDVConfig,
  setPDVProductConfig,
  getMenuItemsForPDVConfig,
  upsertMenuPrice,
  getPDVEmployees,
  upsertPDVEmployee,
  deletePDVEmployee,
  type PDVSectorConfig,
  type PDVProductConfig,
  type PDVMenuItemConfig,
  type PDVEmployee,
} from '../../lib/pdvService';
import { erbonService } from '../../lib/erbonService';
import type { ErbonGuest } from '../../lib/erbonService';

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const isNaoUsar = (name: string) => name.includes('(Não usar)') || name.includes('(NAO USAR)');

// ── Shared UI primitives ────────────────────────────────────────────────────

const tabCls = (active: boolean) =>
  `flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
    active
      ? 'bg-amber-500 text-white shadow-sm'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
  }`;

const badge = (color: 'green' | 'amber' | 'red' | 'blue' | 'gray', text: string) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
    color === 'green' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
    color === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
    color === 'red'   ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
    color === 'blue'  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                        'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
  }`}>{text}</span>
);

// ── Price inline editor ─────────────────────────────────────────────────────

interface PriceInputProps {
  value: number | null;
  onSave: (v: number) => void;
  disabled?: boolean;
  saving?: boolean;
}

const PriceInput: React.FC<PriceInputProps> = ({ value, onSave, disabled, saving }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const open = () => { setDraft(value != null ? String(value) : ''); setEditing(true); setTimeout(() => ref.current?.select(), 30); };
  const cancel = () => setEditing(false);
  const commit = () => {
    const n = parseFloat(draft.replace(',', '.'));
    if (isNaN(n) || n < 0) { cancel(); return; }
    onSave(n);
    setEditing(false);
  };

  if (disabled) return <span className="text-xs text-gray-400 italic">—</span>;

  if (editing) return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-400">R$</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        className="w-20 px-2 py-1 text-xs border border-amber-400 rounded focus:ring-1 focus:ring-amber-500 bg-white dark:bg-gray-800 dark:text-white"
        autoFocus
      />
      <button onClick={commit} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
      </button>
      <button onClick={cancel} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
        <X className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <button onClick={open} className="flex items-center gap-1 group">
      {value != null && value > 0 ? (
        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmt(value)}</span>
      ) : (
        <span className="text-xs text-amber-500 italic">Definir preço</span>
      )}
      <Edit2 className="w-3 h-3 text-gray-300 group-hover:text-gray-500 dark:group-hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

// ── Toggle switch ───────────────────────────────────────────────────────────

interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md'; }
const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, size = 'md' }) => (
  <button
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
      size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
    } ${checked ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
  >
    <span className={`pointer-events-none inline-block rounded-full bg-white shadow transform ring-0 transition duration-200 ${
      size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
    } ${checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
  </button>
);

// ══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Setores PDV
// ══════════════════════════════════════════════════════════════════════════════

const SetoresTab: React.FC<{ hotelId: string }> = ({ hotelId }) => {
  const { addNotification } = useNotification();
  const [sectors, setSectors] = useState<PDVSectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  /** Busca setores e, se houver mapeamentos sem ID numérico, sincroniza automaticamente */
  const load = useCallback(async (autoSync = false) => {
    setLoading(true);
    try {
      const data = await getSectorsWithPDVStatus(hotelId);
      setSectors(data);
      // Auto-sync: se algum setor mapeado ainda não tem erbon_department_id, tenta puxar da Erbon
      const needsSync = data.some(s => s.erbon_department && !s.erbon_department_id);
      if (needsSync || autoSync) {
        await syncDeptIdsInner(data);
        // Recarrega após sincronização
        setSectors(await getSectorsWithPDVStatus(hotelId));
      }
    } catch (e: any) { addNotification('error', e.message); }
    finally { setLoading(false); }
  }, [hotelId]);

  /** Sincroniza erbon_department_id buscando transações recentes da Erbon */
  const syncDeptIdsInner = async (currentSectors: PDVSectorConfig[]) => {
    setSyncing(true);
    try {
      const depts = await erbonService.fetchErbonDepartments(hotelId);
      const deptMap = new Map(depts.filter(d => d.id > 0).map(d => [d.name, d.id]));

      // Pega todos os mapeamentos sem erbon_department_id
      const { data: mappings } = await supabase
        .from('erbon_sector_mappings')
        .select('id, sector_id, erbon_department, erbon_department_id')
        .eq('hotel_id', hotelId)
        .is('erbon_department_id', null);

      const toUpdate = (mappings || []).filter(m => deptMap.has(m.erbon_department));
      if (toUpdate.length === 0) return;

      for (const m of toUpdate) {
        const deptId = deptMap.get(m.erbon_department)!;
        await supabase
          .from('erbon_sector_mappings')
          .update({ erbon_department_id: deptId })
          .eq('id', m.id);
      }
      addNotification('success', `${toUpdate.length} ID(s) Erbon sincronizados automaticamente`);
    } catch {
      // Silencioso — Erbon pode estar offline, não bloqueia o carregamento
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncManual = async () => {
    setSyncing(true);
    try {
      const depts = await erbonService.fetchErbonDepartments(hotelId);
      const deptMap = new Map(depts.filter(d => d.id > 0).map(d => [d.name, d.id]));

      const { data: mappings } = await supabase
        .from('erbon_sector_mappings')
        .select('id, erbon_department, erbon_department_id')
        .eq('hotel_id', hotelId)
        .is('erbon_department_id', null);

      const toUpdate = (mappings || []).filter(m => deptMap.has(m.erbon_department));

      if (toUpdate.length === 0) {
        addNotification('success', 'Todos os IDs já estão sincronizados!');
        setSyncing(false);
        return;
      }

      for (const m of toUpdate) {
        await supabase
          .from('erbon_sector_mappings')
          .update({ erbon_department_id: deptMap.get(m.erbon_department)! })
          .eq('id', m.id);
      }

      addNotification('success', `${toUpdate.length} ID(s) Erbon atualizados`);
      setSectors(await getSectorsWithPDVStatus(hotelId));
    } catch (e: any) {
      addNotification('error', 'Erro ao sincronizar: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { load(false); }, [load]);

  const handleToggle = async (sector: PDVSectorConfig) => {
    setToggling(sector.id);
    try {
      await toggleSectorPDV(sector.id, !sector.pdv_enabled);
      setSectors(prev => prev.map(s => s.id === sector.id ? { ...s, pdv_enabled: !s.pdv_enabled } : s));
      addNotification('success', `${sector.name} ${!sector.pdv_enabled ? 'ativado' : 'desativado'} como PDV`);
    } catch (e: any) {
      addNotification('error', e.message);
    } finally { setToggling(null); }
  };

  const missingIds = sectors.filter(s => s.erbon_department && !s.erbon_department_id).length;

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
      {syncing && <p className="text-sm text-gray-400 animate-pulse">Sincronizando IDs Erbon…</p>}
    </div>
  );

  const enabled = sectors.filter(s => s.pdv_enabled);
  const disabled = sectors.filter(s => !s.pdv_enabled);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {enabled.length} de {sectors.length} setores ativos como PDV
          </p>
          {missingIds > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {missingIds} setor(es) sem ID Erbon — necessário para lançar débitos no PMS
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {missingIds > 0 && (
            <button
              onClick={handleSyncManual}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Sincronizar IDs Erbon
            </button>
          )}
          <button onClick={() => load(false)} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      </div>

      {sectors.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <LayoutGrid className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nenhum setor cadastrado para este hotel.</p>
        </div>
      )}

      {enabled.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase text-gray-400 dark:text-gray-500 mb-3 tracking-wider">Pontos de Venda Ativos</h4>
          <div className="grid gap-2">
            {enabled.map(s => <SectorRow key={s.id} sector={s} toggling={toggling} onToggle={handleToggle} />)}
          </div>
        </div>
      )}
      {disabled.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase text-gray-400 dark:text-gray-500 mb-3 tracking-wider">Setores Inativos no PDV</h4>
          <div className="grid gap-2">
            {disabled.map(s => <SectorRow key={s.id} sector={s} toggling={toggling} onToggle={handleToggle} />)}
          </div>
        </div>
      )}
    </div>
  );
};

const SectorRow: React.FC<{ sector: PDVSectorConfig; toggling: string | null; onToggle: (s: PDVSectorConfig) => void }> = ({ sector, toggling, onToggle }) => (
  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
    sector.pdv_enabled
      ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
      : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
  }`}>
    <div className="flex items-center gap-4 min-w-0">
      <div className={`p-2 rounded-lg ${sector.pdv_enabled ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
        <ShoppingCart className={`w-4 h-4 ${sector.pdv_enabled ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{sector.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-400">{sector.product_count} produtos em estoque</span>
          {sector.erbon_department ? (
            <>
              {badge('blue', sector.erbon_department)}
              {sector.erbon_department_id
                ? badge('green', `ID ${sector.erbon_department_id}`)
                : badge('amber', 'Sem ID Dept')}
            </>
          ) : badge('gray', 'Sem mapeamento Erbon')}
        </div>
      </div>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      {toggling === sector.id
        ? <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
        : <Toggle checked={sector.pdv_enabled} onChange={() => onToggle(sector)} />
      }
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// Tab 2 — Produtos (stock setorial)
// ══════════════════════════════════════════════════════════════════════════════

const ProdutosTab: React.FC<{ hotelId: string }> = ({ hotelId }) => {
  const { addNotification } = useNotification();
  const [sectors, setSectors] = useState<PDVSectorConfig[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [products, setProducts] = useState<PDVProductConfig[]>([]);
  const [loadingSectors, setLoadingSectors] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getSectorsWithPDVStatus(hotelId)
      .then(s => {
        setSectors(s);
        const first = s.find(x => x.pdv_enabled);
        if (first) setSelectedSector(first.id);
      })
      .catch(e => addNotification('error', e.message))
      .finally(() => setLoadingSectors(false));
  }, [hotelId]);

  useEffect(() => {
    if (!selectedSector) return;
    setLoadingProducts(true);
    getProductsForPDVConfig(hotelId, selectedSector)
      .then(setProducts)
      .catch(e => addNotification('error', e.message))
      .finally(() => setLoadingProducts(false));
  }, [selectedSector, hotelId]);

  const handleToggle = async (p: PDVProductConfig) => {
    setSaving(p.product_id);
    try {
      await setPDVProductConfig(hotelId, p.product_id, !p.is_available, p.sale_price);
      setProducts(prev => prev.map(x => x.product_id === p.product_id ? { ...x, is_available: !p.is_available } : x));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handlePrice = async (p: PDVProductConfig, price: number) => {
    setSaving(p.product_id);
    try {
      await setPDVProductConfig(hotelId, p.product_id, p.is_available, price);
      setProducts(prev => prev.map(x => x.product_id === p.product_id ? { ...x, sale_price: price } : x));
      addNotification('success', `Preço de ${p.product_name} atualizado`);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const pdvSectors = sectors.filter(s => s.pdv_enabled);
  const filtered = products.filter(p => p.product_name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()));

  // Group by category
  const grouped = filtered.reduce<Record<string, PDVProductConfig[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Sector selector */}
      <div className="flex items-center gap-3 flex-wrap">
        {loadingSectors ? <Loader2 className="w-4 h-4 animate-spin text-amber-500" /> : (
          pdvSectors.length === 0
            ? <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4" /> Ative ao menos um setor como PDV na aba Setores.
              </div>
            : pdvSectors.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSector(s.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedSector === s.id
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />{s.name}
                </button>
              ))
        )}
      </div>

      {selectedSector && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar produto ou categoria..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          {loadingProducts
            ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-amber-500" /></div>
            : products.length === 0
              ? <div className="text-center py-12 text-gray-400"><Package className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>Nenhum produto em estoque neste setor.</p></div>
              : (
                <div className="space-y-5">
                  {/* Summary row */}
                  <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      {products.filter(p => p.is_available).length} disponíveis para venda
                    </span>
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      {products.filter(p => p.is_available && !p.sale_price).length} sem preço definido
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Link2 className="w-4 h-4 text-blue-500" />
                      {products.filter(p => p.erbon_service_id).length} mapeados no Erbon
                    </span>
                  </div>

                  {Object.entries(grouped).map(([cat, items]) => (
                    <div key={cat}>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">{cat}</h4>
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                        {items.map(p => (
                          <div key={p.product_id} className={`flex items-center gap-4 px-4 py-3 transition-colors ${p.is_available ? 'bg-white dark:bg-gray-800/80' : 'bg-gray-50 dark:bg-gray-800/30'}`}>
                            <Toggle
                              checked={p.is_available}
                              onChange={() => handleToggle(p)}
                              disabled={saving === p.product_id}
                              size="sm"
                            />
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${p.is_available ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {p.product_name}
                              </p>
                              <p className="text-xs text-gray-400">{p.unit_measure} · Estoque: {p.stock_quantity}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {p.erbon_service_id
                                ? badge('blue', `Erbon #${p.erbon_service_id}`)
                                : badge('gray', 'Sem Erbon')}
                              <PriceInput
                                value={p.sale_price}
                                onSave={v => handlePrice(p, v)}
                                disabled={!p.is_available}
                                saving={saving === p.product_id}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
          }
        </>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// Tab 3 — Cardápio (Pratos & Acompanhamentos)
// ══════════════════════════════════════════════════════════════════════════════

const CardapioTab: React.FC<{ hotelId: string }> = ({ hotelId }) => {
  const { addNotification } = useNotification();
  const [items, setItems] = useState<PDVMenuItemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'dish' | 'side'>('dish');
  const [search, setSearch] = useState('');
  const [erbonProducts, setErbonProducts] = useState<{ id: number; description: string }[]>([]);
  const [editingErbon, setEditingErbon] = useState<string | null>(null);
  const [erbonSearch, setErbonSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await getMenuItemsForPDVConfig(hotelId)); }
    catch (e: any) { addNotification('error', e.message); }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const loadErbonProducts = async () => {
    try {
      const prods = await erbonService.fetchErbonProducts(hotelId);
      setErbonProducts(prods.map((p: any) => ({ id: p.id, description: p.description })));
    } catch (e: any) { addNotification('error', 'Erro ao carregar produtos Erbon: ' + e.message); }
  };

  const handleToggle = async (item: PDVMenuItemConfig) => {
    setSaving(item.id);
    try {
      await upsertMenuPrice(hotelId, {
        ...(item.type === 'dish' ? { dishId: item.id } : { sideId: item.id }),
        isAvailable: !item.is_available,
        salePrice: item.sale_price ?? 0,
        erbonServiceId: item.erbon_service_id,
        erbonServiceDescription: item.erbon_service_description,
      });
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, is_available: !item.is_available } : x));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handlePrice = async (item: PDVMenuItemConfig, price: number) => {
    setSaving(item.id);
    try {
      await upsertMenuPrice(hotelId, {
        ...(item.type === 'dish' ? { dishId: item.id } : { sideId: item.id }),
        isAvailable: item.is_available,
        salePrice: price,
        erbonServiceId: item.erbon_service_id,
        erbonServiceDescription: item.erbon_service_description,
      });
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, sale_price: price } : x));
      addNotification('success', `Preço de ${item.name} atualizado`);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleLinkErbon = async (item: PDVMenuItemConfig, erbonId: number, erbonDesc: string) => {
    setSaving(item.id);
    try {
      await upsertMenuPrice(hotelId, {
        ...(item.type === 'dish' ? { dishId: item.id } : { sideId: item.id }),
        isAvailable: item.is_available,
        salePrice: item.sale_price ?? 0,
        erbonServiceId: erbonId,
        erbonServiceDescription: erbonDesc,
      });
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, erbon_service_id: erbonId, erbon_service_description: erbonDesc } : x));
      setEditingErbon(null);
      addNotification('success', `${item.name} vinculado ao serviço Erbon #${erbonId}`);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleUnlinkErbon = async (item: PDVMenuItemConfig) => {
    setSaving(item.id);
    try {
      await upsertMenuPrice(hotelId, {
        ...(item.type === 'dish' ? { dishId: item.id } : { sideId: item.id }),
        isAvailable: item.is_available,
        salePrice: item.sale_price ?? 0,
        erbonServiceId: null,
        erbonServiceDescription: null,
      });
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, erbon_service_id: null, erbon_service_description: null } : x));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const visibleItems = items
    .filter(x => x.type === subTab)
    .filter(x => x.name.toLowerCase().includes(search.toLowerCase()));

  const filteredErbonProducts = erbonProducts.filter(p =>
    p.description.toLowerCase().includes(erbonSearch.toLowerCase()) || String(p.id).includes(erbonSearch)
  );

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex items-center gap-2">
        <button onClick={() => setSubTab('dish')} className={tabCls(subTab === 'dish')}>
          <UtensilsCrossed className="w-4 h-4" /> Pratos ({items.filter(x => x.type === 'dish').length})
        </button>
        <button onClick={() => setSubTab('side')} className={tabCls(subTab === 'side')}>
          <BookOpen className="w-4 h-4" /> Acompanhamentos ({items.filter(x => x.type === 'side').length})
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Buscar ${subTab === 'dish' ? 'prato' : 'acompanhamento'}...`}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => { loadErbonProducts(); }}
          className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Zap className="w-3.5 h-3.5" /> Carregar Erbon
        </button>
      </div>

      {loading
        ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-amber-500" /></div>
        : visibleItems.length === 0
          ? <div className="text-center py-12 text-gray-400">
              <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum {subTab === 'dish' ? 'prato' : 'acompanhamento'} cadastrado.<br />
                <a href="/purchases/tech-sheets" className="text-amber-500 hover:underline text-sm">Ir para Fichas Técnicas →</a>
              </p>
            </div>
          : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-700/50">
              {visibleItems.map(item => (
                <div key={item.id} className={`transition-colors ${item.is_available ? 'bg-white dark:bg-gray-800/80' : 'bg-gray-50 dark:bg-gray-800/30'}`}>
                  <div className="flex items-center gap-4 px-4 py-3">
                    <Toggle
                      checked={item.is_available}
                      onChange={() => handleToggle(item)}
                      disabled={saving === item.id}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${item.is_available ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-400">{subTab === 'dish' ? 'Prato' : 'Acompanhamento'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                      {/* Erbon linking */}
                      {editingErbon === item.id ? (
                        <div className="flex flex-col gap-1 min-w-52">
                          <input
                            type="text"
                            value={erbonSearch}
                            onChange={e => setErbonSearch(e.target.value)}
                            placeholder="Buscar serviço Erbon..."
                            className="px-2 py-1 text-xs border border-blue-400 rounded bg-white dark:bg-gray-800 dark:text-white focus:ring-1 focus:ring-blue-500"
                            autoFocus
                          />
                          <div className="max-h-32 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                            {erbonProducts.length === 0 && (
                              <p className="px-3 py-2 text-xs text-gray-400">Clique em "Carregar Erbon" primeiro.</p>
                            )}
                            {filteredErbonProducts.slice(0, 15).map(ep => (
                              <button
                                key={ep.id}
                                onClick={() => handleLinkErbon(item, ep.id, ep.description)}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300"
                              >
                                #{ep.id} — {ep.description}
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setEditingErbon(null)} className="text-xs text-gray-400 hover:text-gray-600 text-right">Cancelar</button>
                        </div>
                      ) : item.erbon_service_id ? (
                        <div className="flex items-center gap-1">
                          {badge('blue', `Erbon #${item.erbon_service_id}`)}
                          <button onClick={() => handleUnlinkErbon(item)} className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" title="Desvincular">
                            <Unlink className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingErbon(item.id); setErbonSearch(''); }}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                          <Link2 className="w-3 h-3" /> Vincular Erbon
                        </button>
                      )}
                      <PriceInput
                        value={item.sale_price}
                        onSave={v => handlePrice(item, v)}
                        disabled={!item.is_available}
                        saving={saving === item.id}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
      }
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// Tab 4 — Funcionários (Uso da Casa)
// ══════════════════════════════════════════════════════════════════════════════

const defaultEmployee = (hotelId: string): PDVEmployee => ({
  hotel_id: hotelId,
  name: '',
  role: null,
  erbon_booking_internal_id: null,
  erbon_booking_number: null,
  erbon_room_description: null,
  is_active: true,
});

const FuncionariosTab: React.FC<{ hotelId: string }> = ({ hotelId }) => {
  const { addNotification } = useNotification();
  const [employees, setEmployees] = useState<PDVEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PDVEmployee>(defaultEmployee(hotelId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inHouseGuests, setInHouseGuests] = useState<ErbonGuest[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [guestSearch, setGuestSearch] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setEmployees(await getPDVEmployees(hotelId)); }
    catch (e: any) { addNotification('error', e.message); }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const loadGuests = async () => {
    setLoadingGuests(true);
    try {
      const guests = await erbonService.fetchInHouseGuests(hotelId);
      setInHouseGuests(guests);
    } catch (e: any) { addNotification('error', 'Erro ao carregar hóspedes: ' + e.message); }
    finally { setLoadingGuests(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { addNotification('error', 'Nome é obrigatório'); return; }
    setSaving('form');
    try {
      // Auto-detect if name contains "(Não usar)" → set inactive
      const autoActive = !isNaoUsar(form.name);
      await upsertPDVEmployee({ ...form, is_active: autoActive && form.is_active });
      await load();
      setShowForm(false);
      setEditingId(null);
      setForm(defaultEmployee(hotelId));
      addNotification('success', editingId ? 'Funcionário atualizado' : 'Funcionário cadastrado');
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleDelete = async (emp: PDVEmployee) => {
    if (!emp.id) return;
    if (!window.confirm(`Remover ${emp.name}?`)) return;
    setSaving(emp.id);
    try {
      await deletePDVEmployee(emp.id);
      setEmployees(prev => prev.filter(e => e.id !== emp.id));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleToggleActive = async (emp: PDVEmployee) => {
    if (!emp.id) return;
    setSaving(emp.id);
    try {
      await upsertPDVEmployee({ ...emp, is_active: !emp.is_active });
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, is_active: !e.is_active } : e));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleLinkGuest = async (emp: PDVEmployee, guest: ErbonGuest) => {
    if (!emp.id) return;
    setSaving(emp.id);
    try {
      const updated: PDVEmployee = {
        ...emp,
        erbon_booking_internal_id: guest.bookingInternalId ?? null,
        erbon_booking_number: guest.bookingNumber ?? null,
        erbon_room_description: guest.roomDescription ?? null,
      };
      await upsertPDVEmployee(updated);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ...updated } : e));
      setLinkingId(null);
      addNotification('success', `${emp.name} vinculado a ${guest.roomDescription}`);
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const handleUnlinkGuest = async (emp: PDVEmployee) => {
    if (!emp.id) return;
    setSaving(emp.id);
    try {
      const updated: PDVEmployee = { ...emp, erbon_booking_internal_id: null, erbon_booking_number: null, erbon_room_description: null };
      await upsertPDVEmployee(updated);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ...updated } : e));
    } catch (e: any) { addNotification('error', e.message); }
    finally { setSaving(null); }
  };

  const startEdit = (emp: PDVEmployee) => {
    setForm({ ...emp });
    setEditingId(emp.id!);
    setShowForm(true);
  };

  const filteredGuests = inHouseGuests.filter(g =>
    (g.guestName || '').toLowerCase().includes(guestSearch.toLowerCase()) ||
    (g.roomDescription || '').toLowerCase().includes(guestSearch.toLowerCase()) ||
    (g.bookingNumber || '').toLowerCase().includes(guestSearch.toLowerCase())
  );

  const activeEmployees = employees.filter(e => e.is_active && !isNaoUsar(e.name)).filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
  const inactiveEmployees = employees.filter(e => !e.is_active || isNaoUsar(e.name)).filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar funcionário..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadGuests(); }}
            disabled={loadingGuests}
            className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            {loadingGuests ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Carregar In-House
          </button>
          <button
            onClick={() => { setForm(defaultEmployee(hotelId)); setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Funcionário
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-xl bg-amber-50 dark:bg-amber-900/10 p-5 space-y-4">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">{editingId ? 'Editar' : 'Novo'} Funcionário</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Nome *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nome completo"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Cargo / Função</label>
              <input
                type="text"
                value={form.role ?? ''}
                onChange={e => setForm(f => ({ ...f, role: e.target.value || null }))}
                placeholder="ex: Gerente, Cozinheiro..."
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} size="sm" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Ativo</span>
            {isNaoUsar(form.name) && badge('amber', 'Será desativado automaticamente — "(Não usar)" no nome')}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving === 'form'} className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50">
              {saving === 'form' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        </div>
      )}

      {loading
        ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-amber-500" /></div>
        : (
          <div className="space-y-6">
            {/* Active employees */}
            {activeEmployees.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Ativos ({activeEmployees.length})
                </h4>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  {activeEmployees.map(emp => (
                    <EmployeeRow
                      key={emp.id}
                      emp={emp}
                      saving={saving}
                      linkingId={linkingId}
                      setLinkingId={setLinkingId}
                      inHouseGuests={filteredGuests}
                      guestSearch={guestSearch}
                      setGuestSearch={setGuestSearch}
                      onEdit={startEdit}
                      onDelete={handleDelete}
                      onToggle={handleToggleActive}
                      onLinkGuest={handleLinkGuest}
                      onUnlinkGuest={handleUnlinkGuest}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Inactive employees */}
            {inactiveEmployees.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Inativos / Não Usar ({inactiveEmployees.length})
                </h4>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden opacity-60">
                  {inactiveEmployees.map(emp => (
                    <EmployeeRow
                      key={emp.id}
                      emp={emp}
                      saving={saving}
                      linkingId={linkingId}
                      setLinkingId={setLinkingId}
                      inHouseGuests={filteredGuests}
                      guestSearch={guestSearch}
                      setGuestSearch={setGuestSearch}
                      onEdit={startEdit}
                      onDelete={handleDelete}
                      onToggle={handleToggleActive}
                      onLinkGuest={handleLinkGuest}
                      onUnlinkGuest={handleUnlinkGuest}
                    />
                  ))}
                </div>
              </div>
            )}

            {employees.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhum funcionário cadastrado.<br />
                  <span className="text-sm">Adicione funcionários para lançar consumos como "Uso da Casa".</span>
                </p>
              </div>
            )}
          </div>
        )
      }
    </div>
  );
};

interface EmployeeRowProps {
  emp: PDVEmployee;
  saving: string | null;
  linkingId: string | null;
  setLinkingId: (id: string | null) => void;
  inHouseGuests: ErbonGuest[];
  guestSearch: string;
  setGuestSearch: (s: string) => void;
  onEdit: (emp: PDVEmployee) => void;
  onDelete: (emp: PDVEmployee) => void;
  onToggle: (emp: PDVEmployee) => void;
  onLinkGuest: (emp: PDVEmployee, guest: ErbonGuest) => void;
  onUnlinkGuest: (emp: PDVEmployee) => void;
}

const EmployeeRow: React.FC<EmployeeRowProps> = ({
  emp, saving, linkingId, setLinkingId, inHouseGuests, guestSearch, setGuestSearch,
  onEdit, onDelete, onToggle, onLinkGuest, onUnlinkGuest,
}) => {
  const isSaving = saving === emp.id;
  const isLinking = linkingId === emp.id;
  const inactive = isNaoUsar(emp.name) || !emp.is_active;

  return (
    <div className={`transition-colors ${inactive ? 'bg-gray-50 dark:bg-gray-800/30' : 'bg-white dark:bg-gray-800/80'}`}>
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          inactive ? 'bg-gray-200 dark:bg-gray-700 text-gray-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
        }`}>
          {emp.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-medium ${inactive ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>{emp.name}</p>
            {emp.role && <span className="text-xs text-gray-400">{emp.role}</span>}
            {isNaoUsar(emp.name) && badge('red', 'Não Usar')}
          </div>
          {/* Erbon booking link */}
          {emp.erbon_booking_internal_id ? (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {badge('blue', emp.erbon_room_description || `UH ${emp.erbon_booking_internal_id}`)}
              {emp.erbon_booking_number && <span className="text-xs text-gray-400">Res. {emp.erbon_booking_number}</span>}
              <span className="text-xs text-gray-400">ID: {emp.erbon_booking_internal_id}</span>
            </div>
          ) : (
            <p className="text-xs text-amber-500 mt-0.5">Sem conta Erbon vinculada</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Erbon link / unlink */}
          {emp.erbon_booking_internal_id ? (
            <button
              onClick={() => onUnlinkGuest(emp)}
              disabled={isSaving}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Desvincular conta Erbon"
            >
              <Unlink className="w-3 h-3" /> Desvincular
            </button>
          ) : (
            <button
              onClick={() => { setLinkingId(emp.id!); setGuestSearch(''); }}
              disabled={isSaving}
              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <Link2 className="w-3 h-3" /> Vincular UH
            </button>
          )}

          <Toggle checked={emp.is_active && !isNaoUsar(emp.name)} onChange={() => onToggle(emp)} disabled={isSaving || isNaoUsar(emp.name)} size="sm" />

          <button onClick={() => onEdit(emp)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(emp)} disabled={isSaving} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* In-house guest picker */}
      {isLinking && (
        <div className="px-4 pb-4 pt-1">
          <div className="border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-900/10 p-3 space-y-2">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
              Selecione a UH/reserva Erbon para vincular a <strong>{emp.name}</strong>:
            </p>
            <input
              type="text"
              value={guestSearch}
              onChange={e => setGuestSearch(e.target.value)}
              placeholder="Buscar por nome, UH ou reserva..."
              className="w-full px-3 py-1.5 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-gray-800 dark:text-white focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {inHouseGuests.length === 0 && (
                <p className="text-xs text-gray-400 py-2 text-center">Clique em "Carregar In-House" para ver as reservas ativas.</p>
              )}
              {inHouseGuests.slice(0, 20).map((g, i) => (
                <button
                  key={i}
                  onClick={() => onLinkGuest(emp, g)}
                  className="w-full text-left px-3 py-2 text-xs rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-transparent hover:border-blue-200 dark:hover:border-blue-700 transition-colors"
                >
                  <span className="font-medium text-gray-900 dark:text-white">{g.roomDescription}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">{g.guestName}</span>
                  <span className="text-gray-400 ml-2">Res. {g.bookingNumber}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setLinkingId(null)} className="text-xs text-gray-400 hover:text-gray-600 w-full text-right">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════

type TabId = 'setores' | 'produtos' | 'cardapio' | 'funcionarios';

const PDVManagement: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('setores');

  if (!selectedHotel) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <p>Selecione um hotel para configurar o PDV.</p>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
              <ShoppingCart className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            Gestão PDV
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure pontos de venda, cardápio, preços e funcionários para lançamentos no Erbon.
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setActiveTab('setores')} className={tabCls(activeTab === 'setores')}>
          <LayoutGrid className="w-4 h-4" /> Setores PDV
        </button>
        <button onClick={() => setActiveTab('produtos')} className={tabCls(activeTab === 'produtos')}>
          <Package className="w-4 h-4" /> Produtos
        </button>
        <button onClick={() => setActiveTab('cardapio')} className={tabCls(activeTab === 'cardapio')}>
          <ChefHat className="w-4 h-4" /> Cardápio
        </button>
        <button onClick={() => setActiveTab('funcionarios')} className={tabCls(activeTab === 'funcionarios')}>
          <Users className="w-4 h-4" /> Funcionários
        </button>
      </div>

      {/* Content card */}
      <div className="bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
        {activeTab === 'setores'      && <SetoresTab      hotelId={selectedHotel.id} />}
        {activeTab === 'produtos'     && <ProdutosTab     hotelId={selectedHotel.id} />}
        {activeTab === 'cardapio'     && <CardapioTab     hotelId={selectedHotel.id} />}
        {activeTab === 'funcionarios' && <FuncionariosTab hotelId={selectedHotel.id} />}
      </div>
    </div>
  );
};

export default PDVManagement;

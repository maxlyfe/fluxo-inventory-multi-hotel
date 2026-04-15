// src/pages/admin/ErbonIntegration.tsx
// Página de configuração e mapeamentos da integração Erbon PMS

import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Link2,
  Package,
  Utensils,
  Loader2,
  AlertCircle,
  CheckCircle,
  Wifi,
  WifiOff,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChefHat,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { supabase } from '../../lib/supabase';
import {
  erbonService,
  ErbonConfig,
  ErbonProduct,
  ErbonProductMapping,
  ErbonSectorMapping,
} from '../../lib/erbonService';

// ── Interfaces locais ───────────────────────────────────────────────────────

interface FluxoProduct {
  id: string;
  name: string;
  category: string | null;
}

interface FluxoSector {
  id: string;
  name: string;
}

// ── CSS helpers ──────────────────────────────────────────────────────────────

const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger = 'p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors';

type TabId = 'config' | 'products' | 'dishes' | 'sectors';

interface FluxoDish {
  id: string;
  name: string;
}

// ── Searchable Select ───────────────────────────────────────────────────────

interface SearchableOption {
  value: string;
  label: string;
  starred?: boolean;
}

const SearchableSelect: React.FC<{
  options: SearchableOption[];
  placeholder: string;
  onSelect: (value: string) => void;
}> = ({ options, placeholder, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const starred = filtered.filter(o => o.starred);
  const rest = filtered.filter(o => !o.starred);

  return (
    <div ref={ref} className="relative max-w-xs w-full">
      <div
        className={inputCls + ' flex items-center gap-2 cursor-pointer'}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
      >
        <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-sm p-0 focus:ring-0"
        />
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">Nenhum resultado</div>
          )}
          {starred.map(o => (
            <button
              key={o.value}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 text-yellow-600 dark:text-yellow-400 font-medium"
              onClick={() => { onSelect(o.value); setQuery(''); setOpen(false); }}
            >
              ★ {o.label}
            </button>
          ))}
          {rest.map(o => (
            <button
              key={o.value}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300"
              onClick={() => { onSelect(o.value); setQuery(''); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Component ────────────────────────────────────────────────────────────────

const ErbonIntegration: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('config');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Config state ────────────────────────────────────────────────────────
  const [config, setConfig] = useState<ErbonConfig | null>(null);
  const [formConfig, setFormConfig] = useState({
    erbon_hotel_id: '',
    erbon_username: '',
    erbon_password: '',
    erbon_base_url: 'https://api.erbonsoftware.com',
    is_active: true,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Products mapping state ──────────────────────────────────────────────
  const [fluxoProducts, setFluxoProducts] = useState<FluxoProduct[]>([]);
  const [erbonProducts, setErbonProducts] = useState<ErbonProduct[]>([]);
  const [productMappings, setProductMappings] = useState<ErbonProductMapping[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // ── Sectors mapping state ───────────────────────────────────────────────
  const [fluxoSectors, setFluxoSectors] = useState<FluxoSector[]>([]);
  const [erbonDepartments, setErbonDepartments] = useState<string[]>([]);
  const [sectorMappings, setSectorMappings] = useState<ErbonSectorMapping[]>([]);
  const [loadingSectors, setLoadingSectors] = useState(false);

  // ── Dishes mapping state ───────────────────────────────────────────────
  const [fluxoDishes, setFluxoDishes] = useState<FluxoDish[]>([]);
  const [dishSearch, setDishSearch] = useState('');
  const [seasonMode, setSeasonMode] = useState('auto');
  const [seasonThreshold, setSeasonThreshold] = useState('40');

  // ── Init ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedHotel) loadConfig();
  }, [selectedHotel]);

  useEffect(() => {
    if (activeTab === 'products' && config?.is_active) loadProductMappings();
    if (activeTab === 'dishes' && config?.is_active) loadDishMappings();
    if (activeTab === 'sectors' && config?.is_active) loadSectorMappings();
  }, [activeTab, config]);

  // Auto-clear messages
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ── Config functions ────────────────────────────────────────────────────

  const loadConfig = async () => {
    setLoading(true);
    try {
      const cfg = await erbonService.getConfig(selectedHotel!.id);
      setConfig(cfg);
      if (cfg) {
        setFormConfig({
          erbon_hotel_id: cfg.erbon_hotel_id,
          erbon_username: cfg.erbon_username,
          erbon_password: cfg.erbon_password,
          erbon_base_url: cfg.erbon_base_url,
          is_active: cfg.is_active,
        });

        const { data: seasonData } = await supabase
          .from('erbon_hotel_config')
          .select('season_mode, high_season_occupancy_threshold')
          .eq('hotel_id', selectedHotel!.id)
          .single();
        if (seasonData) {
          setSeasonMode(seasonData.season_mode || 'auto');
          setSeasonThreshold(String(seasonData.high_season_occupancy_threshold ?? 40));
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await erbonService.testConnection(formConfig);
      setTestResult({
        success: result.success,
        message: result.success
          ? `Conectado! Hotel: ${result.hotelName}`
          : `Falha: ${result.error}`,
      });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!formConfig.erbon_hotel_id || !formConfig.erbon_username || !formConfig.erbon_password) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    setSaving(true);
    try {
      const saved = await erbonService.saveConfig({
        hotel_id: selectedHotel!.id,
        ...formConfig,
      });
      setConfig(saved);
      setSuccess('Configuração salva com sucesso!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Product Mappings ────────────────────────────────────────────────────

  const loadProductMappings = async () => {
    setLoadingProducts(true);
    try {
      const [mappings, productsRes] = await Promise.all([
        erbonService.getProductMappings(selectedHotel!.id),
        supabase.from('products').select('id, name, category').eq('hotel_id', selectedHotel!.id).eq('is_active', true).order('name'),
      ]);
      setProductMappings(mappings);
      setFluxoProducts(productsRes.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadErbonProducts = async () => {
    setLoadingProducts(true);
    try {
      const products = await erbonService.fetchErbonProducts(selectedHotel!.id);
      setErbonProducts(products);
      setSuccess(`${products.length} produtos carregados da Erbon!`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingProducts(false);
    }
  };

  const handleMapProduct = async (fluxoProductId: string, erbonProduct: ErbonProduct) => {
    try {
      await erbonService.saveProductMapping({
        hotel_id: selectedHotel!.id,
        product_id: fluxoProductId,
        erbon_service_id: erbonProduct.id,
        erbon_service_description: erbonProduct.description,
      });
      await loadProductMappings();
      setSuccess(`Produto mapeado: ${erbonProduct.description}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteProductMapping = async (id: string) => {
    try {
      await erbonService.deleteProductMapping(id);
      await loadProductMappings();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Dish Mappings ───────────────────────────────────────────────────────

  const loadDishMappings = async () => {
    try {
      const [mappings, dishesRes] = await Promise.all([
        erbonService.getProductMappings(selectedHotel!.id),
        supabase.from('dishes').select('id, name').or(`hotel_id.eq.${selectedHotel!.id},hotel_id.is.null`).order('name'),
      ]);
      setProductMappings(mappings);
      setFluxoDishes(dishesRes.data || []);
    } catch (err: any) { setError(err.message); }
  };

  const handleMapDish = async (dishId: string, erbonProduct: ErbonProduct) => {
    try {
      await erbonService.saveProductMapping({
        hotel_id: selectedHotel!.id, dish_id: dishId,
        erbon_service_id: erbonProduct.id, erbon_service_description: erbonProduct.description,
      });
      await loadDishMappings();
      setSuccess(`Prato mapeado: ${erbonProduct.description}`);
    } catch (err: any) { setError(err.message); }
  };

  const handleSaveSeasonConfig = async () => {
    try {
      const threshold = parseFloat(seasonThreshold.replace(',', '.')) || 40;
      await supabase.from('erbon_hotel_config').update({
        season_mode: seasonMode, high_season_occupancy_threshold: threshold,
      }).eq('hotel_id', selectedHotel!.id);
      setSuccess('Configuracao sazonal salva!');
    } catch (err: any) { setError(err.message); }
  };

  // ── Sector Mappings ─────────────────────────────────────────────────────

  const loadSectorMappings = async () => {
    setLoadingSectors(true);
    try {
      const [mappings, sectorsRes] = await Promise.all([
        erbonService.getSectorMappings(selectedHotel!.id),
        supabase.from('sectors').select('id, name').eq('hotel_id', selectedHotel!.id).order('name'),
      ]);
      setSectorMappings(mappings);
      setFluxoSectors(sectorsRes.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingSectors(false);
    }
  };

  const loadErbonDepartments = async () => {
    setLoadingSectors(true);
    try {
      const depts = await erbonService.fetchErbonDepartments(selectedHotel!.id);
      setErbonDepartments(depts);
      setSuccess(`${depts.length} departamentos carregados da Erbon!`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingSectors(false);
    }
  };

  const handleMapSector = async (sectorId: string, department: string) => {
    try {
      await erbonService.saveSectorMapping({
        hotel_id: selectedHotel!.id,
        sector_id: sectorId,
        erbon_department: department,
      });
      await loadSectorMappings();
      setSuccess(`Setor mapeado: ${department}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteSectorMapping = async (id: string) => {
    try {
      await erbonService.deleteSectorMapping(id);
      await loadSectorMappings();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Tabs ────────────────────────────────────────────────────────────────

  const tabs: { id: TabId; label: string; icon: React.FC<any>; disabled?: boolean }[] = [
    { id: 'config', label: 'Configuração', icon: Settings },
    { id: 'products', label: 'Produtos', icon: Package, disabled: !config?.is_active },
    { id: 'dishes', label: 'Pratos', icon: ChefHat, disabled: !config?.is_active },
    { id: 'sectors', label: 'Setores', icon: Utensils, disabled: !config?.is_active },
  ];

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Unmapped fluxo products (para seleção)
  const mappedProductIds = new Set(productMappings.map(m => m.product_id));
  const unmappedFluxoProducts = fluxoProducts.filter(p => !mappedProductIds.has(p.id));
  const mappedErbonServiceIds = new Set(productMappings.map(m => m.erbon_service_id));
  const unmappedErbonProducts = erbonProducts.filter(p => !mappedErbonServiceIds.has(p.id));

  // Unmapped sectors
  const mappedSectorDepts = new Set(sectorMappings.map(m => `${m.sector_id}::${m.erbon_department}`));

  const filteredUnmappedErbon = productSearch
    ? unmappedErbonProducts.filter(p =>
        p.description.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.code.toLowerCase().includes(productSearch.toLowerCase())
      )
    : unmappedErbonProducts;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <Link2 className="w-7 h-7 text-blue-600" />
          Integração Erbon PMS
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Configure a conexão com o Erbon e mapeie produtos e setores.
        </p>
      </div>

      {/* Status messages */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="font-bold">OK</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-center gap-3 text-green-700 dark:text-green-400 text-sm">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <p>{success}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
          <nav className="flex">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                className={
                  'flex items-center gap-2 py-4 px-6 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ' +
                  (activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : tab.disabled
                    ? 'border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')
                }
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* ══════════════ TAB: CONFIGURAÇÃO ══════════════ */}
          {activeTab === 'config' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Credenciais Erbon</h3>
                <div className="flex items-center gap-2 text-sm">
                  {config?.is_active ? (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <Wifi className="w-4 h-4" /> Ativo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-gray-400">
                      <WifiOff className="w-4 h-4" /> Inativo
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Hotel ID (Erbon)</label>
                  <input
                    type="text"
                    value={formConfig.erbon_hotel_id}
                    onChange={e => setFormConfig(p => ({ ...p, erbon_hotel_id: e.target.value }))}
                    placeholder="UUID do hotel na Erbon"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>URL Base</label>
                  <input
                    type="text"
                    value={formConfig.erbon_base_url}
                    onChange={e => setFormConfig(p => ({ ...p, erbon_base_url: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Usuário</label>
                  <input
                    type="text"
                    value={formConfig.erbon_username}
                    onChange={e => setFormConfig(p => ({ ...p, erbon_username: e.target.value }))}
                    placeholder="Usuário Erbon"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Senha</label>
                  <input
                    type="password"
                    value={formConfig.erbon_password}
                    onChange={e => setFormConfig(p => ({ ...p, erbon_password: e.target.value }))}
                    placeholder="Senha Erbon"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="erbon-active"
                  checked={formConfig.is_active}
                  onChange={e => setFormConfig(p => ({ ...p, is_active: e.target.checked }))}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="erbon-active" className="text-sm text-gray-700 dark:text-gray-300">
                  Integração ativa
                </label>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={
                  'p-3 rounded-lg text-sm flex items-center gap-2 ' +
                  (testResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800')
                }>
                  {testResult.success ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  {testResult.message}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handleTestConnection} disabled={testing} className={btnPrimary}>
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  Testar Conexão
                </button>
                <button onClick={handleSaveConfig} disabled={saving} className={btnPrimary}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                  Salvar Configuração
                </button>
              </div>

              {config?.last_sync_at && (
                <p className="text-xs text-gray-400">
                  Última sincronização: {new Date(config.last_sync_at).toLocaleString('pt-BR')}
                </p>
              )}

              {config && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Configuração Sazonal</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Modo de Temporada</label>
                      <select value={seasonMode} onChange={e => setSeasonMode(e.target.value)} className={inputCls}>
                        <option value="auto">Automático (baseado em ocupação)</option>
                        <option value="alta">Sempre Alta Temporada</option>
                        <option value="baixa">Sempre Baixa Temporada</option>
                      </select>
                    </div>
                    {seasonMode === 'auto' && (
                      <div>
                        <label className={labelCls}>Threshold de Ocupação (%)</label>
                        <input type="text" inputMode="decimal" value={seasonThreshold}
                          onChange={e => setSeasonThreshold(e.target.value)} placeholder="40" className={inputCls} />
                        <p className="text-xs text-gray-400 mt-1">Acima deste % = alta temporada</p>
                      </div>
                    )}
                  </div>
                  <button onClick={handleSaveSeasonConfig} className={btnPrimary + ' mt-4'}>
                    <Settings className="w-4 h-4" /> Salvar Config. Sazonal
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══════════════ TAB: PRODUTOS ══════════════ */}
          {activeTab === 'products' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Mapeamento de Produtos
                </h3>
                <button
                  onClick={loadErbonProducts}
                  disabled={loadingProducts}
                  className={btnPrimary}
                >
                  {loadingProducts ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Carregar Produtos Erbon
                </button>
              </div>

              {/* Mapeamentos existentes */}
              {productMappings.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Mapeamentos Ativos ({productMappings.length})
                  </h4>
                  <div className="space-y-2">
                    {productMappings.map(mapping => {
                      const fluxoProd = fluxoProducts.find(p => p.id === mapping.product_id);
                      return (
                        <div
                          key={mapping.id}
                          className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {fluxoProd?.name || mapping.product_id}
                            </span>
                            <span className="text-gray-400">↔</span>
                            <span className="text-sm text-green-700 dark:text-green-400">
                              {mapping.erbon_service_description} (ID: {mapping.erbon_service_id})
                            </span>
                          </div>
                          <button onClick={() => handleDeleteProductMapping(mapping.id)} className={btnDanger}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Criar novo mapeamento */}
              {erbonProducts.length > 0 && unmappedFluxoProducts.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Criar Novo Mapeamento
                  </h4>

                  {/* Search */}
                  <div className="mb-3 relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Buscar produto Erbon..."
                      className={inputCls + ' pl-9'}
                    />
                  </div>

                  <div className="grid gap-2 max-h-96 overflow-y-auto">
                    {filteredUnmappedErbon.map(erbonProd => {
                      // Auto-sugestão: encontrar produto Fluxo com nome similar
                      const suggested = unmappedFluxoProducts.find(fp =>
                        fp.name.toLowerCase().includes(erbonProd.description.toLowerCase()) ||
                        erbonProd.description.toLowerCase().includes(fp.name.toLowerCase())
                      );

                      return (
                        <div
                          key={erbonProd.id}
                          className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {erbonProd.description}
                            </p>
                            <p className="text-xs text-gray-400">
                              {erbonProd.stocksGroupDescription} · {erbonProd.mensureUnite} · R${erbonProd.priceSale?.toFixed(2)}
                            </p>
                          </div>
                          <SearchableSelect
                            placeholder="Vincular a..."
                            onSelect={value => handleMapProduct(value, erbonProd)}
                            options={[
                              ...(suggested ? [{ value: suggested.id, label: `${suggested.name} (${suggested.category || 'Sem cat.'})`, starred: true }] : []),
                              ...unmappedFluxoProducts
                                .filter(p => p.id !== suggested?.id)
                                .map(p => ({ value: p.id, label: `${p.name} (${p.category || 'Sem cat.'})` })),
                            ]}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {erbonProducts.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Clique em "Carregar Produtos Erbon" para ver os produtos disponíveis.</p>
                </div>
              )}
            </div>
          )}

          {/* ══════════════ TAB: PRATOS ══════════════ */}
          {activeTab === 'dishes' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Mapeamento de Pratos (Baixa Decomposta)
                </h3>
                <button
                  onClick={loadErbonProducts}
                  disabled={loadingProducts}
                  className={btnPrimary}
                >
                  {loadingProducts ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Carregar Produtos Erbon
                </button>
              </div>

              {/* Mapeamentos de pratos existentes */}
              {productMappings.filter(m => m.dish_id).length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Mapeamentos de Pratos Ativos ({productMappings.filter(m => m.dish_id).length})
                  </h4>
                  <div className="space-y-2">
                    {productMappings.filter(m => m.dish_id).map(mapping => {
                      const dish = fluxoDishes.find(d => d.id === mapping.dish_id);
                      return (
                        <div
                          key={mapping.id}
                          className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-lg"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {dish?.name || mapping.dish_id}
                            </span>
                            <span className="text-gray-400">&harr;</span>
                            <span className="text-sm text-purple-700 dark:text-purple-400">
                              {mapping.erbon_service_description} (ID: {mapping.erbon_service_id})
                            </span>
                          </div>
                          <button onClick={() => handleDeleteProductMapping(mapping.id)} className={btnDanger}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Criar novo mapeamento de prato */}
              {erbonProducts.length > 0 && fluxoDishes.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Criar Novo Mapeamento de Prato
                  </h4>

                  {/* Search */}
                  <div className="mb-3 relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={dishSearch}
                      onChange={e => setDishSearch(e.target.value)}
                      placeholder="Buscar produto Erbon..."
                      className={inputCls + ' pl-9'}
                    />
                  </div>

                  <div className="grid gap-2 max-h-96 overflow-y-auto">
                    {(dishSearch
                      ? erbonProducts.filter(p =>
                          p.description.toLowerCase().includes(dishSearch.toLowerCase()) ||
                          p.code.toLowerCase().includes(dishSearch.toLowerCase())
                        )
                      : erbonProducts
                    ).filter(p => !productMappings.some(m => m.dish_id && m.erbon_service_id === p.id)).map(erbonProd => (
                      <div
                        key={erbonProd.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {erbonProd.description}
                          </p>
                          <p className="text-xs text-gray-400">
                            {erbonProd.stocksGroupDescription} &middot; {erbonProd.mensureUnite} &middot; R${erbonProd.priceSale?.toFixed(2)}
                          </p>
                        </div>
                        <SearchableSelect
                          placeholder="Vincular a prato..."
                          onSelect={value => handleMapDish(value, erbonProd)}
                          options={fluxoDishes.map(d => ({ value: d.id, label: d.name }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {erbonProducts.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Clique em "Carregar Produtos Erbon" para ver os produtos disponíveis.</p>
                </div>
              )}
            </div>
          )}

          {/* ══════════════ TAB: SETORES ══════════════ */}
          {activeTab === 'sectors' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Mapeamento de Setores
                </h3>
                <button
                  onClick={loadErbonDepartments}
                  disabled={loadingSectors}
                  className={btnPrimary}
                >
                  {loadingSectors ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Carregar Departamentos Erbon
                </button>
              </div>

              {/* Mapeamentos existentes */}
              {sectorMappings.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Mapeamentos Ativos ({sectorMappings.length})
                  </h4>
                  <div className="space-y-2">
                    {sectorMappings.map(mapping => {
                      const sector = fluxoSectors.find(s => s.id === mapping.sector_id);
                      return (
                        <div
                          key={mapping.id}
                          className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {sector?.name || mapping.sector_id}
                            </span>
                            <span className="text-gray-400">↔</span>
                            <span className="text-sm text-blue-700 dark:text-blue-400">
                              {mapping.erbon_department}
                            </span>
                          </div>
                          <button onClick={() => handleDeleteSectorMapping(mapping.id)} className={btnDanger}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Criar novo mapeamento */}
              {erbonDepartments.length > 0 && fluxoSectors.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
                    Vincular Departamento a Setor
                  </h4>
                  <div className="grid gap-2">
                    {erbonDepartments.map(dept => {
                      const existingMappings = sectorMappings.filter(m => m.erbon_department === dept);
                      return (
                        <div
                          key={dept}
                          className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {dept}
                            </p>
                            {existingMappings.length > 0 && (
                              <p className="text-xs text-green-600 dark:text-green-400">
                                Vinculado a: {existingMappings.map(m => {
                                  const s = fluxoSectors.find(fs => fs.id === m.sector_id);
                                  return s?.name || m.sector_id;
                                }).join(', ')}
                              </p>
                            )}
                          </div>
                          <SearchableSelect
                            placeholder="Vincular a setor..."
                            onSelect={value => handleMapSector(value, dept)}
                            options={fluxoSectors
                              .filter(s => !mappedSectorDepts.has(`${s.id}::${dept}`))
                              .map(s => ({ value: s.id, label: s.name }))}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {erbonDepartments.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Utensils className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Clique em "Carregar Departamentos Erbon" para ver os departamentos.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErbonIntegration;

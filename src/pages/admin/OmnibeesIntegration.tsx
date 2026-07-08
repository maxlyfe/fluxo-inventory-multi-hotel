// src/pages/admin/OmnibeesIntegration.tsx
// Tela exclusiva de configuração da integração Omnibees (PMS Pull WebService,
// OTA 2014B). Independente da Erbon: credenciais por hotel, teste de conexão
// (OTA_Ping) e sincronização manual das reservas dos canais.

import React, { useState, useEffect } from 'react';
import {
  Globe, Loader2, AlertCircle, CheckCircle, Wifi, WifiOff, RefreshCw, Info,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { omnibeesService, OmnibeesConfig } from '../../lib/omnibeesService';

const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

const OmnibeesIntegration: React.FC = () => {
  const { selectedHotel } = useHotel();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [config, setConfig] = useState<OmnibeesConfig | null>(null);
  const [form, setForm] = useState({
    hotel_code: '',
    chain_code: '',
    user_code: '',
    username: '',
    password: '',
    base_url: 'https://pms.omnibees.com/OTA2014B/PullWebService.asmx',
    is_active: true,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadConfig = async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const cfg = await omnibeesService.getConfig(selectedHotel.id);
      setConfig(cfg);
      if (cfg) {
        setForm({
          hotel_code: cfg.hotel_code,
          chain_code: cfg.chain_code || '',
          user_code: cfg.user_code,
          username: cfg.username,
          password: cfg.password,
          base_url: cfg.base_url,
          is_active: cfg.is_active,
        });
      } else {
        setForm({
          hotel_code: '', chain_code: '', user_code: '', username: '', password: '',
          base_url: 'https://pms.omnibees.com/OTA2014B/PullWebService.asmx',
          is_active: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfig(); }, [selectedHotel?.id]);

  // Auto-clear das mensagens
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t); }
  }, [success]);
  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 8000); return () => clearTimeout(t); }
  }, [error]);

  const formValid = !!(form.hotel_code && form.user_code && form.username && form.password);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    const result = await omnibeesService.testConnection({
      ...(config || {}),
      hotel_id: selectedHotel!.id,
      hotel_code: form.hotel_code,
      chain_code: form.chain_code || null,
      user_code: form.user_code,
      username: form.username,
      password: form.password,
      base_url: form.base_url,
    } as OmnibeesConfig);
    setTestResult(result.success
      ? { success: true, message: 'Conexão OK — credenciais válidas (OTA_Ping).' }
      : { success: false, message: result.error || 'Falha na conexão.' });
    setTesting(false);
  };

  const handleSave = async () => {
    if (!selectedHotel) return;
    setSaving(true);
    try {
      await omnibeesService.saveConfig({
        hotel_id: selectedHotel.id,
        ...form,
        chain_code: form.chain_code || null,
      });
      await loadConfig();
      setSuccess('Configuração Omnibees salva!');
    } catch (e: any) {
      setError('Erro ao salvar: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    if (!selectedHotel) return;
    setSyncing(true);
    try {
      const n = await omnibeesService.syncHotel(selectedHotel.id);
      setSuccess(n > 0
        ? `${n} reserva${n > 1 ? 's' : ''} sincronizada${n > 1 ? 's' : ''} da Omnibees!`
        : 'Sincronizado — nenhuma reserva pendente de entrega.');
      await loadConfig();
    } catch (e: any) {
      setError('Erro na sincronização: ' + (e.message || ''));
    } finally {
      setSyncing(false);
    }
  };

  if (!selectedHotel) {
    return (
      <div className="container mx-auto p-6 text-center text-gray-400">
        Selecione um hotel para configurar a integração Omnibees.
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
          <Globe className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Integração Omnibees</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Channel manager — {selectedHotel.name}
          </p>
        </div>
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

      {/* Explicação */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Integração OTA 2014B (Pull WebService). Com ela, as reservas que entram na Omnibees pelos
          canais (Booking, Expedia, site...) aparecem automaticamente no <strong>Planning</strong> e no{' '}
          <strong>Rack de UH's</strong>. Hotéis com Erbon ativa continuam usando a Erbon como fonte
          principal de reservas — esta integração é indicada para unidades sem PMS externo.
        </span>
      </div>

      {/* Card de configuração */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Credenciais</h3>
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
                <label className={labelCls}>Hotel Code *</label>
                <input type="text" value={form.hotel_code}
                  onChange={e => setForm(f => ({ ...f, hotel_code: e.target.value }))}
                  placeholder="Código do hotel na Omnibees" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Chain Code</label>
                <input type="text" value={form.chain_code}
                  onChange={e => setForm(f => ({ ...f, chain_code: e.target.value }))}
                  placeholder="Só se configurado na Omnibees" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>User Code (nome do PMS) *</label>
                <input type="text" value={form.user_code}
                  onChange={e => setForm(f => ({ ...f, user_code: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Username *</label>
                <input type="text" value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Password *</label>
                <input type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>URL do Web Service</label>
                <input type="text" value={form.base_url}
                  onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  className={inputCls} />
                <p className="text-[10px] text-gray-400 mt-1">
                  Produção: pms.omnibees.com · Certificação: pmscert.omnibees.com
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Integração ativa</span>
            </label>

            {testResult && (
              <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
                testResult.success
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                {testResult.success ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                {testResult.message}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button onClick={handleTest} disabled={testing || !formValid}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-50">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                Testar Conexão
              </button>
              <button onClick={handleSave} disabled={saving || !formValid}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Salvar
              </button>
              {config?.is_active && (
                <button onClick={handleSyncNow} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm transition-all disabled:opacity-50">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sincronizar Reservas Agora
                </button>
              )}
            </div>

            {config?.last_sync_at && (
              <p className="text-xs text-gray-400">
                Última sincronização: {new Date(config.last_sync_at).toLocaleString('pt-BR')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OmnibeesIntegration;

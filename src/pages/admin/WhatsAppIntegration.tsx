// src/pages/admin/WhatsAppIntegration.tsx
// Configuração da integração WhatsApp Business API

import React, { useState, useEffect } from 'react';
import {
  MessageSquare, Settings, FileText, Clock, Loader2, CheckCircle, AlertCircle,
  Wifi, WifiOff, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { whatsappService, WhatsAppConfig, WhatsAppMessageTemplate, WhatsAppMessageLog } from '../../lib/whatsappService';

// ── CSS helpers ──────────────────────────────────────────────────────────────
const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

type TabId = 'config' | 'templates' | 'log';

const WhatsAppIntegration: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [activeTab, setActiveTab] = useState<TabId>('config');

  // Config state
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);
  const [configForm, setConfigForm] = useState({
    phone_number_id: '',
    waba_id: '',
    access_token: '',
    display_phone: '',
  });

  // Templates state
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Log state
  const [logs, setLogs] = useState<WhatsAppMessageLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // ── Load config ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedHotel) return;
    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const config = await whatsappService.getConfig(selectedHotel.id);
        if (config) {
          setConfigForm({
            phone_number_id: config.phone_number_id,
            waba_id: config.waba_id,
            access_token: config.access_token,
            display_phone: config.display_phone || '',
          });
          setIsGlobal(config.hotel_id === null);
        }
      } catch {
        // sem config = ok
      } finally {
        setConfigLoading(false);
      }
    };
    loadConfig();
  }, [selectedHotel]);

  // ── Save config ──────────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    if (!configForm.phone_number_id || !configForm.waba_id || !configForm.access_token) {
      addNotification('Preencha todos os campos obrigatórios', 'error');
      return;
    }
    setSaving(true);
    try {
      await whatsappService.saveConfig({
        hotel_id: isGlobal ? null : selectedHotel?.id || null,
        phone_number_id: configForm.phone_number_id.trim(),
        waba_id: configForm.waba_id.trim(),
        access_token: configForm.access_token.trim(),
        display_phone: configForm.display_phone.trim() || null,
      });
      addNotification('Configuração WhatsApp salva!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar';
      addNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Test connection ──────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await whatsappService.testConnection({
        phone_number_id: configForm.phone_number_id.trim(),
        access_token: configForm.access_token.trim(),
      });
      setTestResult({
        success: result.success,
        message: result.success ? `Conectado: ${result.phoneName}` : `Erro: ${result.error}`,
      });
    } catch {
      setTestResult({ success: false, message: 'Erro ao testar conexão' });
    } finally {
      setTesting(false);
    }
  };

  // ── Load templates ─────────────────────────────────────────────────────
  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await whatsappService.getTemplates();
      setTemplates(data);
    } catch {
      addNotification('Erro ao carregar templates', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  // ── Load logs ─────────────────────────────────────────────────────────
  const loadLogs = async () => {
    if (!selectedHotel) return;
    setLogsLoading(true);
    try {
      const data = await whatsappService.getMessageLog(selectedHotel.id);
      setLogs(data);
    } catch {
      addNotification('Erro ao carregar log', 'error');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'templates') loadTemplates();
    if (activeTab === 'log') loadLogs();
  }, [activeTab, selectedHotel]);

  if (!selectedHotel) {
    return <div className="p-8 text-center text-gray-500">Selecione um hotel.</div>;
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'config', label: 'Configuração', icon: <Settings className="w-4 h-4" /> },
    { id: 'templates', label: 'Templates', icon: <FileText className="w-4 h-4" /> },
    { id: 'log', label: 'Log de Envios', icon: <Clock className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-green-500" />
          WhatsApp Business
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure a integração com a API WhatsApp Business (Meta Cloud API).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Config ──────────────────────────────────────────────── */}
      {activeTab === 'config' && (
        <div className="space-y-5">
          {configLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
          ) : (
            <>
              {/* Scope toggle */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={isGlobal} onChange={e => setIsGlobal(e.target.checked)}
                    className="h-4 w-4 rounded text-green-600 border-gray-300 focus:ring-green-500" />
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">Configuração Global</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {isGlobal
                        ? 'Todos os hotéis usarão estas credenciais.'
                        : `Credenciais apenas para ${selectedHotel.name}.`}
                    </p>
                  </div>
                </label>
              </div>

              {/* Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Phone Number ID *</label>
                  <input value={configForm.phone_number_id}
                    onChange={e => setConfigForm(p => ({ ...p, phone_number_id: e.target.value }))}
                    className={inputCls} placeholder="Ex: 123456789012345" />
                </div>
                <div>
                  <label className={labelCls}>WABA ID *</label>
                  <input value={configForm.waba_id}
                    onChange={e => setConfigForm(p => ({ ...p, waba_id: e.target.value }))}
                    className={inputCls} placeholder="WhatsApp Business Account ID" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Access Token *</label>
                  <div className="relative">
                    <input value={configForm.access_token}
                      onChange={e => setConfigForm(p => ({ ...p, access_token: e.target.value }))}
                      type={showToken ? 'text' : 'password'}
                      className={`${inputCls} pr-10`} placeholder="System User Access Token (permanente)" />
                    <button type="button" onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Número para exibição</label>
                  <input value={configForm.display_phone}
                    onChange={e => setConfigForm(p => ({ ...p, display_phone: e.target.value }))}
                    className={inputCls} placeholder="+55 11 99999-9999 (opcional)" />
                </div>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                  testResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}>
                  {testResult.success
                    ? <Wifi className="w-5 h-5 flex-shrink-0" />
                    : <WifiOff className="w-5 h-5 flex-shrink-0" />}
                  {testResult.message}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={handleTestConnection} disabled={testing || !configForm.phone_number_id || !configForm.access_token}
                  className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-all">
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  Testar Conexão
                </button>
                <button onClick={handleSaveConfig} disabled={saving} className={btnPrimary}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Salvar Configuração
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Templates ─────────────────────────────────────────── */}
      {activeTab === 'templates' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Templates registrados no Meta Business Manager.
            </p>
            <button onClick={loadTemplates} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {templatesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum template encontrado.</p>
              <p className="text-xs text-gray-400 mt-1">Execute a migration SQL para criar os templates padrão.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => (
                <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-bold rounded-md">
                      {t.template_key}
                    </span>
                    <span className="text-xs text-gray-400">{t.language_code}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{t.template_name}</p>
                  {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                  <div className="mt-2 text-xs text-gray-400">
                    Parâmetros: {Object.entries(t.parameter_mappings).map(([k, v]) => `{{${k}}} = ${v}`).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Log ──────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Últimas mensagens enviadas via WhatsApp.
            </p>
            <button onClick={loadLogs} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {logsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">Nenhuma mensagem enviada ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <div key={log.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    log.status === 'sent' ? 'bg-blue-400' :
                    log.status === 'delivered' ? 'bg-green-400' :
                    log.status === 'read' ? 'bg-green-600' :
                    'bg-red-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {(log as any).supplier_contacts?.company_name || 'Contato'}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-500">
                        {log.template_key}
                      </span>
                    </div>
                    {log.error_message && (
                      <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />{log.error_message}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {new Date(log.sent_at).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WhatsAppIntegration;

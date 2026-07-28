// src/pages/admin/WhatsAppIntegration.tsx
// Configuração da integração WhatsApp: Meta Cloud API ou Evolution API self-hosted

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare, Settings, FileText, Clock, Loader2, CheckCircle, AlertCircle,
  Wifi, WifiOff, RefreshCw, Eye, EyeOff, QrCode, Cloud, Server, Copy, Check,
  LogOut, Save, Link2, Share2,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import {
  whatsappService, WhatsAppConfig, WhatsAppMessageTemplate, WhatsAppMessageLog,
  WhatsAppProvider, evolutionCredentials,
} from '../../lib/whatsappService';
import {
  evolutionApi, connectionStateLabel, EvolutionConnectionState, EvolutionQrCode,
} from '../../lib/evolutionService';
import { supabase } from '../../lib/supabase';

// ── CSS helpers ──────────────────────────────────────────────────────────────
const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = 'flex items-center gap-2 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-all';

type TabId = 'config' | 'templates' | 'log';

/** Nome de instância derivado do hotel, sanitizado para o Evolution */
function suggestInstanceName(hotelName: string): string {
  return hotelName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const WhatsAppIntegration: React.FC = () => {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [activeTab, setActiveTab] = useState<TabId>('config');

  // Config state
  const [configLoading, setConfigLoading] = useState(true);
  const [savedConfig, setSavedConfig] = useState<WhatsAppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);

  // Compartilhamento do WhatsApp entre unidades do mesmo grupo
  const [hotels, setHotels] = useState<Array<{ id: string; name: string }>>([]);
  const [sourceHotelId, setSourceHotelId] = useState<string | null>(null);
  const [attachedHotels, setAttachedHotels] = useState<Array<{ id: string; name: string }>>([]);
  const [savingSource, setSavingSource] = useState(false);
  const [provider, setProvider] = useState<WhatsAppProvider>('meta');
  const [configForm, setConfigForm] = useState({
    phone_number_id: '',
    waba_id: '',
    access_token: '',
    display_phone: '',
    base_url: '',
    api_key: '',
    instance_name: '',
  });

  // Evolution connection state
  const [connecting, setConnecting] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [qr, setQr] = useState<EvolutionQrCode | null>(null);
  const [connState, setConnState] = useState<EvolutionConnectionState>('unknown');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [savingBody, setSavingBody] = useState<string | null>(null);

  // Log state
  const [logs, setLogs] = useState<WhatsAppMessageLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const webhookUrl = `${window.location.origin}/.netlify/functions/whatsapp-webhook`;

  /**
   * O webhook é derivado da origem atual. Em dev local isso gera um endereço que
   * o servidor Evolution não alcança, e as mensagens recebidas sumiriam sem erro
   * visível. Conectar a instância só faz sentido a partir do site publicado.
   */
  const isLocalOrigin = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
    || window.location.hostname.endsWith('.local');

  /** Aponta o erro no campo de URL base, que é onde se confunde com login */
  const baseUrlHint = (() => {
    const v = configForm.base_url.trim();
    if (!v) return null;
    if (v.includes('@')) return 'Isto parece um e-mail. O campo espera o endereço do servidor, por exemplo https://evolution.seudominio.com.br';
    if (!/^https?:\/\//i.test(v)) return 'Precisa começar com https://';
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:') return 'O proxy aceita apenas HTTPS.';
      if (!u.hostname.includes('.')) return 'Informe um domínio completo, não apenas um nome.';
    } catch {
      return 'URL inválida.';
    }
    return null;
  })();

  // ── Load config ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedHotel) return;
    const loadConfig = async () => {
      setConfigLoading(true);
      setTestResult(null);
      setQr(null);
      setConnState('unknown');
      try {
        const config = await whatsappService.getConfig(selectedHotel.id);
        if (config) {
          setSavedConfig(config);
          setProvider(config.provider || 'meta');
          setConfigForm({
            phone_number_id: config.phone_number_id || '',
            waba_id: config.waba_id || '',
            access_token: config.access_token || '',
            display_phone: config.display_phone || '',
            base_url: config.base_url || '',
            api_key: config.api_key || '',
            instance_name: config.instance_name || '',
          });
          setIsGlobal(config.hotel_id === null);
          setConnState((config.connection_status as EvolutionConnectionState) || 'unknown');
        } else {
          setSavedConfig(null);
          setProvider('meta');
          setConfigForm({
            phone_number_id: '', waba_id: '', access_token: '', display_phone: '',
            base_url: '', api_key: '',
            instance_name: suggestInstanceName(selectedHotel.name),
          });
        }
      } catch {
        // sem config = ok
      } finally {
        setConfigLoading(false);
      }
    };
    loadConfig();
  }, [selectedHotel]);

  // Encerra o polling ao desmontar ou trocar de hotel
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, [selectedHotel]);

  // ── Compartilhamento entre unidades ──────────────────────────────────────
  const loadSharing = useCallback(async () => {
    if (!selectedHotel) return;
    try {
      const [{ data: lista }, anexados, ownerId] = await Promise.all([
        supabase.from('hotels').select('id, name, whatsapp_source_hotel_id').order('name'),
        whatsappService.getAttachedHotels(selectedHotel.id),
        whatsappService.resolveConfigHotelId(selectedHotel.id),
      ]);

      // Só pode servir de origem quem não está delegando para outro
      setHotels(
        (lista || [])
          .filter((h: any) => h.id !== selectedHotel.id && !h.whatsapp_source_hotel_id)
          .map((h: any) => ({ id: h.id, name: h.name })),
      );
      setAttachedHotels(anexados);
      setSourceHotelId(ownerId === selectedHotel.id ? null : ownerId);
    } catch (err) {
      console.error('Erro ao carregar compartilhamento:', err);
    }
  }, [selectedHotel]);

  useEffect(() => { loadSharing(); }, [loadSharing]);

  const handleSaveSource = async (novoSourceId: string | null) => {
    if (!selectedHotel) return;
    setSavingSource(true);
    try {
      await whatsappService.setConfigSource(selectedHotel.id, novoSourceId);
      setSourceHotelId(novoSourceId);
      addNotification(
        novoSourceId
          ? 'Esta unidade passou a usar o WhatsApp da unidade escolhida.'
          : 'Esta unidade voltou a ter configuração própria.',
        'success',
      );
      await loadSharing();
    } catch (err: unknown) {
      // O trigger no banco recusa cadeia de delegação com mensagem explicativa
      addNotification(err instanceof Error ? err.message : 'Erro ao salvar', 'error');
    } finally {
      setSavingSource(false);
    }
  };

  // ── Save config ──────────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const saved = await whatsappService.saveConfig({
        hotel_id: isGlobal ? null : selectedHotel?.id || null,
        provider,
        phone_number_id: configForm.phone_number_id,
        waba_id: configForm.waba_id,
        access_token: configForm.access_token,
        base_url: configForm.base_url,
        api_key: configForm.api_key,
        instance_name: configForm.instance_name,
        display_phone: configForm.display_phone,
      });
      setSavedConfig(saved);
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
        provider,
        phone_number_id: configForm.phone_number_id.trim(),
        access_token: configForm.access_token.trim(),
        base_url: configForm.base_url.trim(),
        api_key: configForm.api_key.trim(),
        instance_name: configForm.instance_name.trim(),
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

  // ── Evolution: criar instância e obter QR ────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleConnectEvolution = async () => {
    const creds = {
      base_url: configForm.base_url.trim().replace(/\/+$/, ''),
      api_key: configForm.api_key.trim(),
      instance_name: configForm.instance_name.trim(),
    };
    if (!creds.base_url || !creds.api_key || !creds.instance_name) {
      addNotification('Preencha URL base, API Key e nome da instância antes de conectar.', 'error');
      return;
    }

    setConnecting(true);
    setQr(null);
    stopPolling();

    try {
      // Cria a instância já com o webhook apontado para esta origem.
      const created = await evolutionApi.createInstance(creds, webhookUrl);
      if (!created.success) {
        addNotification(`Falha ao criar instância: ${created.error}`, 'error');
        setConnecting(false);
        return;
      }
      // Instância pré-existente pode ter webhook antigo ou de outro domínio
      if (created.alreadyExists) {
        await evolutionApi.setWebhook(creds, webhookUrl);
      }

      const res = await evolutionApi.connect(creds);
      if (!res.success) {
        addNotification(`Falha ao obter QR Code: ${res.error}`, 'error');
        setConnecting(false);
        return;
      }

      setQr(res.qr || null);
      setConnState(res.qr?.state || 'connecting');

      if (res.qr?.state === 'open') {
        addNotification('Instância já está conectada.', 'success');
        setConnecting(false);
        return;
      }

      // Acompanha o estado até conectar. O QR expira em torno de 60s, então
      // o operador pode precisar clicar em Conectar novamente.
      pollRef.current = window.setInterval(async () => {
        const st = await evolutionApi.getState(creds);
        if (!st.success) return;
        setConnState(st.state);
        if (st.state === 'open') {
          stopPolling();
          setQr(null);
          setConnecting(false);
          addNotification('WhatsApp conectado!', 'success');
          if (savedConfig) await whatsappService.updateConnectionStatus(savedConfig.id, 'open');
        }
      }, 3000);
    } catch (err: unknown) {
      addNotification(err instanceof Error ? err.message : 'Erro ao conectar', 'error');
      setConnecting(false);
    }
  };

  const handleRefreshState = async () => {
    const creds = evolutionCredentials(savedConfig) || {
      base_url: configForm.base_url.trim().replace(/\/+$/, ''),
      api_key: configForm.api_key.trim(),
      instance_name: configForm.instance_name.trim(),
    };
    if (!creds.base_url || !creds.api_key || !creds.instance_name) return;
    const st = await evolutionApi.getState(creds);
    setConnState(st.success ? st.state : 'unknown');
    if (!st.success) addNotification(`Erro: ${st.error}`, 'error');
    else if (savedConfig) await whatsappService.updateConnectionStatus(savedConfig.id, st.state);
  };

  /**
   * Reaponta o webhook de uma instância já conectada. Necessário quando a URL
   * base muda sem a sessão cair, o caso típico de túnel com endereço aleatório
   * (Cloudflare quick tunnel) que é regenerado a cada reinício.
   */
  const handleReapplyWebhook = async () => {
    const creds = evolutionCredentials(savedConfig) || {
      base_url: configForm.base_url.trim().replace(/\/+$/, ''),
      api_key: configForm.api_key.trim(),
      instance_name: configForm.instance_name.trim(),
    };
    if (!creds.base_url || !creds.api_key || !creds.instance_name) {
      addNotification('Preencha URL base, API Key e nome da instância.', 'error');
      return;
    }
    setReapplying(true);
    try {
      const res = await evolutionApi.setWebhook(creds, webhookUrl);
      if (res.success) addNotification('Webhook reaplicado na instância.', 'success');
      else addNotification(`Falha ao reaplicar webhook: ${res.error}`, 'error');
    } finally {
      setReapplying(false);
    }
  };

  const handleLogoutEvolution = async () => {
    const creds = evolutionCredentials(savedConfig);
    if (!creds) return;
    const res = await evolutionApi.logout(creds);
    if (res.success) {
      stopPolling();
      setQr(null);
      setConnState('close');
      await whatsappService.updateConnectionStatus(savedConfig!.id, 'close');
      addNotification('Instância desconectada.', 'success');
    } else {
      addNotification(`Erro ao desconectar: ${res.error}`, 'error');
    }
  };

  const copyWebhook = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    window.setTimeout(() => setCopiedWebhook(false), 2000);
  };

  // ── Load templates ─────────────────────────────────────────────────────
  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await whatsappService.getTemplates();
      setTemplates(data);
      setBodyDrafts(Object.fromEntries(data.map(t => [t.id, t.body_text || ''])));
    } catch {
      addNotification('Erro ao carregar templates', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSaveBody = async (tpl: WhatsAppMessageTemplate) => {
    setSavingBody(tpl.id);
    try {
      const { error } = await supabase
        .from('whatsapp_message_templates')
        .update({ body_text: bodyDrafts[tpl.id] || null })
        .eq('id', tpl.id);
      if (error) throw error;
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, body_text: bodyDrafts[tpl.id] } : t));
      addNotification('Corpo do template salvo.', 'success');
    } catch (err: unknown) {
      addNotification(err instanceof Error ? err.message : 'Erro ao salvar', 'error');
    } finally {
      setSavingBody(null);
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

  const isEvolution = provider === 'evolution';

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-green-500" />
          WhatsApp
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Escolha entre a API oficial da Meta e o Evolution API self hosted.
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
              {/* ── Compartilhamento entre unidades ─────────────────── */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <label className={labelCls}>
                  <Share2 className="inline w-3.5 h-3.5 mr-1" />
                  WhatsApp desta unidade
                </label>
                <select
                  value={sourceHotelId || ''}
                  onChange={e => handleSaveSource(e.target.value || null)}
                  disabled={savingSource || attachedHotels.length > 0}
                  className={inputCls}
                >
                  <option value="">Configuração própria</option>
                  {hotels.map(h => (
                    <option key={h.id} value={h.id}>Usar o WhatsApp de {h.name}</option>
                  ))}
                </select>

                {attachedHotels.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {attachedHotels.map(h => h.name).join(', ')}{' '}
                    {attachedHotels.length > 1 ? 'usam' : 'usa'} o WhatsApp desta unidade.
                    Para anexar esta a outra, reaponte {attachedHotels.length > 1 ? 'essas unidades' : 'essa unidade'} primeiro.
                  </p>
                )}

                {sourceHotelId && (
                  <div className="mt-3 flex items-start gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Esta unidade usa as credenciais de{' '}
                      <strong>{hotels.find(h => h.id === sourceHotelId)?.name || 'outra unidade'}</strong>.
                      Como o número é o mesmo, o inbox, as etiquetas e as auto respostas
                      também são compartilhados: a resposta do fornecedor chega em um
                      número único, sem indicar a qual unidade se referia.
                    </p>
                  </div>
                )}
              </div>

              {/* Credenciais só existem em quem tem configuração própria */}
              {!sourceHotelId && (<>
              <div>
                <label className={labelCls}>Provider</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setProvider('meta'); setTestResult(null); }}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                      !isEvolution
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Cloud className={`w-5 h-5 mt-0.5 shrink-0 ${!isEvolution ? 'text-green-600' : 'text-gray-400'}`} />
                    <div>
                      <p className="font-bold text-sm text-gray-900 dark:text-white">Meta Cloud API</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Oficial. Exige templates aprovados e respeita a janela de 24h. Cobrança por conversa.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setProvider('evolution'); setTestResult(null); }}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                      isEvolution
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Server className={`w-5 h-5 mt-0.5 shrink-0 ${isEvolution ? 'text-green-600' : 'text-gray-400'}`} />
                    <div>
                      <p className="font-bold text-sm text-gray-900 dark:text-white">Evolution API</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Gratuito e self hosted. Texto livre sem janela de 24h. Conexão via QR Code.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {isEvolution && (
                <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    O Evolution API usa o protocolo do WhatsApp Web, que não é homologado pela Meta.
                    Existe risco de bloqueio do número, principalmente em disparos em massa. Use número
                    aquecido, mantenha intervalo entre envios e evite mensagens para quem nunca interagiu.
                  </p>
                </div>
              )}

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

              {/* ── Campos Meta ─────────────────────────────────────── */}
              {!isEvolution && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Phone Number ID *</label>
                    <input value={configForm.phone_number_id}
                      onChange={e => setConfigForm(p => ({ ...p, phone_number_id: e.target.value }))}
                      className={inputCls} placeholder="Ex: 123456789012345" />
                  </div>
                  <div>
                    <label className={labelCls}>WABA ID</label>
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
                </div>
              )}

              {/* ── Campos Evolution ────────────────────────────────── */}
              {isEvolution && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className={labelCls}>URL base do Evolution *</label>
                    <input value={configForm.base_url}
                      onChange={e => setConfigForm(p => ({ ...p, base_url: e.target.value }))}
                      className={inputCls} placeholder="https://evolution.seudominio.com.br" />
                    {baseUrlHint ? (
                      <p className="text-xs text-red-500 mt-1 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />{baseUrlHint}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">
                        Endereço do seu servidor Evolution. Precisa ser HTTPS e acessível pela internet.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>API Key *</label>
                    <div className="relative">
                      <input value={configForm.api_key}
                        onChange={e => setConfigForm(p => ({ ...p, api_key: e.target.value }))}
                        type={showApiKey ? 'text' : 'password'}
                        className={`${inputCls} pr-10`} placeholder="AUTHENTICATION_API_KEY" />
                      <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Nome da instância *</label>
                    <input value={configForm.instance_name}
                      onChange={e => setConfigForm(p => ({ ...p, instance_name: e.target.value }))}
                      className={inputCls} placeholder="costa-do-sol" />
                    <p className="text-xs text-gray-400 mt-1">
                      Único por hotel. Identifica a origem no webhook.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>Número para exibição</label>
                <input value={configForm.display_phone}
                  onChange={e => setConfigForm(p => ({ ...p, display_phone: e.target.value }))}
                  className={inputCls} placeholder="+55 22 99947 6601 (opcional)" />
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
              <div className="flex gap-3 flex-wrap">
                <button onClick={handleTestConnection} disabled={testing} className={btnGhost}>
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  Testar Conexão
                </button>
                <button onClick={handleSaveConfig} disabled={saving} className={btnPrimary}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Salvar Configuração
                </button>
              </div>

              {/* ── Conexão Evolution ───────────────────────────────── */}
              {isEvolution && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <QrCode className="w-4 h-4 text-gray-500" />
                      <h2 className="text-sm font-bold text-gray-900 dark:text-white">Conexão da instância</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                        connState === 'open'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : connState === 'connecting'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          connState === 'open' ? 'bg-green-500'
                            : connState === 'connecting' ? 'bg-amber-500 animate-pulse'
                            : 'bg-gray-400'
                        }`} />
                        {connectionStateLabel(connState)}
                      </span>
                      <button onClick={handleRefreshState} title="Atualizar estado"
                        className="text-gray-400 hover:text-gray-600">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Webhook URL */}
                  <div>
                    <label className={labelCls}>URL do webhook aplicada na instância</label>
                    <div className="flex items-center gap-2">
                      <code className={`flex-1 min-w-0 truncate px-3 py-2 border rounded-lg text-xs ${
                        isLocalOrigin
                          ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400'
                          : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {webhookUrl}
                      </code>
                      <button onClick={copyWebhook} className="p-2 text-gray-400 hover:text-gray-600" title="Copiar">
                        {copiedWebhook ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {isLocalOrigin && (
                    <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="text-xs text-red-700 dark:text-red-300 space-y-1">
                        <p className="font-bold">Você está em ambiente local.</p>
                        <p>
                          Esse endereço só existe na sua máquina, então o servidor Evolution não
                          conseguiria entregar as mensagens recebidas nele. A instância ficaria
                          conectada, o envio funcionaria, mas nada apareceria no inbox.
                        </p>
                        <p>Conecte a instância a partir do site publicado, não daqui.</p>
                      </div>
                    </div>
                  )}

                  {/* QR Code */}
                  {qr?.base64 && (
                    <div className="flex flex-col items-center gap-3 py-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl">
                      <img src={qr.base64} alt="QR Code de conexão do WhatsApp" className="w-56 h-56 rounded-lg bg-white p-2" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-xs">
                        No WhatsApp do número, abra Configurações › Aparelhos conectados › Conectar aparelho
                        e aponte para o código. Ele expira em cerca de 1 minuto.
                      </p>
                      {qr.pairingCode && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Código de pareamento: <strong className="font-mono">{qr.pairingCode}</strong>
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={handleConnectEvolution}
                      disabled={connecting || connState === 'open' || isLocalOrigin}
                      title={isLocalOrigin ? 'Indisponível em ambiente local: o webhook não seria alcançável' : undefined}
                      className={btnPrimary}
                    >
                      {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      {connState === 'open' ? 'Já conectado' : connecting ? 'Aguardando leitura' : 'Criar instância e conectar'}
                    </button>
                    <button
                      onClick={handleReapplyWebhook}
                      disabled={reapplying || isLocalOrigin}
                      title={isLocalOrigin
                        ? 'Indisponível em ambiente local: o webhook não seria alcançável'
                        : 'Use quando a URL base mudar sem a instância cair'}
                      className={btnGhost}
                    >
                      {reapplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      Reaplicar webhook
                    </button>
                    {connState === 'open' && (
                      <button onClick={handleLogoutEvolution} className={btnGhost}>
                        <LogOut className="w-4 h-4" />
                        Desconectar
                      </button>
                    )}
                    {connecting && (
                      <button onClick={() => { stopPolling(); setConnecting(false); setQr(null); }} className={btnGhost}>
                        Cancelar
                      </button>
                    )}
                  </div>

                  {!savedConfig && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Salve a configuração antes de conectar para que o webhook consiga identificar a instância.
                    </p>
                  )}
                </div>
              )}
              </>)}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Templates ─────────────────────────────────────────── */}
      {activeTab === 'templates' && (
        <div>
          <div className="flex items-start justify-between mb-4 gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              O nome do template é usado pela Meta. O corpo em texto puro é usado pelo Evolution,
              com placeholders {'{{1}}'}, {'{{2}}'} substituídos pelos mesmos parâmetros.
            </p>
            <button onClick={loadTemplates} className="text-gray-400 hover:text-gray-600 shrink-0">
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
              {templates.map(t => {
                const dirty = (bodyDrafts[t.id] || '') !== (t.body_text || '');
                return (
                  <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-bold rounded-md">
                        {t.template_key}
                      </span>
                      <span className="text-xs text-gray-400">{t.language_code}</span>
                      {!t.body_text && (
                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-md">
                          Sem corpo para Evolution
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{t.template_name}</p>
                    {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                    <div className="mt-2 text-xs text-gray-400">
                      Parâmetros: {Object.entries(t.parameter_mappings).map(([k, v]) => `{{${k}}} = ${v}`).join(', ')}
                    </div>

                    <div className="mt-3">
                      <label className={labelCls}>Corpo em texto puro (Evolution)</label>
                      <textarea
                        value={bodyDrafts[t.id] ?? ''}
                        onChange={e => setBodyDrafts(p => ({ ...p, [t.id]: e.target.value }))}
                        rows={4}
                        className={`${inputCls} font-mono text-xs resize-y`}
                        placeholder="{{1}}! Segue o link da cotação do {{2}}: {{3}}"
                      />
                      {dirty && (
                        <button onClick={() => handleSaveBody(t)} disabled={savingBody === t.id}
                          className={`${btnPrimary} mt-2 !py-2 !text-xs`}>
                          {savingBody === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Salvar corpo
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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

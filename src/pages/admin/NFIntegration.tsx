// src/pages/admin/NFIntegration.tsx
// Página de configuração NF-e (Produtos / SEFAZ-RJ) e NFS-e (Serviços / Prefeitura Búzios)

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Receipt,
  Building2,
  FileText,
  ShieldCheck,
  Loader2,
  AlertCircle,
  CheckCircle,
  Wifi,
  WifiOff,
  Save,
  Upload,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { nfService } from '../../lib/nfService';
import { supabase } from '../../lib/supabase';
import type { NFHotelConfig, NFAmbiente, NFSEProvider } from '../../types/nf';
import { ImageIcon, Globe, Landmark } from 'lucide-react';

// ── CSS helpers ──────────────────────────────────────────────────────────────

const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

type TabId = 'empresa' | 'nfse' | 'nfe' | 'nfce' | 'receber' | 'certificado';

const EMPTY_FORM = {
  ambiente: 'homologacao' as NFAmbiente,
  razao_social: '',
  nome_fantasia: '',
  cnpj: '',
  endereco_logradouro: '',
  endereco_numero: '',
  endereco_complemento: '',
  endereco_bairro: '',
  endereco_cidade: 'Armação dos Búzios',
  endereco_uf: 'RJ',
  endereco_cep: '',
  endereco_codigo_municipio: '3300233',
  telefone: '',
  email: '',
  nfse_enabled: false,
  inscricao_municipal: '',
  regime_tributario_nfse: '',
  codigo_servico: '',
  aliquota_iss: 5,
  serie_nfse: 'NFS',
  proximo_numero_nfse: 1,
  prefeitura_login: '',
  prefeitura_senha: '',
  nfe_enabled: false,
  inscricao_estadual: '',
  crt: 1,
  serie_nfe: '1',
  proximo_numero_nfe: 1,
  csc_id: '',
  csc_token: '',
  nfce_enabled: false,
  serie_nfce: '1',
  proximo_numero_nfce: 1,
  nfce_csc_id: '',
  nfce_csc_token: '',
  nfce_taxa_na_base_icms: false,
  nfce_emit_redirect_enabled: false,
  nfce_emit_redirect_hotel_id: '',
  nfse_provider: 'prefeitura' as NFSEProvider,
  adn_ambiente: 'homologacao' as NFAmbiente,
  el_token: '',
  el_ambiente: 'homologacao' as NFAmbiente,
  codigo_servico_municipal: '',
  logo_url: '',
  nf_recebidas_enabled: false,
  certificado_base64: '',
  certificado_senha: '',
  certificado_validade: '',
};

type FormState = typeof EMPTY_FORM;

// ── Component ────────────────────────────────────────────────────────────────

const NFIntegration: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [activeTab, setActiveTab] = useState<TabId>('empresa');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resettingNSU, setResettingNSU] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [config, setConfig] = useState<NFHotelConfig | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [groupUnits, setGroupUnits] = useState<{ id: string; name: string }[]>([]);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedHotel) loadConfig();
  }, [selectedHotel]);

  // Unidades do mesmo grupo (para redirecionamento de emissão de NFC-e)
  useEffect(() => {
    if (!selectedHotel) return;
    (async () => {
      const { data: me } = await supabase.from('hotels').select('group_id').eq('id', selectedHotel.id).single();
      if (!me?.group_id) { setGroupUnits([]); return; }
      const { data: units } = await supabase
        .from('hotels')
        .select('id, name, fantasy_name')
        .eq('group_id', me.group_id)
        .neq('id', selectedHotel.id)
        .eq('is_active', true)
        .order('name');
      setGroupUnits((units ?? []).map((u: any) => ({ id: u.id, name: u.fantasy_name || u.name })));
    })();
  }, [selectedHotel]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  async function loadConfig() {
    if (!selectedHotel) return;
    setLoading(true);
    setError(null);
    try {
      const cfg = await nfService.getConfig(selectedHotel.id);
      setConfig(cfg);
      if (cfg) {
        setForm({
          ambiente: cfg.ambiente || 'homologacao',
          razao_social: cfg.razao_social || selectedHotel.corporate_name || '',
          nome_fantasia: cfg.nome_fantasia || selectedHotel.fantasy_name || selectedHotel.name || '',
          cnpj: cfg.cnpj || selectedHotel.cnpj || '',
          endereco_logradouro: cfg.endereco_logradouro || '',
          endereco_numero: cfg.endereco_numero || '',
          endereco_complemento: cfg.endereco_complemento || '',
          endereco_bairro: cfg.endereco_bairro || '',
          endereco_cidade: cfg.endereco_cidade || 'Armação dos Búzios',
          endereco_uf: cfg.endereco_uf || 'RJ',
          endereco_cep: cfg.endereco_cep || '',
          endereco_codigo_municipio: cfg.endereco_codigo_municipio || '3300233',
          telefone: cfg.telefone || '',
          email: cfg.email || '',
          nfse_enabled: cfg.nfse_enabled ?? false,
          inscricao_municipal: cfg.inscricao_municipal || '',
          regime_tributario_nfse: cfg.regime_tributario_nfse || '',
          codigo_servico: cfg.codigo_servico || '',
          aliquota_iss: cfg.aliquota_iss ?? 5,
          serie_nfse: cfg.serie_nfse || 'NFS',
          proximo_numero_nfse: cfg.proximo_numero_nfse ?? 1,
          prefeitura_login: cfg.prefeitura_login || '',
          prefeitura_senha: cfg.prefeitura_senha || '',
          nfe_enabled: cfg.nfe_enabled ?? false,
          inscricao_estadual: cfg.inscricao_estadual || '',
          crt: cfg.crt ?? 1,
          serie_nfe: cfg.serie_nfe || '1',
          proximo_numero_nfe: cfg.proximo_numero_nfe ?? 1,
          csc_id: cfg.csc_id || '',
          csc_token: cfg.csc_token || '',
          nfce_enabled: cfg.nfce_enabled ?? false,
          serie_nfce: cfg.serie_nfce || '1',
          proximo_numero_nfce: cfg.proximo_numero_nfce ?? 1,
          nfce_csc_id: cfg.nfce_csc_id || '',
          nfce_csc_token: cfg.nfce_csc_token || '',
          nfce_taxa_na_base_icms: (cfg as any).nfce_taxa_na_base_icms ?? false,
          nfce_emit_redirect_enabled: (cfg as any).nfce_emit_redirect_enabled ?? false,
          nfce_emit_redirect_hotel_id: (cfg as any).nfce_emit_redirect_hotel_id ?? '',
          nfse_provider: cfg.nfse_provider || 'prefeitura',
          adn_ambiente: cfg.adn_ambiente || 'homologacao',
          el_token: (cfg as any).el_token || '',
          el_ambiente: (cfg as any).el_ambiente || 'homologacao',
          codigo_servico_municipal: (cfg as any).codigo_servico_municipal || '',
          logo_url: cfg.logo_url || '',
          nf_recebidas_enabled: cfg.nf_recebidas_enabled ?? false,
          certificado_base64: cfg.certificado_base64 || '',
          certificado_senha: cfg.certificado_senha || '',
          certificado_validade: cfg.certificado_validade || '',
        });
      } else {
        setForm({
          ...EMPTY_FORM,
          razao_social: selectedHotel.corporate_name || '',
          nome_fantasia: selectedHotel.fantasy_name || selectedHotel.name || '',
          cnpj: selectedHotel.cnpj || '',
        });
      }
    } catch (err) {
      console.error('[NFIntegration] loadConfig:', err);
      setError('Erro ao carregar configuração fiscal.');
    } finally {
      setLoading(false);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedHotel) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await nfService.saveConfig(selectedHotel.id, {
        ...form,
        aliquota_iss: Number(form.aliquota_iss) || 0,
        proximo_numero_nfse: Number(form.proximo_numero_nfse) || 1,
        crt: Number(form.crt) || 1,
        proximo_numero_nfe: Number(form.proximo_numero_nfe) || 1,
        proximo_numero_nfce: Number(form.proximo_numero_nfce) || 1,
        certificado_validade: form.certificado_validade || null,
        nfce_emit_redirect_hotel_id: form.nfce_emit_redirect_hotel_id || null,
        is_active: true,
      });
      setConfig(saved);
      setSuccess('Configuração fiscal salva com sucesso!');
    } catch (err) {
      console.error('[NFIntegration] save:', err);
      setError('Erro ao salvar configuração.');
    } finally {
      setSaving(false);
    }
  }

  // ── Test Connection ───────────────────────────────────────────────────────

  async function handleTestConnection(tipo: 'nfse' | 'nfe') {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await nfService.testConnection(tipo, form as Partial<NFHotelConfig>);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: 'Erro ao testar conexão' });
    } finally {
      setTesting(false);
    }
  }

  // ── Reset NSU (Receber NF) ────────────────────────────────────────────────

  async function handleResetNSU() {
    if (!selectedHotel) return;
    setResettingNSU(true);
    setError(null);
    try {
      await nfService.resetDFeNSU(selectedHotel.id);
      setConfig(prev => (prev ? { ...prev, dfe_ultimo_nsu: '0' } : prev));
      setSuccess('NSU zerado — a próxima busca reconsultará os últimos 90 dias.');
    } catch (err) {
      console.error('[NFIntegration] resetNSU:', err);
      setError('Erro ao zerar o NSU.');
    } finally {
      setResettingNSU(false);
    }
  }

  // ── Certificate Upload ────────────────────────────────────────────────────

  function handleCertificateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setForm(p => ({ ...p, certificado_base64: base64 }));
    };
    reader.readAsDataURL(file);
  }

  // ── Logo Upload ───────────────────────────────────────────────────────────

  const [uploadingLogo, setUploadingLogo] = useState(false);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedHotel) return;
    if (file.size > 500 * 1024) {
      setError('Logo deve ter no máximo 500KB.');
      return;
    }
    setUploadingLogo(true);
    setError(null);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${selectedHotel.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage.from('nf-logos').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('nf-logos').getPublicUrl(path);
      const logoUrl = urlData.publicUrl + '?t=' + Date.now();
      setForm(p => ({ ...p, logo_url: logoUrl }));
      setSuccess('Logo atualizada com sucesso!');
    } catch (err) {
      console.error('[NFIntegration] logoUpload:', err);
      setError('Erro ao fazer upload da logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  // ── ADN Test Connection ──────────────────────────────────────────────────

  async function handleTestADN() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        import.meta.env.PROD ? '/.netlify/functions/nf-proxy' : '/.netlify/functions/nf-proxy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-nf-action': 'test-nfse-adn' },
          body: JSON.stringify({
            action: 'test-nfse-adn',
            certificado_base64: form.certificado_base64,
            certificado_senha: form.certificado_senha,
            ambiente: form.adn_ambiente,
          }),
        },
      );
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message || data.error || 'Erro desconhecido' });
    } catch {
      setTestResult({ success: false, message: 'Erro ao testar conexão com ADN' });
    } finally {
      setTesting(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const upd = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [key]: e.target.value }));

  const certValidade = form.certificado_validade ? new Date(form.certificado_validade) : null;
  const certVencido = certValidade ? certValidade < new Date() : false;

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'empresa',     label: 'Empresa',     icon: Building2 },
    { id: 'nfse',        label: 'NFS-e (Serviços)', icon: FileText },
    { id: 'nfe',         label: 'NF-e (Produtos)',  icon: Receipt },
    { id: 'nfce',        label: 'NFC-e (Consumidor)', icon: Receipt },
    { id: 'receber',     label: 'Receber NF',         icon: Inbox },
    { id: 'certificado', label: 'Certificado',      icon: ShieldCheck },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  if (!selectedHotel) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Settings className="w-6 h-6 mr-2 animate-spin" />
        Selecione um hotel
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="w-6 h-6 mr-2 animate-spin" />
        Carregando configuração fiscal…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
          <Receipt className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">NF-e / NFS-e</h1>
          <p className="text-sm text-gray-500">{selectedHotel.name} — Configuração de notas fiscais eletrônicas</p>
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

      {/* Test result */}
      {testResult && (
        <div className={`p-3 rounded-xl flex items-center gap-3 text-sm border ${
          testResult.success
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
        }`}>
          {testResult.success ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <p className="flex-1">{testResult.message}</p>
          <button onClick={() => setTestResult(null)} className="font-bold">OK</button>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
          <nav className="flex overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  'flex items-center gap-2 py-4 px-6 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ' +
                  (activeTab === tab.id
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
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
          {/* ══════════════ TAB: EMPRESA ══════════════ */}
          {activeTab === 'empresa' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Dados da Empresa</h3>
                <select
                  value={form.ambiente}
                  onChange={upd('ambiente')}
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                >
                  <option value="homologacao">🧪 Homologação</option>
                  <option value="producao">🟢 Produção</option>
                </select>
              </div>

              {/* Logo upload */}
              <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-900/30">
                <label className={labelCls}>Logo da Unidade (impressa na NF)</label>
                <div className="flex items-center gap-4 mt-2">
                  <div className="w-24 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden bg-white dark:bg-gray-800">
                    {form.logo_url ? (
                      <img src={form.logo_url} alt="Logo" className="max-h-14 max-w-20 object-contain" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <label className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:border-blue-400 transition-colors text-sm text-gray-600 dark:text-gray-400">
                      <Upload className="w-4 h-4" />
                      {uploadingLogo ? 'Enviando...' : form.logo_url ? 'Trocar logo' : 'Selecionar logo'}
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        onChange={handleLogoUpload}
                        disabled={uploadingLogo}
                        className="hidden"
                      />
                    </label>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG ou WebP. Máximo 500KB.</p>
                  </div>
                  {form.logo_url && (
                    <button
                      onClick={() => setForm(p => ({ ...p, logo_url: '' }))}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Razão Social</label>
                  <input type="text" value={form.razao_social} onChange={upd('razao_social')} className={inputCls} placeholder="Razão social da empresa" />
                </div>
                <div>
                  <label className={labelCls}>Nome Fantasia</label>
                  <input type="text" value={form.nome_fantasia} onChange={upd('nome_fantasia')} className={inputCls} placeholder="Nome fantasia" />
                </div>
                <div>
                  <label className={labelCls}>CNPJ</label>
                  <input type="text" value={form.cnpj} onChange={upd('cnpj')} className={inputCls} placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <label className={labelCls}>Telefone</label>
                  <input type="text" value={form.telefone} onChange={upd('telefone')} className={inputCls} placeholder="(22) 0000-0000" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>E-mail Fiscal</label>
                  <input type="email" value={form.email} onChange={upd('email')} className={inputCls} placeholder="fiscal@empresa.com.br" />
                </div>
              </div>

              <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 pt-2">Endereço</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className={labelCls}>Logradouro</label>
                  <input type="text" value={form.endereco_logradouro} onChange={upd('endereco_logradouro')} className={inputCls} placeholder="Rua, Avenida..." />
                </div>
                <div>
                  <label className={labelCls}>Número</label>
                  <input type="text" value={form.endereco_numero} onChange={upd('endereco_numero')} className={inputCls} placeholder="123" />
                </div>
                <div>
                  <label className={labelCls}>Complemento</label>
                  <input type="text" value={form.endereco_complemento} onChange={upd('endereco_complemento')} className={inputCls} placeholder="Sala, Bloco..." />
                </div>
                <div>
                  <label className={labelCls}>Bairro</label>
                  <input type="text" value={form.endereco_bairro} onChange={upd('endereco_bairro')} className={inputCls} placeholder="Bairro" />
                </div>
                <div>
                  <label className={labelCls}>CEP</label>
                  <input type="text" value={form.endereco_cep} onChange={upd('endereco_cep')} className={inputCls} placeholder="28950-000" />
                </div>
                <div>
                  <label className={labelCls}>Cidade</label>
                  <input type="text" value={form.endereco_cidade} onChange={upd('endereco_cidade')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>UF</label>
                  <input type="text" value={form.endereco_uf} onChange={upd('endereco_uf')} className={inputCls} maxLength={2} />
                </div>
                <div>
                  <label className={labelCls}>Cód. Município (IBGE)</label>
                  <input type="text" value={form.endereco_codigo_municipio} onChange={upd('endereco_codigo_municipio')} className={inputCls} placeholder="3300233" />
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ TAB: NFS-e (Serviços) ══════════════ */}
          {activeTab === 'nfse' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">NFS-e — Nota Fiscal de Serviços</h3>
                <div className="flex items-center gap-3">
                  {form.nfse_enabled ? (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                      <Wifi className="w-4 h-4" /> Habilitado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-gray-400 text-sm">
                      <WifiOff className="w-4 h-4" /> Desabilitado
                    </span>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.nfse_enabled}
                      onChange={e => setForm(p => ({ ...p, nfse_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* Provider toggle */}
              <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  onClick={() => setForm(p => ({ ...p, nfse_provider: p.nfse_provider === 'adn' ? 'prefeitura' : p.nfse_provider }))}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold transition-colors ${
                    form.nfse_provider !== 'adn'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Landmark className="w-4 h-4" />
                  Prefeitura (Municipal)
                </button>
                <button
                  onClick={() => setForm(p => ({ ...p, nfse_provider: 'adn' }))}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold transition-colors ${
                    form.nfse_provider === 'adn'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-50 dark:bg-gray-900/50 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  Governo Federal / ADN
                </button>
              </div>

              {/* Sub-toggle: formato de emissão da Prefeitura (atual × futuro) */}
              {form.nfse_provider !== 'adn' && (
                <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-900/30 space-y-2">
                  <label className={labelCls}>Formato de Emissão</label>
                  <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <button
                      onClick={() => setForm(p => ({ ...p, nfse_provider: 'prefeitura' }))}
                      className={`flex-1 py-2.5 px-4 text-sm font-bold transition-colors ${
                        form.nfse_provider === 'prefeitura'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      ABRASF 2.04 — Atual (sem IBS/CBS)
                    </button>
                    <button
                      onClick={() => setForm(p => ({ ...p, nfse_provider: 'el-nacional' }))}
                      className={`flex-1 py-2.5 px-4 text-sm font-bold transition-colors ${
                        form.nfse_provider === 'el-nacional'
                          ? 'bg-amber-600 text-white'
                          : 'bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      Nacional DPS — Futuro (com IBS/CBS)
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Quando a prefeitura migrar para a Plataforma Nacional, basta trocar o formato aqui e salvar — 1 clique.
                  </p>
                </div>
              )}

              {form.nfse_provider === 'el-nacional' ? (
                <>
                  <p className="text-sm text-gray-500">
                    Integração via API Nacional NFS-e hospedada pelo E&L (Búzios). Formato DPS (layout nacional v1.01) com CBS e IBS.
                    O XML é assinado digitalmente, compactado e enviado via REST com token de integração.
                  </p>

                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      Este formato será o padrão de produção quando a prefeitura migrar para a Plataforma Nacional NFS-e.
                      O token de integração é gerado no portal do município (E&L Cloud).
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Ambiente E&L Nacional</label>
                      <select value={form.el_ambiente} onChange={upd('el_ambiente') as any} className={inputCls}>
                        <option value="homologacao">🧪 Homologação</option>
                        <option value="producao">🟢 Produção</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Token de Integração (E&L)</label>
                      <input type="password" value={form.el_token} onChange={upd('el_token')} className={inputCls} placeholder="Token gerado no portal E&L" />
                    </div>
                    <div>
                      <label className={labelCls}>Inscrição Municipal</label>
                      <input type="text" value={form.inscricao_municipal} onChange={upd('inscricao_municipal')} className={inputCls} placeholder="Número da IM" />
                    </div>
                    <div>
                      <label className={labelCls}>Código de Serviço (LC 116)</label>
                      <input type="text" value={form.codigo_servico} onChange={upd('codigo_servico')} className={inputCls} placeholder="9.01 — Hospedagem" />
                    </div>
                    <div>
                      <label className={labelCls}>Código Serviço Municipal (cIntContrib)</label>
                      <input type="text" value={form.codigo_servico_municipal} onChange={upd('codigo_servico_municipal')} className={inputCls} placeholder="Ex: 901 ou código do município" />
                    </div>
                    <div>
                      <label className={labelCls}>Alíquota ISS (%)</label>
                      <input type="number" value={form.aliquota_iss} onChange={upd('aliquota_iss')} className={inputCls} step="0.01" min="0" max="100" />
                    </div>
                    <div>
                      <label className={labelCls}>Série</label>
                      <input type="text" value={form.serie_nfse} onChange={upd('serie_nfse')} className={inputCls} placeholder="NFS" />
                    </div>
                    <div>
                      <label className={labelCls}>Próximo Número DPS</label>
                      <input type="number" value={form.proximo_numero_nfse} onChange={upd('proximo_numero_nfse')} className={inputCls} min="1" />
                    </div>
                  </div>

                  {/* Pré-requisitos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                      form.certificado_base64 && !certVencido
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                    }`}>
                      {form.certificado_base64 && !certVencido ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                      {!form.certificado_base64
                        ? 'Certificado A1 não configurado (aba Certificado)'
                        : certVencido
                        ? 'Certificado A1 vencido — renove na aba Certificado'
                        : 'Certificado A1 configurado e válido'}
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                      form.el_token
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                    }`}>
                      {form.el_token ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                      {form.el_token ? 'Token E&L configurado' : 'Token de integração E&L não configurado'}
                    </div>
                  </div>
                </>
              ) : form.nfse_provider === 'prefeitura' ? (
                <>
                  <p className="text-sm text-gray-500">
                    Integração com a Prefeitura de Armação dos Búzios (padrão ABRASF) para emissão de notas de serviço (diárias, taxas).
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Inscrição Municipal</label>
                      <input type="text" value={form.inscricao_municipal} onChange={upd('inscricao_municipal')} className={inputCls} placeholder="Número da IM" />
                    </div>
                    <div>
                      <label className={labelCls}>Regime Tributário</label>
                      <select value={form.regime_tributario_nfse} onChange={upd('regime_tributario_nfse')} className={inputCls}>
                        <option value="">Nenhum / Regime Normal (Lucro Presumido ou Lucro Real)</option>
                        <option value="1">Microempresa Municipal</option>
                        <option value="2">Estimativa</option>
                        <option value="3">Sociedade de Profissionais</option>
                        <option value="4">Cooperativa</option>
                        <option value="5">MEI</option>
                        <option value="6">ME/EPP — Simples Nacional</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Código de Serviço (LC 116)</label>
                      <input type="text" value={form.codigo_servico} onChange={upd('codigo_servico')} className={inputCls} placeholder="9.01 — Hospedagem" />
                    </div>
                    <div>
                      <label className={labelCls}>Código de Tributação Municipal</label>
                      <input type="text" value={form.codigo_servico_municipal} onChange={upd('codigo_servico_municipal')} className={inputCls} placeholder="9.01 (com ponto, como no portal)" />
                      <p className="text-xs text-gray-400 mt-1">
                        Valor da tabela do município, com ponto (ex.: 9.01 — confirmado nas notas emitidas no portal). Vazio = usa o Código de Serviço.
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Alíquota ISS (%)</label>
                      <input type="number" value={form.aliquota_iss} onChange={upd('aliquota_iss')} className={inputCls} step="0.01" min="0" max="100" />
                    </div>
                    <div>
                      <label className={labelCls}>Série</label>
                      <input type="text" value={form.serie_nfse} onChange={upd('serie_nfse')} className={inputCls} placeholder="NFS" />
                    </div>
                    <div>
                      <label className={labelCls}>Próximo Número</label>
                      <input type="number" value={form.proximo_numero_nfse} onChange={upd('proximo_numero_nfse')} className={inputCls} min="1" />
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 pt-2">Credenciais da Prefeitura</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Login / Usuário</label>
                      <input type="text" value={form.prefeitura_login} onChange={upd('prefeitura_login')} className={inputCls} placeholder="Usuário da prefeitura" />
                    </div>
                    <div>
                      <label className={labelCls}>Senha</label>
                      <input type="password" value={form.prefeitura_senha} onChange={upd('prefeitura_senha')} className={inputCls} placeholder="••••••••" />
                    </div>
                  </div>

                  <button
                    onClick={() => handleTestConnection('nfse')}
                    disabled={testing}
                    className={btnPrimary}
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    Testar Conexão NFS-e (Prefeitura)
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-500">
                    Emissão via ADN (Ambiente de Dados Nacional) — sistema do Governo Federal gerenciado pela Receita Federal / Serpro.
                    A autenticação utiliza o certificado digital A1 configurado na aba Certificado.
                  </p>

                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      O ADN utiliza autenticação mTLS com o <span className="font-semibold">Certificado Digital A1</span> (aba Certificado).
                      Não são necessários login ou senha adicionais. Configure o certificado primeiro.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Ambiente ADN</label>
                      <select value={form.adn_ambiente} onChange={upd('adn_ambiente') as any} className={inputCls}>
                        <option value="homologacao">🧪 Produção Restrita (Homologação)</option>
                        <option value="producao">🟢 Produção</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Inscrição Municipal</label>
                      <input type="text" value={form.inscricao_municipal} onChange={upd('inscricao_municipal')} className={inputCls} placeholder="Número da IM" />
                    </div>
                    <div>
                      <label className={labelCls}>Regime Tributário</label>
                      <select value={form.regime_tributario_nfse} onChange={upd('regime_tributario_nfse')} className={inputCls}>
                        <option value="">Nenhum / Regime Normal</option>
                        <option value="1">Microempresa Municipal</option>
                        <option value="2">Estimativa</option>
                        <option value="3">Sociedade de Profissionais</option>
                        <option value="4">Cooperativa</option>
                        <option value="5">MEI</option>
                        <option value="6">ME/EPP — Simples Nacional</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Código de Serviço (Tributação Nacional)</label>
                      <input type="text" value={form.codigo_servico} onChange={upd('codigo_servico')} className={inputCls} placeholder="01.01 — Hospedagem" />
                    </div>
                    <div>
                      <label className={labelCls}>Alíquota ISS (%)</label>
                      <input type="number" value={form.aliquota_iss} onChange={upd('aliquota_iss')} className={inputCls} step="0.01" min="0" max="100" />
                    </div>
                    <div>
                      <label className={labelCls}>Série</label>
                      <input type="text" value={form.serie_nfse} onChange={upd('serie_nfse')} className={inputCls} placeholder="NFS" />
                    </div>
                    <div>
                      <label className={labelCls}>Próximo Número DPS</label>
                      <input type="number" value={form.proximo_numero_nfse} onChange={upd('proximo_numero_nfse')} className={inputCls} min="1" />
                    </div>
                  </div>

                  {/* Pré-requisitos ADN */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                      form.certificado_base64 && !certVencido
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                    }`}>
                      {form.certificado_base64 && !certVencido ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                      {!form.certificado_base64
                        ? 'Certificado A1 não configurado (aba Certificado)'
                        : certVencido
                        ? 'Certificado A1 vencido — renove na aba Certificado'
                        : 'Certificado A1 configurado e válido'}
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                      form.cnpj
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                    }`}>
                      {form.cnpj ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                      {form.cnpj ? `CNPJ: ${form.cnpj}` : 'CNPJ não configurado (aba Empresa)'}
                    </div>
                  </div>

                  <button
                    onClick={handleTestADN}
                    disabled={testing || !form.certificado_base64}
                    className={btnPrimary}
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    Testar Conexão ADN
                  </button>
                </>
              )}
            </div>
          )}

          {/* ══════════════ TAB: NF-e (Produtos) ══════════════ */}
          {activeTab === 'nfe' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">NF-e — Nota Fiscal de Produtos</h3>
                <div className="flex items-center gap-3">
                  {form.nfe_enabled ? (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                      <Wifi className="w-4 h-4" /> Habilitado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-gray-400 text-sm">
                      <WifiOff className="w-4 h-4" /> Desabilitado
                    </span>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.nfe_enabled}
                      onChange={e => setForm(p => ({ ...p, nfe_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              <p className="text-sm text-gray-500 -mt-2">
                Integração com SEFAZ-RJ (Estado do Rio de Janeiro) para emissão de notas de consumo (produtos, alimentos, bebidas).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Inscrição Estadual</label>
                  <input type="text" value={form.inscricao_estadual} onChange={upd('inscricao_estadual')} className={inputCls} placeholder="Número da IE" />
                </div>
                <div>
                  <label className={labelCls}>CRT (Código Regime Tributário)</label>
                  <select value={form.crt} onChange={upd('crt')} className={inputCls}>
                    <option value={1}>1 — Simples Nacional</option>
                    <option value={2}>2 — Simples Nacional (excesso)</option>
                    <option value={3}>3 — Regime Normal (Lucro Presumido ou Lucro Real)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Série</label>
                  <input type="text" value={form.serie_nfe} onChange={upd('serie_nfe')} className={inputCls} placeholder="1" />
                </div>
                <div>
                  <label className={labelCls}>Próximo Número</label>
                  <input type="number" value={form.proximo_numero_nfe} onChange={upd('proximo_numero_nfe')} className={inputCls} min="1" />
                </div>
                <div>
                  <label className={labelCls}>CSC ID (Código de Segurança)</label>
                  <input type="text" value={form.csc_id} onChange={upd('csc_id')} className={inputCls} placeholder="ID do CSC" />
                </div>
                <div>
                  <label className={labelCls}>CSC Token</label>
                  <input type="password" value={form.csc_token} onChange={upd('csc_token')} className={inputCls} placeholder="Token do CSC" />
                </div>
              </div>

              <button
                onClick={() => handleTestConnection('nfe')}
                disabled={testing}
                className={btnPrimary}
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                Testar Conexão NF-e
              </button>
            </div>
          )}

          {/* ══════════════ TAB: NFC-e ══════════════ */}
          {activeTab === 'nfce' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">NFC-e — Nota Fiscal do Consumidor</h3>
                <div className="flex items-center gap-3">
                  {form.nfce_enabled ? (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                      <Wifi className="w-4 h-4" /> Habilitado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-gray-400 text-sm">
                      <WifiOff className="w-4 h-4" /> Desabilitado
                    </span>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.nfce_enabled}
                      onChange={e => setForm(p => ({ ...p, nfce_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              <p className="text-sm text-gray-500 -mt-2">
                Modelo 65 (SEFAZ-RJ) — cupom fiscal eletrônico para vendas ao consumidor final. Não exige identificação completa do destinatário. Compartilha o certificado digital e a inscrição estadual com a NF-e.
              </p>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>A NFC-e utiliza a mesma Inscrição Estadual e certificado digital configurados na aba NF-e. Configure-os lá primeiro. O CSC abaixo é específico para NFC-e (diferente do CSC da NF-e).</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Série NFC-e</label>
                  <input type="text" value={form.serie_nfce} onChange={upd('serie_nfce')} className={inputCls} placeholder="1" />
                </div>
                <div>
                  <label className={labelCls}>Próximo Número</label>
                  <input type="number" value={form.proximo_numero_nfce} onChange={upd('proximo_numero_nfce')} className={inputCls} min="1" />
                </div>
                <div>
                  <label className={labelCls}>CSC ID (NFC-e)</label>
                  <input type="text" value={form.nfce_csc_id} onChange={upd('nfce_csc_id')} className={inputCls} placeholder="ID do CSC para NFC-e" />
                </div>
                <div>
                  <label className={labelCls}>CSC Token (NFC-e)</label>
                  <input type="password" value={form.nfce_csc_token} onChange={upd('nfce_csc_token')} className={inputCls} placeholder="Token do CSC para NFC-e" />
                </div>
              </div>

              {/* Tratamento da taxa de serviço (acréscimo/vOutro) na base do ICMS */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-200">Taxa de serviço na base do ICMS</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      A taxa de serviço (10%) é enviada como acréscimo (vOutro) e soma no total da NFC-e.
                      Ligado = entra na base do ICMS (tributada); desligado = fora da base (isenta). Confirme com o contador.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={form.nfce_taxa_na_base_icms}
                      onChange={e => setForm(p => ({ ...p, nfce_taxa_na_base_icms: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* Redirecionar emissão de NFC-e para outra unidade do grupo */}
              <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-purple-800 dark:text-purple-300">Emitir NFC-e por outra unidade</p>
                    <p className="text-xs text-purple-700/80 dark:text-purple-400/80 mt-0.5">
                      Esta unidade vende mas não fatura: a NFC-e sai com a identidade fiscal (CNPJ, IE, certificado,
                      numeração, logo) da unidade responsável escolhida abaixo. Só unidades do mesmo grupo.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={form.nfce_emit_redirect_enabled}
                      onChange={e => setForm(p => ({ ...p, nfce_emit_redirect_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
                {form.nfce_emit_redirect_enabled && (
                  <div>
                    <label className={labelCls}>Unidade responsável pela emissão</label>
                    <select value={form.nfce_emit_redirect_hotel_id} onChange={upd('nfce_emit_redirect_hotel_id')} className={inputCls}>
                      <option value="">Selecione uma unidade do grupo…</option>
                      {groupUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    {groupUnits.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Nenhuma outra unidade do grupo encontrada.</p>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleTestConnection('nfce')}
                disabled={testing}
                className={btnPrimary}
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                Testar Conexão NFC-e (SEFAZ)
              </button>
            </div>
          )}

          {/* ══════════════ TAB: RECEBER NF ══════════════ */}
          {activeTab === 'receber' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Receber NF — Notas emitidas contra o CNPJ</h3>
                <div className="flex items-center gap-3">
                  {form.nf_recebidas_enabled ? (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                      <Wifi className="w-4 h-4" /> Habilitado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-gray-400 text-sm">
                      <WifiOff className="w-4 h-4" /> Desabilitado
                    </span>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.nf_recebidas_enabled}
                      onChange={e => setForm(p => ({ ...p, nf_recebidas_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              <p className="text-sm text-gray-500 -mt-2">
                Consulta na SEFAZ (Distribuição DF-e, Ambiente Nacional) as NF-e emitidas por fornecedores contra o CNPJ da empresa.
                As notas encontradas aparecem em <span className="font-semibold">Financeiro → NF Recebidas</span>, onde é possível baixar o XML ou lançá-lo como compra.
              </p>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  A consulta usa o <span className="font-semibold">CNPJ</span> da aba Empresa e o <span className="font-semibold">Certificado Digital A1</span> da aba Certificado —
                  não é necessário CSC nem login da prefeitura. A consulta é feita sempre no <span className="font-semibold">ambiente de produção</span> da SEFAZ
                  (as notas reais dos fornecedores só existem lá), independente do ambiente de emissão.
                  Com esta opção habilitada, o sistema também consulta <span className="font-semibold">automaticamente a cada 2 horas</span> —
                  as notas novas aparecem sozinhas em Financeiro → NF Recebidas.
                </span>
              </div>

              {/* Pré-requisitos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                  form.cnpj
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                }`}>
                  {form.cnpj ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                  {form.cnpj ? `CNPJ configurado: ${form.cnpj}` : 'CNPJ não configurado (aba Empresa)'}
                </div>
                <div className={`p-3 rounded-xl border flex items-center gap-3 text-sm ${
                  form.certificado_base64 && !certVencido
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                }`}>
                  {form.certificado_base64 && !certVencido ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
                  {!form.certificado_base64
                    ? 'Certificado A1 não configurado (aba Certificado)'
                    : certVencido
                    ? 'Certificado A1 vencido — renove na aba Certificado'
                    : 'Certificado A1 configurado e válido'}
                </div>
              </div>

              {/* Estado da sincronização */}
              {config && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Último NSU sincronizado</label>
                    <input type="text" value={config.dfe_ultimo_nsu || '0'} readOnly className={inputCls + ' opacity-60 cursor-not-allowed'} />
                  </div>
                  <div>
                    <label className={labelCls}>Última consulta</label>
                    <input
                      type="text"
                      value={config.dfe_ultima_consulta ? new Date(config.dfe_ultima_consulta).toLocaleString('pt-BR') : 'Nunca consultado'}
                      readOnly
                      className={inputCls + ' opacity-60 cursor-not-allowed'}
                    />
                  </div>
                </div>
              )}

              {/* Zerar NSU — reconsultar os 90 dias de histórico */}
              {config && config.dfe_ultimo_nsu && config.dfe_ultimo_nsu !== '0' && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1 text-xs text-amber-700 dark:text-amber-400">
                    Se a busca diz "nenhum documento novo" mas existem notas que nunca apareceram, o contador NSU pode estar à frente do real
                    (ex.: consulta feita em homologação). Zere o contador para reconsultar todo o histórico de 90 dias na próxima busca.
                    <span className="block mt-0.5 opacity-80">Atenção: respeite o intervalo de 1 hora entre consultas exigido pela SEFAZ.</span>
                  </div>
                  <button
                    onClick={handleResetNSU}
                    disabled={resettingNSU}
                    className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {resettingNSU ? 'Zerando…' : 'Zerar NSU'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══════════════ TAB: CERTIFICADO ══════════════ */}
          {activeTab === 'certificado' && (
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Certificado Digital A1</h3>
              <p className="text-sm text-gray-500 -mt-2">
                Certificado digital tipo A1 (.pfx/.p12) utilizado para assinar as notas fiscais. Compartilhado entre NF-e e NFS-e.
              </p>

              {/* Status do certificado */}
              <div className={`p-4 rounded-xl border ${
                !form.certificado_base64
                  ? 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
                  : certVencido
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              }`}>
                <div className="flex items-center gap-3">
                  {!form.certificado_base64 ? (
                    <>
                      <AlertTriangle className="w-6 h-6 text-gray-400" />
                      <div>
                        <p className="font-bold text-gray-600 dark:text-gray-300">Nenhum certificado configurado</p>
                        <p className="text-xs text-gray-400">Faça upload do arquivo .pfx para habilitar a emissão de notas.</p>
                      </div>
                    </>
                  ) : certVencido ? (
                    <>
                      <AlertTriangle className="w-6 h-6 text-red-500" />
                      <div>
                        <p className="font-bold text-red-700 dark:text-red-400">Certificado vencido</p>
                        <p className="text-xs text-red-500">
                          Venceu em {certValidade?.toLocaleDateString('pt-BR')}. Faça upload de um novo certificado.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-6 h-6 text-green-500" />
                      <div>
                        <p className="font-bold text-green-700 dark:text-green-400">Certificado válido</p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Validade até {certValidade?.toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Upload */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Arquivo do Certificado (.pfx / .p12)</label>
                  <label className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                    <Upload className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-500">
                      {form.certificado_base64 ? 'Certificado carregado — clique para substituir' : 'Clique para selecionar arquivo'}
                    </span>
                    <input
                      type="file"
                      accept=".pfx,.p12"
                      onChange={handleCertificateUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <div>
                  <label className={labelCls}>Senha do Certificado</label>
                  <input type="password" value={form.certificado_senha} onChange={upd('certificado_senha')} className={inputCls} placeholder="••••••••" />
                </div>
                <div>
                  <label className={labelCls}>Validade do Certificado</label>
                  <input type="date" value={form.certificado_validade ? form.certificado_validade.split('T')[0] : ''} onChange={e => setForm(p => ({ ...p, certificado_validade: e.target.value ? new Date(e.target.value).toISOString() : '' }))} className={inputCls} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Save bar */}
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-6 py-4 flex justify-end">
          <button onClick={handleSave} disabled={saving} className={btnPrimary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Configuração
          </button>
        </div>
      </div>
    </div>
  );
};

export default NFIntegration;

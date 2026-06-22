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
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { nfService } from '../../lib/nfService';
import type { NFHotelConfig, NFAmbiente } from '../../types/nf';

// ── CSS helpers ──────────────────────────────────────────────────────────────

const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';
const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';
const btnPrimary = 'flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

type TabId = 'empresa' | 'nfse' | 'nfe' | 'certificado';

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
  endereco_codigo_municipio: '3300456',
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
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [config, setConfig] = useState<NFHotelConfig | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedHotel) loadConfig();
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
          endereco_codigo_municipio: cfg.endereco_codigo_municipio || '3300456',
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
        certificado_validade: form.certificado_validade || null,
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
                  <input type="text" value={form.endereco_codigo_municipio} onChange={upd('endereco_codigo_municipio')} className={inputCls} placeholder="3300456" />
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

              <p className="text-sm text-gray-500 -mt-2">
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
                    <option value="">Selecione...</option>
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
                Testar Conexão NFS-e
              </button>
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
                    <option value={3}>3 — Regime Normal</option>
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

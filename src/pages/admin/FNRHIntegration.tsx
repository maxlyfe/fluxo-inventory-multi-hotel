// src/pages/admin/FNRHIntegration.tsx
// Configuração das credenciais FNRH Gov — somente admins.
// Fichas Enviadas e Consulta Gov estão em /reception/fnrh-fichas.

import React, { useState, useEffect } from 'react';
import {
  FileText, Settings,
  Loader2, CheckCircle, Wifi, WifiOff,
  ToggleLeft, ToggleRight, Clock,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { fnrhService, FNRHConfig } from '../../lib/fnrhService';

// ── CSS helpers ───────────────────────────────────────────────────────────────

const inputCls =
  'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 ' +
  'rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors';

const labelCls = 'block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5';

const btnPrimary =
  'flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white ' +
  'rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';

const btnSecondary =
  'flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 ' +
  'rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed';

// ── Config form ───────────────────────────────────────────────────────────────

function TabConfig({ hotelId }: { hotelId: string }) {
  const { addNotification } = useNotification();
  const [config,     setConfig]    = useState<Partial<FNRHConfig>>({ ambiente: 'producao', is_active: true });
  const [loading,    setLoading]   = useState(true);
  const [saving,     setSaving]    = useState(false);
  const [testing,    setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const cfg = await fnrhService.getConfig(hotelId);
      if (cfg) setConfig(cfg);
      setLoading(false);
    })();
  }, [hotelId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config.usuario || !config.senha || !config.cpf_responsavel) {
      addNotification('Preencha usuário, senha e CPF responsável.', 'error');
      return;
    }
    setSaving(true);
    try {
      await fnrhService.saveConfig({
        hotel_id:        hotelId,
        usuario:         config.usuario!,
        senha:           config.senha!,
        cpf_responsavel: config.cpf_responsavel!,
        ambiente:        (config.ambiente as 'producao' | 'homologacao') || 'producao',
        is_active:       config.is_active ?? true,
      });
      addNotification('Configuração salva com sucesso!', 'success');
    } catch (e: any) {
      addNotification(e.message || 'Erro ao salvar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!config.usuario || !config.senha || !config.cpf_responsavel) {
      addNotification('Preencha as credenciais antes de testar.', 'error');
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await fnrhService.testConnection({
      usuario:         config.usuario!,
      senha:           config.senha!,
      cpf_responsavel: config.cpf_responsavel!,
      ambiente:        (config.ambiente as 'producao' | 'homologacao') || 'producao',
    });
    setTestResult(result);
    setTesting(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
      {/* Credenciais */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-5">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <Settings className="w-4 h-4 text-emerald-500" /> Credenciais FNRH Gov
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Usuário *</label>
            <input type="text" className={inputCls} value={config.usuario || ''}
              onChange={e => setConfig(p => ({ ...p, usuario: e.target.value }))} placeholder="Usuário SERPRO" />
          </div>
          <div>
            <label className={labelCls}>Senha *</label>
            <input type="password" className={inputCls} value={config.senha || ''}
              onChange={e => setConfig(p => ({ ...p, senha: e.target.value }))} placeholder="••••••••" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>CPF Responsável *</label>
            <input type="text" className={inputCls} value={config.cpf_responsavel || ''}
              onChange={e => setConfig(p => ({ ...p, cpf_responsavel: e.target.value }))} placeholder="00000000000" />
          </div>
          <div>
            <label className={labelCls}>Ambiente</label>
            <select className={inputCls} value={config.ambiente || 'producao'}
              onChange={e => setConfig(p => ({ ...p, ambiente: e.target.value as 'producao' | 'homologacao' }))}>
              <option value="producao">Produção</option>
              <option value="homologacao">Homologação</option>
            </select>
          </div>
        </div>

        {/* Toggle ativo */}
        <button type="button"
          onClick={() => setConfig(p => ({ ...p, is_active: !p.is_active }))}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
          {config.is_active
            ? <ToggleRight className="w-6 h-6 text-emerald-500" />
            : <ToggleLeft  className="w-6 h-6 text-gray-400" />
          }
          Sincronização automática {config.is_active ? 'ativada' : 'desativada'}
        </button>

        {/* Info job */}
        <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Job automático todos os dias às 23:50 (horário de Brasília) via Netlify Functions
        </p>
      </div>

      {/* Test + Save */}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={handleTest} disabled={testing} className={btnSecondary}>
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          Testar Conexão
        </button>
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Salvar Configuração
        </button>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`p-3 rounded-xl border text-sm ${
          testResult.ok
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/40 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-300'
        }`}>
          <div className="flex items-center gap-2 font-medium">
            {testResult.ok
              ? <CheckCircle className="w-4 h-4 shrink-0" />
              : <WifiOff className="w-4 h-4 shrink-0" />
            }
            {testResult.message}
          </div>
          {/* Resposta bruta do SERPRO — ajuda a diagnosticar o problema */}
          {!testResult.ok && testResult.detail && (
            <pre className="mt-2 text-[11px] bg-red-100/60 dark:bg-red-900/20 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all opacity-80">
              {testResult.detail}
            </pre>
          )}
          {!testResult.ok && (
            <p className="mt-2 text-xs opacity-70">
              Verifique: usuário, senha e CPF corretos? Conta ativa no portal FNRH? Ambiente (Produção/Homologação) correto?
            </p>
          )}
        </div>
      )}

      {/* Info: fichas moved */}
      <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 text-sm text-emerald-700 dark:text-emerald-300">
        💡 Para ver as fichas enviadas e consultar o Gov, acesse <strong>Recepção → FNRH Gov</strong>.
      </div>
    </form>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FNRHIntegration() {
  const { selectedHotel } = useHotel();

  if (!selectedHotel) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-center">
        <p className="text-gray-500 dark:text-gray-400">Selecione um hotel para configurar a integração FNRH.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center sm:items-start gap-3 sm:gap-4">
        <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 shrink-0">
          <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white truncate">FNRH Gov — Configuração</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
            Credenciais e sincronização automática com a API FNRH SERPRO
          </p>
        </div>
      </div>

      <TabConfig hotelId={selectedHotel.id} />
    </div>
  );
}

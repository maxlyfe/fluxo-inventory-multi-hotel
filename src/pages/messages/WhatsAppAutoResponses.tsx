// src/pages/messages/WhatsAppAutoResponses.tsx
// Configuração de auto-respostas WhatsApp — CRUD completo com toggle de ativação

import React, { useState, useEffect } from 'react';
import {
  Bot, Plus, Pencil, Trash2, Power, PowerOff, Save, X,
  Loader2, AlertCircle, MessageSquare, Clock, Tag, Hash,
  ChevronUp, ChevronDown, Info, Zap
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { waInboxService, WaAutoResponse } from '../../lib/whatsappService';

// ─── Types ───────────────────────────────────────────────────────────────────

type TriggerType = WaAutoResponse['trigger_type'];

const TRIGGER_CONFIG: Record<TriggerType, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}> = {
  first_message: {
    label: 'Primeira mensagem',
    description: 'Dispara quando um contato envia a primeira mensagem na conversa',
    icon: MessageSquare,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  keyword: {
    label: 'Palavra-chave',
    description: 'Dispara quando a mensagem contém uma das palavras-chave configuradas',
    icon: Hash,
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-100 dark:bg-violet-900/30',
  },
  out_of_hours: {
    label: 'Fora do horário',
    description: 'Dispara entre 22h e 07h (configurável no código)',
    icon: Clock,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
  },
  always: {
    label: 'Sempre',
    description: 'Dispara para todas as mensagens recebidas (use com cuidado)',
    icon: Zap,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
};

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  rule: Partial<WaAutoResponse> | null;
  hotelId: string;
  onSave: (rule: WaAutoResponse) => void;
  onClose: () => void;
}

function RuleModal({ rule, hotelId, onSave, onClose }: ModalProps) {
  const { addNotification } = useNotification();
  const [saving, setSaving] = useState(false);

  const [name, setName]               = useState(rule?.name || '');
  const [triggerType, setTriggerType] = useState<TriggerType>(rule?.trigger_type || 'first_message');
  const [keywords, setKeywords]       = useState<string>(rule?.trigger_keywords?.join(', ') || '');
  const [responseText, setResponseText] = useState(rule?.response_text || '');
  const [priority, setPriority]       = useState(String(rule?.priority ?? 0));
  const [isActive, setIsActive]       = useState(rule?.is_active ?? true);

  const isEdit = !!rule?.id;

  const handleSave = async () => {
    if (!name.trim()) { addNotification('Informe um nome para a regra.', 'error'); return; }
    if (!responseText.trim()) { addNotification('Informe o texto de resposta.', 'error'); return; }
    if (triggerType === 'keyword') {
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
      if (kws.length === 0) { addNotification('Adicione pelo menos uma palavra-chave.', 'error'); return; }
    }

    setSaving(true);
    try {
      const payload = {
        ...(isEdit && rule?.id ? { id: rule.id } : {}),
        hotel_id: hotelId,
        name: name.trim(),
        trigger_type: triggerType,
        trigger_keywords: triggerType === 'keyword'
          ? keywords.split(',').map(k => k.trim()).filter(Boolean)
          : null,
        response_text: responseText.trim(),
        priority: parseInt(priority) || 0,
        is_active: isActive,
      } as Parameters<typeof waInboxService.saveAutoResponse>[0];

      const saved = await waInboxService.saveAutoResponse(payload);
      onSave(saved);
      addNotification(`Regra ${isEdit ? 'atualizada' : 'criada'} com sucesso.`, 'success');
      onClose();
    } catch {
      addNotification('Erro ao salvar regra.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const TriggerIcon = TRIGGER_CONFIG[triggerType].icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">
              {isEdit ? 'Editar regra' : 'Nova regra de auto-resposta'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
              Nome da regra <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Boas-vindas, Fora do horário..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>

          {/* Trigger type */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
              Gatilho <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(TRIGGER_CONFIG) as [TriggerType, typeof TRIGGER_CONFIG[TriggerType]][]).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const isSelected = triggerType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTriggerType(key)}
                    className={`flex items-start gap-2 p-3 rounded-xl border-2 text-left transition-all
                      ${isSelected
                        ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
                  >
                    <div className={`mt-0.5 p-1 rounded-lg ${isSelected ? cfg.bgColor : 'bg-gray-100 dark:bg-gray-700'}`}>
                      <Icon className={`h-3.5 w-3.5 ${isSelected ? cfg.color : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                        {cfg.label}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
              <Info className="h-3 w-3 flex-shrink-0" />
              {TRIGGER_CONFIG[triggerType].description}
            </p>
          </div>

          {/* Keywords (only for keyword trigger) */}
          {triggerType === 'keyword' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Palavras-chave <span className="text-red-400">*</span>
              </label>
              <input
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                placeholder="oi, olá, bom dia, informações..."
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <p className="mt-1 text-[10px] text-gray-400">
                Separe as palavras-chave por vírgula. A busca é case-insensitive.
              </p>
              {keywords.trim() && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {keywords.split(',').map(k => k.trim()).filter(Boolean).map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Response text */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
              Texto da resposta <span className="text-red-400">*</span>
            </label>
            <textarea
              value={responseText}
              onChange={e => setResponseText(e.target.value)}
              rows={4}
              placeholder="Olá! Bem-vindo ao Hotel. Em que posso ajudar?"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              {responseText.length}/1024 caracteres
            </p>
          </div>

          {/* Priority + active */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Prioridade
              </label>
              <input
                type="number"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                min={0}
                max={99}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <p className="mt-1 text-[10px] text-gray-400">Maior número = maior prioridade</p>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Status
              </label>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold border-2 transition-all
                  ${isActive
                    ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
              >
                {isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                {isActive ? 'Ativa' : 'Inativa'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl transition-colors"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isEdit ? 'Atualizar' : 'Criar regra'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WhatsAppAutoResponses() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [rules, setRules]   = useState<WaAutoResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState<Partial<WaAutoResponse> | null | false>(false); // false = closed
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hotelId = selectedHotel?.id;

  useEffect(() => {
    if (!hotelId) return;
    loadRules();
  }, [hotelId]);

  const loadRules = async () => {
    if (!hotelId) return;
    setLoading(true);
    try {
      const data = await waInboxService.getAutoResponses(hotelId);
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (rule: WaAutoResponse) => {
    setTogglingId(rule.id);
    try {
      await waInboxService.toggleAutoResponse(rule.id, !rule.is_active);
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: !r.is_active } : r));
      addNotification(`Regra ${!rule.is_active ? 'ativada' : 'desativada'}.`, 'success');
    } catch {
      addNotification('Erro ao alterar status.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir esta regra de auto-resposta?')) return;
    setDeletingId(id);
    try {
      await waInboxService.deleteAutoResponse(id);
      setRules(prev => prev.filter(r => r.id !== id));
      addNotification('Regra excluída.', 'success');
    } catch {
      addNotification('Erro ao excluir regra.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaved = (saved: WaAutoResponse) => {
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  };

  const reorder = (id: string, dir: 'up' | 'down') => {
    const idx = rules.findIndex(r => r.id === id);
    if (idx < 0) return;
    const next = [...rules];
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setRules(next);
  };

  if (!hotelId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400">Selecione um hotel para continuar.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
            <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Auto-respostas</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Regras automáticas de resposta por gatilho
            </p>
          </div>
        </div>
        <button
          onClick={() => setModal({})}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nova regra
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-300">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Como funcionam as auto-respostas</p>
          <p className="text-blue-600 dark:text-blue-400">
            Quando uma mensagem chega, o sistema verifica as regras em ordem de prioridade (maior número primeiro).
            A <strong>primeira regra que corresponder</strong> será executada e as demais ignoradas.
            Apenas mensagens de texto disparam auto-respostas.
          </p>
        </div>
      </div>

      {/* Rules list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
          <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-2xl">
            <Bot className="h-10 w-10 opacity-40" />
          </div>
          <p className="text-sm font-medium">Nenhuma regra cadastrada</p>
          <p className="text-xs text-center max-w-xs">
            Crie regras para responder automaticamente as mensagens recebidas no WhatsApp.
          </p>
          <button
            onClick={() => setModal({})}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-colors"
          >
            <Plus className="h-4 w-4" />
            Criar primeira regra
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, idx) => {
            const cfg = TRIGGER_CONFIG[rule.trigger_type];
            const Icon = cfg.icon;
            const isExpanded = expandedId === rule.id;
            const isToggling = togglingId === rule.id;
            const isDeleting = deletingId === rule.id;

            return (
              <div
                key={rule.id}
                className={`bg-white dark:bg-gray-800 rounded-2xl border transition-all duration-200
                  ${rule.is_active
                    ? 'border-gray-200 dark:border-gray-700'
                    : 'border-gray-100 dark:border-gray-700/50 opacity-60'}`}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 p-4">
                  {/* Priority reorder */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => reorder(rule.id, 'up')}
                      disabled={idx === 0}
                      className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => reorder(rule.id, 'down')}
                      disabled={idx === rules.length - 1}
                      className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Priority badge */}
                  <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[10px] font-black bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
                    {rule.priority}
                  </span>

                  {/* Trigger icon */}
                  <div className={`flex-shrink-0 p-1.5 rounded-lg ${cfg.bgColor}`}>
                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  </div>

                  {/* Name + trigger */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{rule.name}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bgColor} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    {rule.trigger_type === 'keyword' && rule.trigger_keywords && rule.trigger_keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {rule.trigger_keywords.slice(0, 3).map((kw, i) => (
                          <span key={i} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                            {kw}
                          </span>
                        ))}
                        {rule.trigger_keywords.length > 3 && (
                          <span className="text-[10px] text-gray-400">+{rule.trigger_keywords.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Expand */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Ver resposta"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => setModal(rule)}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    {/* Toggle active */}
                    <button
                      onClick={() => handleToggle(rule)}
                      disabled={isToggling}
                      className={`p-1.5 rounded-lg transition-colors
                        ${rule.is_active
                          ? 'text-green-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500'
                          : 'text-gray-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-500'}`}
                      title={rule.is_active ? 'Desativar' : 'Ativar'}
                    >
                      {isToggling
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : rule.is_active
                          ? <Power className="h-4 w-4" />
                          : <PowerOff className="h-4 w-4" />
                      }
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(rule.id)}
                      disabled={isDeleting}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      {isDeleting
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />
                      }
                    </button>
                  </div>
                </div>

                {/* Expanded: response preview */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Resposta automática</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {rule.response_text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {modal !== false && (
        <RuleModal
          rule={modal}
          hotelId={hotelId}
          onSave={handleSaved}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}

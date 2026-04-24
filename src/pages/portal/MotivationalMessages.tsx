// src/pages/portal/MotivationalMessages.tsx
// CRUD admin de mensagens motivacionais

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import {
  Sparkles, Plus, Trash2, Edit2, X, Loader2,
  ToggleLeft, ToggleRight, Globe, Building2,
} from 'lucide-react';

interface Message {
  id: string;
  hotel_id: string | null;
  message: string;
  author: string | null;
  is_active: boolean;
  created_at: string;
}

const inputCls = 'w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5';

export default function MotivationalMessages() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Message | null>(null);
  const [form, setForm]         = useState({ message: '', author: '', apply_to_all: false });
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (selectedHotel?.id) loadMessages();
  }, [selectedHotel?.id]);

  async function loadMessages() {
    setLoading(true);
    const { data } = await supabase
      .from('motivational_messages')
      .select('*')
      .or(`hotel_id.eq.${selectedHotel!.id},hotel_id.is.null`)
      .order('created_at', { ascending: false });
    setMessages(data || []);
    setLoading(false);
  }

  function openForm(msg?: Message) {
    if (msg) {
      setEditing(msg);
      setForm({ message: msg.message, author: msg.author || '', apply_to_all: msg.hotel_id === null });
    } else {
      setEditing(null);
      setForm({ message: '', author: '', apply_to_all: false });
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.message.trim()) return;
    setSaving(true);
    try {
      const payload = {
        hotel_id: form.apply_to_all ? null : selectedHotel!.id,
        message: form.message.trim(),
        author: form.author.trim() || null,
        is_active: true,
        created_by: user?.id,
      };
      if (editing) {
        await supabase.from('motivational_messages').update(payload).eq('id', editing.id);
      } else {
        await supabase.from('motivational_messages').insert(payload);
      }
      setShowForm(false);
      loadMessages();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(msg: Message) {
    await supabase.from('motivational_messages').update({ is_active: !msg.is_active }).eq('id', msg.id);
    loadMessages();
  }

  async function deleteMessage(id: string) {
    await supabase.from('motivational_messages').delete().eq('id', id);
    loadMessages();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Mensagens Motivacionais</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Frases exibidas no portal dos colaboradores</p>
          </div>
        </div>
        <button
          onClick={() => openForm()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 text-sm font-semibold active:scale-95 transition-all shadow-sm shadow-amber-500/20"
        >
          <Plus className="w-4 h-4" /> Nova Mensagem
        </button>
      </div>

      {/* ── Messages List ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center shadow-sm">
          <Sparkles className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-3">Nenhuma mensagem cadastrada</p>
          <button
            onClick={() => openForm()}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
          >
            Criar primeira mensagem
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`bg-white dark:bg-slate-800 rounded-2xl border p-4 shadow-sm transition-opacity ${
                msg.is_active
                  ? 'border-slate-200 dark:border-slate-700'
                  : 'border-slate-100 dark:border-slate-700/50 opacity-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 dark:text-white italic leading-relaxed">
                    &ldquo;{msg.message}&rdquo;
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {msg.author && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">— {msg.author}</span>
                    )}
                    {msg.hotel_id === null ? (
                      <span className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 font-medium">
                        <Globe className="w-3 h-3" /> Todas as unidades
                      </span>
                    ) : (
                      <span className="text-xs bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <Building2 className="w-3 h-3" /> Este hotel
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(msg)}
                    className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all"
                    title={msg.is_active ? 'Desativar' : 'Ativar'}
                  >
                    {msg.is_active
                      ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                      : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                  </button>
                  <button
                    onClick={() => openForm(msg)}
                    className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all"
                  >
                    <Edit2 className="w-4 h-4 text-slate-500" />
                  </button>
                  <button
                    onClick={() => deleteMessage(msg.id)}
                    className="p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 transition-all"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Nova / Editar Mensagem Modal ────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {editing ? 'Editar Mensagem' : 'Nova Mensagem'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 active:scale-95 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Mensagem */}
              <div>
                <label className={labelCls}>Mensagem *</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={4}
                  className={`${inputCls} resize-none`}
                  placeholder="O sucesso é a soma de pequenos esforços repetidos dia após dia."
                />
              </div>

              {/* Autor */}
              <div>
                <label className={labelCls}>Autor <span className="normal-case font-normal text-slate-400">(opcional)</span></label>
                <input
                  type="text"
                  value={form.author}
                  onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                  className={inputCls}
                  placeholder="Robert Collier"
                />
              </div>

              {/* Escopo */}
              <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={form.apply_to_all}
                  onChange={e => setForm(f => ({ ...f, apply_to_all: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-amber-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Exibir em todas as unidades</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Aparece no portal de todos os hotéis</p>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.message.trim()}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 shadow-sm shadow-amber-500/20"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Salvar Alterações' : 'Criar Mensagem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

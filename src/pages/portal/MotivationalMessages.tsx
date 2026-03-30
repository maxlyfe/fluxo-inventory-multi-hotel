// src/pages/portal/MotivationalMessages.tsx
// CRUD admin de mensagens motivacionais

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import {
  Sparkles, Plus, Trash2, Edit2, X, Check, Loader2,
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

export default function MotivationalMessages() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [form, setForm] = useState({ message: '', author: '', apply_to_all: false });
  const [saving, setSaving] = useState(false);

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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Mensagens Motivacionais</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Frases exibidas no portal dos colaboradores</p>
          </div>
        </div>
        <button
          onClick={() => openForm()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm"
        >
          <Plus className="w-4 h-4" /> Nova Mensagem
        </button>
      </div>

      {/* Messages List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Sparkles className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma mensagem cadastrada</p>
          <button
            onClick={() => openForm()}
            className="mt-3 text-sm text-amber-600 hover:text-amber-700"
          >
            Criar primeira mensagem
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition-opacity ${
                msg.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-gray-200 dark:border-gray-700 opacity-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 dark:text-white italic">"{msg.message}"</p>
                  <div className="flex items-center gap-2 mt-2">
                    {msg.author && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">— {msg.author}</span>
                    )}
                    {msg.hotel_id === null ? (
                      <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Globe className="w-3 h-3" /> Todas
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Building2 className="w-3 h-3" /> Este hotel
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(msg)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={msg.is_active ? 'Desativar' : 'Ativar'}
                  >
                    {msg.is_active
                      ? <ToggleRight className="w-5 h-5 text-green-500" />
                      : <ToggleLeft className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                  <button
                    onClick={() => openForm(msg)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Edit2 className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    onClick={() => deleteMessage(msg.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? 'Editar Mensagem' : 'Nova Mensagem'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none"
                  placeholder="O sucesso é a soma de pequenos esforços repetidos dia após dia."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Autor</label>
                <input
                  type="text"
                  value={form.author}
                  onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  placeholder="Robert Collier"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.apply_to_all}
                  onChange={e => setForm(f => ({ ...f, apply_to_all: e.target.checked }))}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                Exibir em todas as unidades
              </label>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.message.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

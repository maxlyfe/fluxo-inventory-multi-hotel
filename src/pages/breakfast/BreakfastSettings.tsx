import React, { useState, useEffect } from 'react';
import { Coffee, Clock, Save, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';

interface BreakfastConfig {
  id?: string;
  hotel_id: string;
  start_time: string;
  end_time: string;
  lunch_start_time: string;
  lunch_end_time: string;
  dinner_start_time: string;
  dinner_end_time: string;
  clock_transition_minutes: number;
}

const BreakfastSettings: React.FC = () => {
  const { selectedHotel } = useHotel();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<BreakfastConfig | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    if (selectedHotel) {
      loadConfig();
    }
  }, [selectedHotel]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('breakfast_configs')
        .select('*')
        .eq('hotel_id', selectedHotel?.id)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        // Formatar HH:mm:ss para HH:mm se necessário
        setConfig({
          ...data,
          start_time: data.start_time.substring(0, 5),
          end_time: data.end_time.substring(0, 5),
          lunch_start_time: (data.lunch_start_time || '12:00').substring(0, 5),
          lunch_end_time: (data.lunch_end_time || '14:30').substring(0, 5),
          dinner_start_time: (data.dinner_start_time || '19:00').substring(0, 5),
          dinner_end_time: (data.dinner_end_time || '22:00').substring(0, 5),
          clock_transition_minutes: data.clock_transition_minutes ?? 30
        });
      } else {
        setConfig({
          hotel_id: selectedHotel!.id,
          start_time: '07:00',
          end_time: '10:00',
          lunch_start_time: '12:00',
          lunch_end_time: '14:30',
          dinner_start_time: '19:00',
          dinner_end_time: '22:00',
          clock_transition_minutes: 30
        });
      }
    } catch (err: any) {
      console.error('[BreakfastSettings] error loading:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHotel || saving) return;

    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from('breakfast_configs')
        .upsert({
          ...config,
          hotel_id: selectedHotel.id,
          updated_at: new Date().toISOString()
        }, { onConflict: 'hotel_id' });

      if (error) throw error;
      setMessage({ type: 'success', text: 'Configurações salvas com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao salvar configurações' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center shadow-sm">
          <Coffee className="w-6 h-6 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Configurações Alimentares</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Defina os horários e regras para o {selectedHotel?.name}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 md:p-8 space-y-8">
        {/* Breakfast Section */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Coffee className="w-4 h-4" /> Café da Manhã
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Início</label>
              <input
                type="time" required value={config?.start_time || '07:00'}
                onChange={e => setConfig(prev => prev ? { ...prev, start_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Término</label>
              <input
                type="time" required value={config?.end_time || '10:00'}
                onChange={e => setConfig(prev => prev ? { ...prev, end_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
          </div>
        </div>

        {/* MAP/Lunch Section */}
        <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            🍴 Almoço (MAP/FAP)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Início</label>
              <input
                type="time" required value={config?.lunch_start_time || '12:00'}
                onChange={e => setConfig(prev => prev ? { ...prev, lunch_start_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Término</label>
              <input
                type="time" required value={config?.lunch_end_time || '14:30'}
                onChange={e => setConfig(prev => prev ? { ...prev, lunch_end_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
          </div>
        </div>

        {/* Dinner Section */}
        <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            🌙 Jantar (MAP/FAP)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Início</label>
              <input
                type="time" required value={config?.dinner_start_time || '19:00'}
                onChange={e => setConfig(prev => prev ? { ...prev, dinner_start_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Horário de Término</label>
              <input
                type="time" required value={config?.dinner_end_time || '22:00'}
                onChange={e => setConfig(prev => prev ? { ...prev, dinner_end_time: e.target.value } : null)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              />
            </div>
          </div>
        </div>

        {/* Display/Automation Section */}
        <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            📺 Automação de Tela
          </h3>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Minutos após o término para exibir Relógio</label>
            <input
              type="number" required value={config?.clock_transition_minutes || 30}
              onChange={e => setConfig(prev => prev ? { ...prev, clock_transition_minutes: parseInt(e.target.value) } : null)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 transition-all outline-none"
              min="0" max="1440"
            />
            <p className="mt-2 text-xs text-gray-400">Após este tempo do fim de qualquer refeição, o dashboard da cozinha mudará automaticamente para o relógio.</p>
          </div>
        </div>

        {message && (
          <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-4 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl font-bold transition-all shadow-lg"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Salvar Todas as Configurações
        </button>
      </form>
      
      <div className="mt-8 bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-5 border border-amber-100 dark:border-amber-900/20">
        <h3 className="text-sm font-bold text-amber-800 dark:text-amber-400 mb-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> Importante
        </h3>
        <p className="text-xs text-amber-700/80 dark:text-amber-500/80 leading-relaxed">
          Os horários configurados aqui serão utilizados para calcular os cronômetros no dashboard da cozinha e no checklist do salão. Certifique-se de que os horários estão corretos para evitar confusão entre os colaboradores.
        </p>
      </div>
    </div>
  );
};

export default BreakfastSettings;

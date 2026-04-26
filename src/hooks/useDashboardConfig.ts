import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AVAILABLE_WIDGETS, WidgetDefinition } from '../config/widgetsConfig';

export interface UserWidget {
  id: string;
  widget_id: string;
  position_x: number;
  position_y: number;
  size_w: number;
  size_h: number;
  settings?: any;
}

export function useDashboardConfig() {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState<UserWidget[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_dashboard_widgets')
        .select('*')
        .eq('user_id', user.id)
        .order('position_y', { ascending: true })
        .order('position_x', { ascending: true });

      if (error) {
        // Se a tabela não existir (404 / 42P01), não lança erro, apenas usa o padrão
        if (error.code === '42P01' || (error as any).status === 404) {
          console.warn('Tabela user_dashboard_widgets não encontrada. Usando dashboard padrão.');
          setWidgets([
            { id: 'default-1', widget_id: 'greeting', position_x: 0, position_y: 0, size_w: 12, size_h: 1 },
          ]);
          setLoading(false);
          return;
        }
        throw error;
      }

      if (data && data.length > 0) {
        setWidgets(data);
      } else {
        // Configuração padrão para novos usuários
        setWidgets([
          { id: 'default-1', widget_id: 'greeting', position_x: 0, position_y: 0, size_w: 12, size_h: 1 },
        ]);
      }
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const addWidget = async (widgetId: string) => {
    if (!user?.id) return;
    const def = AVAILABLE_WIDGETS.find(w => w.id === widgetId);
    if (!def) return;

    const newWidget = {
      user_id: user.id,
      widget_id: widgetId,
      position_x: 0,
      position_y: widgets.length,
      size_w: def.defaultSize === 'full' ? 12 : def.defaultSize === 'large' ? 6 : 4,
      size_h: 1
    };

    const { data, error } = await supabase
      .from('user_dashboard_widgets')
      .insert(newWidget)
      .select()
      .single();

    if (!error && data) {
      setWidgets(prev => [...prev, data]);
    }
  };

  const removeWidget = async (id: string) => {
    const { error } = await supabase
      .from('user_dashboard_widgets')
      .delete()
      .eq('id', id);

    if (!error) {
      setWidgets(prev => prev.filter(w => w.id !== id));
    }
  };

  return { widgets, loading, addWidget, removeWidget, refresh: fetchConfig };
}

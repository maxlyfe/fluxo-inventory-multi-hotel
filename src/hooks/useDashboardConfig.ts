import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AVAILABLE_WIDGETS } from '../config/widgetsConfig';

export interface UserWidget {
  id: string;
  widget_id: string;
  position_x: number;
  position_y: number;
  size_w: number;
  size_h: number;
  settings?: any;
}

const STORAGE_KEY = 'fluxo_dashboard_fallback';

export function useDashboardConfig() {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState<UserWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLocalMode, setIsLocalMode] = useState(false);

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
        // Se a tabela não existir (42P01 ou 404), ativa o modo local
        if (error.code === '42P01' || (error as any).status === 404) {
          console.warn('DB Dashboard indisponível. Ativando modo local.');
          setIsLocalMode(true);
          const local = localStorage.getItem(`${STORAGE_KEY}_${user.id}`);
          if (local) {
            setWidgets(JSON.parse(local));
          } else {
            setWidgets([{ id: 'default-1', widget_id: 'greeting', position_x: 0, position_y: 0, size_w: 12, size_h: 1 }]);
          }
          setLoading(false);
          return;
        }
        throw error;
      }

      if (data && data.length > 0) {
        setWidgets(data);
      } else {
        setWidgets([{ id: 'default-1', widget_id: 'greeting', position_x: 0, position_y: 0, size_w: 12, size_h: 1 }]);
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

  const addWidget = async (widgetId: string, customSettings: any = {}, sizeW?: number) => {
    if (!user?.id) return;
    const def = AVAILABLE_WIDGETS.find(w => w.id === widgetId);
    if (!def) return;

    const newWidgetData = {
      user_id: user.id,
      widget_id: widgetId,
      position_x: 0,
      position_y: widgets.length,
      size_w: sizeW || (def.defaultSize === 'full' ? 12 : def.defaultSize === 'large' ? 6 : 4),
      size_h: 1,
      settings: customSettings
    };

    if (isLocalMode) {
      const newWidgets = [...widgets, { ...newWidgetData, id: `local-${Date.now()}` }];
      setWidgets(newWidgets);
      localStorage.setItem(`${STORAGE_KEY}_${user.id}`, JSON.stringify(newWidgets));
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_dashboard_widgets')
        .insert(newWidgetData)
        .select()
        .single();
      
      if (!error && data) {
        setWidgets(prev => [...prev, data]);
      } else {
        // Fallback imediato se o insert falhar (ex: tabela sumiu)
        setIsLocalMode(true);
        const localItems = [...widgets, { ...newWidgetData, id: `local-${Date.now()}` }];
        setWidgets(localItems);
        localStorage.setItem(`${STORAGE_KEY}_${user.id}`, JSON.stringify(localItems));
      }
    } catch {
      setIsLocalMode(true);
    }
  };

  const removeWidget = async (id: string) => {
    if (!user?.id) return;

    if (isLocalMode || id.startsWith('local-') || id.startsWith('default-')) {
      const newWidgets = widgets.filter(w => w.id !== id);
      setWidgets(newWidgets);
      localStorage.setItem(`${STORAGE_KEY}_${user.id}`, JSON.stringify(newWidgets));
      return;
    }

    const { error } = await supabase
      .from('user_dashboard_widgets')
      .delete()
      .eq('id', id);

    if (!error) {
      setWidgets(prev => prev.filter(w => w.id !== id));
    }
  };

  return { widgets, loading, addWidget, removeWidget, refresh: fetchConfig, isLocalMode };
}

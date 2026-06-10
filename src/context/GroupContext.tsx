// src/context/GroupContext.tsx
// Grupo "atual" da sessão — define qual grupo o usuário está visualizando.
// Definido ao entrar por /grupo/<slug>; persiste em localStorage. Fallback:
// o próprio grupo do usuário (profiles.group_id). Usado para filtrar hotéis
// (select-hotel, navbar) e mostrar o nome do grupo.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface CurrentGroup { id: string; name: string; slug: string | null; }

interface GroupContextType {
  currentGroup: CurrentGroup | null;
  setCurrentGroup: (g: CurrentGroup | null) => void;
  /** Slug presente na URL (/grupo/<slug>/...), ou null. */
  urlSlug: string | null;
}

const STORAGE_KEY = 'fluxo_current_group';
const GroupContext = createContext<GroupContextType | undefined>(undefined);

export const useGroup = () => {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error('useGroup must be used within a GroupProvider');
  return ctx;
};

export function GroupProvider({ children, slug = null }: { children: React.ReactNode; slug?: string | null }) {
  const { user } = useAuth();
  const [currentGroup, setCurrentGroupState] = useState<CurrentGroup | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const setCurrentGroup = useCallback((g: CurrentGroup | null) => {
    setCurrentGroupState(g);
    try {
      if (g) localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }, []);

  // 1) Se há slug na URL, ele é a FONTE AUTORITATIVA do grupo atual.
  useEffect(() => {
    if (!slug) return;
    let active = true;
    supabase.rpc('get_group_by_slug', { p_slug: slug }).then(({ data }) => {
      const g = Array.isArray(data) ? data[0] : data;
      if (active && g) setCurrentGroup({ id: g.id, name: g.name, slug: g.slug });
    });
    return () => { active = false; };
  }, [slug, setCurrentGroup]);

  // 2) Fallback: sem slug na URL e sem grupo definido, usa o grupo do usuário.
  useEffect(() => {
    if (slug || currentGroup || !user?.group_id) return;
    let active = true;
    supabase.from('groups').select('id, name, slug').eq('id', user.group_id).maybeSingle()
      .then(({ data }) => {
        if (active && data) setCurrentGroupState({ id: data.id, name: data.name, slug: data.slug });
      });
    return () => { active = false; };
  }, [slug, user?.group_id, currentGroup]);

  return (
    <GroupContext.Provider value={{ currentGroup, setCurrentGroup, urlSlug: slug }}>
      {children}
    </GroupContext.Provider>
  );
}

// src/hooks/usePendingSignatures.ts
//
// Quais colaboradores têm documento aguardando assinatura, ao vivo.
//
// Alimenta o indicador de caneta na lista de `/personnel-department` →
// Colaboradores. Tem de ser reativo: o DP publica o lote e fica olhando a lista
// enquanto o pessoal assina pelo celular, então o indicador precisa apagar na
// hora, sem recarregar a página.
//
// Duas escolhas que explicam o desenho:
//
// 1. **Refaz a consulta em qualquer evento, em vez de aplicar o payload.**
//    Manter o Set incrementalmente exigiria reproduzir aqui a regra de "tem
//    pendência" (que depende de `requires_signature` e do estado atual dos
//    OUTROS documentos da mesma pessoa) e acertar os três eventos. Um documento
//    pendente apagado, por exemplo, só zera a pendência se não sobrar outro. A
//    consulta devolve o estado certo por construção, é uma linha por documento
//    pendente (dezenas, não milhares), e roda com debounce.
//
// 2. **Não filtra por `hotel_id`.** A RLS de `employee_documents` já recorta
//    para o grupo de quem está logado, e o módulo é de escopo de grupo por
//    definição — o contracheque pode ser da unidade em que a pessoa está
//    cadastrada, diferente da selecionada na barra. Filtrar aqui apagaria o
//    indicador justamente no caso que o módulo existe para resolver.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Espera antes de refazer a consulta, para um lote de eventos virar uma. */
const DEBOUNCE_MS = 400;

/** Situação dos documentos pendentes de um colaborador. */
export interface PendingState {
  /** Quantos documentos aguardam assinatura */
  pending: number;
  /** Quantos desses o colaborador já abriu */
  viewed: number;
  /** Data da visualização mais antiga entre os pendentes (ISO), se houver */
  firstViewedAt: string | null;
}

export interface PendingSignatures {
  /** employee_id → situação dos documentos pendentes */
  byEmployee: Map<string, PendingState>;
  /** Total de documentos pendentes visíveis */
  total: number;
  loading: boolean;
  /** Recarrega à mão (usado depois de gravar um lote, sem esperar o realtime) */
  reload: () => void;
}

export function usePendingSignatures(enabled = true): PendingSignatures {
  const [byEmployee, setByEmployee] = useState<Map<string, PendingState>>(new Map());
  const [loading, setLoading] = useState(enabled);

  // Guarda o timer entre renders sem provocar re-render nem recriar o canal.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  const fetchPending = useCallback(async () => {
    try {
      // `first_viewed_at` entra no mesmo select porque o indicador de olho e o
      // de caneta contam a mesma história: entre os documentos pendentes, o que
      // o colaborador já abriu. Duas consultas separadas poderiam divergir
      // entre si por uma fração de segundo e piscar na tela.
      const { data, error } = await supabase
        .from('employee_documents')
        .select('employee_id, first_viewed_at')
        .eq('requires_signature', true)
        .eq('signature_status', 'pending');

      if (error) throw error;
      if (!activeRef.current) return;

      const map = new Map<string, PendingState>();
      for (const row of (data || []) as { employee_id: string; first_viewed_at: string | null }[]) {
        const current = map.get(row.employee_id)
          ?? { pending: 0, viewed: 0, firstViewedAt: null };

        current.pending += 1;
        if (row.first_viewed_at) {
          current.viewed += 1;
          // A mais antiga entre os pendentes: é a que diz há quanto tempo a
          // pessoa está sabendo e não assinou.
          if (!current.firstViewedAt || row.first_viewed_at < current.firstViewedAt) {
            current.firstViewedAt = row.first_viewed_at;
          }
        }

        map.set(row.employee_id, current);
      }
      setByEmployee(map);
    } catch {
      // Indicador é informação acessória: falhar calado é melhor que derrubar
      // a lista de colaboradores inteira por causa dele.
      if (activeRef.current) setByEmployee(new Map());
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, []);

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchPending, DEBOUNCE_MS);
  }, [fetchPending]);

  useEffect(() => {
    activeRef.current = true;

    if (!enabled) {
      setLoading(false);
      setByEmployee(new Map());
      return () => { activeRef.current = false; };
    }

    fetchPending();

    // Sem `filter`: um documento que vai de pending para signed some do filtro
    // `signature_status=eq.pending`, e o evento que interessa — justamente o
    // da assinatura — nunca chegaria.
    const channel = supabase
      .channel('pending-signatures')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_documents' },
        scheduleFetch,
      )
      .subscribe();

    return () => {
      activeRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [enabled, fetchPending, scheduleFetch]);

  let total = 0;
  byEmployee.forEach(state => { total += state.pending; });

  return { byEmployee, total, loading, reload: fetchPending };
}

import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { deliverDeferredNotifications, isUserInWorkHours } from '../lib/workHours';

// Verifica a cada 2 minutos se o turno começou e entrega pushes diferidos.
// O estado "estava fora" → "entrou no turno" dispara a entrega.
export function useWorkHoursNotifications() {
  const { user } = useAuth();
  const wasInWorkRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function checkAndDeliver() {
      if (cancelled) return;
      try {
        const inWork = await isUserInWorkHours(user!.id);
        if (cancelled) return;

        const prev = wasInWorkRef.current;
        wasInWorkRef.current = inWork;

        // Entregar quando:
        // 1. Primeira verificação E dentro do turno (app aberto durante o turno)
        // 2. Transição: estava fora → agora dentro (turno começou)
        if (inWork && (prev === false || prev === null)) {
          await deliverDeferredNotifications(user!.id);
        }
      } catch {
        // Falha silenciosa — não interrompe o app
      }
    }

    checkAndDeliver();
    const interval = setInterval(checkAndDeliver, 2 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id]);
}

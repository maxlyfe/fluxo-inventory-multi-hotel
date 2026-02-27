// src/hooks/usePushNotifications.ts
// Hook que:
// 1. Solicita permissão de push ao usuário (uma vez por dispositivo)
// 2. Salva o token FCM na tabela user_fcm_tokens
// 3. Ouve mensagens em primeiro plano e exibe toast via callback

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  requestFirebaseNotificationPermission,
  onForegroundMessage,
} from '../lib/firebase';

interface PushNotificationPayload {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

interface UsePushNotificationsOptions {
  /** ID do usuário logado (auth.users.id) */
  userId: string | undefined;
  /** Callback chamado quando chega mensagem com o app aberto */
  onForegroundNotification?: (payload: PushNotificationPayload) => void;
}

export function usePushNotifications({
  userId,
  onForegroundNotification,
}: UsePushNotificationsOptions) {
  const registeredRef = useRef(false); // Evita registrar múltiplas vezes na mesma sessão

  useEffect(() => {
    if (!userId || registeredRef.current) return;

    let unsubscribeForeground: (() => void) | null = null;

    const setup = async () => {
      try {
        // 1. Solicita permissão e obtém token FCM
        const token = await requestFirebaseNotificationPermission();
        if (!token) return;

        // 2. Detecta informações básicas do dispositivo para identificação
        const deviceInfo = [
          navigator.userAgentData?.brands?.[0]?.brand || 'Browser',
          navigator.platform || 'Unknown',
        ].join('/');

        // 3. Salva/atualiza o token no banco
        //    upsert por token — evita duplicatas, atualiza last_seen
        const { error } = await supabase
          .from('user_fcm_tokens')
          .upsert(
            {
              user_id:     userId,
              token,
              device_info: deviceInfo,
              last_seen:   new Date().toISOString(),
            },
            { onConflict: 'token' }
          );

        if (error) {
          console.error('[Push] Erro ao salvar token FCM:', error);
        } else {
          console.info('[Push] Token FCM registrado para o usuário.');
          registeredRef.current = true;
        }

        // 4. Listener de mensagens com app em primeiro plano
        if (onForegroundNotification) {
          const unsub = await onForegroundMessage(onForegroundNotification);
          unsubscribeForeground = unsub;
        }
      } catch (err) {
        console.error('[Push] Erro no setup de notificações push:', err);
      }
    };

    setup();

    return () => {
      if (unsubscribeForeground) unsubscribeForeground();
    };
  }, [userId]);
}

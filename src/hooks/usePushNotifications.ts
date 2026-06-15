// src/hooks/usePushNotifications.ts

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  requestFirebaseNotificationPermission,
  onForegroundMessage,
} from '../lib/firebase';
import { isNativePushPlatform, registerNativePush } from '../lib/nativePush';

interface PushNotificationPayload {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

interface UsePushNotificationsOptions {
  userId?: string;
  onForegroundNotification?: (payload: PushNotificationPayload) => void;
}

// Aceita objeto vazio ou undefined — nunca crasha
export function usePushNotifications(options?: UsePushNotificationsOptions) {
  const userId                 = options?.userId;
  const onForegroundNotification = options?.onForegroundNotification;

  const registeredRef = useRef(false);

  useEffect(() => {
    if (!userId || registeredRef.current) return;

    let unsubscribeForeground: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        // ── APK (Capacitor) → push NATIVO via FCM ──────────────────────
        // Funciona com o app fechado (bandeja do sistema). O Web SDK abaixo
        // não funciona dentro do WebView Android.
        if (isNativePushPlatform()) {
          await registerNativePush(userId, (path) => {
            // Navegar ao tocar na notificação (hash router → mantém SPA)
            if (path && path !== '/') {
              window.location.assign(path);
            }
          });
          registeredRef.current = true;
          return;
        }

        // ── Navegador (desktop/mobile web) → Firebase Web SDK ──────────
        const token = await requestFirebaseNotificationPermission();
        if (!token || cancelled) return;

        // Marca mobile vs desktop para a limpeza de tokens web-mobile quando o
        // app nativo estiver presente (ver prune_mobile_web_tokens).
        const isMobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        const deviceInfo = [
          isMobileBrowser ? 'WebMobile' : 'WebDesktop',
          (navigator as any).userAgentData?.brands?.[0]?.brand || 'Browser',
          navigator.platform || 'Unknown',
        ].join('/');

        const { error } = await supabase.rpc('upsert_fcm_token', {
          p_user_id: userId,
          p_token: token,
          p_device_info: deviceInfo,
        });

        if (error) {
          console.warn('[Push] Erro ao salvar token FCM:', error.message);
        } else {
          registeredRef.current = true;
          console.info('[Push] Token FCM registrado.');
        }

        if (onForegroundNotification && !cancelled) {
          const unsub = await onForegroundMessage(onForegroundNotification);
          unsubscribeForeground = unsub;
        }
      } catch (err) {
        // Push é funcionalidade opcional — nunca propaga erro
        console.warn('[Push] Setup de notificações falhou (não crítico):', err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unsubscribeForeground) unsubscribeForeground();
    };
  }, [userId]);
}

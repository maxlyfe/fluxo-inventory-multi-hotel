// src/lib/nativePush.ts
// ---------------------------------------------------------------------------
// Push notifications NATIVAS para o APK (Capacitor / Android).
// Usa @capacitor/push-notifications → registra o device no FCM nativamente,
// permitindo que notificações cheguem na bandeja do sistema MESMO com o app
// fechado (o Web SDK / Service Worker não faz isso dentro do WebView).
//
// O token nativo é salvo na MESMA tabela (via RPC upsert_fcm_token) usada
// pelo push web — a Edge Function send-fcm-notification envia para ambos.
// ---------------------------------------------------------------------------

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase';

let nativePushRegistered = false;

/** True somente dentro do APK (Android/iOS), nunca no navegador. */
export function isNativePushPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Registra o dispositivo nativo no FCM e salva o token no Supabase.
 * - Pede permissão (Android 13+ mostra o pop-up do sistema)
 * - Registra no FCM e obtém o token nativo
 * - Configura os listeners (token, recebimento, clique → deep link)
 *
 * @param userId  id do usuário logado (para vincular o token)
 * @param onNavigate  callback opcional para navegar ao clicar na notificação
 */
export async function registerNativePush(
  userId: string,
  onNavigate?: (path: string) => void,
): Promise<void> {
  if (!isNativePushPlatform()) return;
  if (nativePushRegistered) return;
  nativePushRegistered = true;

  try {
    // 1. Verificar / pedir permissão (pop-up nativo no Android 13+)
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      console.info('[NativePush] Permissão de notificação negada:', perm.receive);
      nativePushRegistered = false; // permite tentar de novo numa próxima abertura
      return;
    }

    // 2. Remover listeners antigos (evita duplicação em hot-reload)
    await PushNotifications.removeAllListeners();

    // 3. Listener: token registrado → salvar no banco
    await PushNotifications.addListener('registration', async (token) => {
      try {
        const deviceInfo = `Android/Native/${Capacitor.getPlatform()}`;
        const { error } = await supabase.rpc('upsert_fcm_token', {
          p_user_id: userId,
          p_token: token.value,
          p_device_info: deviceInfo,
        });
        if (error) console.warn('[NativePush] Erro ao salvar token:', error.message);
        else {
          console.info('[NativePush] Token nativo registrado.');
          // Remove tokens de push WEB-MOBILE deste usuário: o celular tem o app,
          // então deve receber a notificação NATIVA (abre o app), não a do
          // navegador (que abriria o site). Mantém tokens de desktop.
          supabase.rpc('prune_mobile_web_tokens')
            .then(({ data, error: pErr }) => {
              if (pErr) console.warn('[NativePush] prune web tokens:', pErr.message);
              else if (data) console.info(`[NativePush] ${data} token(s) web-mobile removido(s).`);
            });
        }
      } catch (e) {
        console.warn('[NativePush] Falha ao persistir token:', e);
      }
    });

    // 4. Listener: erro de registro
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[NativePush] Erro de registro FCM:', JSON.stringify(err));
    });

    // 5. Listener: notificação recebida com o app ABERTO (foreground)
    //    No Android, mensagens "notification" não aparecem na bandeja em
    //    foreground automaticamente — então logamos para depuração.
    //    (O sino in-app já é alimentado pela tabela notifications.)
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.info('[NativePush] Recebida em foreground:', notification.title);
    });

    // 6. Listener: usuário TOCOU na notificação → navegar para o destino
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data || {};
      const path = data.targetPath || data.url || data.target_path || '/';
      if (onNavigate && typeof path === 'string') {
        try { onNavigate(path); } catch { /* noop */ }
      }
    });

    // 7. Registrar no FCM (dispara o listener 'registration')
    await PushNotifications.register();
  } catch (err) {
    console.warn('[NativePush] Setup falhou (não crítico):', err);
    nativePushRegistered = false;
  }
}

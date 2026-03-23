// src/lib/firebase.ts
// IMPORTANTE: Nenhuma inicialização no nível do módulo.
// Tudo é lazy — só executa quando chamado, nunca no import.
// Isso evita tela branca em browsers que não suportam FCM (ex: iOS Safari < 16.4)

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

// ---------------------------------------------------------------------------
// Config — projeto gestaohotel-23603
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

// ---------------------------------------------------------------------------
// Lazy getter — inicializa o app Firebase apenas quando necessário
// ---------------------------------------------------------------------------
function getFirebaseApp() {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
}

// ---------------------------------------------------------------------------
// requestFirebaseNotificationPermission
// Solicita permissão, registra SW e retorna o token FCM.
// Retorna null silenciosamente em qualquer caso de não-suporte ou erro.
// ---------------------------------------------------------------------------
export async function requestFirebaseNotificationPermission(): Promise<string | null> {
  try {
    // 1. Verifica suporte ao FCM neste browser/plataforma
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.info('[FCM] Não suportado neste browser.');
      return null;
    }

    // 2. Verifica suporte a Service Worker
    if (!('serviceWorker' in navigator)) {
      console.info('[FCM] Service Worker não disponível.');
      return null;
    }

    // 3. Solicita permissão
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[FCM] Permissão não concedida:', permission);
      return null;
    }

    // 4. Registra o Service Worker
    let registration: ServiceWorkerRegistration;
    try {
      registration = await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
        { scope: '/' }
      );
      await navigator.serviceWorker.ready;
    } catch (swErr) {
      console.warn('[FCM] Falha ao registrar Service Worker:', swErr);
      return null;
    }

    // 5. Inicializa Firebase e obtém token
    const app       = getFirebaseApp();
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      console.info('[FCM] Token registrado.');
      return token;
    }

    console.warn('[FCM] Token não retornado — verifique VAPID key e SW.');
    return null;

  } catch (err) {
    // Nunca propaga erro — push é funcionalidade opcional
    console.warn('[FCM] Erro ao configurar push (não crítico):', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// onForegroundMessage
// Ouve mensagens com o app aberto. Retorna função para cancelar o listener.
// ---------------------------------------------------------------------------
export async function onForegroundMessage(
  callback: (payload: {
    title?: string;
    body?: string;
    data?: Record<string, string>;
  }) => void
): Promise<(() => void) | null> {
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return null;

    const app       = getFirebaseApp();
    const messaging = getMessaging(app);

    const unsubscribe = onMessage(messaging, (payload) => {
      callback({
        title: payload.notification?.title,
        body:  payload.notification?.body,
        data:  payload.data as Record<string, string> | undefined,
      });
    });

    return unsubscribe;
  } catch (err) {
    console.warn('[FCM] Erro ao registrar listener foreground:', err);
    return null;
  }
}

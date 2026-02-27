// src/lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

// ---------------------------------------------------------------------------
// Configuração do projeto Firebase — gestaohotel-23603
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey:            'AIzaSyA4wMk6km4kphnshBrycNaBRclzGUVRiRI',
  authDomain:        'gestaohotel-23603.firebaseapp.com',
  projectId:         'gestaohotel-23603',
  storageBucket:     'gestaohotel-23603.firebasestorage.app',
  messagingSenderId: '446108850138',
  appId:             '1:446108850138:web:6426819e7d3962d81952e3',
  measurementId:     'G-EXXQWBXFL2',
};

// Chave pública VAPID para Web Push
const VAPID_KEY = 'BF_6aeE_xpPknXkfKeugaPKcmVK1u6Q_y4RMyaMcpUUTI215B2SFVig1nS3MUG-yWoahwzGPI1JBZUrVqMMthWQ';

// ---------------------------------------------------------------------------
// Inicialização — evita duplicação em hot-reload (dev)
// ---------------------------------------------------------------------------
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// ---------------------------------------------------------------------------
// Solicita permissão e retorna o token FCM do dispositivo atual
// Retorna null se não suportado, permissão negada ou erro
// ---------------------------------------------------------------------------
export async function requestFirebaseNotificationPermission(): Promise<string | null> {
  try {
    // Verifica suporte do browser (Safari < 16, alguns browsers mobile não suportam)
    const supported = await isSupported();
    if (!supported) {
      console.info('[FCM] Push notifications não suportadas neste browser.');
      return null;
    }

    // Verifica se o Service Worker está registrado
    if (!('serviceWorker' in navigator)) {
      console.warn('[FCM] Service Worker não disponível.');
      return null;
    }

    // Solicita permissão ao usuário
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[FCM] Permissão de notificação não concedida:', permission);
      return null;
    }

    // Garante que o Service Worker está registrado e ativo
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    await navigator.serviceWorker.ready;

    // Obtém o token FCM
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      console.info('[FCM] Token obtido:', token.slice(0, 20) + '...');
      return token;
    }

    console.warn('[FCM] Token não retornado. Verifique a VAPID key e o Service Worker.');
    return null;
  } catch (err) {
    console.error('[FCM] Erro ao solicitar permissão/token:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ouve mensagens enquanto o app está em primeiro plano
// Retorna uma função para cancelar o listener
// ---------------------------------------------------------------------------
export async function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; data?: Record<string, string> }) => void
): Promise<(() => void) | null> {
  try {
    const supported = await isSupported();
    if (!supported) return null;

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
    console.error('[FCM] Erro ao registrar listener de foreground:', err);
    return null;
  }
}

export { app };

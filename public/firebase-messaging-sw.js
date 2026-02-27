// public/firebase-messaging-sw.js
// Service Worker para receber notificações push em background (app fechado/minimizado)
// IMPORTANTE: Este arquivo deve estar na raiz do domínio (/public no Vite)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ---------------------------------------------------------------------------
// Configuração Firebase — deve ser idêntica ao firebase.ts
// ---------------------------------------------------------------------------
firebase.initializeApp({
  apiKey:            'AIzaSyA4wMk6km4kphnshBrycNaBRclzGUVRiRI',
  authDomain:        'gestaohotel-23603.firebaseapp.com',
  projectId:         'gestaohotel-23603',
  storageBucket:     'gestaohotel-23603.firebasestorage.app',
  messagingSenderId: '446108850138',
  appId:             '1:446108850138:web:6426819e7d3962d81952e3',
});

const messaging = firebase.messaging();

// ---------------------------------------------------------------------------
// Notificações em background (app fechado ou aba em segundo plano)
// O FCM envia automaticamente via Service Worker quando há notification payload.
// Este handler cobre o caso de mensagens com apenas "data" (sem notification).
// ---------------------------------------------------------------------------
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Mensagem recebida em background:', payload);

  const title = payload.notification?.title || payload.data?.title || 'Fluxo Inventory';
  const body  = payload.notification?.body  || payload.data?.body  || 'Você tem uma nova notificação.';
  const icon  = payload.notification?.icon  || '/icon-192x192.png';
  const badge = '/icon-72x72.png';
  const url   = payload.data?.url || '/';

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag:           payload.data?.tag || 'fluxo-notif',
    renotify:      true,
    requireInteraction: false,
    data: { url, ...payload.data },
  });
});

// ---------------------------------------------------------------------------
// Clique na notificação — abre/foca o app na URL correta
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Se já tem uma aba aberta com a URL, foca ela
        for (const client of clientList) {
          if (client.url === fullUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Se não tem aba aberta, abre uma nova
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      })
  );
});

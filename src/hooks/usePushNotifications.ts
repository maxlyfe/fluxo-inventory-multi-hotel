import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  // O usuário deve preencher com as credenciais do Firebase Console
  apiKey: "AIzaSyCn5DEo4Aydcgin9X0RLixH2FoT5Ic__Zw",
  authDomain: "studio-47770912-83ad2.firebaseapp.com",
  projectId: "studio-47770912-83ad2",
  storageBucket: "studio-47770912-83ad2.firebasestorage.app",
  messagingSenderId: "33466118929",
  appId: "1:33466118929:web:d1cdc936bc57456d2f92b0"
};

export const usePushNotifications = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    const setupNotifications = async () => {
      try {
        // 1. Solicitar permissão
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('Permissão de notificação negada');
          return;
        }

        // 2. Inicializar Firebase
        const app = initializeApp(firebaseConfig);
        const messaging = getMessaging(app);

        // 3. Obter Token FCM
        const token = await getToken(messaging, {
          vapidKey: 'YOUR_VAPID_KEY' // Gerar no Firebase Console -> Cloud Messaging
        });

        if (token) {
          console.log('Token FCM obtido:', token);
          
          // 4. Salvar token no Supabase (usando a tabela user_fcm_tokens que a Edge Function usa)
          await supabase.from('user_fcm_tokens').upsert({
            user_id: userId,
            token: token,
            last_seen: new Date().toISOString()
          }, { onConflict: 'token' });
        }

        // 5. Ouvir mensagens em primeiro plano
        onMessage(messaging, (payload) => {
          console.log('Mensagem recebida em primeiro plano:', payload);
          // Opcional: Mostrar um toast customizado aqui
          new Notification(payload.notification?.title || 'Nova Notificação', {
            body: payload.notification?.body,
            icon: '/icon-192x192.png'
          });
        });

      } catch (error) {
        console.error('Erro ao configurar notificações push:', error);
      }
    };

    setupNotifications();
  }, [userId]);
};

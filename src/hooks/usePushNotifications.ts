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
          vapidKey: 'BH1Zeaqdm5vCGGJgVhy3M7tV8vptbUbzMMRW_8qzyoJNcPjolb7JqRVvFwUupxnNq152048Rm5iy27eJjMiza5c' // Gerar no Firebase Console -> Cloud Messaging
        });

        if (token) {
          console.log('Token FCM obtido:', token);
          
          // 4. Salvar token no Supabase (usando a tabela user_devices conforme definido em notifications.ts)
          await supabase.from('user_devices').upsert({
            user_id: userId,
            fcm_token: token,
            device_info: {
              type: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'web',
              userAgent: navigator.userAgent
            },
            is_active: true,
            last_used_at: new Date().toISOString()
          }, { onConflict: 'user_id, fcm_token' });
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

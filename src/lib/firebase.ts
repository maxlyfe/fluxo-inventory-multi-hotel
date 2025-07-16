// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// TODO: Substitua com a configuração do seu projeto Firebase!
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  // measurementId: "YOUR_MEASUREMENT_ID" // Opcional, para Analytics
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export const requestFirebaseNotificationPermission = async () => {
  console.log("Requesting Firebase notification permission...");
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      console.log("Notification permission granted.");
      // Obter o token de registro do FCM
      // Certifique-se de que seu VAPID key está configurado no Firebase Console
      // (Configurações do Projeto > Cloud Messaging > Certificados push da Web > Gerar par de chaves)
      const currentToken = await getToken(messaging, {
        vapidKey: "YOUR_VAPID_KEY_FROM_FIREBASE_CONSOLE", // TODO: Substitua pela sua VAPID key
      });
      if (currentToken) {
        console.log("FCM Token:", currentToken);
        return currentToken;
      } else {
        console.log("No registration token available. Request permission to generate one.");
        return null;
      }
    } else {
      console.log("Unable to get permission to notify.");
      return null;
    }
  } catch (error) {
    console.error("An error occurred while requesting permission or getting token:", error);
    return null;
  }
};

// Lidar com mensagens recebidas enquanto o app está em primeiro plano
export const onForegroundMessage = () => {
  onMessage(messaging, (payload) => {
    console.log("Message received in foreground: ", payload);
    // Personalize como você quer lidar com a notificação aqui
    // Ex: exibir um toast, atualizar a UI, etc.
    // Por padrão, notificações push não aparecem se o app está em primeiro plano
    // a menos que você lide com elas aqui.
    if (payload.notification) {
        alert(`Foreground Message: ${payload.notification.title}\n${payload.notification.body}`);
    }
  });
};

export { messaging };


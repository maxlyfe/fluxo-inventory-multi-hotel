// public/firebase-messaging-sw.js

// Importar e configurar o SDK do Firebase (necessário para algumas funcionalidades em segundo plano)
// No entanto, para notificações simples, o navegador lida com a exibição se o payload estiver correto.
// Se você precisar de lógica mais complexa no service worker (ex: analytics, manipulação de dados do payload),
// você precisará importar o SDK aqui.

// Para este exemplo básico, vamos apenas logar que o service worker está ativo.
// console.log("Firebase Messaging Service Worker starting...");

// O Firebase SDK lida com a maior parte da mágica de recebimento em segundo plano.
// Se você não importar o SDK aqui, certifique-se de que seu payload de notificação push
// enviado pelo servidor FCM tenha uma chave `notification` para que o navegador
// possa exibir a notificação automaticamente.
// Exemplo de payload que o servidor FCM deve enviar:
// {
//   "to": "USER_FCM_TOKEN",
//   "notification": {
//     "title": "Título da Notificação",
//     "body": "Corpo da sua notificação!",
//     "icon": "/icons/icon-192x192.png", // Opcional
//     "click_action": "https://seusite.com/caminho_desejado" // Opcional
//   },
//   "data": { // Dados personalizados opcionais
//     "customKey": "customValue"
//   }
// }

// Se você quiser lidar com o clique na notificação em segundo plano:
self.addEventListener("notificationclick", function (event) {
  event.notification.close(); // Fechar a notificação
  // console.log("Notification clicked:", event.notification);

  // Exemplo: Abrir uma URL específica ou focar em uma aba existente
  // A URL pode vir do `click_action` no payload da notificação ou de `event.notification.data.url`
  const targetUrl = event.notification.data && (event.notification.data.target_path || event.notification.data.url)
                    ? (event.notification.data.target_path || event.notification.data.url)
                    : "/"; // Fallback para a raiz do site
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Verificar se já existe uma aba aberta com a URL de destino
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      // Se não houver, abrir uma nova aba
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Opcional: Lidar com o recebimento da mensagem em segundo plano (se precisar de lógica customizada)
// self.addEventListener("push", function (event) {
//   console.log("[Service Worker] Push Received.");
//   console.log(`[Service Worker] Push had this data: "${event.data.text()}"`);

//   const notificationData = event.data.json(); // Assumindo que o payload é JSON

//   const title = notificationData.notification.title || "Nova Notificação";
//   const options = {
//     body: notificationData.notification.body || "Você tem uma nova mensagem.",
//     icon: notificationData.notification.icon || "/icons/icon-192x192.png",
//     badge: "/icons/badge.png", // Opcional
//     data: notificationData.data || { url: "/" } // Passar dados para o evento notificationclick
//   };

//   event.waitUntil(self.registration.showNotification(title, options));
// });

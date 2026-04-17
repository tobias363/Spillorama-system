importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCDX8TKN3YQhX9EmN5A2PGZ99Z-DZTBKM8",
  authDomain: "spillorama-81245.firebaseapp.com",
  projectId: "spillorama-81245",
  storageBucket: "spillorama-81245.firebasestorage.app",
  messagingSenderId: "839491165887",
  appId: "1:839491165887:web:8e199d92d3acafbaccb00a",
  measurementId: "G-BYWTVGSYQG"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log('[SW] BG message:', payload);

  const title = payload.notification?.title || 'Notification';
  const body = payload.notification?.body || '';
  const icon = '/TemplateData/favicon.ico';
  const staticURL = new URL('./', self.location.href).toString();

  const options = {
    body,
    icon,
    data: { url: staticURL }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

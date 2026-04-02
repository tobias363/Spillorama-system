importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCn63hcAqgw-iWLRFCxKmJk6Wa6UrK8Ucc",
  authDomain: "spillorama-bingo-ca229.firebaseapp.com",
  databaseURL: "https://spillorama-bingo-ca229-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "spillorama-bingo-ca229",
  storageBucket: "spillorama-bingo-ca229.firebasestorage.app",
  messagingSenderId: "360754039754",
  appId: "1:360754039754:web:78c18c50fed1b2ad509d33",
  measurementId: "G-8WZJB8ECSW"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log('[SW] BG message:', payload);

  const title = payload.notification?.title || 'Notification';
  const body = payload.notification?.body || '';
  const icon = '/TemplateData/favicon.ico';
  const staticURL = 'https://spillorama.aistechnolabs.info/web/';

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

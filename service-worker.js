const CACHE_NAME = 'sladkaya-planeta-v2';
const URLS_TO_CACHE = ['/', '/index.html', '/manifest.json', '/service-worker.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone).catch(() => {}));
          }

          return networkResponse;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Сладкая планета', body: 'У вас новое уведомление', url: '/' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Сладкая планета', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            client.navigate(targetUrl);
          } catch {}
          return client.focus();
        }
      }

      return clients.openWindow ? clients.openWindow(targetUrl) : null;
    })
  );
});

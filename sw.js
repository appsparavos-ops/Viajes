/**
 * Service Worker para Ticket Scanner — modo offline robusto.
 */
const CACHE_VERSION = 'ts-v1';
const CACHE_KEYS = ['ts-v1-cache'];
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  'https://cdn.tailwindcss.com/',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;500;600&display=swap',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_KEYS[0]).then(cache => {
      return cache.addAll(ASSETS).catch(err => console.warn('SW install cache error:', err));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (!CACHE_KEYS.includes(k)) return caches.delete(k); })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.startsWith('file:')) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // Si es una imagen, devolver un placeholder transparente
        if (event.request.destination === 'image') {
          return new Response(new Blob([''], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        return cached;
      });
    })
  );
});

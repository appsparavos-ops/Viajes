/**
 * sw.js — Service Worker unificado del ecosistema Viajes.
 *
 * Sirve a las DOS apps instalables:
 *   • Bitácora  → bitacora/index.html  (scope /bitacora/)
 *   • Panel     → panel/index.html, panel/presupuesto.html, panel/scanner.html
 *                 (scope /panel/)
 *
 * Estrategias:
 *   • Navegación (HTML): RED PRIMERO, caché como respaldo. Con internet siempre
 *     ves la última versión; sin internet abre la última copia guardada.
 *   • Estáticos del mismo origen (lib/, icons/, *.js, *.jpg): stale-while-revalidate.
 *     Responde al instante desde la caché y se actualiza solo en segundo plano.
 *   • Terceros (tipografías): caché primero.
 *   • Firebase / Cloudinary / analytics: NUNCA se cachean (se dejan pasar).
 *
 * ⚠️ AL DESPLEGAR CAMBIOS: subí VERSION (ej. 'viajes-v3'). Es el único paso
 *    manual; sin esto la caché vieja puede sobrevivir en algunos dispositivos.
 *
 * Corrige los 3 bugs del sw.js anterior:
 *   1. Precacheaba './index.html', que no existe: cache.addAll() es atómico y al
 *      fallar UN recurso no cacheaba NADA. Ahora cada recurso va por separado
 *      (un 404 no rompe la instalación).
 *   2. La versión de caché era fija ('ts-v1') con estrategia cache-first: los
 *      usuarios quedaban pegados a la versión vieja del código.
 *   3. Si fallaba la red y no había caché, respondía con `undefined` (error de SW).
 *      Ahora devuelve una página de aviso real.
 */
const VERSION = 'viajes-v3';
const CACHE = VERSION; // nombre de la caché = versión (el limpiador de datos offline la reconoce por el prefijo 'viajes-')

/* Recursos que se guardan en la instalación. Si alguno falla, se anota y sigue. */
const PRECACHE = [
  './bitacora/',
  './bitacora/index.html',
  './panel/',
  './panel/index.html',
  './panel/presupuesto.html',
  './panel/scanner.html',
  './pwa-install.js',
  './panel/app.js',
  './panel/viaje-admin.bundle.js',
  './firebase-config.js',
  './manifest-bitacora.json',
  './manifest-panel.json',
  './bitacora/manifest.json',
  './panel/manifest.json',
  './lib/tailwindcss.js',
  './lib/leaflet.js',
  './lib/leaflet.css',
  './lib/chart.js',
  './lib/tesseract.min.js',
  './lib/firebase-app-compat.js',
  './lib/firebase-auth-compat.js',
  './lib/firebase-database-compat.js',
  './lib/images/marker-icon.png',
  './lib/images/marker-icon-2x.png',
  './lib/images/marker-shadow.png',
  './icons/bitacora-192.png',
  './icons/bitacora-512.png',
  './icons/bitacora-maskable-512.png',
  './icons/panel-192.png',
  './icons/panel-512.png',
  './icons/panel-maskable-512.png',
  './kia.jpg',
  // Tipografías: si no hay internet en la primera visita, fallan y se reintentan solas.
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,600&family=Lato:wght@300;400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;500;600&display=swap'
];

/* Nunca cachear: datos en vivo (Firebase), imágenes de usuario (Cloudinary) ni analytics. */
const BYPASS = [
  /firebaseio\.com/i,
  /firebasedatabase\.app/i,
  /identitytoolkit\.googleapis\.com/i,
  /securetoken\.googleapis\.com/i,
  /firebase\.google\.com/i,
  /gstatic\.com\/firebasejs/i,
  /cloudinary\.com/i,
  /cloudflareinsights\.com/i,
  /cdn-cgi\//i,
  /google-analytics\.com/i
];

const OFFLINE_HTML = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#fafaf9;color:#1c1917;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center">
<div><div style="font-size:3rem">📵</div>
<h1 style="font-size:1.25rem;margin:.5rem 0">Sin conexión</h1>
<p style="color:#78716c;max-width:32ch;margin:0 auto">Esta pantalla todavía no tiene copia guardada en el dispositivo. Conectate una vez para habilitarla sin internet.</p>
</div></body></html>`;

/* ------------------------------------------------------------------ install */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const resultados = await Promise.allSettled(
      PRECACHE.map(async url => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (err) {
          // Un recurso que falta (404, sin internet) NO debe romper toda la instalación.
          console.warn('[SW] no se pudo precachear:', url, err && err.message);
          throw err;
        }
      })
    );
    const fallidos = resultados.filter(r => r.status === 'rejected').length;
    console.info(`[SW ${VERSION}] instalado — ${PRECACHE.length - fallidos}/${PRECACHE.length} recursos en caché`);
    await self.skipWaiting();
  })());
});

/* ----------------------------------------------------------------- activate */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.map(k => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
    console.info(`[SW ${VERSION}] activo — cachés viejas eliminadas`);
  })());
});

/* -------------------------------------------------------------------- fetch */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (BYPASS.some(rx => rx.test(url.href))) return; // datos en vivo: siempre a la red

  // 1) Navegación: red primero, caché de respaldo.
  if (req.mode === 'navigate') {
    event.respondWith(redPrimero(event));
    return;
  }

  // 2) Mismo origen (estáticos): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(estatico(event));
    return;
  }

  // 3) Terceros (tipografías): caché primero.
  event.respondWith(cachePrimero(event));
});

async function redPrimero(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function estatico(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const enCache = await cache.match(req, { ignoreSearch: true });
  const deRed = fetch(req)
    .then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (enCache) {
    event.waitUntil(deRed); // responde ya y se actualiza en segundo plano
    return enCache;
  }
  const res = await deRed;
  return res || new Response('', { status: 504, statusText: 'Sin conexion' });
}

async function cachePrimero(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Sin conexion' });
  }
}

/* ------------------------------------------------- mensajes desde la página */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'VERSION') {
    event.source && event.source.postMessage({ sw: VERSION });
  }
});

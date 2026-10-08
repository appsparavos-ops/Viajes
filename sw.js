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
 * ACTUALIZACIÓN AUTOMÁTICA (ya no hay que acordarse de nada)
 *   Al publicar cambios en la web, las apps instaladas se actualizan solas:
 *     1. Cada vez que se abre o se vuelve a la app, el SW compara las HUELLAS
 *        (SHA-256) de los archivos con las guardadas. Si algo cambió, baja la
 *        versión nueva a la caché y avisa a la pantalla abierta.
 *     2. La pantalla muestra «Actualizando…» y se recarga una sola vez (con
 *        guardas para no entrar en bucle si no hay cambios).
 *     3. Si además cambió este archivo (sw.js), el navegador lo reemplaza,
 *        se activa al instante (skipWaiting) y la pantalla también se recarga.
 *   Subir VERSION ya NO es obligatorio (es solo un nombre de caché legible y una
 *   señal para limpiar todo de una). Si lo subís, todo se refresca de una.
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
const VERSION = 'viajes-v6';
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
  './panel/dictado.js',
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

/* --------------------------------------------------- detección de cambios */
/* Las huellas se guardan dentro de la propia caché, en una entrada sintética. */
const CLAVE_HUELLAS = new Request(new URL('__huellas-v1__', self.registration.scope));
const REVALIDAR_CADA = 20 * 1000;   // no revalidar más seguido que esto (ms)

let ultimoRefresco = 0;
let refrescoEnCurso = null;

async function leerHuellas(cache) {
  try {
    const r = await cache.match(CLAVE_HUELLAS);
    if (!r) return {};
    const datos = await r.json();
    return datos && typeof datos === 'object' ? datos : {};
  } catch (e) { return {}; }
}

/** SHA-256 corto del contenido (16 hex), para comparar sin guardar los archivos. */
async function huella(buffer) {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Revisa si cambió algún archivo de la lista. Devuelve { cambios, revisado }.
 *   · Si hay cambios: guarda la versión nueva en la caché (las apps la usan al
 *     instante después de recargar) y las huellas nuevas.
 *   · Si un archivo no se pudo pedir (sin internet), se deja como estaba.
 *   · Los terceros (tipografías) no se pueden leer por CORS: se saltean.
 */
async function refrescarCaches(forzar) {
  if (!self.navigator || self.navigator.onLine === false) return { cambios: 0, revisado: false };
  if (refrescoEnCurso) return refrescoEnCurso;                 // ya hay uno corriendo
  if (!forzar && Date.now() - ultimoRefresco < REVALIDAR_CADA) return { cambios: 0, revisado: false };
  ultimoRefresco = Date.now();

  refrescoEnCurso = (async () => {
    const cache = await caches.open(CACHE);
    const antes = await leerHuellas(cache);
    const ahora = Object.assign({}, antes);
    const cambiosArchivos = [];
    let cambios = 0;

    for (const url of PRECACHE) {
      let res;
      try { res = await fetch(url, { cache: 'no-cache' }); } catch (e) { continue; }
      if (!res || !res.ok || res.type === 'opaque') continue;   // sin red o terceros: se dejan como están
      let buf;
      try { buf = await res.arrayBuffer(); } catch (e) { continue; }
      const h = await huella(buf);

      if (antes[url] === h) continue;                           // igual que la última vez
      const conocido = antes[url] !== undefined;                // ¿lo habíamos visto antes?
      ahora[url] = h;
      if (!conocido) {                                          // archivo nuevo: se guarda sin avisar
        try { if (!(await cache.match(url))) await cache.put(url, new Response(buf, { headers: res.headers })); } catch (e) {}
        continue;
      }
      /* Doble control: antes de declarar el cambio, se vuelve a pedir el archivo por
         única vez. Si en la segunda lectura ya coincide con lo guardado, fue una
         lectura pasajera y no se avisa a nadie (evita recargas innecesarias). */
      let buf2 = null;
      try {
        const res2 = await fetch(url, { cache: 'reload' });
        if (res2 && res2.ok) buf2 = await res2.arrayBuffer();
      } catch (e) {}
      if (buf2) {
        const h2 = await huella(buf2);
        if (h2 === antes[url]) continue;                        // coincidía con lo guardado: falsa alarma
        cambios++; cambiosArchivos.push(url);                   // confirmado, dos lecturas coinciden
        try { await cache.put(url, new Response(buf2, { headers: res.headers })); } catch (e) {}
        continue;
      }
      cambios++;                                                // ¡cambió de verdad!
      cambiosArchivos.push(url);
      try { await cache.put(url, new Response(buf, { headers: res.headers })); } catch (e) {}
    }

    try {
      await cache.put(CLAVE_HUELLAS, new Response(JSON.stringify(ahora), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {}
    if (cambios) console.info(`[SW ${VERSION}] ${cambios} archivo(s) nuevos en la web → caché actualizada:`, cambiosArchivos.join(', '));
    return { cambios, revisado: true, archivos: cambiosArchivos };
  })();

  try { return await refrescoEnCurso; } finally { refrescoEnCurso = null; }
}

/** Avisa a todas las pantallas abiertas de que hay versión nueva (para que recarguen). */
async function avisarAClientes(motivo) {
  try {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientes) c.postMessage({ tipo: 'contenido-nuevo', version: VERSION, motivo: motivo || 'archivos' });
  } catch (e) {}
}

/** Responde al mensaje de quien preguntó (página) por el mismo canal. */
function responderA(event, datos) {
  try {
    if (event.source && event.source.postMessage) event.source.postMessage(datos);
    else if (event.ports && event.ports[0]) event.ports[0].postMessage(datos);
  } catch (e) {}
}

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
    /* Primera pasada de huellas (sin avisar: es la foto inicial). */
    refrescarCaches(true);
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
    /* Aprovechamos cada apertura de la app para ver si hay algo nuevo en la web. */
    event.waitUntil(refrescarCaches(false).then(r => { if (r && r.cambios) avisarAClientes('archivos'); }));
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
  const datos = event.data;

  if (datos === 'SKIP_WAITING' || (datos && datos.tipo === 'activar-ya')) { self.skipWaiting(); return; }
  if (datos === 'VERSION') { responderA(event, { sw: VERSION }); return; }
  if (!datos || typeof datos !== 'object') return;

  if (datos.tipo === 'version') { responderA(event, { tipo: 'version', version: VERSION }); return; }

  if (datos.tipo === 'buscar-cambios') {
    event.waitUntil((async () => {
      const r = await refrescarCaches(true);          // a pedido: sin esperar el intervalo
      if (!r.revisado) { responderA(event, { tipo: 'sin-conexion', version: VERSION }); return; }
      if (r.cambios) { await avisarAClientes('pedido'); responderA(event, { tipo: 'actualizado', cambios: r.cambios, version: VERSION }); }
      else responderA(event, { tipo: 'al-dia', version: VERSION });
    })());
  }
});

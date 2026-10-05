/**
 * Ticket Scanner — App independiente para análisis de tickets de viaje.
 * Usa las rutas de Firebase de viaje-admin.html sin modificarlo.
 * Diseño profesional con experiencia de 10 años en arquitectura de software.
 */

/* ================================================================
   CONFIGURACIÓN Y ESTADO GLOBAL
   ================================================================ */
const APP_NAME = 'TicketScanner';
const urlParams = new URLSearchParams(window.location.search);
let currentUsername = urlParams.get('user') || localStorage.getItem('travelapp_active_user') || 'usuario_anonimo';

function getUserRoot() {
  return currentUsername || 'usuario_anonimo';
}

/* ---- Modo borrador local ----
   Si la bitacora se creo sin cuenta, no hay nodo en Firebase: los gastos se
   guardan en la MISMA cache local que usa viaje-admin.html, para que el panel y
   el presupuesto los vean. */
const DRAFT_USER = '_borrador_local';
const DRAFT_KEYS = {
  viajes: 'travelapp__borrador_local_viajes_cache',
  viajeData: id => 'travelapp__borrador_local_viajedata_' + id,
};

function esBorradorLocal() {
  if (currentUsername === DRAFT_USER) return true;
  try { return urlParams.get('user') === DRAFT_USER; } catch (e) { return false; }
}

const CACHE_KEYS = {
  get viajes() { return esBorradorLocal() ? DRAFT_KEYS.viajes : `ts_${getUserRoot()}_viajes_cache`; },
  get viajeId() { return `ts_${getUserRoot()}_viaje_id`; },
  get syncQueue() { return `ts_${getUserRoot()}_sync_queue`; },
  gastosCache: id => `ts_${getUserRoot()}_gastos_${id}`,
};

let db = null;
let currentViajeId = urlParams.get('id') || null;
let syncQueue = [];
let isOnline = navigator.onLine;
let ocrWorker = null;

/* ================================================================
   INICIALIZACIÓN
   ================================================================ */
function initApp() {

  // Verificar Firebase
  if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey !== 'TU_API_KEY') {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      console.info('[TicketScanner] Firebase inicializado correctamente');
    } catch (e) {
      console.warn('[TicketScanner] Firebase ya inicializado o error:', e.message);
    }
  } else {
    console.warn('[TicketScanner] Firebase no configurado (revisá firebase-config.js)');
  }

  // Leer cola pendiente de localStorage (compatibles con viaje-admin)
  try {
    const raw = getCache(CACHE.syncQueue);
    syncQueue = raw ? JSON.parse(JSON.stringify(raw)) : [];
  } catch (e) { syncQueue = []; }

  // Eventos de conectividad
  window.addEventListener('online', () => {
    isOnline = true;
    updateStatusUI();
    syncPending();
    showToast('Conexión restaurada. Sincronizando…');
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    updateStatusUI();
    showToast('Sin conexión — modo offline activado', 'warn');
  });

  // Cargar viajes y configurar UI
  cargarViajes();
  initIndexedDB();
  initOcrWorker();
  updateStatusUI();
  renderOfflineBanner();

  // Aviso de modo borrador local (datos solo en este dispositivo)
  if (esBorradorLocal()) {
    const aviso = document.getElementById('aviso-borrador');
    if (aviso) aviso.classList.remove('hidden');
    const desc = document.getElementById('viaje-desc');
    if (desc) desc.textContent = 'Modo borrador: el gasto se guarda en este dispositivo (misma caché que el panel admin).';
  }

  // Si hay un viaje guardado, recargar gastos y viajeros
  setTimeout(() => {
    const savedId = localStorage.getItem(CACHE_KEYS.viajeId);
    if (savedId) currentViajeId = savedId;
    cargarViajerosDelViaje();
    cargarGastos();
  }, 500);
}

/* ================================================================
   INDEXEDDB (respaldo robusto offline)
   ================================================================ */
let idb = null;
function initIndexedDB() {
  const req = indexedDB.open('TicketScannerDB', 1);
  req.onerror = () => console.warn('IndexedDB no disponible');
  req.onsuccess = (e) => { idb = e.target.result; };
  req.onupgradeneeded = (e) => {
    const db2 = e.target.result;
    if (!db2.objectStoreNames.contains('gastos')) {
      db2.createObjectStore('gastos', { keyPath: 'id' });
    }
    if (!db2.objectStoreNames.contains('sync')) {
      db2.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
    }
  };
}

function saveToIndexedDB(storeName, data) {
  return new Promise((res, rej) => {
    if (!idb) return res();
    const tx = idb.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const r = store.put(data);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
function getFromIndexedDB(storeName, key) {
  return new Promise((res, rej) => {
    if (!idb) return res(null);
    const tx = idb.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const r = store.get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

function getAllFromIndexedDB(storeName) {
  return new Promise((res) => {
    if (!idb) return res([]);
    try {
      const tx = idb.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const r = store.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    } catch (e) { res([]); }
  });
}

/* ================================================================
   OCR — TESSERACT.JS
   ================================================================ */
function initOcrWorker() {
  if (typeof Tesseract === 'undefined') {
    console.warn('Tesseract.js no cargado');
    return;
  }
  // Creamos el worker una sola vez
  (async () => {
    try {
      ocrWorker = await Tesseract.createWorker('spa', 1, {
        logger: m => console.log('[OCR]', m.status, m.progress ? Math.round(m.progress * 100) : '')
      });
      await ocrWorker.loadLanguage('spa');
      await ocrWorker.initialize('spa');
      console.info('[TicketScanner] OCR listo (español)');
    } catch (e) {
      console.error('Error inicializando OCR:', e);
      try {
        // Fallback a inglés
        ocrWorker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
        await ocrWorker.load();
        await ocrWorker.loadLanguage('eng');
        await ocrWorker.initialize('eng');
        console.info('[TicketScanner] OCR listo (inglés fallback)');
      } catch (e2) {
        console.error('No se pudo inicializar OCR:', e2);
      }
    }
  })();
}

/* ================================================================
   VIAJES — LECTURA DESDE viajes_index (igual que viaje-admin)
   ================================================================ */
async function cargarViajes() {
  const select = document.getElementById('viaje-select');
  select.innerHTML = '<option value="">Cargando viajes…</option>';

  let viajes = [];
  let viaSource = 'offline';

  if (db && isOnline && !esBorradorLocal()) {
    try {
      const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_index`).once('value'), 6000);
      if (snap.exists()) {
        snap.forEach(child => viajes.push({ ...child.val(), id: child.key }));
        viajes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        localStorage.setItem(CACHE_KEYS.viajes, JSON.stringify(viajes));
        viaSource = 'online';
      }
    } catch (e) {
      console.warn('Timeout o error leyendo viajes:', e.message);
    }
  }

  if (viajes.length === 0) {
    try {
      const raw = localStorage.getItem(CACHE_KEYS.viajes);
      viajes = raw ? JSON.parse(raw) : [];
    } catch (e) {}
  }

  if (viajes.length === 0) {
    // Si no hay viajes, creamos uno por defecto para no bloquear la app
    const defaultViaje = {
      id: 'default_viaje_' + Date.now(),
      titulo: 'Viaje General',
      activo: true,
      createdAt: Date.now()
    };
    viajes = [defaultViaje];
    localStorage.setItem(CACHE_KEYS.viajes, JSON.stringify(viajes));
  }

  // Renderizar selector con el primer viaje activo como seleccionado por defecto
  const activo = viajes.find(v => v.activo) || viajes[0];
  select.innerHTML = viajes.map(v => {
    const label = v.titulo || v.id || 'Sin título';
    return `<option value="${v.id}" ${v.id === activo.id ? 'selected' : ''}>${label}${v.activo ? ' ✅' : ' ⛔'} ${viaSource === 'offline' ? '[offline]' : ''}</option>`;
  }).join('');

  currentViajeId = activo.id;
  localStorage.setItem(CACHE_KEYS.viajeId, currentViajeId);
  cargarViajerosDelViaje();

  // Actualizar descripción
  const desc = document.getElementById('viaje-desc');
  if (desc) desc.textContent = `Viaje: ${activo.titulo || activo.id} · ${viajes.length} viaje(s) cargado(s) · ${viaSource}`;

  // Si estaba seleccionado antes, mantenerlo
  const savedId = localStorage.getItem(CACHE_KEYS.viajeId);
  if (savedId && viajes.find(v => v.id === savedId)) {
    select.value = savedId;
    currentViajeId = savedId;
  }
}

/* ---------------- Funciones auxiliares de caché (compatibles con viaje-admin) ---------------- */
const CACHE = {
  viajes: 'travelapp_viajes_cache',
  lastViajeId: 'travelapp_last_viaje_id',
  lastViaje: 'travelapp_last_viaje',
  syncQueue: 'travelapp_syncQueue',
  // En modo borrador apunta a la cache local del panel admin.
  viajeData: id => esBorradorLocal() ? DRAFT_KEYS.viajeData(id) : ('travelapp_viajedata_' + id),
  diasLegacy: id => 'travelapp_dias_' + id
};

function getCache(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function setCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
function toFbKey(key) {
  return String(key).replace(/\$/g, '_S_').replace(/\./g, '_D_').replace(/#/g, '_H_').replace(/\//g, '_F_');
}

function fromFbKey(key) {
  return String(key).replace(/_S_/g, '$').replace(/_D_/g, '.').replace(/_H_/g, '#').replace(/_F_/g, '/');
}

function encodeObjectKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const res = {};
  for (const k of Object.keys(obj)) {
    res[toFbKey(k)] = obj[k];
  }
  return res;
}

function decodeObjectKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const res = {};
  for (const k of Object.keys(obj)) {
    res[fromFbKey(k)] = (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]))
      ? decodeObjectKeys(obj[k])
      : obj[k];
  }
  return res;
}

function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

function normalizeTimestamps(obj, mode) {
  if (Array.isArray(obj)) { obj.forEach(o => normalizeTimestamps(o, mode)); return obj; }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v === 'TIMESTAMP') {
        obj[k] = (mode === 'server' && typeof firebase !== 'undefined' && typeof firebase.database !== 'undefined')
          ? firebase.database.ServerValue.TIMESTAMP
          : Date.now();
      } else if (v && typeof v === 'object') {
        normalizeTimestamps(v, mode);
      }
    }
  }
  return obj;
}

/* ---------------- Caché por viaje (respaldo en el dispositivo) ---------------- */
function getViajeCache(id) {
  if (!id) return { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
  let cache = getCache(CACHE.viajeData(id));
  if (!cache) {
    cache = { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
  }
  return cache;
}
function setViajeCache(id, cache) { setCache(CACHE.viajeData(id), cache); }

function applyToCache(path, action, data, viajeId) {
  const cache = getViajeCache(viajeId);
  const parts = path.split('/');
  const collection = parts[0];
  const id = parts[1] || null;
  const cData = data == null ? null : (typeof normalizeTimestamps === 'function' ? normalizeTimestamps(deepClone(data), 'local') : deepClone(data));
  if (collection === 'configuracion' || collection === 'cotizaciones') {
    const bucket = cache[collection] = cache[collection] || {};
    if (action === 'remove' && id) delete bucket[id];
    else if (action === 'set' && id) bucket[id] = cData;
    else if (action === 'update' && id) bucket[id] = { ...(bucket[id] || {}), ...cData };
  } else {
    let arr = cache[collection] || [];
    if (action === 'remove' && id) {
      arr = arr.filter(x => x.id !== id);
    } else if ((action === 'set' || action === 'update') && id) {
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = { ...arr[i], ...cData };
      else arr.push({ id, ...cData });
    }
    cache[collection] = arr;
  }
  setViajeCache(viajeId, cache);
}

function cacheCollection(viajeId, collection, arr) {
  const cache = getViajeCache(viajeId);
  cache[collection] = arr;
  setViajeCache(viajeId, cache);
}

function mergeQueued(arr, collection) {
  const out = arr.slice();
  (syncQueue || []).forEach(op => {
    if (op.viajeId !== currentViajeId) return;
    const parts = op.path.split('/');
    if (parts[0] !== collection) return;
    const id = parts[1];
    if (!id) return;
    if (op.action === 'remove') {
      const i = out.findIndex(x => x.id === id);
      if (i >= 0) out.splice(i, 1);
    } else {
      const d = (typeof normalizeTimestamps === 'function') ? normalizeTimestamps(deepClone(op.data), 'local') : deepClone(op.data);
      const i = out.findIndex(x => x.id === id);
      if (i >= 0) out[i] = { ...out[i], ...d };
      else out.push({ id, ...d });
    }
  });
  return out;
}

function guardarConfigViajeros() {
  const inputEl = document.getElementById('c-viajeros');
  if (!inputEl) return; // La configuración de viajeros se hace exclusivamente desde viaje-admin.html
  const input = inputEl.value;
  const lista = input.split(',').map(v => v.trim()).filter(v => v);
  if (lista.length === 0) return showToast('Ingresá al menos un viajero', 'warn');
  viajerosList = lista;
  // Guardar en caché local y en Firebase
  const cache = (typeof window.getViajeCache === 'function') ? window.getViajeCache(currentViajeId) : { configuracion: {} };
  cache.configuracion = cache.configuracion || {};
  cache.configuracion.viajeros = lista;
  if (typeof window.setViajeCache === 'function') window.setViajeCache(currentViajeId, cache);
  if (db && currentViajeId) {
    db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/configuracion/viajeros`).set(lista).catch(() => {});
  }
  actualizarUiViajeros();
  showToast('Viajeros guardados');
}

function actualizarUiViajeros() {
  const selectPagador = document.getElementById('g-pagador');
  const divInvolucrados = document.getElementById('g-involucrados');
  if (!selectPagador || !divInvolucrados) return;
  if (viajerosList && viajerosList.length > 0) {
    selectPagador.innerHTML = viajerosList.map(v => `<option value="${v}">${v}</option>`).join('');
    selectPagador.value = viajerosList[0];
    divInvolucrados.innerHTML = viajerosList.map(v => `
      <label class="flex items-center gap-1 cursor-pointer bg-white border border-amber-200 rounded-full px-2 py-0.5 text-xs hover:bg-amber-50 transition">
        <input type="checkbox" value="${v}" checked class="form-checkbox h-3.5 w-3.5 text-amber-600 rounded">
        <span class="text-ink">${v}</span>
      </label>
    `).join('');
  } else {
    selectPagador.innerHTML = '<option value="">(Configurá viajeros primero)</option>';
    divInvolucrados.innerHTML = '<span class="text-[11px] text-gray-400 italic">Configurá los viajeros primero</span>';
  }
}

function cargarViajerosDelViaje() {
  try {
    if (!currentViajeId || !db) {
      viajerosList = [];
      actualizarUiViajeros();
      return;
    }
    if (typeof window.getViajeCache !== 'function') {
      console.warn('[TicketScanner] getViajeCache no disponible en este contexto');
      viajerosList = [];
      actualizarUiViajeros();
      return;
    }
    const cache = window.getViajeCache(currentViajeId);
    const cfg = cache.configuracion || {};
    // Intentar cargar de Firebase (no en modo borrador: ya se leyó de la cache)
    if (db && isOnline && !esBorradorLocal()) {
      db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/configuracion/viajeros`).once('value').then(snap => {
        if (snap.exists()) {
          viajerosList = snap.val() || [];
          cache.configuracion = cache.configuracion || {};
          cache.configuracion.viajeros = viajerosList;
          if (typeof window.setViajeCache === 'function') window.setViajeCache(currentViajeId, cache);
          actualizarUiViajeros();
        } else if (cfg.viajeros) {
          viajerosList = cfg.viajeros;
          actualizarUiViajeros();
        }
      }).catch(() => {
        if (cfg.viajeros) { viajerosList = cfg.viajeros; actualizarUiViajeros(); }
      });
    } else {
      if (cfg.viajeros) { viajerosList = cfg.viajeros; actualizarUiViajeros(); }
    }
    cargarMonedasDelViaje();
  } catch (e) {
    console.warn('[TicketScanner] Error en cargarViajerosDelViaje:', e);
  }
}

function cargarMonedasDelViaje() {
  try {
    const fieldMoneda = document.getElementById('field-moneda');
    if (!fieldMoneda || !currentViajeId) return;

    const cache = (typeof getViajeCache === 'function') ? getViajeCache(currentViajeId) : { configuracion: {} };
    const cfg = cache.configuracion || {};
    let mList = cfg.monedas_gasto || ['AR$', 'US$', 'UY$'];

    if (db && isOnline && !esBorradorLocal()) {
      db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/configuracion/monedas_gasto`).once('value').then(snap => {
        if (snap.exists()) {
          mList = snap.val() || mList;
          cache.configuracion = cache.configuracion || {};
          cache.configuracion.monedas_gasto = mList;
          if (typeof setViajeCache === 'function') setViajeCache(currentViajeId, cache);
          actualizarSelectorMonedaField(mList);
        }
      }).catch(() => {});
    }
    actualizarSelectorMonedaField(mList);
  } catch (e) {}
}

function actualizarSelectorMonedaField(mList) {
  const fieldMoneda = document.getElementById('field-moneda');
  if (!fieldMoneda) return;
  const lista = Array.isArray(mList) ? mList : String(mList).split(',').map(s => s.trim()).filter(Boolean);
  const valPrev = fieldMoneda.value;
  fieldMoneda.innerHTML = lista.map(m => `<option value="${m}">${m}</option>`).join('');
  if (lista.includes(valPrev)) fieldMoneda.value = valPrev;
}

function onViajeChange(id) {
  currentViajeId = id || null;
  localStorage.setItem(CACHE_KEYS.viajeId, id || '');
  cargarViajes();
  cargarViajerosDelViaje();
  cargarGastos();
  const desc = document.getElementById('viaje-desc');
  if (desc && id) {
    const sel = document.getElementById('viaje-select').selectedOptions[0].textContent;
    desc.textContent = `Viaje seleccionado: ${sel}`;
  }
}

/* ================================================================
   CÁMARA / ARCHIVO
   ================================================================ */
function startCamera() {
  const video = document.createElement('video');
  video.setAttribute('playsinline', true);
  video.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:cover;z-index:60;background:#000;';
  document.body.appendChild(video);

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    .then(stream => {
      video.srcObject = stream;
      video.play();

      const captureBtn = document.createElement('button');
      captureBtn.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-white text-ink font-display font-extrabold text-base px-8 py-3.5 rounded-full shadow-2xl ring-4 ring-amber-200 hover:scale-105 transition active:scale-95';
      captureBtn.textContent = '📸 Capturar';
      captureBtn.onclick = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || video.clientWidth;
        canvas.height = video.videoHeight || video.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const blob = dataUrlToBlob(canvas.toDataURL('image/png'));
        processImageFile(blob, 'ticket-capturado.png');
        stream.getTracks().forEach(t => t.stop());
        video.remove();
        captureBtn.remove();
        closeBtn.remove();
      };
      document.body.appendChild(captureBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'fixed top-5 right-5 z-[70] bg-white/20 backdrop-blur-md text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/30 transition';
      closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.onclick = () => {
        stream.getTracks().forEach(t => t.stop());
        video.remove();
        captureBtn.remove();
        closeBtn.remove();
      };
      document.body.appendChild(closeBtn);
    })
    .catch(err => {
      console.warn('No se pudo acceder a la cámara:', err.message);
      showToast('No se pudo abrir la cámara. Intentá con una foto de la galería.', 'warn');
    });
}

function onFileSelect(input) {
  if (!input.files || !input.files[0]) return;
  processImageFile(input.files[0], input.files[0].name);
  input.value = '';
}

function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

/* ================================================================
   PROCESAMIENTO DE IMAGEN — OCR + EXTRACCIÓN
   ================================================================ */
async function processImageFile(blob, fileName) {
  const previewSection = document.getElementById('preview-section');
  const previewImg = document.getElementById('preview-img');
  const loader = document.getElementById('ocr-loader');

  previewSection.classList.remove('hidden');
  previewImg.src = URL.createObjectURL(blob);
  loader.classList.remove('hidden');

  // Esperar a que la imagen cargue visualmente
  await new Promise(r => setTimeout(r, 300));

  try {
    if (!ocrWorker) {
      showToast('El motor OCR aún no está listo. Intentá de nuevo en unos segundos.', 'warn');
      loader.classList.add('hidden');
      return;
    }

    const { data: { text } } = await ocrWorker.recognize(URL.createObjectURL(blob));
    console.info('[TicketScanner] Texto OCR extraído:', text);

    // Extraer datos con heurísticas
    const montoMatch = extractMonto(text);
    const fechaMatch = extractFecha(text);
    const detalle = extractDetalle(text);
    const moneda = extractMoneda(text);
    const categoriaSugerida = sugerirCategoria(text);

    document.getElementById('field-monto').value = montoMatch || '';
    document.getElementById('field-fecha').value = formatFechaParaInput(fechaMatch) || new Date().toISOString().split('T')[0];
    document.getElementById('field-detalle').value = detalle || '';
    document.getElementById('field-moneda').value = moneda || 'AR$';
    document.getElementById('field-categoria').value = categoriaSugerida || 'Otros';

    loader.classList.add('hidden');
    showToast('Datos extraídos. Revisá y ajustá antes de guardar.');
  } catch (e) {
    console.error('Error en OCR:', e);
    loader.classList.add('hidden');
    showToast('No se pudo analizar la imagen. Intentá con una foto más clara.', 'warn');
  }
}

function extractMonto(text) {
  // Buscar montos: cifras con punto o coma decimal, opcionalmente prefijo de moneda
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // Buscar patrones como: $ 1.250,00  /  1250.00  /  US$ 45,50  /  45.50  /  1,250
    const patterns = [
      /(?:US\$|\$|AR\$|UY\$)?\s*([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,
      /([\d]+[.,]\d{2})/,
      /([\d]{1,3}(?:[.,][\d]{3})+[.,]\d{2})/,
    ];
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        let val = m[1].replace(/\.(?=\d{3})/g, '').replace(',', '.');
        // Si tiene coma como separador decimal, corregir
        const partes = val.split('.');
        if (partes.length > 1 && partes[partes.length - 1].length === 2 && partes.length > 2) {
          val = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
        }
        if (!isNaN(parseFloat(val)) && parseFloat(val) > 0) return val;
      }
    }
  }
  return '';
}

function extractFecha(text) {
  // Buscar fechas: DD/MM/YYYY o YYYY-MM-DD
  const patterns = [
    /(\d{2})\/(\d{2})\/(\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{1,2})[\s\/\.](\d{1,2})[\s\/\.](\d{2,4})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      if (m[3] && m[3].length === 4) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (m[1] && m[1].length === 4) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
  }
  return '';
}

function formatFechaParaInput(fechaStr) {
  if (!fechaStr) return '';
  try {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch (e) { return ''; }
}

function extractMoneda(text) {
  const patterns = [
    /AR\$/i,
    /US\$/i,
    /UY\$/i,
  ];
  for (const line of text.split(/\r?\n/)) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        if (m[0].toUpperCase().includes('AR')) return 'AR$';
        if (m[0].toUpperCase().includes('US')) return 'US$';
        if (m[0].toUpperCase().includes('UY')) return 'UY$';
      }
    }
  }
  return '';
}

function sugerirCategoria(text) {
  const lower = text.toLowerCase();
  if (lower.includes('combustible') || lower.includes('gas') || lower.includes('nafta') || lower.includes('gasolina')) return 'Combustible';
  if (lower.includes('hotel') || lower.includes('hospedaje') || lower.includes('alojamiento') || lower.includes('noche')) return 'Hoteleria';
  if (lower.includes('excursion') || lower.includes('tour') || lower.includes('paseo')) return 'Excursiones';
  if (lower.includes('almuerzo') || lower.includes('desayuno') || lower.includes('cena') || lower.includes('comida') || lower.includes('bebida') || lower.includes('restaurante') || lower.includes('cafe')) return 'Alimentacion';
  return 'Otros';
}

function extractDetalle(text) {
  // Buscar líneas descriptivas (más de 3 palabras, no solo montos/fechas, permite símbolos comunes)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 3);
  // Priorizar líneas con palabras clave de consumo
  const keywords = ['almuerzo','desayuno','cena','refresco','bebida','cafe','comida','plato','consumo','ticket','factura','pedido','mesa','hora','fecha'];
  for (const line of lines) {
    const words = line.split(/[\s+\-&,]+/);
    const hasKeyword = words.some(w => keywords.some(k => w.toLowerCase().includes(k)));
    if (hasKeyword && words.length >= 2 && !line.match(/^[\d\s.,$]+$/)) {
      return line.length > 60 ? line.substring(0, 60) + '…' : line;
    }
  }
  // Fallback: cualquier línea con 2+ palabras que no sea principalmente montos
  for (const line of lines) {
    const words = line.split(/[\s+\-&,]+/);
    if (words.length >= 2 && !line.match(/^[\d\s.,$]+$/) && words.some(w => w.length > 2)) {
      return line.length > 60 ? line.substring(0, 60) + '…' : line;
    }
  }
  return '';
}

/* ================================================================
   GUARDAR GASTO — FIREBASE O LOCAL
   ================================================================ */
async function guardarGasto() {
  if (!currentViajeId) {
    showToast('Seleccioná un viaje primero', 'warn');
    document.getElementById('viaje-select').focus();
    return;
  }

  const montoStr = document.getElementById('field-monto').value;
  const fechaStr = document.getElementById('field-fecha').value;
  const detalle = document.getElementById('field-detalle').value.trim();
  const categoria = document.getElementById('field-categoria').value;
  const moneda = document.getElementById('field-moneda').value;

  if (!montoStr || isNaN(parseFloat(montoStr))) {
    showToast('Ingresá un monto válido', 'warn');
    document.getElementById('field-monto').focus();
    return;
  }
  if (!fechaStr) {
    showToast('Seleccioná una fecha', 'warn');
    document.getElementById('field-fecha').focus();
    return;
  }

  let pagadorValue = '';
  try { pagadorValue = document.getElementById('g-pagador').value; } catch (e) {}
  let involucrados = [];
  try {
    const checkboxes = document.querySelectorAll('#g-involucrados input[type="checkbox"]:checked');
    involucrados = Array.from(checkboxes).map(cb => cb.value);
  } catch (e) {}

  const cache = (typeof getViajeCache === 'function') ? getViajeCache(currentViajeId) : { configuracion: {} };
  const cfg = cache.configuracion || {};
  const origMoneda = cfg.moneda_origen || 'UY$';
  const ef = cfg.efectivo || {};
  const cots = cache.cotizaciones || {};
  let cotFecha = cots[fechaStr];
  if (!cotFecha) {
    const fechas = Object.keys(cots).sort();
    const ant = fechas.filter(f => f <= fechaStr);
    if (ant.length > 0) cotFecha = cots[ant[ant.length - 1]];
  }

  function getTasa(m) {
    if (m === 'US$') return 1;
    if (cotFecha && cotFecha[m]) return parseFloat(cotFecha[m]);
    if (ef && ef[m]) return parseFloat(ef[m]);
    if (m === 'AR$' && (cotFecha?.ar_por_us || ef?.ar_por_us)) return parseFloat(cotFecha?.ar_por_us || ef?.ar_por_us);
    if (m === origMoneda && (cotFecha?.uy_por_us || ef?.uy_por_us)) return parseFloat(cotFecha?.uy_por_us || ef?.uy_por_us);
    return 1;
  }

  const monto = parseFloat(montoStr);
  const tasaMoneda = getTasa(moneda);
  const tasaOrigen = getTasa(origMoneda);

  let montoUS = (moneda === 'US$') ? monto : (tasaMoneda > 0 ? monto / tasaMoneda : monto);
  let montoOrigen = (moneda === origMoneda) ? monto : (tasaOrigen > 0 ? montoUS * tasaOrigen : montoUS);

  montoUS = Math.round(montoUS * 100) / 100;
  montoOrigen = Math.round(montoOrigen * 100) / 100;

  const gasto = {
    id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    fecha: fechaStr,
    categoria: categoria || 'Otros',
    moneda: moneda || 'AR$',
    monto: monto,
    montoUS: montoUS,
    montoOrigen: montoOrigen,
    monedaOrigen: origMoneda,
    metodo: 'Tarjeta',
    detalle: detalle || 'Sin detalle',
    pagador: pagadorValue || 'Sin asignar',
    involucrados: involucrados.length > 0 ? involucrados : (viajerosList.length > 0 ? viajerosList : ['Sin asignar']),
    timestamp: 'TIMESTAMP',
    viaSource: isOnline ? 'online' : 'offline',
  };

  // 1) Guardar local inmediatamente (IndexedDB + localStorage backup)
  await saveToIndexedDB('gastos', gasto);

  // 2) Intentar guardar en Firebase si hay conexión (nunca en modo borrador)
  let wroteOnline = false;
  const enBorrador = esBorradorLocal();
  if (enBorrador) {
    // El gasto queda en la cache local del viaje (la lee el panel admin y el
    // presupuesto). No se encola: no hay cuenta destino a la que sincronizar.
    applyToCache('gastos/' + gasto.id, 'set', gasto, currentViajeId);
  } else if (db && isOnline) {
    try {
      const refPath = `${getUserRoot()}/viajes_data/${currentViajeId}/gastos`;
      await withTimeout(db.ref(refPath).push({
        ...gasto,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      }), 8000);
      wroteOnline = true;
    } catch (e) {
      console.warn('No se pudo escribir en Firebase (timeout o error):', e.message);
      wroteOnline = false;
    }
  }

  // 3) Si no se pudo escribir online, encolar para sincronizar
  if (!wroteOnline && !enBorrador) {
    syncQueue.push({
      action: 'push',
      path: `viajes_data/${currentViajeId}/gastos`,
      data: gasto,
      viajeId: currentViajeId,
      createdAt: Date.now()
    });
    setCache(CACHE.syncQueue, syncQueue);
  }

  // 4) Actualizar caché visual y UI
  await cargarGastos();
  document.getElementById('preview-section').classList.add('hidden');
  document.getElementById('ocr-loader').classList.remove('hidden'); // reset visual
  document.getElementById('field-monto').value = '';
  document.getElementById('field-detalle').value = '';

  if (enBorrador) showToast('🧾 Gasto guardado en este dispositivo (modo borrador)', 'success');
  else showToast(wroteOnline ? '✅ Gasto guardado en Firebase' : '💾 Gasto guardado (se sincronizará)', wroteOnline ? 'success' : 'warn');
}

/* ================================================================
   CARGAR GASTOS — USA RUTAS viaje-admin.html
   ================================================================ */
async function cargarGastos() {
  const container = document.getElementById('lista-gastos');
  container.innerHTML = '<div class="bg-white rounded-2xl p-4 shadow-sm border border-amber-100 text-center"><div class="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-2"></div><span class="text-xs text-gray-500">Cargando gastos…</span></div>';

  if (!currentViajeId) {
    container.innerHTML = '<div class="text-center text-xs text-gray-400 py-4">Seleccioná un viaje para ver sus gastos.</div>';
    return;
  }

  // Mapa para deduplicar por id
  const gastosMap = new Map();

  // Fuente 1: caché de viaje-admin (localStorage)
  try {
    const cache = getViajeCache(currentViajeId);
    for (const g of (cache.gastos || [])) {
      if (g.id) gastosMap.set(g.id, g);
    }
  } catch (e) {}

  // Fuente 2: IndexedDB local (gastos guardados por scanner)
  try {
    const idbGastos = await getAllFromIndexedDB('gastos');
    for (const g of idbGastos) {
      if (g.id && !gastosMap.has(g.id)) gastosMap.set(g.id, g);
    }
  } catch (e) {}

  // Fuente 3: Firebase (fuente de verdad si hay conexión; no en modo borrador)
  if (db && isOnline && !esBorradorLocal()) {
    try {
      const snap = await withTimeout(db.ref(`${getUserRoot()}/viajes_data/${currentViajeId}/gastos`).once('value'), 6000);
      if (snap.exists()) {
        gastosMap.clear(); // Firebase es la fuente de verdad online
        snap.forEach(child => {
          const g = { ...child.val(), id: child.key };
          gastosMap.set(child.key, g);
        });
        // Cachear para uso offline
        cacheCollection(currentViajeId, 'gastos', Array.from(gastosMap.values()));
      }
    } catch (e) {
      console.info('Usando caché local para gastos:', e.message);
    }
  }

  let gastos = Array.from(gastosMap.values());

  // Agregar cola pendiente (offline)
  const queued = syncQueue.filter(q => q.viajeId === currentViajeId && q.path.includes('gastos'));
  for (const q of queued) {
    if (q.action === 'push') {
      const tempId = q.data.id || ('pending_' + q.createdAt);
      if (!gastosMap.has(tempId)) gastos.push({ ...q.data, id: tempId });
    } else if (q.action === 'update' || q.action === 'set') {
      const idx = gastos.findIndex(g => g.id === q.data.id);
      if (idx >= 0) gastos[idx] = { ...gastos[idx], ...q.data };
      else gastos.push({ ...q.data, id: q.data.id || ('pending_' + q.createdAt) });
    } else if (q.action === 'remove') {
      gastos = gastos.filter(g => g.id !== q.data.id);
    }
  }

  // Ordenar: más reciente primero (por fecha, luego timestamp, luego id)
  gastos.sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '') ||
    ((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)) ||
    String(b.id || '').localeCompare(String(a.id || ''))
  );

  console.info('[TicketScanner] Gastos totales a mostrar:', gastos.length);

  if (gastos.length === 0) {
    container.innerHTML = `
      <div class="bg-gradient-to-br from-amber-50 to-amber-100/40 rounded-3xl p-6 text-center border border-amber-100">
        <div class="text-3xl mb-2">🧾</div>
        <h4 class="font-display font-extrabold text-sm text-ink">Sin gastos aún</h4>
        <p class="text-xs text-gray-500 mt-1">Capturá tu primer ticket para empezar.</p>
      </div>`;
    return;
  }

  container.innerHTML = gastos.map(g => {
    const montoFormateado = typeof g.monto === 'number' ? g.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : g.monto;
    return `
      <article class="bg-white rounded-2xl p-4 shadow-sm border border-amber-100/50 flex items-center gap-3 hover:shadow-md hover:-translate-y-0.5 transition">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white flex items-center justify-center shadow-md shrink-0">
          <span class="text-xs font-extrabold">${g.categoria ? g.categoria.substring(0, 2).toUpperCase() : 'GT'}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h4 class="font-display font-bold text-sm text-ink truncate">${escHtml(g.detalle || 'Sin detalle')}</h4>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${g.viaSource === 'offline' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'}">${g.viaSource === 'offline' ? 'Pendiente' : 'Online'}</span>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-gray-500">
            <span>${escHtml(g.fecha || '—')}</span>
            <span class="w-0.5 h-0.5 rounded-full bg-gray-300"></span>
            <span class="font-bold text-amber-700">${escHtml(g.moneda || '')} ${escHtml(montoFormateado)}</span>
            <span class="w-0.5 h-0.5 rounded-full bg-gray-300"></span>
            <span>${escHtml(g.categoria || '')}</span>
          </div>
        </div>
      </article>`;
  }).join('');
}

/* ================================================================
   SINCRONIZACIÓN — COLA PENDIENTE
   ================================================================ */
async function syncPending(auto = false) {
  if (esBorradorLocal()) {
    if (!auto) showToast('🧾 Modo borrador: los gastos se guardan en este dispositivo', 'warn');
    return;
  }
  if (!db || !isOnline) {
    if (!auto) showToast('Sin conexión para sincronizar', 'warn');
    return;
  }
  if (syncQueue.length === 0) {
    if (!auto) showToast('Nada pendiente de sincronizar');
    return;
  }

  if (!auto) showToast('Sincronizando datos con Firebase…');

  const pending = [...syncQueue];
  let successCount = 0;
  let errors = 0;

  for (const op of pending) {
    try {
      // Usar la misma estructura de rutas que viaje-admin.html
      let refPath = op.path;
      if (op.viajeId && !op.path.startsWith('viajes_data/') && !op.path.startsWith('viajes_index')) {
        refPath = `${getUserRoot()}/viajes_data/${op.viajeId}/${op.path}`;
      } else if (!refPath.startsWith(getUserRoot())) {
        refPath = `${getUserRoot()}/${refPath}`;
      }

      const ref = db.ref(refPath);

      const dataToSync = (op.data && typeof op.data === 'object' && !Array.isArray(op.data))
        ? encodeObjectKeys(op.data)
        : op.data;

      if (op.action === 'push' || op.action === 'set') {
        // Para push, necesitamos usar child(id).set() o usar el id que generamos en la cola
        if (op.path.includes('/')) {
          // Se generó un id en el momento del guardado
          const parts = op.path.split('/');
          const id = parts[parts.length - 1];
          await withTimeout(ref.child(id).set({ ...dataToSync, timestamp: firebase.database.ServerValue.TIMESTAMP }), 8000);
        } else {
          await withTimeout(ref.push({ ...dataToSync, timestamp: firebase.database.ServerValue.TIMESTAMP }), 8000);
        }
      } else if (op.action === 'update') {
        await withTimeout(ref.update({ ...dataToSync, timestamp: firebase.database.ServerValue.TIMESTAMP }), 8000);
      } else if (op.action === 'remove') {
        await ref.remove();
      }
      successCount++;
    } catch (e) {
      console.error('Error sincronizando:', op, e.message);
      errors++;
    }
  }

  // Si todos los intentos tuvieron éxito, limpiar la cola; de lo contrario, conservar los fallidos
  if (errors === 0) {
    syncQueue = [];
  } else {
    // Reintentar solo los fallidos más adelante (simplificación: mantenemos todos si hay error)
    // En una app de producción usaríamos un mecanismo más granular
  }

  setCache(CACHE.syncQueue, syncQueue);
  await cargarGastos();

  if (!auto) {
    showToast(successCount > 0 ? `✅ ${successCount} elemento(s) sincronizado(s)` : (errors > 0 ? '❌ Error sincronizando algunos elementos' : 'Sin cambios'), errors > 0 ? 'warn' : 'success');
  }
  updateStatusUI();
}

/* ================================================================
   UTILIDADES
   ================================================================ */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

function updateStatusUI() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (isOnline) {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.3)]';
    text.textContent = 'En línea';
  } else {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.3)]';
    text.textContent = 'Sin conexión';
  }
}

function renderOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (isOnline) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl opacity-100 pointer-events-auto transition-opacity duration-300 z-50 max-w-[92vw] text-center ${
    type === 'warn' ? 'bg-amber-600 text-white' :
    type === 'success' ? 'bg-emerald-600 text-white' :
    'bg-ink text-white'
  }`;
  setTimeout(() => { toast.classList.add('opacity-0', 'pointer-events-none'); }, 3200);
}

function resetApp() {
  document.getElementById('preview-section').classList.add('hidden');
  document.getElementById('field-monto').value = '';
  document.getElementById('field-fecha').value = '';
  document.getElementById('field-detalle').value = '';
  document.getElementById('field-categoria').selectedIndex = 0;
  document.getElementById('field-moneda').selectedIndex = 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================================================================
   ARRANQUE
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  // Auto-cargar gastos periódicamente si está en línea
  setInterval(() => {
    if (isOnline) cargarGastos();
  }, 30000);
  // Intentar sincronizar cada 15 segundos si hay cola pendiente
  setInterval(() => {
    if (isOnline && syncQueue.length > 0) syncPending(true);
  }, 15000);
});

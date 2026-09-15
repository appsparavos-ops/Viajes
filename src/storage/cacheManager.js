/**
 * cacheManager.js — Abstracción sobre localStorage
 * Antes: getCache/setCache/getViajeCache/setViajeCache dispersos + claves concatenadas manually
 * Ahora: clase con namespace por usuario, JSON seguro, quota handling, migración legacy.
 */

import { encodeObjectKeys } from '../utils/sanitize.js';

export function safeParse(json, fallback = null) {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
}

// Helper idéntico al original: solo encodea si es objeto plano (no array)
function sanitizeData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) return encodeObjectKeys(data);
  return data;
}

export class CacheManager {
  constructor({ getUserRoot, storage = null } = {}) {
    this.getUserRoot = getUserRoot || (() => 'usuario_anonimo');
    // Permite inyectar storage para tests (Map)
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!this.storage) {
      // Fallback en-memory para Node/tests
      const m = new Map();
      this.storage = {
        getItem: k => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, v),
        removeItem: k => m.delete(k),
        key: i => [...m.keys()][i] || null,
        get length() { return m.size; }
      };
    }
  }

  // Keys dinámicas por usuario — antes: objeto CACHE con getters
  keyViajes() { return `travelapp_${this.getUserRoot()}_viajes_cache`; }
  keyLastViajeId() { return `travelapp_${this.getUserRoot()}_last_viaje_id`; }
  keyLastViaje() { return `travelapp_${this.getUserRoot()}_last_viaje`; }
  keySyncQueue() { return `travelapp_${this.getUserRoot()}_syncQueue`; }
  keyViajeData(id) { return `travelapp_${this.getUserRoot()}_viajedata_${id}`; }
  keyDiasLegacy(id) { return `travelapp_${this.getUserRoot()}_dias_${id}`; }
  keyRuta(user, viajeId, fecha) { return `travelapp_${user}_ruta_${encodeURIComponent(String(viajeId || ''))}_${fecha}`; }
  keyRutaActiva(user) { return `travelapp_${user}_ruta_activa`; }

  get(key) {
    try { const v = this.storage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  set(key, val) {
    try { this.storage.setItem(key, JSON.stringify(val)); } catch (e) {
      if (e && e.name === 'QuotaExceededError') console.warn('Cache quota exceeded for', key);
    }
  }
  remove(key) { try { this.storage.removeItem(key); } catch {} }

  getViajeCache(id) {
    if (!id) return { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
    let cache = this.get(this.keyViajeData(id));
    if (!cache) {
      cache = { dias: [], gastos: [], comentarios: [], configuracion: {}, cotizaciones: {} };
      const legacy = this.get(this.keyDiasLegacy(id));
      if (legacy) cache.dias = legacy;
    }
    // Asegurar estructura
    cache.dias = cache.dias || [];
    cache.gastos = cache.gastos || [];
    cache.comentarios = cache.comentarios || [];
    cache.configuracion = cache.configuracion || {};
    cache.cotizaciones = cache.cotizaciones || {};
    return cache;
  }
  setViajeCache(id, cache) { this.set(this.keyViajeData(id), cache); }

  deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  // Write-through a caché local — antes applyToCache
  // NOTA COMPATIBILIDAD ECOSISTEMA: se guarda EXACTAMENTE igual que el original:
  // 1) deepClone, 2) encodeObjectKeys (sanitizeData), 3) normalizeTimestamps local
  // Así viaje.html / presupuesto.html / scanner.html leen el mismo formato byte-a-byte.
  applyToCache(path, action, data, viajeId) {
    const cache = this.getViajeCache(viajeId);
    const parts = path.split('/');
    const collection = parts[0];
    const id = parts[1] || null;
    const sanitized = sanitizeData(data);
    const cData = sanitized == null ? null : this.normalizeTimestamps(this.deepClone(sanitized), 'local');

    if (collection === 'configuracion' || collection === 'cotizaciones') {
      const bucket = cache[collection] = cache[collection] || {};
      if (action === 'remove' && id) delete bucket[id];
      else if (action === 'set' && id) bucket[id] = cData;
      else if (action === 'update' && id) bucket[id] = { ...(bucket[id] || {}), ...cData };
    } else {
      let arr = cache[collection] || [];
      if (action === 'remove' && id) arr = arr.filter(x => x.id !== id);
      else if ((action === 'set' || action === 'update') && id) {
        const i = arr.findIndex(x => x.id === id);
        if (i >= 0) arr[i] = { ...arr[i], ...cData };
        else arr.push({ id, ...cData });
      }
      cache[collection] = arr;
    }
    this.setViajeCache(viajeId, cache);
  }

  cacheCollection(viajeId, collection, arr) {
    const cache = this.getViajeCache(viajeId);
    cache[collection] = arr;
    this.setViajeCache(viajeId, cache);
  }

  normalizeTimestamps(obj, mode) {
    if (Array.isArray(obj)) { obj.forEach(o => this.normalizeTimestamps(o, mode)); return obj; }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === 'TIMESTAMP') {
          // En cache siempre es local timestamp; server timestamp solo en Firebase
          obj[k] = Date.now();
        } else if (v && typeof v === 'object') {
          this.normalizeTimestamps(v, mode);
        }
      }
    }
    return obj;
  }

  // Rutas
  getRutaCache(viajeId, fecha, userOverride) {
    const user = userOverride || this.getUserRoot();
    const key = this.keyRuta(user, viajeId, fecha);
    const raw = this.get(key);
    if (!raw) return { version: 1, viajeId, fecha, google: [], automatica: [], fuentePrincipal: null, pendingSync: false, updatedAt: 0 };
    // normalización mínima
    return {
      version: raw.version || 1,
      viajeId: raw.viajeId || viajeId,
      fecha: raw.fecha || fecha,
      google: Array.isArray(raw.google) ? raw.google : [],
      automatica: Array.isArray(raw.automatica) ? raw.automatica : (Array.isArray(raw.auto) ? raw.auto : []),
      fuentePrincipal: raw.fuentePrincipal === 'google' || raw.fuentePrincipal === 'automatica' ? raw.fuentePrincipal : null,
      pendingSync: !!raw.pendingSync,
      updatedAt: raw.updatedAt || 0,
      googleImportadoAt: raw.googleImportadoAt,
      googleArchivo: raw.googleArchivo
    };
  }

  setRutaCache(record, userOverride) {
    if (!record || !record.viajeId || !record.fecha) return;
    const user = userOverride || this.getUserRoot();
    record.updatedAt = Date.now();
    this.set(this.keyRuta(user, record.viajeId, record.fecha), record);
  }
}

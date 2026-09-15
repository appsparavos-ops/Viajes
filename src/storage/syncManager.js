/**
 * syncManager.js — Cola offline + sincronización
 * Antes: objeto SyncManager global con 150 líneas mezcladas con UI (updateUI dentro de save)
 * Ahora: clase pura con eventos, sin tocar DOM directamente.
 */

import { encodeObjectKeys } from '../utils/sanitize.js';

function sanitizeData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) return encodeObjectKeys(data);
  return data;
}

export class SyncManager {
  constructor({ cacheManager, firebaseAdapter, isOnline, isDraftMode, getViajeId, onQueueChange }) {
    this.cache = cacheManager;
    this.firebase = firebaseAdapter; // { available, ref(path), withTimeout, normalizeForServer }
    this.isOnline = isOnline || (() => typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
    this.isDraftMode = isDraftMode || (() => false);
    this.getViajeId = getViajeId || (() => null);
    this.onQueueChange = onQueueChange || (() => {});
    this.queue = this.loadQueue();
  }

  loadQueue() {
    const key = this.cache.keySyncQueue();
    this.queue = this.cache.get(key) || [];
    this.onQueueChange(this.queue);
    return this.queue;
  }

  saveQueue() {
    this.cache.set(this.cache.keySyncQueue(), this.queue);
    this.onQueueChange(this.queue);
  }

  genId() {
    if (this.firebase?.available && this.firebase.genId) {
      try { return this.firebase.genId(); } catch {}
    }
    return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  async save(path, action, data = null, isGlobal = false) {
    const viajeId = isGlobal ? null : this.getViajeId();
    let generatedId = null;
    if (action === 'push') generatedId = this.genId();

    // COMPATIBILIDAD ECOSISTEMA: idéntico al original viaje-admin.html línea ~2450:
    // sanitizedData = encodeObjectKeys(data) si es objeto (escapa . $ # /)
    // Se guarda así TANTO en localStorage (applyToCache) COMO en Firebase y en la cola.
    const sanitizedData = sanitizeData(data);

    // 1) Write-through a caché local
    if (!isGlobal && viajeId) {
      if (action === 'push') this.cache.applyToCache(path + '/' + generatedId, 'set', sanitizedData, viajeId);
      else this.cache.applyToCache(path, action, sanitizedData, viajeId);
    }

    // 2) Intentar Firebase si hay conexión y no es borrador
    let wrote = false;
    if (this.firebase?.available && this.isOnline() && !this.isDraftMode()) {
      try {
        const refPath = isGlobal ? path : `${viajeId}/${path}`;
        await this.firebase.write(refPath, action === 'push' ? 'set' : action, sanitizedData, generatedId, isGlobal);
        wrote = true;
      } catch {
        wrote = false;
      }
    }

    if (!wrote) {
      const op = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        path: action === 'push' ? path + '/' + (generatedId || this.genId()) : path,
        action: action === 'push' ? 'set' : action,
        data: sanitizedData == null ? null : JSON.parse(JSON.stringify(sanitizedData)),
        isGlobal,
        viajeId
      };
      this.queue.push(op);
      this.saveQueue();
    } else {
      this.onQueueChange(this.queue);
    }
    return generatedId;
  }

  // Mezcla cola pendiente en una lista — antes mergeQueued global
  mergeQueued(arr, collection) {
    const viajeId = this.getViajeId();
    const out = arr.slice();
    (this.queue || []).forEach(op => {
      if (op.viajeId !== viajeId) return;
      const parts = op.path.split('/');
      if (parts[0] !== collection) return;
      const id = parts[1];
      if (!id) return;
      if (op.action === 'remove') {
        const i = out.findIndex(x => x.id === id);
        if (i >= 0) out.splice(i, 1);
      } else {
        const d = JSON.parse(JSON.stringify(op.data));
        // normalizar timestamp local
        if (d && typeof d === 'object') this.cache.normalizeTimestamps(d, 'local');
        const i = out.findIndex(x => x.id === id);
        if (i >= 0) out[i] = { ...out[i], ...d };
        else out.push({ id, ...d });
      }
    });
    return out;
  }

  async sync({ auto = false } = {}) {
    if (this.isDraftMode()) {
      if (!auto) throw new Error('Modo borrador: iniciá sesión para sincronizar');
      return 0;
    }
    if (!this.firebase?.available) throw new Error('Firebase no disponible');
    if (!this.isOnline()) throw new Error('Sin conexión');
    if (this.queue.length === 0) return 0;

    for (const op of this.queue) {
      await this.firebase.write(
        op.isGlobal ? op.path : `${op.viajeId}/${op.path}`,
        op.action,
        op.data,
        null,
        op.isGlobal
      );
    }
    const count = this.queue.length;
    this.queue = [];
    this.saveQueue();
    return count;
  }

  pendingCount() { return this.queue.length; }
}

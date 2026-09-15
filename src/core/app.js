/**
 * app.js — Composición raíz (DI container muy simple)
 * Muestra cómo se conectan todos los módulos refactorizados.
 * Este archivo reemplaza los 162 globals del HTML original.
 */
import { CacheManager } from '../storage/cacheManager.js';
import { SyncManager } from '../storage/syncManager.js';
import { createFirebaseAdapter } from './firebaseAdapter.js';
import { RutaService } from '../domain/rutas.js';
import { ViajeService } from '../domain/viajes.js';

export function createApp({ firebase, firebaseConfig, getUserRoot, storage } = {}) {
  const cache = new CacheManager({ getUserRoot, storage });
  const firebaseAdapter = createFirebaseAdapter({ firebase, firebaseConfig, getUserRoot });

  let currentViajeId = cache.get(cache.keyLastViajeId()) || null;

  const sync = new SyncManager({
    cacheManager: cache,
    firebaseAdapter,
    isOnline: () => typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    isDraftMode: () => {
      try { return localStorage.getItem('travelapp_modo_borrador') === '1'; } catch { return false; }
    },
    getViajeId: () => currentViajeId,
    onQueueChange: (q) => {
      // Aquí se emitiría evento para que la UI actualice badge/estado
      // sin acoplar SyncManager al DOM (antes updateUI dentro de save)
    }
  });

  const rutas = new RutaService({
    cacheManager: cache,
    syncManager: sync,
    getViajeId: () => currentViajeId,
    getFechaSeleccionada: () => document.getElementById('ruta-fecha')?.value || new Date().toISOString().slice(0, 10)
  });

  const viajes = new ViajeService({ cacheManager: cache, syncManager: sync, firebaseAdapter });

  function setViajeId(id) {
    currentViajeId = id;
    cache.set(cache.keyLastViajeId(), id);
  }

  return { cache, sync, firebaseAdapter, rutas, viajes, setViajeId, getViajeId: () => currentViajeId };
}

/**
 * rutas.js — Lógica de rutas GPS híbridas
 * Extraído de las 600+ líneas de ruta en viaje-admin.html
 */
import { normalizarRutaRecord, rutaVacia, puntosRutaPrincipal, puntosDeFuenteRuta } from '../utils/geo.js';

export class RutaService {
  constructor({ cacheManager, syncManager, getViajeId, getFechaSeleccionada }) {
    this.cache = cacheManager;
    this.sync = syncManager;
    this.getViajeId = getViajeId;
    this.getFecha = getFechaSeleccionada;
  }

  getRecord(viajeId, fecha) {
    return this.cache.getRutaCache(viajeId, fecha);
  }

  guardarPunto(point, context) {
    // context = { viajeId, fecha, user }
    // Delega a lógica pura de guardado con deduplicación
    const { viajeId, fecha, user } = context;
    const record = this.cache.getRutaCache(viajeId, fecha, user);
    const arr = record.automatica;
    // deduplicación por uuid y distancia
    if (point.uuid && arr.some(x => x.uuid && x.uuid === point.uuid)) return false;
    const ultimo = arr[arr.length - 1];
    if (ultimo && !point.uuid && Math.abs(Number(ultimo.ts) - point.ts) < 10000) {
      const dist = Math.hypot(Number(ultimo.lat) - point.lat, Number(ultimo.lng) - point.lng) * 111000; // aprox
      if (dist < 5) return false;
    }
    arr.push(point);
    if (arr.length > 30000) arr.splice(0, arr.length - 30000);
    record.pendingSync = true;
    if (!record.fuentePrincipal) record.fuentePrincipal = 'automatica';
    this.cache.setRutaCache(record, user);
    return true;
  }

  importarGoogle({ viajeId, fecha, puntos, archivo }) {
    const record = this.cache.getRutaCache(viajeId, fecha);
    record.google = puntos;
    record.fuentePrincipal = 'google';
    record.pendingSync = true;
    record.googleImportadoAt = Date.now();
    record.googleArchivo = archivo || 'Timeline.json';
    this.cache.setRutaCache(record);
    return record;
  }

  elegirFuente(viajeId, fecha, fuente) {
    const record = this.cache.getRutaCache(viajeId, fecha);
    const puntos = puntosDeFuenteRuta(record, fuente);
    if (!puntos.length) throw new Error('No hay puntos para esa fuente');
    record.fuentePrincipal = fuente;
    record.pendingSync = true;
    this.cache.setRutaCache(record);
    return record;
  }

  principal(viajeId, fecha) {
    return puntosRutaPrincipal(this.getRecord(viajeId, fecha));
  }
}

/**
 * geo.js — Utilidades geográficas puras
 * Extraído de viaje-admin.html (líneas 1455-1520, 1771-1811)
 * Antes: funciones globales acopladas a DOM/localStorage.
 * Ahora: puras, testeables, con memoización opcional.
 */

// Haversine en metros
export function distanciaMetros(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = Math.PI / 180;
  const p1 = Number(a.lat) * toRad;
  const p2 = Number(b.lat) * toRad;
  const dLat = (Number(b.lat) - Number(a.lat)) * toRad;
  const dLng = (Number(b.lng) - Number(a.lng)) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function distanciaRutaKm(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanciaMetros(points[i - 1], points[i]);
  return total / 1000;
}

export function formatearDistanciaRuta(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 1) return Math.round(km * 1000) + ' m';
  return km.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
}

export function fechaRutaHoy(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export function fechaRutaDeTimestamp(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function horaPuntoRuta(ts) {
  const d = new Date(Number(ts));
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

export function parseTimestampRuta(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (value.seconds != null) return Number(value.seconds) * 1000 + Math.round(Number(value.nanoseconds || 0) / 1e6);
    return null;
  }
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    let n = Number(value);
    if (n < 1e11) n *= 1000;
    return Number.isFinite(n) ? n : null;
  }
  const n = Date.parse(String(value));
  return Number.isFinite(n) ? n : null;
}

export function coordsDesdeTimeline(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.trim().replace(/^geo:/i, '');
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    return null;
  }
  if (typeof value !== 'object') return null;
  if (value.latitudeE7 != null && value.longitudeE7 != null) return { lat: Number(value.latitudeE7) / 1e7, lng: Number(value.longitudeE7) / 1e7 };
  if (value.latE7 != null && value.lngE7 != null) return { lat: Number(value.latE7) / 1e7, lng: Number(value.lngE7) / 1e7 };
  if (value.latitude != null && value.longitude != null) return { lat: Number(value.latitude), lng: Number(value.longitude) };
  if (value.lat != null && (value.lng != null || value.lon != null)) return { lat: Number(value.lat), lng: Number(value.lng != null ? value.lng : value.lon) };
  const nestedKeys = ['point', 'latLng', 'geo', 'location', 'placeLocation', 'startLocation', 'endLocation'];
  for (const key of nestedKeys) {
    if (value[key] != null) {
      const c = coordsDesdeTimeline(value[key]);
      if (c) return c;
    }
  }
  return null;
}

export function puntoDesdeLocationPlugin(location) {
  if (!location) return null;
  const c = location.coords || location.coordinate || location;
  const lat = Number(c.latitude != null ? c.latitude : c.lat);
  const lng = Number(c.longitude != null ? c.longitude : (c.lng != null ? c.lng : c.lon));
  const accuracy = Number(c.accuracy != null ? c.accuracy : location.accuracy);
  let ts = location.timestamp || location.ts || c.timestamp || c.ts || Date.now();
  if (typeof ts === 'string') ts = Date.parse(ts);
  if (typeof ts === 'object' && ts && ts.seconds != null) ts = Number(ts.seconds) * 1000;
  ts = Number(ts);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat, lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    uuid: location.uuid || location.id || null
  };
}

// Normalización de record de ruta (antes normalizarRutaRecord disperso)
export function rutaVacia(viajeId, fecha) {
  return { version: 1, viajeId, fecha, google: [], automatica: [], fuentePrincipal: null, pendingSync: false, updatedAt: 0 };
}

export function normalizarRutaRecord(record, viajeId, fecha) {
  const r = record && typeof record === 'object' ? { ...record } : rutaVacia(viajeId, fecha);
  r.version = r.version || 1;
  r.viajeId = r.viajeId || viajeId;
  r.fecha = r.fecha || fecha;
  r.google = Array.isArray(r.google) ? r.google : [];
  r.automatica = Array.isArray(r.automatica) ? r.automatica : (Array.isArray(r.auto) ? r.auto : []);
  r.fuentePrincipal = r.fuentePrincipal === 'google' || r.fuentePrincipal === 'automatica' ? r.fuentePrincipal : null;
  r.pendingSync = !!r.pendingSync;
  return r;
}

export function puntosDeFuenteRuta(record, fuente) {
  if (!record) return [];
  return fuente === 'google' ? (record.google || []) : (record.automatica || []);
}

export function puntosRutaPrincipal(record) {
  if (!record) return { fuente: null, puntos: [] };
  const google = puntosDeFuenteRuta(record, 'google');
  const auto = puntosDeFuenteRuta(record, 'automatica');
  if (record.fuentePrincipal === 'google' && google.length) return { fuente: 'google', puntos: google };
  if (record.fuentePrincipal === 'automatica' && auto.length) return { fuente: 'automatica', puntos: auto };
  if (google.length) return { fuente: 'google', puntos: google };
  if (auto.length) return { fuente: 'automatica', puntos: auto };
  return { fuente: null, puntos: [] };
}

export function resumenRutaFuente(points, emptyText = 'Sin datos') {
  if (!points || !points.length) return emptyText;
  const km = distanciaRutaKm(points);
  const inicio = horaPuntoRuta(points[0].ts);
  const fin = horaPuntoRuta(points[points.length - 1].ts);
  return `${points.length} puntos · ${formatearDistanciaRuta(km)} · ${inicio}–${fin}`;
}

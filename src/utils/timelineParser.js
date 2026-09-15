/**
 * timelineParser.js — Parser de Google Timeline / Takeout
 * Extraído de viaje-admin.html parseGoogleTimelineJson (líneas 1813-1980)
 * Refactor: función pura, sin side-effects (no toca ultimaLimpiezaTimeline global),
 * retorna { puntos, descartados } y es 100% testeable.
 */
import { parseTimestampRuta, coordsDesdeTimeline } from './geo.js';

function distanciaMetrosRaw(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function parseGoogleTimelineJson(data) {
  const out = [];
  const seen = new Set();
  let descartados = 0;

  const add = (coords, ts, accuracy, horaPropia) => {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return;
    const t = parseTimestampRuta(ts);
    if (!t) return;
    const p = { lat: coords.lat, lng: coords.lng, ts: t, accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null, _h: horaPropia ? 1 : 0 };
    const key = p.lat.toFixed(6) + '|' + p.lng.toFixed(6) + '|' + p.ts;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  const HORAS_PROPIAS = ['timestampMs', 'timestamp', 'time'];
  const pointTimestamp = (obj, fallback) => {
    if (!obj || typeof obj !== 'object') return fallback;
    return obj.timestampMs || obj.timestamp || obj.time || obj.startTimestamp || obj.startTime || obj.startTimestampMs ||
      (obj.duration && (obj.duration.startTimestamp || obj.duration.startTime || obj.duration.startTimestampMs)) || fallback;
  };
  const endTimestamp = (obj, fallback) => {
    if (!obj || typeof obj !== 'object') return fallback;
    return obj.endTimestamp || obj.endTime || obj.endTimestampMs ||
      (obj.duration && (obj.duration.endTimestamp || obj.duration.endTime || obj.duration.endTimestampMs)) || fallback;
  };
  const esClaveLlegada = (key) => /^(end|endlocation|destination)$/i.test(key);
  const CLAVES_PATH = ['timelinePath', 'waypointPath', 'path', 'points', 'locations', 'rawLocations', 'waypoints'];

  const parsePathArray = (arr, fallbackTs) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (typeof item === 'string') add(coordsDesdeTimeline(item), fallbackTs, null, false);
      else if (item && typeof item === 'object') {
        const propio = HORAS_PROPIAS.some(k => item[k] != null);
        add(coordsDesdeTimeline(item), pointTimestamp(item, fallbackTs), item.accuracy || (item.coords && item.coords.accuracy), propio);
      }
    });
  };

  const walk = (node, fallbackTs, fallbackEndTs, depth) => {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) { node.forEach(x => walk(x, fallbackTs, fallbackEndTs, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const ownTs = pointTimestamp(node, fallbackTs);
    const ownEndTs = endTimestamp(node, fallbackEndTs);
    const ownCoords = coordsDesdeTimeline(node);
    if (ownCoords) add(ownCoords, ownTs, node.accuracy || (node.coords && node.coords.accuracy), HORAS_PROPIAS.some(k => node[k] != null));
    CLAVES_PATH.forEach(key => {
      if (Array.isArray(node[key])) parsePathArray(node[key], ownTs);
      else if (node[key] && typeof node[key] === 'object') walk(node[key], ownTs, ownEndTs, depth + 1);
    });
    Object.keys(node).forEach(key => {
      if (['settings', 'userLocationProfile', 'placeVisit', 'visit', 'topCandidate'].includes(key)) {
        if (key === 'placeVisit' || key === 'visit') walk(node[key], ownTs, ownEndTs, depth + 1);
        return;
      }
      const v = node[key];
      if (v && typeof v === 'object' && !CLAVES_PATH.includes(key)) {
        walk(v, esClaveLlegada(key) ? ownEndTs : ownTs, ownEndTs, depth + 1);
      }
    });
  };

  const limpiarSegmento = (desde, hasta) => {
    const pts = out.slice(desde, hasta);
    if (!pts.length) return;
    const conHoraPropia = pts.filter(p => p._h).length;
    if (conHoraPropia >= 3) {
      const limpios = pts.filter(p => p._h);
      descartados += (pts.length - limpios.length);
      out.splice(desde, hasta - desde, ...limpios);
    }
  };
  const incorporar = (x) => {
    const antes = out.length;
    walk(x, null, null, 0);
    limpiarSegmento(antes, out.length);
  };

  const quitarPuntasDeRecta = (pts) => {
    if (!Array.isArray(pts) || pts.length < 4) return pts;
    let arr = pts;
    for (let pasada = 0; pasada < 2; pasada++) {
      const res = [arr[0]];
      for (let i = 1; i < arr.length - 1; i++) {
        const a = res[res.length - 1], b = arr[i], c = arr[i + 1];
        const dAB = distanciaMetrosRaw(a, b), dBC = distanciaMetrosRaw(b, c), dAC = distanciaMetrosRaw(a, c);
        const umbralVecinos = Math.max(1500, Math.min(dAB, dBC) / 4);
        if (dAB >= 3000 && dBC >= 3000 && dAC <= umbralVecinos) { descartados++; continue; }
        res.push(b);
      }
      res.push(arr[arr.length - 1]);
      arr = res;
    }
    return arr;
  };

  if (data && Array.isArray(data.locations)) parsePathArray(data.locations, null);
  if (data && Array.isArray(data.timelineObjects)) data.timelineObjects.forEach(incorporar);
  if (data && Array.isArray(data.semanticSegments)) data.semanticSegments.forEach(incorporar);
  if (data && Array.isArray(data.timelineSegments)) data.timelineSegments.forEach(incorporar);
  if (!out.length) walk(data, null, null, 0);

  const quitarVelocidadesImposibles = (pts) => {
    if (!Array.isArray(pts) || pts.length < 3) return pts;
    const VMAX_MS = 55.5;
    const res = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = res[res.length - 1];
      const dt = (Number(pts[i].ts) - Number(prev.ts)) / 1000;
      const d = distanciaMetrosRaw(prev, pts[i]);
      if (d > 150 && dt < 120 && (dt <= 0 || d / dt > VMAX_MS)) { descartados++; continue; }
      res.push(pts[i]);
    }
    return res;
  };

  out.sort((a, b) => a.ts - b.ts);
  let limpio = quitarVelocidadesImposibles(quitarPuntasDeRecta(out));
  limpio.forEach(p => { delete p._h; });
  return { puntos: limpio, descartados };
}

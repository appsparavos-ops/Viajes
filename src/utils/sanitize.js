/**
 * sanitize.js — Normalización y validación de usernames y keys de Firebase
 * Extraído y desacoplado de viaje-admin.html (líneas 696-728)
 * Mejoras: pure functions, testeable, sin dependencia de DOM/firebase
 */

export const RESERVED_USERNAMES = new Set([
  'usernames', 'users', 'viajes_index', 'viajes_data', 'admin', 'api', 'auth',
  'null', 'undefined', 'root', 'config', '_borrador_local', 'borrador', 'borrador_local', 'usuario_anonimo'
]);

/**
 * Normaliza cualquier cadena a un ID válido de Firebase Realtime Database.
 * Firebase no permite: . $ # [ ] / ni ASCII control (0-31,127)
 */
export function sanitizeUsername(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/ñ/g, 'n')
    .replace(/[\s.]+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 25);
}

export function validateUsernameFormat(username) {
  if (!username || username.length < 3) {
    return 'El nombre de usuario debe tener al menos 3 caracteres.';
  }
  if (username.length > 25) {
    return 'El nombre de usuario no puede superar los 25 caracteres.';
  }
  if (/[.$#[\]/]/.test(username)) {
    return 'El nombre no puede contener caracteres no permitidos en Firebase (. $ # [ ] /).';
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return 'Solo se permiten letras minúsculas (a-z), números (0-9), guiones (-) y guiones bajos (_).';
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return 'Este nombre de usuario está reservado para el sistema.';
  }
  return null; // válido
}

/** Escape para Firebase keys — antes toFbKey/fromFbKey (líneas 2310-2336) */
export function toFbKey(key) {
  return String(key).replace(/\$/g, '_S_').replace(/\./g, '_D_').replace(/#/g, '_H_').replace(/\//g, '_F_');
}
export function fromFbKey(key) {
  return String(key).replace(/_S_/g, '$').replace(/_D_/g, '.').replace(/_H_/g, '#').replace(/_F_/g, '/');
}

export function encodeObjectKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const res = {};
  for (const k of Object.keys(obj)) res[toFbKey(k)] = obj[k];
  return res;
}

export function decodeObjectKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const res = {};
  for (const k of Object.keys(obj)) {
    res[fromFbKey(k)] = (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]))
      ? decodeObjectKeys(obj[k]) : obj[k];
  }
  return res;
}

// Util general: escape HTML para prevenir XSS en innerHTML (no existía antes)
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

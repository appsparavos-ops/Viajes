/**
 * toast.js — Notificaciones y confirmaciones sin prompt/confirm bloqueantes
 * Mantiene compatibilidad con el ecosistema pero desacopla UI.
 */
let toastTimer = null;
export function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// Reemplazo no-bloqueante para confirm/prompt (retorna Promise)
export function confirmAsync(message) {
  return new Promise(resolve => {
    const ok = window.confirm(message);
    resolve(ok);
  });
}
export function promptAsync(message, def = '') {
  return new Promise(resolve => {
    const v = window.prompt(message, def);
    resolve(v);
  });
}

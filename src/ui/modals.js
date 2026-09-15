/**
 * modals.js — Gestión centralizada de modales (reemplaza 4× abrir/cerrar duplicado)
 */
export function createModalManager() {
  const modals = new Map();

  function register(id, { onOpen, onClose } = {}) {
    const el = document.getElementById(id);
    if (!el) return null;
    const api = {
      open() {
        el.classList.remove('hidden');
        if (el.classList.contains('flex-col') || el.id.includes('modal')) {
          el.classList.add('flex');
        }
        document.body.style.overflow = 'hidden';
        if (onOpen) onOpen(el);
      },
      close() {
        el.classList.add('hidden');
        el.classList.remove('flex');
        document.body.style.overflow = '';
        if (onClose) onClose(el);
      },
      el
    };
    // Cerrar con ×
    el.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => api.close());
    });
    // Cerrar clic fuera
    el.addEventListener('click', e => {
      if (e.target === el) api.close();
    });
    modals.set(id, api);
    return api;
  }

  // Esc global
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      modals.forEach(m => {
        if (!m.el.classList.contains('hidden')) m.close();
      });
    }
  });

  return { register, get: id => modals.get(id) };
}

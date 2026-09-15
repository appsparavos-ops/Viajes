/**
 * tabs.js — Navegación por pestañas sin onclick inline
 * Reemplaza switchTab() global + 5 onclick="switchTab('tab-...')"
 */
export function initTabs({ onSwitch }) {
  const btns = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('.tab-content');
  const tabIds = ['tab-nueva','tab-entradas','tab-comentarios','tab-ruta','tab-finanzas'];

  function switchTab(id) {
    tabIds.forEach(tab => {
      const panel = document.getElementById(tab);
      if (panel) panel.classList.toggle('hidden', tab !== id);
      const btn = document.querySelector(`[data-tab="${tab}"]`);
      if (btn) {
        btn.classList.toggle('active', tab === id);
        btn.classList.toggle('bg-white', tab !== id);
        btn.setAttribute('aria-selected', tab === id ? 'true' : 'false');
      }
    });
    if (onSwitch) onSwitch(id);
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.setAttribute('role', 'tab');
  });

  return { switchTab };
}

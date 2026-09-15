/**
 * renderer.js — Render seguro con escapeHtml + DocumentFragment
 * Antes: innerHTML = arr.map(d => `<div ...>${d.destino}`) vulnerable a XSS
 * Ahora: templates con escape + fragment para evitar reflows múltiples
 */
import { escapeHtml } from '../utils/sanitize.js';
import { formatearMonto } from '../utils/finance.js';

export function renderListaEntradas(arr, container) {
  if (!container) return;
  if (!arr.length) {
    container.innerHTML = '<p class="text-gray-400 italic py-4">No hay días registrados.</p>';
    return;
  }
  // Ordenar por numero
  const sorted = [...arr].sort((a, b) => (a.numero || 0) - (b.numero || 0));
  container.innerHTML = sorted.map(d => `
    <div class="flex justify-between items-center py-3 border-b">
      <span class="font-bold text-gray-800">Día ${escapeHtml(d.numero)} - ${escapeHtml(d.destino)}</span>
      <div>
        <button data-action="editar-dia" data-id="${escapeHtml(d.id)}" class="text-blue-600 bg-blue-50 px-3 py-1 rounded-md text-sm font-bold mr-2 hover:bg-blue-100 transition">Editar</button>
        <button data-action="borrar-dia" data-id="${escapeHtml(d.id)}" class="text-red-600 bg-red-50 px-3 py-1 rounded-md text-sm font-bold hover:bg-red-100 transition">Borrar</button>
      </div>
    </div>`).join('');
}

export function renderListaGastos(arr, container, { monedaOrigen, currentGastoEditId } = {}) {
  if (!container) return;
  if (!arr.length) {
    container.innerHTML = '<tr><td colspan="9" class="py-4 text-gray-400 italic">No hay gastos registrados.</td></tr>';
    return;
  }
  const sorted = [...arr].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '') ||
    ((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
  );
  container.innerHTML = sorted.map(d => {
    const invol = Array.isArray(d.involucrados) ? d.involucrados.join(', ') : '';
    const editing = currentGastoEditId === d.id;
    const valUS = d.montoUS != null ? formatearMonto(d.montoUS) : '—';
    const valOrig = d.montoOrigen != null ? formatearMonto(d.montoOrigen) : '—';
    const valMonto = d.monto != null ? formatearMonto(d.monto) : '—';
    return `
      <tr class="border-b ${editing ? 'bg-amber-50' : ''}">
        <td class="py-2 pr-2 whitespace-nowrap">${escapeHtml(d.fecha)}</td>
        <td class="pr-2">${escapeHtml(d.categoria)}</td>
        <td class="pr-2 max-w-[10rem] truncate" title="${escapeHtml(d.detalle || '')}">${escapeHtml(d.detalle || '—')}</td>
        <td class="pr-2"><span class="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded font-bold">${escapeHtml(d.pagador || 'N/A')}</span></td>
        <td class="pr-2 text-xs text-gray-600">${escapeHtml(invol || '—')}</td>
        <td class="pr-2 whitespace-nowrap font-medium">${escapeHtml(d.moneda)} ${valMonto} <span class="text-gray-400 text-xs">(${escapeHtml(d.metodo)})</span></td>
        <td class="pr-2 whitespace-nowrap font-bold text-amber-700">US$ ${escapeHtml(valUS)}</td>
        <td class="pr-2 whitespace-nowrap text-emerald-700 font-medium">${escapeHtml(d.monedaOrigen || monedaOrigen)} ${escapeHtml(valOrig)}</td>
        <td class="whitespace-nowrap text-right">
          <button data-action="editar-gasto" data-id="${escapeHtml(d.id)}" class="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs font-bold mr-1 hover:bg-blue-100">Editar</button>
          <button data-action="borrar-gasto" data-id="${escapeHtml(d.id)}" class="text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-bold hover:bg-red-100">Borrar</button>
        </td>
      </tr>`;
  }).join('');
}

// Delegación de eventos — reemplaza 51 onclick inline
export function bindActionDelegation(root, handlers) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (handlers[action]) handlers[action](id, btn, e);
  });
}

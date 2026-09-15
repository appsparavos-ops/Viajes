/**
 * gastos.js — Validación y construcción de objetos gasto
 * Separa la lógica de negocio del DOM.
 */
import { resolverMontosGasto } from '../utils/finance.js';

export function validarGasto({ fecha, monto, categoria, moneda, metodo }) {
  const errores = [];
  if (!fecha) errores.push('Falta fecha');
  if (isNaN(parseFloat(monto))) errores.push('Falta monto válido');
  if (!categoria) errores.push('Falta categoría');
  if (!moneda) errores.push('Falta moneda');
  if (!metodo) errores.push('Falta método de pago');
  return errores;
}

export function construirGasto({ fecha, categoria, moneda, monto, montoUSEditable, metodo, detalle, pagador, involucrados, viajerosList, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta, timestamp }) {
  const montoNum = parseFloat(monto);
  const { montoUS, montoOrigen } = resolverMontosGasto({
    monto: montoNum, moneda, metodo, fecha, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta, montoUSEditable
  });
  return {
    fecha,
    categoria,
    moneda,
    monto: montoNum,
    montoUS,
    montoOrigen,
    monedaOrigen,
    metodo,
    detalle: detalle || '',
    pagador: pagador || 'Sin asignar',
    involucrados: (involucrados && involucrados.length) ? involucrados : (viajerosList && viajerosList.length ? viajerosList : ['Sin asignar']),
    timestamp: timestamp || 'TIMESTAMP'
  };
}

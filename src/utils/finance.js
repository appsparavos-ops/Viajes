/**
 * finance.js — Lógica financiera pura (antes esparcida en 300+ líneas dentro de finanzas)
 * Mejoras: sin DOM, sin localStorage, cotización inyectada, testeable.
 */

export function obtenerTasaMoneda({ metodo, fecha, moneda, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta }) {
  if (moneda === 'US$') return 1;
  // Helper para decodificar si vienen con keys encodeadas
  const decode = (obj) => obj || {};

  if (metodo === 'Efectivo') {
    const ef = decode(cotizacionesEfectivo);
    if (ef[moneda] != null) return parseFloat(ef[moneda]);
    if (moneda === 'AR$' && ef.ar_por_us != null) return parseFloat(ef.ar_por_us);
    if (moneda === monedaOrigen && ef.uy_por_us != null) return parseFloat(ef.uy_por_us);
    if (ef[moneda] != null) return parseFloat(ef[moneda]);
    return 1;
  } else {
    // Tarjeta: buscar por fecha exacta o más cercana <= fecha
    if (cotizacionesTarjeta) {
      let cotFecha = cotizacionesTarjeta[fecha];
      if (!cotFecha) {
        const fechas = Object.keys(cotizacionesTarjeta).sort();
        const ant = fechas.filter(f => f <= fecha);
        if (ant.length > 0) cotFecha = cotizacionesTarjeta[ant[ant.length - 1]];
        else if (fechas.length > 0) cotFecha = cotizacionesTarjeta[fechas[0]];
      }
      const cf = decode(cotFecha);
      if (cf) {
        if (cf[moneda] != null) return parseFloat(cf[moneda]);
        if (moneda === 'AR$' && cf.ar_por_us != null) return parseFloat(cf.ar_por_us);
        if (moneda === monedaOrigen && cf.uy_por_us != null) return parseFloat(cf.uy_por_us);
      }
    }
    // fallback a efectivo
    return obtenerTasaMoneda({ metodo: 'Efectivo', fecha, moneda, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta });
  }
}

export function calcularMontoUS({ monto, moneda, metodo, fecha, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta }) {
  const m = parseFloat(monto);
  if (isNaN(m) || m <= 0) return null;
  if (moneda === 'US$') return Math.round(m * 100) / 100;
  const tasa = obtenerTasaMoneda({ metodo, fecha, moneda, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta });
  const us = tasa > 0 ? (m / tasa) : m;
  return Math.round(us * 100) / 100;
}

export function calcularMontoOrigen({ montoUS, moneda, monedaOrigen, metodo, fecha, cotizacionesEfectivo, cotizacionesTarjeta }) {
  const us = parseFloat(montoUS);
  if (isNaN(us)) return null;
  if (moneda === monedaOrigen) {
    // si ya es origen, el monto original es el de origen
    // esta función se usa cuando se conoce US y se quiere origen
    // para moneda != origen, convierto US -> origen
    // la tasa es origen por US
  }
  const tasaOrigen = obtenerTasaMoneda({ metodo, fecha, moneda: monedaOrigen, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta });
  if (moneda === monedaOrigen) return Math.round(parseFloat(montoUS) * (tasaOrigen > 0 ? 1 : 1) * 100) / 100; // fallback
  // En el código original: montoOrigen = tasaOrigen * montoUS
  return Math.round(us * (tasaOrigen > 0 ? tasaOrigen : 1) * 100) / 100;
}

// Versión completa usada en guardarGasto (reproduce lógica original exacta)
export function resolverMontosGasto({ monto, moneda, metodo, fecha, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta, montoUSEditable }) {
  let montoUS = montoUSEditable != null && !isNaN(parseFloat(montoUSEditable)) && parseFloat(montoUSEditable) > 0
    ? parseFloat(montoUSEditable)
    : null;
  if (montoUS == null) {
    const tasa = obtenerTasaMoneda({ metodo, fecha, moneda, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta });
    montoUS = (moneda === 'US$') ? monto : (tasa > 0 ? monto / tasa : monto);
  }
  montoUS = Math.round(montoUS * 100) / 100;

  const tasaOrigen = obtenerTasaMoneda({ metodo, fecha, moneda: monedaOrigen, monedaOrigen, cotizacionesEfectivo, cotizacionesTarjeta });
  let montoOrigen;
  if (moneda === monedaOrigen) montoOrigen = monto;
  else montoOrigen = tasaOrigen > 0 ? montoUS * tasaOrigen : montoUS;
  montoOrigen = Math.round(montoOrigen * 100) / 100;

  return { montoUS, montoOrigen };
}

export function dividirGastoEquitativamente(montoUS, involucrados) {
  if (!involucrados || involucrados.length === 0) return {};
  const porPersona = Math.round((montoUS / involucrados.length) * 100) / 100;
  const result = {};
  involucrados.forEach(p => result[p] = porPersona);
  // Ajuste por redondeo: asignar residuo al primero
  const totalAsignado = porPersona * involucrados.length;
  const residuo = Math.round((montoUS - totalAsignado) * 100) / 100;
  if (residuo !== 0) result[involucrados[0]] = Math.round((porPersona + residuo) * 100) / 100;
  return result;
}

export function formatearMonto(n) {
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false });
}

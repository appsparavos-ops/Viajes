/**
 * generar-capturas-pwa.js — Capturas para el campo "screenshots" de los manifiestos.
 * Chrome/Edge las muestran en el diálogo de instalación (Android y Windows).
 * Medidas exactas: 1280x720 (wide) y 412x915 (narrow).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8000';
const OUT = path.join(__dirname, 'repo', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MEDIDAS = [
  { sufijo: 'wide', width: 1280, height: 720 },
  { sufijo: 'narrow', width: 412, height: 915 }
];

(async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  // IMPORTANTE: ?user=_borrador_local fuerza el modo borrador, así las capturas
  // muestran datos de EJEMPLO y nunca el contenido real de la cuenta del usuario
  // (estas imágenes se publican en el repo y las muestra Chrome al instalar).
  for (const app of [
    { id: 'bitacora', url: '/bitacora/index.html?user=_borrador_local', espera: 6000, tab: null },
    { id: 'panel', url: '/panel/index.html?user=_borrador_local', espera: 6000, tab: '#btn-entradas' }
  ]) {
    for (const m of MEDIDAS) {
      const ctx = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('travelapp_modo_borrador', '1');
          localStorage.setItem('travelapp_active_user', '_borrador_local');
          // Viaje de ejemplo con un día escrito, para que la captura muestre la app en uso.
          localStorage.setItem('travelapp__borrador_local_viajes_cache', JSON.stringify([
            { id: 'demo', titulo: 'Ruta 40', activo: true, createdAt: 1 }
          ]));
          localStorage.setItem('travelapp__borrador_local_last_viaje_id', JSON.stringify('demo'));
          localStorage.setItem('travelapp__borrador_local_viajedata_demo', JSON.stringify({
            dias: [
              { id: 'd1', numero: 1, fecha: '2026-09-09', destino: 'Fray Bentos', titulo: 'Primera etapa',
                recorrido: 'Montevideo → Fray Bentos, 310 km por la 3',
                contenido: 'Salimos temprano con el mate listo. La ruta 3 estaba impecable y el campo verde después de las lluvias.\n\nParamos a almorzar en Mercedes y llegamos a Fray Bentos con sol bajo. El primer día de viaje siempre tiene algo de vértigo: todavía no caemos de que arrancamos.' },
              { id: 'd2', numero: 2, fecha: '2026-09-10', destino: 'Paysandú',
                recorrido: 'Fray Bentos → Paysandú, 120 km',
                contenido: 'Mañana de museo: el frigorífico y su historia. Después, termas y un atardecer enorme sobre el río Uruguay.' }
            ],
            gastos: [], comentarios: [], configuracion: { viajeros: ['Arturo', 'Marta'], monedas_gasto: ['UY$', 'US$'] }, cotizaciones: {}
          }));
        } catch (e) {}
      });
      const p = await ctx.newPage();
      await p.goto(BASE + app.url, { waitUntil: 'load', timeout: 45000 });
      await p.waitForTimeout(app.espera);
      if (app.tab) {
        await p.click(app.tab).catch(() => {});
        await p.waitForTimeout(2500);
      }
      // Sin el botón flotante: la captura es de la app, no del instalador.
      await p.evaluate(() => { const b = document.getElementById('pwa-btn-instalar'); if (b) b.remove(); });
      const destino = path.join(OUT, `${app.id}-${m.sufijo}.png`);
      await p.screenshot({ path: destino });
      console.log(`  ${app.id}-${m.sufijo}.png  ${m.width}x${m.height}  ${Math.round(fs.statSync(destino).size / 1024)} KB`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('\nCapturas en screenshots/');
})();

/**
 * pwa-install.js — Instalación de las dos apps del ecosistema Viajes.
 *
 * Uso (una sola línea por página):
 *   <script src="pwa-install.js" data-app="bitacora" defer></script>   // viaje.html
 *   <script src="pwa-install.js" data-app="panel"    defer></script>   // viaje-admin / presupuesto / scanner
 *
 * Qué hace:
 *   1. Registra el service worker (sw.js) — requisito para que la app sea instalable.
 *   2. Escucha `beforeinstallprompt` (Chrome/Edge/Android) y muestra una barra con
 *      botón "Instalar". El navegador sólo dispara ese evento si la app cumple los
 *      requisitos (manifest + íconos 192/512 + SW + HTTPS).
 *   3. En iPhone/iPad no existe ese evento: muestra la instrucción de Compartir →
 *      "Agregar a pantalla de inicio".
 *   4. No muestra nada si la app ya se está usando instalada (modo standalone).
 *
 * El usuario puede ocultar la barra: se recuerda por app en localStorage.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const APP = (script && script.dataset.app) === 'bitacora' ? 'bitacora' : 'panel';
  const CONF = {
    bitacora: { nombre: 'Bitácora de Viaje', color: '#b45309', icono: 'icons/bitacora-192.png' },
    panel: { nombre: 'Panel de Viaje', color: '#0f172a', icono: 'icons/panel-192.png' }
  }[APP];
  const CLAVE_OCULTO = 'pwa_barra_oculta_' + APP;

  const ua = navigator.userAgent || '';
  const esIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
  const esSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
  const enAppInstalada =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.indexOf('android-app://') === 0;

  const oculto = (() => { try { return localStorage.getItem(CLAVE_OCULTO) === '1'; } catch (e) { return false; } })();

  /* ---------------------------------------------------------- 1) service worker */
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'file:') {
      // En file:// el SW no aplica y además estorba: se desregistra cualquier resto.
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    } else {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then(reg => {
            console.info('[PWA] service worker listo para', APP, '→', reg.scope);
            // Si hay una versión nueva esperando, se activa sin pedir nada al usuario.
            reg.addEventListener('updatefound', () => {
              const nuevo = reg.installing;
              if (!nuevo) return;
              nuevo.addEventListener('statechange', () => {
                if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                  console.info('[PWA] actualización descargada — se aplicará al reabrir');
                }
              });
            });
          })
          .catch(err => console.warn('[PWA] no se pudo registrar el service worker:', err));
      });
    }
  }

  /* ------------------------------------------------------------- 2) la barra */
  function crearBarra(modo) {
    if (document.getElementById('pwa-barra')) return;
    const barra = document.createElement('div');
    barra.id = 'pwa-barra';
    barra.setAttribute('role', 'dialog');
    barra.setAttribute('aria-label', 'Instalar ' + CONF.nombre);
    barra.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(16px + env(safe-area-inset-bottom,0px))', 'z-index:2147483000',
      'display:flex', 'align-items:center', 'gap:12px',
      'max-width:min(94vw,460px)', 'padding:10px 12px',
      'background:#ffffff', 'color:#1c1917',
      'border:1px solid rgba(0,0,0,.08)', 'border-radius:16px',
      'box-shadow:0 12px 32px rgba(0,0,0,.22)',
      'font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    ].join(';');

    const icono = document.createElement('img');
    icono.src = CONF.icono;
    icono.alt = '';
    icono.width = 40; icono.height = 40;
    icono.style.cssText = 'border-radius:11px;flex:0 0 auto;display:block';

    const texto = document.createElement('div');
    texto.style.cssText = 'flex:1 1 auto;min-width:0';
    texto.innerHTML = modo === 'ios'
      ? '<strong style="display:block;font-size:13.5px">Instalar ' + CONF.nombre + '</strong>' +
        '<span style="color:#57534e;font-size:12.5px">Tocá <strong>Compartir</strong> ⬆️ y luego <strong>«Agregar a pantalla de inicio»</strong>.</span>'
      : '<strong style="display:block;font-size:13.5px">Instalar ' + CONF.nombre + '</strong>' +
        '<span style="color:#57534e;font-size:12.5px">Queda como una app, con ícono propio y funciona sin conexión.</span>';

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Instalar';
    boton.style.cssText = 'flex:0 0 auto;border:0;cursor:pointer;font:inherit;font-weight:700;' +
      'color:#fff;background:' + CONF.color + ';padding:9px 14px;border-radius:11px';

    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'No mostrar de nuevo');
    cerrar.innerHTML = '&times;';
    cerrar.style.cssText = 'flex:0 0 auto;border:0;background:transparent;cursor:pointer;' +
      'font-size:20px;line-height:1;color:#a8a29e;padding:2px 4px';

    function olvidar() {
      try { localStorage.setItem(CLAVE_OCULTO, '1'); } catch (e) {}
      barra.remove();
    }
    cerrar.addEventListener('click', olvidar);
    if (modo === 'ios') boton.style.display = 'none';

    barra.append(icono, texto, boton, cerrar);
    document.body.appendChild(barra);
    return barra;
  }

  /* --------------------------------------------- 3) evento de instalación real */
  window.addEventListener('beforeinstallprompt', evento => {
    evento.preventDefault();
    window.__pwaPrompt = evento;              // queda disponible para instalarPWA()
    if (enAppInstalada || oculto) return;
    crearBarra('chrome');
  });

  window.addEventListener('appinstalled', () => {
    console.info('[PWA] app instalada');
    window.__pwaPrompt = null;
    const barra = document.getElementById('pwa-barra');
    if (barra) barra.remove();
  });

  /* Instalación manual (por si querés un botón propio): window.instalarPWA() */
  window.instalarPWA = async function () {
    const prompt = window.__pwaPrompt;
    if (!prompt) {
      alert('Para instalar: abrí el menú del navegador (⋮ o Compartir) y elegí «Instalar app» / «Agregar a pantalla de inicio».');
      return false;
    }
    prompt.prompt();
    const eleccion = await prompt.userChoice;
    window.__pwaPrompt = null;
    if (eleccion && eleccion.outcome === 'accepted') {
      const barra = document.getElementById('pwa-barra');
      if (barra) barra.remove();
      return true;
    }
    return false;
  };

  /* ------------------------------------------------------ 4) botón de la barra */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('#pwa-barra button');
    if (b && b.textContent === 'Instalar') window.instalarPWA();
  });

  /* ------------------------------------------------------ 4) aviso para iOS */
  window.addEventListener('load', () => {
    if (enAppInstalada || oculto) return;
    if (esIOS && esSafari && !window.__pwaPrompt) {
      setTimeout(() => crearBarra('ios'), 1500);
    }
  });
})();

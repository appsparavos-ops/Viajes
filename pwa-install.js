/**
 * pwa-install.js — Instalación de las dos apps del ecosistema Viajes.
 *
 * Uso (una sola línea por página):
 *   <script src="../pwa-install.js" data-app="bitacora" defer></script>   // bitacora/index.html
 *   <script src="../pwa-install.js" data-app="panel"    defer></script>   // panel/index.html, presupuesto, scanner
 *
 * Qué hace:
 *   1. Registra el service worker (sw.js, en la raíz del sitio) — requisito para que la
 *      app sea instalable. Las rutas de abajo se calculan desde la ubicación de ESTE
 *      archivo, no desde la página: así funciona igual desde /bitacora/ y desde /panel/.
 *   2. Muestra un BOTÓN FLOTANTE "Instalar" en la esquina inferior derecha de la
 *      pantalla, presente en TODAS las páginas de la app:
 *        • bitacora/index.html            → instala la Bitácora
 *        • panel/index.html + presupuesto + scanner → instala el Panel
 *   3. Al tocarlo: si el navegador ya ofreció la instalación (Chrome/Edge/Android),
 *      abre el diálogo nativo. Si no (Safari, Firefox, Chrome sin engagement),
 *      despliega los pasos exactos según la plataforma.
 *   4. Se oculta solo si la app ya está instalada (modo standalone / app nativa).
 *   5. "No mostrar más" lo esconde de forma permanente para esa app (clave `pwa_*`,
 *      que el limpiador de datos offline respeta). Se puede recuperar con
 *      window.mostrarBotonInstalar() o borrando esa clave.
 *
 * API disponible en la página:
 *   window.instalarPWA()          → dispara la instalación (o muestra los pasos)
 *   window.mostrarBotonInstalar() → vuelve a mostrar el botón flotante
 *   window.ocultarBotonInstalar() → lo esconde (no permanente)
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const APP = (script && script.dataset.app) === 'bitacora' ? 'bitacora' : 'panel';

  /* Carpeta donde vive ESTE archivo (la raíz del sitio), no la de la página que lo
     carga: las dos apps viven en carpetas distintas (/bitacora/ y /panel/) y el service
     worker y los íconos están en la raíz. Se calcula con script.src para no depender
     de la profundidad de la página. */
  const BASE = (function () {
    try { return new URL('.', script.src).href; }               // http(s)
    catch (e) { return location.href.replace(/[^/]*([?#].*)?$/, ''); }
  })();

  const CONF = {
    bitacora: { nombre: 'Bitácora de Viaje', corto: 'Bitácora', color: '#b45309', hover: '#92400e', icono: BASE + 'icons/bitacora-192.png' },
    panel: { nombre: 'Panel de Viaje', corto: 'Panel', color: '#0f172a', hover: '#1e293b', icono: BASE + 'icons/panel-192.png' }
  }[APP];
  const CLAVE_OCULTO = 'pwa_boton_oculto_' + APP;

  /* ------------------------------------------------------------ estado */
  const oculto = () => { try { return localStorage.getItem(CLAVE_OCULTO) === '1'; } catch (e) { return false; } };
  const recordarOculto = v => { try { v ? localStorage.setItem(CLAVE_OCULTO, '1') : localStorage.removeItem(CLAVE_OCULTO); } catch (e) {} };

  function esAppInstalada() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
      if (window.navigator.standalone === true) return true;
      if (document.referrer.indexOf('android-app://') === 0) return true;
    } catch (e) {}
    return false;
  }

  function plataforma() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) {
      if (/SamsungBrowser/i.test(ua)) return 'samsung';
      if (/Firefox|FxiOS/i.test(ua)) return 'firefox-movil';
      return 'android';
    }
    if (/Firefox/i.test(ua)) return 'firefox';
    if (/Edg\//i.test(ua)) return 'edge';
    if (/Chrome|Chromium|CriOS/i.test(ua)) return 'chrome';
    return 'otro';
  }

  /** Pasos para instalar a mano, según dónde se esté abriendo la app. */
  function pasosInstalacion() {
    switch (plataforma()) {
      case 'ios':
        return ['Tocá el botón <strong>Compartir</strong> ⬆️ (abajo, en Safari).',
                'Elegí <strong>«Agregar a pantalla de inicio»</strong>.',
                'Confirmá con <strong>Agregar</strong>: queda el ícono en tu teléfono.'];
      case 'android':
        return ['Abrí el menú <strong>⋮</strong> de Chrome (arriba a la derecha).',
                'Elegí <strong>«Instalar aplicación»</strong> (o «Agregar a pantalla de inicio»).',
                'Confirmá con <strong>Instalar</strong>.'];
      case 'samsung':
        return ['Abrí el menú <strong>☰</strong> de Samsung Internet.',
                'Elegí <strong>«Agregar página a»</strong> → <strong>«Pantalla de inicio»</strong>.'];
      case 'firefox-movil':
        return ['Abrí el menú <strong>⋮</strong> de Firefox.',
                'Elegí <strong>«Instalar»</strong> o <strong>«Agregar a pantalla de inicio»</strong>.'];
      case 'firefox':
        return ['Abrí el menú <strong>☰</strong> de Firefox.',
                'Elegí <strong>«Instalar esta aplicación»</strong> (o «Agregar a la barra de herramientas»).'];
      case 'edge':
        return ['Hacé clic en el ícono <strong>⊕</strong> de la barra de direcciones, o abrí el menú <strong>…</strong>.',
                'Elegí <strong>«Aplicaciones» → «Instalar este sitio como aplicación»</strong>.'];
      case 'chrome':
        return ['Hacé clic en el ícono <strong>⊕</strong> de la barra de direcciones, o abrí el menú <strong>⋮</strong>.',
                'Elegí <strong>«Instalar ' + CONF.nombre + '»</strong>.',
                'Confirmá con <strong>Instalar</strong>: queda como ventana propia con su acceso directo.'];
      default:
        return ['Abrí el menú del navegador (⋮ o ☰).',
                'Elegí <strong>«Instalar aplicación»</strong> o <strong>«Agregar a pantalla de inicio»</strong>.'];
    }
  }

  /* ---------------------------------------------------------- 1) service worker */
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'file:') {
      // En file:// el SW no aplica y además estorba: se desregistra cualquier resto.
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    } else {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE })
          .then(reg => {
            console.info('[PWA] service worker listo para', APP, '→', reg.scope);
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

  /* ----------------------------------------------- 2) botón flotante (FAB) */
  let fab = null;
  let popover = null;
  let animacion = null;

  function crearBoton() {
    if (fab || !document.body) return fab;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'pwa-btn-instalar';
    b.title = 'Instalar ' + CONF.nombre;
    b.setAttribute('aria-label', 'Instalar ' + CONF.nombre);
    b.style.cssText = [
      'position:fixed',
      'right:calc(16px + env(safe-area-inset-right,0px))',
      'bottom:calc(16px + env(safe-area-inset-bottom,0px))',
      'z-index:150', // por debajo de los modales del panel (z 200/220/240)
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:11px 18px 11px 14px',
      'border:0', 'border-radius:999px', 'cursor:pointer',
      'background:' + CONF.color, 'color:#fff',
      'font:700 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 6px 18px rgba(0,0,0,.28)',
      'opacity:0', 'transform:translateY(8px)',
      'transition:opacity .25s ease, transform .25s ease, background .15s ease',
      'pointer-events:auto'
    ].join(';');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>';

    const label = document.createElement('span');
    label.textContent = 'Instalar';

    b.append(svg, label);
    b.addEventListener('click', () => window.instalarPWA());
    b.addEventListener('mouseenter', () => { b.style.background = CONF.hover; });
    b.addEventListener('mouseleave', () => { b.style.background = CONF.color; });
    document.body.appendChild(b);
    fab = b;

    requestAnimationFrame(() => {
      b.style.opacity = '1';
      b.style.transform = 'translateY(0)';
    });
    return b;
  }

  function quitarBoton() {
    if (popover) { popover.remove(); popover = null; }
    if (animacion) { clearInterval(animacion); animacion = null; }
    if (fab) { fab.remove(); fab = null; }
  }

  /** Llamada de atención suave, 3 veces, respetando "reducir movimiento". */
  function sugerir() {
    if (!fab) return;
    let reducido = false;
    try { reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reducido) return;
    let veces = 0;
    animacion = setInterval(() => {
      if (!fab) { clearInterval(animacion); return; }
      fab.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
        { duration: 600, easing: 'ease-in-out' }
      );
      if (++veces >= 3) { clearInterval(animacion); animacion = null; }
    }, 4000);
  }

  /* --------------------------------------------- 3) instrucciones a mano */
  function abrirInstrucciones() {
    if (popover) { popover.remove(); popover = null; return; }
    const p = document.createElement('div');
    p.id = 'pwa-popover-instalar';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Cómo instalar ' + CONF.nombre);
    p.style.cssText = [
      'position:fixed',
      'right:calc(16px + env(safe-area-inset-right,0px))',
      'bottom:calc(76px + env(safe-area-inset-bottom,0px))',
      'z-index:151',
      'width:min(340px,calc(100vw - 32px))',
      'background:#fff', 'color:#1c1917',
      'border:1px solid rgba(0,0,0,.08)', 'border-radius:16px',
      'box-shadow:0 18px 40px rgba(0,0,0,.28)',
      'font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'overflow:hidden'
    ].join(';');

    const cabecera = document.createElement('div');
    cabecera.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #f1f0ee';
    const icono = document.createElement('img');
    icono.src = CONF.icono; icono.alt = ''; icono.width = 34; icono.height = 34;
    icono.style.cssText = 'border-radius:9px;flex:0 0 auto;display:block';
    const titulo = document.createElement('div');
    titulo.style.cssText = 'flex:1 1 auto;min-width:0';
    titulo.innerHTML = '<strong style="display:block;font-size:13.5px">Instalar ' + CONF.nombre + '</strong>' +
                       '<span style="color:#78716c;font-size:12px">Queda como una app, con su ícono y sin conexión.</span>';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.innerHTML = '&times;';
    cerrar.setAttribute('aria-label', 'Cerrar');
    cerrar.style.cssText = 'border:0;background:transparent;cursor:pointer;font-size:22px;line-height:1;color:#a8a29e;padding:0 2px';
    cerrar.addEventListener('click', () => { p.remove(); popover = null; });
    cabecera.append(icono, titulo, cerrar);

    const cuerpo = document.createElement('div');
    cuerpo.style.cssText = 'padding:12px 14px';
    const lista = document.createElement('ol');
    lista.style.cssText = 'margin:0;padding-left:20px;display:grid;gap:7px;font-size:13px';
    pasosInstalacion().forEach(txt => {
      const li = document.createElement('li');
      li.innerHTML = txt;
      lista.appendChild(li);
    });
    cuerpo.appendChild(lista);

    const pie = document.createElement('div');
    pie.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;background:#fafaf9;border-top:1px solid #f1f0ee';
    const nunca = document.createElement('button');
    nunca.type = 'button';
    nunca.textContent = 'No mostrar más';
    nunca.style.cssText = 'border:0;background:transparent;cursor:pointer;color:#78716c;font-size:12px;text-decoration:underline;padding:4px 0';
    nunca.addEventListener('click', () => { recordarOculto(true); quitarBoton(); });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Entendido';
    ok.style.cssText = 'border:0;cursor:pointer;background:' + CONF.color + ';color:#fff;font-weight:700;font-size:12.5px;padding:8px 14px;border-radius:9px';
    ok.addEventListener('click', () => { p.remove(); popover = null; });
    pie.append(nunca, ok);

    p.append(cabecera, cuerpo, pie);
    document.body.appendChild(p);
    popover = p;

    // Cierre al tocar afuera
    setTimeout(() => {
      const afuera = ev => {
        if (!popover) { document.removeEventListener('click', afuera, true); return; }
        if (popover.contains(ev.target) || (fab && fab.contains(ev.target))) return;
        popover.remove(); popover = null;
        document.removeEventListener('click', afuera, true);
      };
      document.addEventListener('click', afuera, true);
    }, 0);
  }

  /* ------------------------------------- 4) eventos de instalación nativos */
  window.addEventListener('beforeinstallprompt', evento => {
    evento.preventDefault();
    window.__pwaPrompt = evento;   // queda listo para instalarPWA()
  });

  window.addEventListener('appinstalled', () => {
    console.info('[PWA] app instalada');
    window.__pwaPrompt = null;
    quitarBoton();
  });

  /* API pública */
  window.instalarPWA = async function () {
    const prompt = window.__pwaPrompt;
    if (!prompt) { abrirInstrucciones(); return false; }   // sin diálogo nativo: pasos a mano
    prompt.prompt();
    const eleccion = await prompt.userChoice;
    window.__pwaPrompt = null;
    if (eleccion && eleccion.outcome === 'accepted') { quitarBoton(); return true; }
    return false;
  };
  window.mostrarBotonInstalar = function () { recordarOculto(false); if (!esAppInstalada()) crearBoton(); };
  window.ocultarBotonInstalar = function () { quitarBoton(); };

  /* ------------------------------------------------ 5) aparición del botón */
  window.addEventListener('load', () => {
    if (esAppInstalada() || oculto()) return;
    setTimeout(() => {
      if (esAppInstalada() || oculto()) return;
      crearBoton();
      sugerir();
    }, 1200);
  });

  // Si la app se instala y sigue abierta la pestaña, el botón se retira solo.
  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    const alCambiar = () => { if (esAppInstalada()) quitarBoton(); };
    mq.addEventListener ? mq.addEventListener('change', alCambiar) : mq.addListener(alCambiar);
  } catch (e) {}
})();

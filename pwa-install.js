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
 *   window.instalarPWA()                 → dispara la instalación (o muestra los pasos)
 *   window.mostrarBotonInstalar()        → vuelve a mostrar el botón flotante
 *   window.ocultarBotonInstalar()        → lo esconde (no permanente)
 *   window.buscarActualizacionDeLaApp(t) → busca actualizaciones ya (botón del Panel)
 *   window.ViajesActualizacion.buscar()  → lo mismo, con API más prolija
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
  /* ------------------------------------------- 1) service worker + AUTO-ACTUALIZACIÓN
   *
   * La app descargada se actualiza sola, sin que el usuario haga nada:
   *   a) Al abrir la página (y al volver a ella: cambiar de pestaña, desbloquear el
   *      teléfono, abrir la app instalada desde el ícono) se le pregunta al service
   *      worker si hay archivos nuevos en la web.
   *   b) Si hay algo nuevo, el service worker baja la versión nueva a la caché y
   *      avisa; acá se muestra «Actualizando…» y se recarga UNA vez, sola.
   *   c) Si además cambió sw.js, el navegador instala el nuevo y, al activarse,
   *      también se recarga sola (una sola vez).
   * Guardas anti-bucle: nunca se recarga dos veces seguidas por actualización en menos
   * de 15 s, ni se recarga si no hay cambios. Sin internet no se toca nada.
   */
  const CLAVE_RECARGA = 'travelapp_recarga_por_actualizacion';
  const CLAVE_DESCARTADA = 'travelapp_actualizacion_pospuesta';
  const CLAVE_CUENTA = 'travelapp_recargas_por_actualizacion';
  const MAX_RECARGAS_SESION = 5;      // tope de recargas automáticas por sesión (anti-bucle)
  let registroSW = null;
  let ultimoChequeo = 0;
  let pendienteAviso = false;
  let recargando = false;

  function mostrarAviso(texto) {
    if (typeof window.toast === 'function') { try { window.toast(texto); return; } catch (e) {} }
    try {
      let av = document.getElementById('pwa-aviso-actualizacion');
      if (!av) {
        av = document.createElement('div');
        av.id = 'pwa-aviso-actualizacion';
        av.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);' +
          'bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:160;background:#1c1917;color:#fff;' +
          'padding:10px 18px;border-radius:999px;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
        document.body.appendChild(av);
      }
      av.textContent = texto;
      av.style.display = 'block';
      clearTimeout(av._t);
      av._t = setTimeout(() => { av.style.display = 'none'; }, 4000);
    } catch (e) {}
  }

  /** ¿El usuario tiene algo a medio escribir? (para no recargar y borrarle el texto) */
  function hayTrabajoSinGuardar() {
    try {
      const campos = document.querySelectorAll('textarea, input[type="text"], input[type="number"]');
      for (const el of campos) {
        if (el.readOnly || el.disabled || el.offsetParent === null) continue;   // solo campos visibles
        /* Solo cuenta si el valor CAMBIÓ respecto del que traía la página: así los campos
           precargados (moneda UY$, monedas del viaje…) no bloquean la actualización. */
        const valor = String(el.value || '');
        if (valor !== String(el.defaultValue === undefined ? '' : el.defaultValue) && valor.trim().length > 3) return true;
      }
    } catch (e) {}
    return false;
  }

  /** Cartel discreto: hay versión nueva pero no recargamos para no interrumpir. */
  function mostrarCartelActualizacion(motivo) {
    try {
      if (document.getElementById('pwa-cartel-actualizacion')) return;
      const c = document.createElement('div');
      c.id = 'pwa-cartel-actualizacion';
      c.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);' +
        'bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:165;display:flex;align-items:center;gap:10px;' +
        'background:#1c1917;color:#fff;padding:10px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.3);' +
        'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:92vw';
      c.innerHTML = '<span>✨ Hay una versión nueva de la app</span>';
      const bSi = document.createElement('button');
      bSi.type = 'button';
      bSi.textContent = 'Actualizar';
      bSi.style.cssText = 'border:0;border-radius:999px;padding:6px 12px;background:#f59e0b;color:#fff;font:700 13px system-ui;cursor:pointer';
      bSi.onclick = () => aplicarRecarga(motivo || 'a pedido');
      const bNo = document.createElement('button');
      bNo.type = 'button';
      bNo.textContent = 'Después';
      bNo.style.cssText = 'border:0;background:transparent;color:#d6d3d1;font:600 13px system-ui;cursor:pointer';
      bNo.onclick = () => {
        try { sessionStorage.setItem(CLAVE_DESCARTADA, '1'); } catch (e) {}
        c.remove();
      };
      c.appendChild(bSi); c.appendChild(bNo);
      document.body.appendChild(c);
    } catch (e) {}
  }

  function aplicarRecarga(motivo) {
    if (recargando) return false;
    recargando = true;
    try {
      sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
      sessionStorage.setItem(CLAVE_CUENTA, String((Number(sessionStorage.getItem(CLAVE_CUENTA)) || 0) + 1));
    } catch (e) {}
    console.info('[PWA] aplicando actualización (' + motivo + ') y recargando…');
    mostrarAviso('Actualizando la app…');
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 450);
    return true;
  }

  /**
   * Decide qué hacer cuando se detectó una versión nueva:
   *   · Si estás escribiendo algo (relato, gasto…) o ya dijiste «Después»: cartel, sin tocar nada.
   *   · Si no: recarga sola, una sola vez (con guarda de 15 s para no entrar en bucle).
   */
  function recargarUnaVez(motivo) {
    if (recargando) return false;
    let ultima = 0, descartada = false, cuenta = 0;
    try {
      ultima = Number(sessionStorage.getItem(CLAVE_RECARGA)) || 0;
      descartada = sessionStorage.getItem(CLAVE_DESCARTADA) === '1';
      cuenta = Number(sessionStorage.getItem(CLAVE_CUENTA)) || 0;
    } catch (e) {}

    if (descartada) { console.info('[PWA] actualización pospuesta por el usuario'); return false; }

    /* 1º: si estás escribiendo algo, NUNCA se recarga (podrías perder el texto):
       se avisa con un cartel y la decisión es tuya. */
    if (hayTrabajoSinGuardar()) {
      console.info('[PWA] hay texto sin guardar: no se recarga, se avisa con un cartel');
      mostrarCartelActualizacion(motivo);
      return false;
    }

    /* 2º: guardas anti-bucle — no encadenar recargas ni pasarse del tope por sesión. */
    if (Date.now() - ultima < 5000) {
      console.info('[PWA] hubo una recarga hace instantes; no se repite por ahora:', motivo);
      return false;
    }
    if (cuenta >= MAX_RECARGAS_SESION) {
      console.info('[PWA] ya se aplicaron ' + cuenta + ' actualizaciones en esta sesión; no se recarga más solo');
      return false;
    }
    return aplicarRecarga(motivo);
  }

  function pintarEstadoActualizacion(extra) {
    const el = document.getElementById('estado-actualizacion');
    if (!el) return;
    el.textContent = extra || 'La app se actualiza sola al abrirla.';
  }

  /** Pregunta si hay cambios. forzar=true salta el intervalo mínimo (botón manual). */
  function buscarActualizacion(forzar, avisarSiNoHay) {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return Promise.resolve(false);
    if (!forzar && Date.now() - ultimoChequeo < 60000) return Promise.resolve(false);   // como máximo 1 vez por minuto
    ultimoChequeo = Date.now();
    if (avisarSiNoHay) pendienteAviso = true;

    if (!forzar) {
      // Sin apuro: dejamos que el SW compare huellas (y de paso vea si cambió sw.js).
      try {
        const c = navigator.serviceWorker.controller;
        if (c) { c.postMessage({ tipo: 'buscar-cambios' }); return Promise.resolve(true); }
      } catch (e) {}
    }
    const tareas = [];
    if (registroSW) tareas.push(registroSW.update().catch(() => {}));   // ¿hay sw.js nuevo?
    tareas.push(Promise.resolve().then(() => {
      const c = navigator.serviceWorker.controller;
      if (c) c.postMessage({ tipo: 'buscar-cambios' });
    }));
    return Promise.all(tareas).then(() => true, () => false);
  }

  if ('serviceWorker' in navigator) {
    if (location.protocol === 'file:') {
      // En file:// el SW no aplica y además estorba: se desregistra cualquier resto.
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    } else {
      const huboControladorPrevio = !!navigator.serviceWorker.controller;

      navigator.serviceWorker.addEventListener('message', ev => {
        const d = ev.data || {};
        if (d.tipo === 'contenido-nuevo') {
          recargarUnaVez('archivos nuevos en la web');
        } else if (d.tipo === 'al-dia') {
          if (pendienteAviso) {
            pendienteAviso = false;
            mostrarAviso('Ya tenés la última versión (' + (d.version || '') + ')');
          }
          pintarEstadoActualizacion('Todo al día · ' + (d.version || ''));
        } else if (d.tipo === 'actualizado') {
          pintarEstadoActualizacion('Se encontraron cambios…');
        } else if (d.tipo === 'version') {
          pintarEstadoActualizacion('Última versión: ' + (d.version || '?'));
        } else if (d.tipo === 'sin-conexion') {
          if (pendienteAviso) { pendienteAviso = false; mostrarAviso('Sin conexión: no se pudo buscar actualizaciones'); }
        }
      });

      /* Cuando el navegador reemplaza el service worker (sw.js cambió), se activa al
         instante y esta recarga deja todo coherente. Solo si YA había uno: en la
         primera instalación no se recarga (no hace falta). */
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (huboControladorPrevio) recargarUnaVez('service worker actualizado');
      });

      window.addEventListener('load', () => {
        navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE, updateViaCache: 'none' })
          .then(reg => {
            registroSW = reg;
            console.info('[PWA] service worker listo para', APP, '→', reg.scope);
            reg.addEventListener('updatefound', () => {
              const nuevo = reg.installing;
              if (!nuevo) return;
              nuevo.addEventListener('statechange', () => {
                if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                  console.info('[PWA] actualización del service worker descargada');
                }
              });
            });
            // Primera búsqueda de cambios al abrir la app (sin avisar si no hay nada).
            buscarActualizacion(false);
            pintarEstadoActualizacion();
          })
          .catch(err => console.warn('[PWA] no se pudo registrar el service worker:', err));
      });

      /* Al volver a la app (cambiar de pestaña, desbloquear, abrirla desde el ícono)
         se revisa de nuevo: si hubo cambios mientras estaba en segundo plano, se
         recarga sola. */
      const alVolver = () => { if (document.visibilityState === 'visible') buscarActualizacion(false); };
      document.addEventListener('visibilitychange', alVolver);
      window.addEventListener('focus', alVolver);
      window.addEventListener('online', () => buscarActualizacion(false));

      /* Y si la app queda abierta mucho rato, cada 10 minutos se revisa sola
         (siempre con la guarda de «no recargar si estás escribiendo»). */
      setInterval(() => { if (document.visibilityState === 'visible') buscarActualizacion(false); }, 10 * 60 * 1000);
    }
  }

  /* API para la página (y para las pruebas). */
  window.ViajesActualizacion = {
    buscar: avisar => buscarActualizacion(true, !!avisar),
    recargar: motivo => recargarUnaVez(motivo || 'manual'),
    hayTrabajoSinGuardar: hayTrabajoSinGuardar
  };
  // Nombre "en criollo" que usa el botón de Configuración del Panel.
  window.buscarActualizacionDeLaApp = function (avisar) {
    if (avisar) { pendienteAviso = true; mostrarAviso('Buscando actualizaciones…'); }
    return buscarActualizacion(true, !!avisar).then(() => {
      const c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (c) c.postMessage({ tipo: 'version' });
    });
  };

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

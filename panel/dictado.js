/**
 * dictado.js — Micrófono "voz a texto" para el RELATO DEL DÍA del Panel.
 *
 * Agrega un botón 🎤 junto al campo «Relato del día» del formulario de días, que sirve
 * tanto para «Nueva entrada de día» como para «Editar día» (es el mismo formulario).
 *
 * Cómo funciona
 *   · Usa el reconocimiento de voz del propio navegador (Web Speech API). No manda nada a
 *     servidores nuestros ni usa servicios pagos: lo hace el navegador
 *     (Chrome/Edge/Android → Google; Safari/iOS → Apple).
 *   · El texto va apareciendo en el relato MIENTRAS hablás y queda escrito al terminar.
 *   · Se agrega al final del texto que ya haya, sin pisar nada. Si el relato venía
 *     escrito, lo dictado se suma después.
 *   · Pone mayúscula al comenzar y punto al cerrar cada frase (se puede editar a mano).
 *   · Si el navegador corta la escucha solo (pasa cuando hay silencios largos),
 *     se reengancha y sigue. Si falla la red, el permiso o no hay micrófono, lo dice
 *     con un mensaje claro en vez de quedarse mudo.
 *
 * Compatibilidad
 *   · Chrome, Edge y Android: funciona completo.
 *   · Safari 14.1+ / iOS: funciona (el navegador pide permiso la primera vez).
 *   · Firefox: todavía no trae reconocimiento de voz → se muestra un aviso y nada más.
 *   · Necesita internet (el reconocimiento del navegador es en línea).
 *
 * Este archivo se carga desde panel/index.html y NO depende de Tailwind, del bundle ni de
 * Firebase: si no encuentra el campo, no hace nada.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ utilidades */

  /** Navegador que expone reconocimiento de voz (Chrome/Edge = webkit prefijado). */
  function motorDisponible() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /** Idioma del dictado: el del sistema si es español; si no, español de España. */
  function idiomaPreferido() {
    const nav = String(navigator.language || 'es').toLowerCase();
    return nav.indexOf('es') === 0 ? (navigator.language || 'es') : 'es-ES';
  }

  const limpia = t => String(t || '').replace(/\s+/g, ' ').trim();

  /** Primera LETRA en mayúscula (los motores de voz devuelven todo en minúsculas).
   *  Ojo: si la frase empieza con ¿ ¡ " « ( hay que saltear esos signos. */
  function capitaliza(t) {
    const s = String(t || '');
    const i = s.search(/[a-záéíóúüñ]/i);
    if (i < 0) return s;
    return s.slice(0, i) + s.charAt(i).toLocaleUpperCase('es') + s.slice(i + 1);
  }

  /** Cierra la frase con punto si el motor no trajo puntuación propia. */
  function cierraFrase(t) {
    return /[.!?…:;,)»"']$/.test(t) ? t : t + '.';
  }

  /** Prepara una frase dictada: limpia, mayúscula inicial y punto final. */
  function preparaFrase(t) {
    const s = limpia(t);
    return s ? cierraFrase(capitaliza(s)) : '';
  }

  /** Pega un fragmento al final del texto anterior, con un espacio de separación. */
  function pegar(anterior, fragmento) {
    const a = String(anterior || '').replace(/\s+$/, '');
    if (!fragmento) return a;
    if (!a) return fragmento;
    return a + ' ' + fragmento;
  }

  /* ------------------------------------------------------------------ montaje en la página */

  const textarea = document.getElementById('f-contenido');   // «Relato del día *»
  if (!textarea) return;                                      // otra pantalla: no hacemos nada

  /* Estilos propios: así el botón se ve igual aunque cambie el CSS del panel. */
  const estilo = document.createElement('style');
  estilo.textContent = [
    '#dictado-fila{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem}',
    '#dictado-barra{display:inline-flex;align-items:center;gap:.5rem;flex-wrap:wrap}',
    '#btn-dictado{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .85rem;border-radius:9999px;',
    'border:1.5px solid #d97706;background:#fffbeb;color:#b45309;font-size:.78rem;font-weight:600;',
    'cursor:pointer;line-height:1.2;transition:background .15s,color .15s,box-shadow .15s;}',
    '#btn-dictado:hover{background:#fef3c7;}',
    '#btn-dictado.dictado-escuchando{background:#dc2626;border-color:#dc2626;color:#fff;animation:dictado-pulso 1.3s ease-in-out infinite;}',
    '#btn-dictado[disabled]{opacity:.55;cursor:not-allowed;}',
    '@keyframes dictado-pulso{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}',
    '#dictado-estado{font-size:.72rem;color:#6b7280;font-style:italic;margin-top:.25rem;display:block;}',
    '#dictado-estado.dictado-aviso{color:#b45309;font-style:normal;}',
    '#dictado-estado.dictado-error{color:#b91c1c;font-style:normal;}',
    '@media (prefers-reduced-motion: reduce){#btn-dictado.dictado-escuchando{animation:none}}'
  ].join('');
  document.head.appendChild(estilo);

  const boton = document.createElement('button');
  boton.type = 'button';                 // nunca dispara el envío del formulario
  boton.id = 'btn-dictado';
  boton.innerHTML = '<span id="dictado-icono" aria-hidden="true">🎤</span><span id="dictado-texto">Dictar</span>';
  boton.title = 'Dictá el relato en voz alta y el texto se escribe solo';

  const estado = document.createElement('span');
  estado.id = 'dictado-estado';
  estado.setAttribute('role', 'status');
  estado.setAttribute('aria-live', 'polite');

  const cajaRelato = textarea.parentElement || textarea;      // <div class="mb-4">
  try {
    const etiqueta = cajaRelato.querySelector('label');
    if (etiqueta) {
      const fila = document.createElement('div');
      fila.id = 'dictado-fila';
      cajaRelato.insertBefore(fila, etiqueta);
      fila.appendChild(etiqueta);
      etiqueta.classList.remove('mb-1');                    // el margen lo pone la fila
      fila.appendChild(boton);
    } else {
      cajaRelato.insertBefore(boton, textarea);
    }
  } catch (e) {
    cajaRelato.insertBefore(boton, textarea);                // plan B: arriba del cuadro
  }
  cajaRelato.appendChild(estado);                            // el aviso, debajo del cuadro

  /* ------------------------------------------------------------------ motor de dictado */

  let reconocedor = null;
  let grabando = false;          // el usuario quiere estar escuchando
  let escuchando = false;        // el motor está activo en este momento
  let base = '';                 // texto ya confirmado del relato
  let interino = '';             // lo que el motor está oyendo ahora (provisorio)
  let escribiendoNosotros = false;   // para no confundir cambios propios con tecleo del usuario
  let ignorarResultados = false;     // al detener, se descarta el final tardío (evita repetir)
  let reintentos = 0;                // reenganches seguidos por cortes del motor
  let probamosEspanol = false;       // ¿ya probamos bajar el idioma a es-ES?
  let temporizador = null;

  function pintaTexto() {
    const vista = limpia(interino);
    const nuevo = base + (vista ? (base ? ' ' : '') + vista : '');
    if (textarea.value === nuevo) return;
    escribiendoNosotros = true;
    textarea.value = nuevo;
    /* Avisamos al resto de la app por si algún día guarda automáticamente. */
    try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    escribiendoNosotros = false;
    try { textarea.scrollTop = textarea.scrollHeight; } catch (e) {}
  }

  function aviso(texto, tipo) {
    estado.textContent = texto || '';
    estado.className = tipo === 'error' ? 'dictado-error' : (tipo === 'aviso' ? 'dictado-aviso' : '');
  }

  function pintaBoton() {
    const icono = document.getElementById('dictado-icono');
    const texto = document.getElementById('dictado-texto');
    if (icono) icono.textContent = grabando ? '⏹' : '🎤';
    if (texto) texto.textContent = grabando ? 'Detener' : 'Dictar';
    boton.classList.toggle('dictado-escuchando', grabando);
    boton.setAttribute('aria-pressed', grabando ? 'true' : 'false');
    boton.title = grabando ? 'Detener el dictado' : 'Dictá el relato en voz alta y el texto se escribe solo';
  }

  function creaReconocedor() {
    const Motor = motorDisponible();
    if (!Motor) return null;
    const r = new Motor();
    r.lang = idiomaPreferido();
    r.continuous = true;          // no cortar en cada pausa
    r.interimResults = true;      // ver el texto mientras hablás
    r.maxAlternatives = 1;

    r.onstart = () => {
      escuchando = true;
      reintentos = 0;
    };

    r.onresult = (evento) => {
      if (ignorarResultados) return;
      let finales = '';
      let provisional = '';
      for (let i = evento.resultIndex || 0; i < evento.results.length; i++) {
        const frase = evento.results[i][0] ? evento.results[i][0].transcript : '';
        if (evento.results[i].isFinal) finales += ' ' + frase;
        else provisional += ' ' + frase;
      }
      const cerrada = preparaFrase(finales);
      if (cerrada) base = pegar(base, cerrada);
      interino = provisional;
      pintaTexto();
    };

    r.onerror = (e) => {
      const tipo = e && e.error ? e.error : 'desconocido';
      if (tipo === 'no-speech' || tipo === 'aborted') return;      // silencio o corte pedido: se reengancha solo
      if (tipo === 'language-not-supported' && !probamosEspanol) {
        /* Algunos equipos no traen el español local: probamos con español genérico. */
        probamosEspanol = true;
        reconocedor.lang = 'es-ES';
        return;
      }
      if (tipo === 'not-allowed' || tipo === 'service-not-allowed') {
        detener({ silencio: true });
        aviso('El navegador bloqueó el micrófono. Tocá el candado 🔒 de la barra de direcciones y permití «Micrófono».', 'error');
        return;
      }
      if (tipo === 'audio-capture') {
        detener({ silencio: true });
        aviso('No se encontró ningún micrófono conectado.', 'error');
        return;
      }
      if (tipo === 'network') {
        detener({ silencio: true });
        aviso('Sin conexión: el dictado del navegador necesita internet.', 'error');
        return;
      }
      detener({ silencio: true });
      aviso('El dictado se cortó (' + tipo + '). Probá de nuevo.', 'error');
    };

    r.onend = () => {
      escuchando = false;
      ignorarResultados = false;
      if (!grabando) return;
      /* El motor se detiene solo tras unos segundos de silencio: reenganchamos. */
      if (reintentos >= 30) { detener({ silencio: true }); aviso('El dictado se detuvo por inactividad.', 'aviso'); return; }
      reintentos++;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => { if (grabando) { try { r.start(); } catch (e) {} } }, 250);
    };

    return r;
  }

  function iniciar() {
    if (grabando) return;
    if (!motorDisponible()) { aviso('Este navegador no trae dictado por voz. Usá Chrome, Edge o Safari.', 'aviso'); return; }

    base = textarea.value || '';     // arrancamos de lo que ya esté escrito
    interino = '';
    reintentos = 0;
    ignorarResultados = false;

    reconocedor = creaReconocedor();
    if (!reconocedor) { aviso('No se pudo iniciar el dictado.', 'error'); return; }

    try { reconocedor.start(); }
    catch (e) {
      /* start() repetido sin haber terminado: reintentamos al toque. */
      try { reconocedor.stop(); } catch (e2) {}
      setTimeout(() => { if (grabando) { try { reconocedor.start(); } catch (e3) {} } }, 300);
    }

    grabando = true;
    pintaBoton();
    aviso('Escuchando… hablá tranquilo, el texto se va escribiendo solo.');
    textarea.focus();
  }

  /**
   * Detiene el dictado.
   * @param {{silencio?:boolean}} opciones  silencio=true → no tocar el aviso (ya lo puso quien llama)
   */
  function detener(opciones) {
    const yaEstaba = grabando;
    grabando = false;
    clearTimeout(temporizador);

    if (interino) {                      // lo último que se vio en pantalla queda escrito
      base = pegar(base, preparaFrase(interino));
      interino = '';
      pintaTexto();
    }
    if (reconocedor) {
      ignorarResultados = true;          // el motor puede mandar un final tardío: se descarta
      try { reconocedor.stop(); } catch (e) {}
    }
    pintaBoton();
    if (yaEstaba && !(opciones && opciones.silencio)) aviso('Dictado detenido. El texto quedó escrito en el relato.');
  }

  function alternar() { grabando ? detener() : iniciar(); }

  boton.addEventListener('click', alternar);

  /* Si el usuario escribe a mano, el dictado no debe pisar lo que hizo. */
  textarea.addEventListener('input', () => {
    if (escribiendoNosotros) return;
    base = textarea.value || '';
    interino = '';
  });

  /* Cualquier acción del panel (guardar, limpiar, cambiar de pestaña, editar otro día)
     apaga el micrófono: nunca dejamos el navegador grabando de fondo. */
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('button, a') : null;
    if (!t || t === boton) return;
    const accion = t.getAttribute && (t.getAttribute('onclick') || '');
    if (/guardarDia|resetForm|switchTab|eliminarDia|editarDia/.test(accion) && grabando) detener();
  }, true);

  /* Al guardar con el teclado (Enter) o al cambiar de pestaña del sistema, también se apaga. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && grabando) detener();
    if (e.key === 'Escape' && grabando) detener();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && grabando) detener(); });
  window.addEventListener('pagehide', () => { if (grabando) detener({ silencio: true }); });

  /* Estado inicial. */
  if (!motorDisponible()) {
    boton.disabled = true;
    aviso('Dictado no disponible en este navegador (funciona en Chrome, Edge y Safari).', 'aviso');
  }

  /* API mínima para pruebas automáticas y para el resto de la app. */
  window.DictadoRelato = {
    iniciar: iniciar,
    detener: detener,
    alternar: alternar,
    estaGrabando: () => grabando,
    soportado: !!motorDisponible()
  };
})();

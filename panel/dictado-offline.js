/**
 * dictado-offline.js — Dictado SIN CONEXIÓN para el RELATO DEL DÍA del Panel.
 *
 * Viajar es viajar: muchas veces no hay señal. Este archivo agrega un motor de
 * voz a texto que corre COMPLETO EN EL DISPOSITIVO (Whisper, vía Transformers.js),
 * sin servidores ni internet mientras se dicta.
 *
 * Cómo funciona
 *   · Agrega un botón «🌐 Online / 📴 Sin conexión» junto al botón Dictar.
 *     - 🌐 Online (por defecto): usa el reconocimiento del navegador (dictado.js).
 *     - 📴 Sin conexión: usa el motor local. La primera vez descarga el modelo
 *       (~77 MB, una sola vez, queda guardado en el dispositivo); después
 *       funciona sin internet.
 *   · Además, si estás en modo online pero SIN red y el modelo ya está bajado,
 *     pasa solo al motor local (no te deja a pata).
 *   · El motor local no muestra el texto palabra por palabra (el modelo procesa
 *     por bloques de ~10 segundos): el texto va apareciendo en tandas mientras
 *     hablás, y al detener queda todo escrito.
 *   · El texto se agrega al final del relato, con mayúscula inicial y punto,
 *     igual que el dictado online.
 *
 * Archivos que lo acompañan
 *   · dictado-offline-worker.js   → worker donde vive Whisper (no congela la página)
 *   · dictado-offline-worklet.js  → captor del micrófono (AudioWorklet)
 *   · ../lib/transformers.js      → librería de modelos (local, como el resto de lib/)
 *   · ../lib/ort/                 → binario WASM de ONNX Runtime (local)
 *
 * Permisos/soporte: necesita micrófono y un navegador moderno (Chrome, Edge,
 * Safari 15+, Firefox). En iPhone/iPad sin WebGPU va por CPU: es más lento,
 * pero funciona.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ configuración */

  const CLAVE_MODO = 'dictadoRelato.modoOffline';  // preferencia guardada del usuario
  const SEGMENTO_SEG = 10;       // largo máximo del bloque de audio que se transcribe junto
  const SILENCIO_RMS = 0.0035;   // por debajo de este volumen, consideramos silencio
  const MIN_VOZ_MS = 800;        // un bloque con menos voz que esto se descarta
  const PAUSA_FLUSH_MS = 2200;   // tras esta pausa se procesa lo hablado sin esperar

  /* ------------------------------------------------------------------ utilidades
     (las mismas reglas de formato que el dictado online, repetidas a propósito:
      este archivo funciona solo, sin depender de dictado.js) */

  const limpia = t => String(t || '').replace(/\s+/g, ' ').trim();

  function capitaliza(t) {
    const s = String(t || '');
    const i = s.search(/[a-záéíóúüñ]/i);
    if (i < 0) return s;
    return s.slice(0, i) + s.charAt(i).toLocaleUpperCase('es') + s.slice(i + 1);
  }

  function cierraFrase(t) {
    return /[.!?…:;,)»"']$/.test(t) ? t : t + '.';
  }

  function preparaFrase(t) {
    const s = limpia(t);
    return s ? cierraFrase(capitaliza(s)) : '';
  }

  /** Calcula el volumen (RMS) de un bloque de audio. */
  function calcularRMS(bloque) {
    let suma = 0;
    for (let i = 0; i < bloque.length; i++) suma += bloque[i] * bloque[i];
    return Math.sqrt(suma / (bloque.length || 1));
  }

  /** ¿El texto es lo mismo repetido varias veces? (el modelo «loopea» con ruido) */
  function esRepeticion(s) {
    const palabras = s.split(' ');
    if (palabras.length < 8) return false;
    for (let n = 1; n <= Math.floor(palabras.length / 4); n++) {
      const unidad = palabras.slice(0, n).join(' ');
      let esRepite = true;
      for (let i = n; i + n <= palabras.length; i += n) {
        if (palabras.slice(i, i + n).join(' ') !== unidad) { esRepite = false; break; }
      }
      if (esRepite) return true;
    }
    return false;
  }

  /** Whisper «alucina» frases hechas cuando solo hay ruido: las descartamos. */
  function esAlucinacion(t) {
    const s = limpia(t).toLowerCase();
    if (!s) return true;
    if (esRepeticion(s)) return true;
    if (s.length > 80) return false;
    return /^(gracias|thank|subt[ií]tulos|subtitles|por favor,? (suscr|like)|te ha gustado)/i.test(s);
  }

  /** Remuestrea un bloque de audio a 16 kHz (lo que pide Whisper). */
  async function a16k(pcm, origenHz) {
    if (origenHz === 16000) return pcm;
    const destino = new OfflineAudioContext(1, Math.max(1, Math.ceil(pcm.length * 16000 / origenHz)), 16000);
    const buffer = destino.createBuffer(1, pcm.length, origenHz);
    buffer.copyToChannel(pcm, 0);
    const fuente = destino.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(destino.destination);
    fuente.start();
    const renderizado = await destino.startRendering();
    return renderizado.getChannelData(0);
  }

  /* ------------------------------------------------------------------ montaje en la página */

  const textarea = document.getElementById('f-contenido');   // «Relato del día *»
  if (!textarea) return;                                      // otra pantalla: nada que hacer

  const estilo = document.createElement('style');
  estilo.textContent = [
    '#btn-dictado-modo{display:inline-flex;align-items:center;gap:.3rem;padding:.4rem .7rem;border-radius:9999px;',
    'border:1.5px solid #94a3b8;background:#f8fafc;color:#475569;font-size:.72rem;font-weight:600;',
    'cursor:pointer;line-height:1.2;transition:background .15s,color .15s,border-color .15s;}',
    '#btn-dictado-modo:hover{background:#e2e8f0;}',
    '#btn-dictado-modo.modo-offline{border-color:#16a34a;background:#f0fdf4;color:#15803d;}',
    '#btn-dictado-modo[disabled]{opacity:.55;cursor:not-allowed;}'
  ].join('');
  document.head.appendChild(estilo);

  /* El chip de modo va en la fila que creó dictado.js (si todavía no está, esperamos). */
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'btn-dictado-modo';
  chip.title = 'Elegí el motor de dictado: el del navegador (necesita internet) o el local (funciona sin señal)';

  function montarChip() {
    const fila = document.getElementById('dictado-fila');
    const botonDictar = document.getElementById('btn-dictado');
    const destino = fila || (botonDictar && botonDictar.parentElement) || textarea.parentElement;
    if (!destino) return false;
    if (chip.parentElement !== destino) destino.appendChild(chip);
    return true;
  }
  if (!montarChip()) {
    const espera = setInterval(() => { if (montarChip()) clearInterval(espera); }, 200);
    setTimeout(() => clearInterval(espera), 5000);
  }

  /* ------------------------------------------------------------------ estado */

  let modoOffline = false;
  try { modoOffline = localStorage.getItem(CLAVE_MODO) === 'si'; } catch (e) {}

  let modeloListo = false;     // el worker tiene el pipeline cargado
  let descargando = false;     // bajando el modelo ahora mismo
  let grabando = false;        // sesión de dictado offline en curso
  let tokenSesion = 0;         // cambia al iniciar/detener: corta esperas viejas

  let worker = null;
  let promesaCarga = null;
  let promesasDeCarga = [];    // resolvers esperando { tipo:'listo' } / { tipo:'error' }

  /* audio de la sesión en curso */
  let flujo = null;            // MediaStream del micrófono
  let contexto = null;         // AudioContext
  let trozos = [];             // bloques crudos a la frecuencia del micrófono
  let muestrasAcumuladas = 0;
  let vozAcumuladaMs = 0;
  let silencioMs = 0;
  let pendientes = 0;          // bloques en el worker sin respuesta todavía
  let idBloque = 0;
  let cerrando = false;        // se detuvo y esperamos las últimas transcripciones
  let ultimoResultado = '';    // el último texto aceptado (para no escribirlo dos veces)

  /* ------------------------------------------------------------------ worker */

  function asegurarWorker() {
    if (worker) return worker;
    worker = new Worker('dictado-offline-worker.js');
    worker.onmessage = (evento) => recibirDelWorker(evento.data || {});
    worker.onerror = (e) => {
      aviso('Falló el motor sin conexión. Probá de nuevo.', 'error');
      if (!modeloListo) rechazarCarga(new Error((e && e.message) || 'worker'));
    };
    return worker;
  }

  function recibirDelWorker(msg) {
    if (msg.tipo === 'progreso') {
      progresoDeDescarga(msg);
    } else if (msg.tipo === 'listo') {
      modeloListo = true;
      descargando = false;
      /* El modelo ocupa decenas de MB en el dispositivo: pedimos que el
         navegador lo trate como dato importante y no lo borre por su cuenta. */
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      pintaChip();
      const resolvers = promesasDeCarga; promesasDeCarga = [];
      resolvers.forEach((r) => r.resolver());
    } else if (msg.tipo === 'error') {
      if (!modeloListo) rechazarCarga(new Error(msg.mensaje || 'error del modelo'));
      if (pendientes > 0) pendientes--;
      if (grabando) aviso('El motor sin conexión falló: ' + (msg.mensaje || 'error desconocido'), 'error');
      revisarCierre();
    } else if (msg.tipo === 'resultado') {
      if (pendientes > 0) pendientes--;
      const s = limpia(msg.texto).toLowerCase();
      /* Descartamos alucinaciones y resultados idénticos al anterior (típico
         artefacto cuando un bloque se corta en el borde de una misma frase). */
      if (s && s !== ultimoResultado && !esAlucinacion(s)) {
        ultimoResultado = s;
        anexar(s);
      }
      revisarCierre();
    }
  }

  function rechazarCarga(err) {
    descargando = false;
    const resolvers = promesasDeCarga; promesasDeCarga = [];
    resolvers.forEach((r) => r.rechazar(err));
    pintaChip();
  }

  /** Descarga (la primera vez) y carga el modelo. Resuelve cuando está listo. */
  function cargarModelo() {
    if (modeloListo) return Promise.resolve();
    if (!promesaCarga) {
      descargando = true;
      pintaChip();
      asegurarWorker();
      worker.postMessage({ tipo: 'cargar' });
      promesaCarga = new Promise((resolver, rechazar) => {
        promesasDeCarga.push({ resolver, rechazar });
      }).finally(() => { promesaCarga = null; });
    }
    return promesaCarga;
  }

  /* Progreso de descarga: el worker avisa archivo por archivo; mostramos el último. */
  function progresoDeDescarga(msg) {
    if (!msg.archivo) return;
    aviso('Descargando el motor sin conexión… ' + msg.progreso + ' % (solo la primera vez)', '');
  }

  /* ------------------------------------------------------------------ escritura en el relato */

  /** Agrega una frase transcrita al final del relato (como hace el dictado online). */
  function anexar(texto) {
    const frase = preparaFrase(texto);
    if (!frase) return;
    const anterior = String(textarea.value || '').replace(/\s+$/, '');
    textarea.value = anterior ? anterior + ' ' + frase : frase;
    /* Avisamos al resto de la app (dictado.js sincroniza su estado interno). */
    try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { textarea.scrollTop = textarea.scrollHeight; } catch (e) {}
  }

  /* ------------------------------------------------------------------ audio */

  async function arrancarAudio() {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    contexto = new (window.AudioContext || window.webkitAudioContext)();
    if (contexto.state === 'suspended') { try { await contexto.resume(); } catch (e) {} }
    await contexto.audioWorklet.addModule('dictado-offline-worklet.js');
    const fuente = contexto.createMediaStreamSource(flujo);
    const captor = new AudioWorkletNode(contexto, 'dictado-captor');
    captor.port.onmessage = (e) => recibirAudio(e.data);
    fuente.connect(captor);   // solo escuchamos: nada conectado a la salida
  }

  function pararAudio() {
    try { if (flujo) flujo.getTracks().forEach((t) => t.stop()); } catch (e) {}
    flujo = null;
    try { if (contexto) contexto.close(); } catch (e) {}
    contexto = null;
    trozos = [];
    muestrasAcumuladas = 0;
    vozAcumuladaMs = 0;
    silencioMs = 0;
  }

  /** Llega un bloque del micrófono: acumulamos y decidimos si ya se transcribe. */
  function recibirAudio(bloque) {
    if (!grabando || !contexto) return;
    const durMs = bloque.length / contexto.sampleRate * 1000;
    if (calcularRMS(bloque) > SILENCIO_RMS) {
      vozAcumuladaMs += durMs;
      silencioMs = 0;
    } else {
      silencioMs += durMs;
    }
    trozos.push(bloque);
    muestrasAcumuladas += bloque.length;

    const totalMs = muestrasAcumuladas / contexto.sampleRate * 1000;
    const bloqueLleno = totalMs >= SEGMENTO_SEG * 1000;
    const pausaLarga = vozAcumuladaMs >= MIN_VOZ_MS && silencioMs >= PAUSA_FLUSH_MS;
    if (bloqueLleno || pausaLarga) enviarSegmento();
  }

  /** Junta lo acumulado, lo pasa a 16 kHz y lo manda al worker. */
  async function enviarSegmento() {
    if (!trozos.length) return;
    const crudo = concatenar(trozos);
    const huboVoz = vozAcumuladaMs;
    trozos = [];
    muestrasAcumuladas = 0;
    vozAcumuladaMs = 0;
    silencioMs = 0;
    if (huboVoz < MIN_VOZ_MS) return;          // casi puro silencio: no molestar al modelo
    const pcm16k = await a16k(crudo, contexto ? contexto.sampleRate : 48000);
    if (!worker) return;
    pendientes++;
    worker.postMessage({ tipo: 'transcribir', id: ++idBloque, audio: pcm16k }, [pcm16k.buffer]);
  }

  function concatenar(lista) {
    let total = 0;
    for (const t of lista) total += t.length;
    const out = new Float32Array(total);
    let pos = 0;
    for (const t of lista) { out.set(t, pos); pos += t.length; }
    return out;
  }

  /** Al detener: si ya llegaron todas las transcripciones, cerramos la sesión. */
  function revisarCierre() {
    if (!cerrando || pendientes > 0) return;
    cerrando = false;
    pintaBotonDictado(false);
    aviso('Listo: el relato quedó escrito (sin conexión).', '');
  }

  /* ------------------------------------------------------------------ UI */

  function aviso(texto, tipo) {
    const estado = document.getElementById('dictado-estado');
    if (!estado) return;
    estado.textContent = texto || '';
    estado.className = tipo === 'error' ? 'dictado-error' : (tipo === 'aviso' ? 'dictado-aviso' : '');
  }

  /* El botón Dictar lo creó dictado.js; desde acá le cambiamos la cara mientras
     dura una sesión offline. */
  function pintaBotonDictado(activo) {
    const boton = document.getElementById('btn-dictado');
    const icono = document.getElementById('dictado-icono');
    const texto = document.getElementById('dictado-texto');
    if (boton) {
      boton.classList.toggle('dictado-escuchando', activo);
      boton.setAttribute('aria-pressed', activo ? 'true' : 'false');
    }
    if (icono) icono.textContent = activo ? '⏹' : '🎤';
    if (texto) texto.textContent = activo ? 'Detener' : 'Dictar';
  }

  function pintaChip() {
    chip.textContent = modoOffline ? '📴 Sin conexión' : '🌐 Online';
    chip.classList.toggle('modo-offline', modoOffline);
    chip.title = modoOffline
      ? (modeloListo ? 'Motor local cargado: el dictado funciona sin internet. Tocá para volver al modo online.'
                     : 'Motor local: la primera vez descarga el modelo (~77 MB) y después funciona sin internet. Tocá para volver al modo online.')
      : 'Usando el reconocimiento del navegador (necesita internet). Tocá para activar el dictado sin conexión.';
  }

  chip.addEventListener('click', () => {
    if (grabando) return;                  // no cambiar de motor en plena sesión
    modoOffline = !modoOffline;
    try { localStorage.setItem(CLAVE_MODO, modoOffline ? 'si' : 'no'); } catch (e) {}
    pintaChip();
    aviso(modoOffline
      ? 'Dictado sin conexión activado. ' + (modeloListo ? 'El modelo ya está listo.' : 'La primera vez va a descargar el modelo (~77 MB).')
      : 'Dictado online activado (necesita internet).', '');
  });

  /* ------------------------------------------------------------------ sesión */

  async function iniciar() {
    if (grabando) return;
    const sesion = ++tokenSesion;
    pintaBotonDictado(true);

    try {
      if (!modeloListo) {
        aviso('Preparando el motor sin conexión…', '');
        await cargarModelo();
        if (sesion !== tokenSesion) return;   // lo detuvo mientras bajaba
      }
    } catch (e) {
      pintaBotonDictado(false);
      aviso(navigator.onLine
        ? 'No se pudo descargar el motor sin conexión. Revisá la conexión y probá de nuevo.'
        : 'Sin internet y sin modelo descargado: conectate una vez para descargarlo, o usá el modo 🌐 Online cuando haya señal.', 'error');
      return;
    }

    try {
      await arrancarAudio();
      if (sesion !== tokenSesion) { pararAudio(); return; }
    } catch (e) {
      pintaBotonDictado(false);
      aviso('El navegador bloqueó el micrófono. Tocá el candado 🔒 de la barra de direcciones y permití «Micrófono».', 'error');
      return;
    }

    grabando = true;
    cerrando = false;
    ultimoResultado = '';
    aviso('Escuchando sin conexión… el texto va apareciendo en tandas mientras hablás.', '');
    textarea.focus();
  }

  async function detener() {
    if (!grabando && !cerrando) return;
    tokenSesion++;
    grabando = false;

    /* Mandamos lo último que quedó acumulado antes de apagar el micrófono. */
    await enviarSegmento();
    pararAudio();

    if (pendientes > 0) {
      cerrando = true;
      aviso('Transcribiendo lo último que dijiste…', '');
    } else {
      pintaBotonDictado(false);
      aviso('Listo: el relato quedó escrito (sin conexión).', '');
    }
  }

  function alternar() {
    if (descargando && !grabando) {
      /* Botón apretado en plena descarga del modelo: se cancela el arranque.
         (La descarga en sí sigue: si termina, la próxima vez arranca al toque.) */
      tokenSesion++;
      pintaBotonDictado(false);
      aviso('Descarga en curso cancelada. Cuando quieras dictar de nuevo se retoma.', '');
      return;
    }
    grabando || cerrando ? detener() : iniciar();
  }

  /* ------------------------------------------------------------------ integración */

  /** ¿Este motor debe atender el botón Dictar?
   *  · Si ya hay una sesión offline en curso, siempre (para poder frenarla).
   *  · Si el usuario eligió 📴 Sin conexión, siempre.
   *  · Si hay red, gana el motor online; si NO hay red y el modelo está listo,
   *    pasamos solos al local. */
  function usarAhora() {
    if (grabando || cerrando) return true;
    if (modoOffline) return true;
    return !navigator.onLine && modeloListo;
  }

  /* Nunca dejamos el micrófono abierto de fondo. */
  document.addEventListener('visibilitychange', () => { if (document.hidden && grabando) detener(); });
  window.addEventListener('pagehide', () => { if (grabando) detener(); });

  /* Estado inicial. */
  pintaChip();
  if (!navigator.mediaDevices || !window.AudioWorkletNode) {
    chip.disabled = true;
    chip.title = 'Este navegador no soporta el dictado sin conexión (probá Chrome, Edge o Safari moderno).';
  }

  /* API mínima para dictado.js, pruebas automáticas y el resto de la app. */
  window.DictadoOffline = {
    usarAhora: usarAhora,
    alternar: alternar,
    iniciar: iniciar,
    detener: detener,
    estaGrabando: () => grabando,
    modeloListo: () => modeloListo,
    modoOffline: () => modoOffline,
    _pruebas: { preparaFrase, calcularRMS, esAlucinacion, esRepeticion },
  };
})();

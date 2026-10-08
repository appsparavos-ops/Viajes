/**
 * dictado-offline-worker.js — Worker del dictado SIN CONEXIÓN del Panel.
 *
 * Acá adentro corre Whisper (OpenAI) vía Transformers.js: el audio del micrófono
 * se transcribe EN EL DISPOSITIVO, sin mandar nada a ningún servidor. Una vez
 * descargado el modelo (una sola vez, con internet), funciona 100 % offline.
 *
 * Por qué un worker: transcribir tarda varios segundos por bloque y, si corriera
 * en la página, la pantalla se quedaría congelada. Acá la página sigue fluida.
 *
 * Protocolo (postMessage):
 *   página → worker:  { tipo:'cargar' }                      prepara el modelo
 *                     { tipo:'transcribir', id, audio }      audio Float32Array a 16 kHz
 *   worker → página:  { tipo:'progreso', archivo, progreso } durante la descarga
 *                     { tipo:'listo' }                       modelo cargado
 *                     { tipo:'resultado', id, texto }        transcripción de un bloque
 *                     { tipo:'error', mensaje }
 *
 * Este archivo se crea como worker clásico desde dictado-offline.js y carga la
 * librería ESM (lib/transformers.js) con import() dinámico: así funciona en
 * todos los navegadores modernos sin tool de empaquetado.
 */
'use strict';

/* ------------------------------------------------------------------ configuración */

/* Modelo multilingüe de Whisper que entiende español.
 * · 'Xenova/whisper-base'  → ~77 MB, buena calidad (recomendado)
 * · 'Xenova/whisper-tiny'  → ~41 MB, más rápido y liviano, menos preciso
 * Para cambiarlo alcanza con tocar esta línea. */
const MODELO = 'Xenova/whisper-base';
const DTYPE = 'q8';   // pesos cuantizados a 8 bits: mismo idioma, un tercio del tamaño

let libreria = null;          // módulo transformers.js
let transcriptor = null;      // pipeline ya cargado
let promesaCarga = null;      // carga en curso (para no duplicar)
let cola = Promise.resolve(); // serializa los mensajes (transcribir uno a la vez)

/* ------------------------------------------------------------------ carga */

async function obtenerLibreria() {
  if (libreria) return libreria;
  libreria = await import('../lib/transformers.js');
  /* Modelos solo desde el hub (no hay carpeta local de modelos). */
  libreria.env.allowLocalModels = false;
  /* El binario de ONNX Runtime vive en el propio sitio (lib/ort/): sin este
   * ajuste la librería lo bajaría del CDN y sin internet no andaría. */
  libreria.env.backends.onnx.wasm.wasmPaths = '../lib/ort/';
  /* Sin cabeceras COOP/COEP no hay hilos: lo dejamos explícito para no
   * intentar workers internos que el navegador rechazaría. */
  if (!self.crossOriginIsolated) {
    libreria.env.backends.onnx.wasm.numThreads = 1;
  }
  return libreria;
}

/** Baja (la primera vez) y carga el modelo. Informa el progreso archivo por archivo. */
async function cargarTranscriptor() {
  const T = await obtenerLibreria();
  const opciones = {
    dtype: DTYPE,
    progress_callback: (info) => {
      if (info && info.status === 'progress') {
        self.postMessage({
          tipo: 'progreso',
          archivo: info.file || '',
          progreso: Math.round(info.progress || 0),
          cargado: info.loaded || 0,
          total: info.total || 0,
        });
      }
    },
  };
  /* Si el equipo trae WebGPU (GPU desde el navegador) el dictado vuela;
   * si no, o si algo falla por ahí, usamos el camino clásico (CPU/WASM). */
  if (self.navigator && self.navigator.gpu) {
    try {
      return await T.pipeline('automatic-speech-recognition', MODELO, Object.assign({ device: 'webgpu' }, opciones));
    } catch (e) {
      /* seguimos por wasm: no pasa nada */
    }
  }
  return await T.pipeline('automatic-speech-recognition', MODELO, opciones);
}

function asegurarCarga() {
  if (transcriptor) return Promise.resolve();
  if (!promesaCarga) {
    promesaCarga = cargarTranscriptor().then((p) => { transcriptor = p; return p; });
    /* Si falla (p. ej. sin internet la primera vez), que se pueda reintentar. */
    promesaCarga.catch(() => { promesaCarga = null; });
  }
  return promesaCarga;
}

/* ------------------------------------------------------------------ mensajes */

async function procesar(msg) {
  if (msg.tipo === 'cargar') {
    await asegurarCarga();
    self.postMessage({ tipo: 'listo' });
  } else if (msg.tipo === 'transcribir') {
    await asegurarCarga();
    const salida = await transcriptor(msg.audio, {
      language: 'spanish',     // forzamos español: es más rápido y no se confunde
      task: 'transcribe',
      chunk_length_s: 15,
      skip_special_tokens: true,
      /* Anti-bucle: de tanto en tanto Whisper «patina» y repite la misma frase
         una y otra vez («sale el sol sale el sol sale el sol…»). Con esto, un
         grupo de 3 palabras no puede aparecer dos veces en el mismo bloque y el
         bucle se corta de raíz. */
      no_repeat_ngram_size: 3,
    });
    self.postMessage({ tipo: 'resultado', id: msg.id, texto: (salida && salida.text) || '' });
  }
}

self.onmessage = (evento) => {
  const msg = evento.data || {};
  cola = cola
    .then(() => procesar(msg))
    .catch((err) => {
      self.postMessage({ tipo: 'error', mensaje: String((err && err.message) || err) });
    });
};

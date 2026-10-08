/**
 * dictado-offline-worklet.js — Captor de micrófono del dictado sin conexión.
 *
 * Corre en el hilo de audio del navegador (AudioWorklet) y manda el sonido del
 * micrófono en bloques crudos (Float32Array, un canal) a la página, que decide
 * cuándo juntarlos en un segmento y mandarlo a transcribir. No se conecta a la
 * salida: solo escucha, nunca reproduce (evita acople).
 */
'use strict';

class CaptorDictado extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal) this.port.postMessage(canal);
    return true;   // seguir procesando
  }
}

registerProcessor('dictado-captor', CaptorDictado);

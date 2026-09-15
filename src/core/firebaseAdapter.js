/**
 * firebaseAdapter.js — Adaptador delgado sobre Firebase
 * Permite inyectar mock en tests y desacoplar el resto del código de firebase compat.
 */
export function createFirebaseAdapter({ firebase, firebaseConfig, getUserRoot, timeoutMs = 12000 }) {
  const available = typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && !!firebase.database;

  function withTimeout(promise, ms = timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);
  }

  function normalizeForServer(obj) {
    if (Array.isArray(obj)) { obj.forEach(o => normalizeForServer(o)); return obj; }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === 'TIMESTAMP') {
          obj[k] = available ? firebase.database.ServerValue.TIMESTAMP : Date.now();
        } else if (v && typeof v === 'object') normalizeForServer(v);
      }
    }
    return obj;
  }

  function ref(path) {
    const user = getUserRoot();
    // path puede ser global (viajes_index) o viaje_data
    // si contiene '/', se asume que ya viene con viajeId
    return firebase.database().ref(`${user}/${path}`);
  }

  function globalRef(path) {
    const user = getUserRoot();
    return firebase.database().ref(`${user}/${path}`);
  }

  async function write(path, action, data, generatedId = null, isGlobal = false) {
    const r = isGlobal ? firebase.database().ref(`${getUserRoot()}/${path}`) : firebase.database().ref(`${getUserRoot()}/viajes_data/${path}`);
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? JSON.parse(JSON.stringify(data)) : data;
    const normalized = payload && typeof payload === 'object' ? normalizeForServer(JSON.parse(JSON.stringify(payload))) : payload;
    await withTimeout((async () => {
      if (generatedId) await r.child(generatedId).set(normalized);
      else if (action === 'update') await r.update(normalized);
      else if (action === 'set') await r.set(normalized);
      else if (action === 'remove') await r.remove();
    })());
  }

  function genId() {
    return firebase.database().ref().push().key;
  }

  return { available, withTimeout, normalizeForServer, ref, globalRef, write, genId };
}

// Mock para tests / offline
export function createMockFirebaseAdapter({ getUserRoot } = {}) {
  const store = new Map();
  return {
    available: true,
    withTimeout: (p) => p,
    normalizeForServer: (o) => { if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (o[k] === 'TIMESTAMP') o[k] = Date.now(); } return o; },
    write: async (path, action, data, genId, isGlobal) => {
      const key = (isGlobal ? 'G:' : 'D:') + path + (genId ? '/' + genId : '');
      if (action === 'remove') store.delete(key);
      else store.set(key, data);
    },
    genId: () => 'mock_' + Math.random().toString(36).slice(2, 10),
    _store: store
  };
}

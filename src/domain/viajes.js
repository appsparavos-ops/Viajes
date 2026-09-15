/**
 * viajes.js — Gestión de viajes (selector, creación, estado activo)
 */
export class ViajeService {
  constructor({ cacheManager, syncManager, firebaseAdapter }) {
    this.cache = cacheManager;
    this.sync = syncManager;
    this.firebase = firebaseAdapter;
  }

  async listar() {
    // Intenta online, fallback cache
    if (this.firebase?.available) {
      try {
        const snap = await this.firebase.withTimeout(
          this.firebase.globalRef('viajes_index').once('value')
        );
        if (snap.exists()) {
          const viajes = [];
          snap.forEach(c => viajes.push({ ...c.val(), id: c.key }));
          viajes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          this.cache.set(this.cache.keyViajes(), viajes);
          return { viajes, source: 'online' };
        }
      } catch {}
    }
    const cached = this.cache.get(this.cache.keyViajes()) || [];
    if (cached.length) return { viajes: cached, source: 'cache' };
    const last = this.cache.get(this.cache.keyLastViaje());
    if (last) return { viajes: [last], source: 'cache-last' };
    return { viajes: [], source: 'empty' };
  }

  updateViajesCache(viajeId, changes) {
    let viajes = this.cache.get(this.cache.keyViajes()) || [];
    const i = viajes.findIndex(v => v.id === viajeId);
    if (i >= 0) viajes[i] = { ...viajes[i], ...changes };
    else viajes.push({ id: viajeId, ...changes });
    this.cache.set(this.cache.keyViajes(), viajes);
    const last = this.cache.get(this.cache.keyLastViaje());
    if (last && last.id === viajeId) this.cache.set(this.cache.keyLastViaje(), { ...last, ...changes });
  }
}

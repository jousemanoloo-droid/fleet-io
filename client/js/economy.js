// Economía cosmética local. Una escritura JSON guarda la transacción completa;
// las cuatro claves públicas se mantienen como espejo compatible con el portal.
(function (global) {
  'use strict';
  const CATALOG = Object.freeze({
    skins: [{ id: 'default', name: 'Caza Original', price: 0 },
      { id: 'alien', name: 'Alien Green', price: 600 }, { id: 'gold', name: 'Golden Elite', price: 1500 },
      { id: 'chrome', name: 'Mecha Chrome', price: 1000 }],
    trails: [{ id: 'cyan', name: 'Plasma Cyan', price: 0 }, { id: 'orange', name: 'Solar Orange', price: 400 },
      { id: 'purple', name: 'Void Purple', price: 800 }],
    effects: [{ id: 'default', name: 'Explosión de plasma', price: 0 },
      { id: 'FROST_SHATTER', name: 'Frost Shatter', price: 900 },
      { id: 'BLACK_HOLE', name: 'Black Hole', price: 1800 },
      { id: 'NEON_GRAFFITI', name: 'Neon Graffiti', price: 1200 }],
  });
  const KEY = 'fleet_io_economy_state';
  class Economy {
    constructor(storage, now = () => Date.now()) {
      try { this.storage = storage || global.localStorage; } catch { this.storage = null; }
      this.now = now; this.persistent = true;
      this.state = { coins: 0, skins: ['default'], trails: ['cyan'], effects: ['default'], titles: [], lastLogin: 0,
        pendingBoost: false, equipped: { skin: 'default', trail: 'cyan', killEffect: 'default' }, settled: [], receipts: {} };
      this.load();
    }
    load() {
      try {
        const serialized = this.storage.getItem(KEY);
        const data = serialized ? JSON.parse(serialized) : {
          coins: Number(this.storage.getItem('fleet_io_coins') || 0),
          skins: JSON.parse(this.storage.getItem('fleet_io_unlocked_skins') || '["default"]'),
          trails: JSON.parse(this.storage.getItem('fleet_io_unlocked_trails') || '["cyan"]'),
          lastLogin: Number(this.storage.getItem('fleet_io_last_login') || 0),
        };
        if (!data || typeof data !== 'object') return;
        const ids = type => CATALOG[type].map(item => item.id);
        this.state = { ...this.state,
          coins: Number.isSafeInteger(data.coins) && data.coins >= 0 ? data.coins : 0,
          skins: [...new Set(['default', ...(Array.isArray(data.skins) ? data.skins.filter(id => ids('skins').includes(id)) : [])])],
          trails: [...new Set(['cyan', ...(Array.isArray(data.trails) ? data.trails.filter(id => ids('trails').includes(id)) : [])])],
          effects: [...new Set(['default', ...(Array.isArray(data.effects) ? data.effects.filter(id => ids('effects').includes(id)) : [])])],
          titles: Array.isArray(data.titles) ? data.titles.filter(title => ['Space Terror', 'Leviathan Slayer', 'Dominator'].includes(title)) : [],
          lastLogin: Number.isFinite(data.lastLogin) ? Math.max(0, data.lastLogin) : 0,
          pendingBoost: data.pendingBoost === true,
          settled: Array.isArray(data.settled) ? data.settled.filter(id => typeof id === 'string').slice(-128) : [],
          receipts: Object.fromEntries(Object.entries(data.receipts || {}).filter(([key, seq]) =>
            key.length < 100 && Number.isSafeInteger(seq) && seq >= 0).slice(-256)),
        };
        if (this.state.skins.includes(data.equipped?.skin)) this.state.equipped.skin = data.equipped.skin;
        if (this.state.trails.includes(data.equipped?.trail)) this.state.equipped.trail = data.equipped.trail;
        if (this.state.effects.includes(data.equipped?.killEffect)) this.state.equipped.killEffect = data.equipped.killEffect;
      } catch { this.persistent = false; }
    }
    save() {
      try {
        this.storage.setItem(KEY, JSON.stringify(this.state));
        this.storage.setItem('fleet_io_coins', String(this.state.coins));
        this.storage.setItem('fleet_io_unlocked_skins', JSON.stringify(this.state.skins));
        this.storage.setItem('fleet_io_unlocked_trails', JSON.stringify(this.state.trails));
        this.storage.setItem('fleet_io_last_login', String(this.state.lastLogin));
      } catch { this.persistent = false; }
    }
    canClaimDaily() { return this.now() - this.state.lastLogin >= 86400000; }
    claimDaily() {
      if (this.persistent) this.load();
      if (!this.canClaimDaily()) return false;
      this.state.coins += 500; this.state.lastLogin = this.now(); this.state.pendingBoost = true;
      this.save(); return true;
    }
    consumeBoost() { this.state.pendingBoost = false; this.save(); }
    // Recibos de servidor reutilizan el ledger persistente: snapshots o reenvíos
    // de un mismo premio no suman monedas dos veces.
    credit(id, coins) {
      return this.creditBatch([{ id, coins }]);
    }
    creditBatch(rewards) {
      if (this.persistent) this.load();
      let total = 0;
      const valid = rewards.filter(reward => typeof reward.id === 'string' && Number.isSafeInteger(reward.coins) && reward.coins > 0);
      // Ordenar también el lote de snapshots evita saltar un recibo anterior
      // que llegó en el mismo frame. Una única escritura por lote evita tirones.
      valid.sort((a, b) => Number(a.id.slice(a.id.lastIndexOf(':') + 1)) - Number(b.id.slice(b.id.lastIndexOf(':') + 1)));
      for (const { id, coins } of valid) {
        const separator = id.lastIndexOf(':'), namespace = id.slice(0, separator), sequence = Number(id.slice(separator + 1));
        if (separator < 0 || !Number.isSafeInteger(sequence)) {
          const key = `reward:${id}`;
          if (this.state.settled.includes(key)) continue;
          this.state.settled.push(key); this.state.settled = this.state.settled.slice(-128);
        } else {
          // Socket.IO conserva el orden fiable; un watermark por sala persiste
          // todos los recibos sin acumular un ledger infinito en localStorage.
          if (sequence <= (this.state.receipts[namespace] || 0)) continue;
          this.state.receipts[namespace] = sequence;
        }
        total += coins;
      }
      const keys = Object.keys(this.state.receipts);
      for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete this.state.receipts[key];
      if (total > 0) { this.state.coins = Math.min(Number.MAX_SAFE_INTEGER, this.state.coins + total); this.save(); }
      return total;
    }
    unlockTitle(title) {
      if (!['Space Terror', 'Leviathan Slayer', 'Dominator'].includes(title)) return;
      if (!this.state.titles.includes(title)) { this.state.titles.push(title); this.save(); }
    }
    settle(id, score) {
      if (this.persistent) this.load();
      if (this.state.settled.includes(id)) return 0;
      const earned = Number.isFinite(score) ? Math.max(0, Math.floor(score / 50)) : 0;
      this.state.coins = Math.min(Number.MAX_SAFE_INTEGER, this.state.coins + earned);
      this.state.settled.push(id); this.state.settled = this.state.settled.slice(-128);
      this.save(); return earned;
    }
    buy(type, id) {
      if (this.persistent) this.load();
      const item = CATALOG[type]?.find(item => item.id === id);
      if (!item) return false;
      if (!this.state[type].includes(id)) {
        if (this.state.coins < item.price) return false;
        this.state.coins -= item.price; this.state[type].push(id);
      }
      this.state.equipped[type === 'skins' ? 'skin' : type === 'effects' ? 'killEffect' : 'trail'] = id;
      this.save(); return true;
    }
  }
  global.FleetEconomy = { Economy, CATALOG };
})(window);

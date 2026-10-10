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
  });
  const KEY = 'fleet_io_economy_state';
  class Economy {
    constructor(storage, now = () => Date.now()) {
      try { this.storage = storage || global.localStorage; } catch { this.storage = null; }
      this.now = now; this.persistent = true;
      this.state = { coins: 0, skins: ['default'], trails: ['cyan'], lastLogin: 0,
        pendingBoost: false, equipped: { skin: 'default', trail: 'cyan' }, settled: [] };
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
          lastLogin: Number.isFinite(data.lastLogin) ? Math.max(0, data.lastLogin) : 0,
          pendingBoost: data.pendingBoost === true,
          settled: Array.isArray(data.settled) ? data.settled.filter(id => typeof id === 'string').slice(-128) : [],
        };
        if (this.state.skins.includes(data.equipped?.skin)) this.state.equipped.skin = data.equipped.skin;
        if (this.state.trails.includes(data.equipped?.trail)) this.state.equipped.trail = data.equipped.trail;
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
      this.state.equipped[type === 'skins' ? 'skin' : 'trail'] = id;
      this.save(); return true;
    }
  }
  global.FleetEconomy = { Economy, CATALOG };
})(window);

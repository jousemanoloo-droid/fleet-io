// Economía cosmética local. Una escritura JSON guarda la transacción completa;
// las cuatro claves públicas se mantienen como espejo compatible con el portal.
(function (global) {
  'use strict';
  const CATALOG = Object.freeze({
    skins: [{ id: 'default', nameKey: 'cosmetic.skins.default', price: 0 },
      { id: 'alien', nameKey: 'cosmetic.skins.alien', price: 600 }, { id: 'gold', nameKey: 'cosmetic.skins.gold', price: 1500 },
      { id: 'chrome', nameKey: 'cosmetic.skins.chrome', price: 1000 },
      { id: 'cyber', nameKey: 'cosmetic.skins.cyber', price: 600 },
      { id: 'void', nameKey: 'cosmetic.skins.void', price: 900 },
      { id: 'solar', nameKey: 'cosmetic.skins.solar', price: 1100 }],
    lasers: [{id:'blue',nameKey:'garage.laser.blue',price:0},{id:'green',nameKey:'garage.laser.green',price:500},
      {id:'red',nameKey:'garage.laser.red',price:500},{id:'rainbow',nameKey:'garage.laser.rainbow',price:1800}],
    trails: [{ id: 'cyan', nameKey: 'cosmetic.trails.cyan', price: 0 }, { id: 'orange', nameKey: 'cosmetic.trails.orange', price: 400 },
      { id: 'purple', nameKey: 'cosmetic.trails.purple', price: 800 }],
    effects: [{ id: 'default', nameKey: 'cosmetic.effects.default', price: 0 },
      { id: 'FROST_SHATTER', nameKey: 'cosmetic.effects.FROST_SHATTER', price: 900 },
      { id: 'BLACK_HOLE', nameKey: 'cosmetic.effects.BLACK_HOLE', price: 1800 },
      { id: 'NEON_GRAFFITI', nameKey: 'cosmetic.effects.NEON_GRAFFITI', price: 1200 }],
  });
  const KEY = 'fleet_io_economy_state';
  CATALOG.skins.push({id:'starlight',nameKey:'garage.starlight',price:0,exclusive:true});
  CATALOG.skins.push({id:'void_stalker',nameKey:'craft.void_stalker.name',price:0,exclusive:true});
  class Economy {
    constructor(storage, now = () => Date.now()) {
      // The SDK data module is the only save source on CrazyGames. It manages
      // guests/accounts itself; no divergent local/cloud balance to merge.
      try { this.storage = storage || global.AdManager?.sdk?.data || global.localStorage; } catch { this.storage = null; }
      this.now = now; this.persistent = true;
      // One-time migration of a previous browser save; never overwrite a
      // pre-existing account save or merge balances from two different sources.
      try {
        if(!storage && this.storage===global.AdManager?.sdk?.data && this.storage.getItem(KEY)===null) {
          const old=global.localStorage?.getItem(KEY);
          if(old && old.length<=131072) {
            const data=JSON.parse(old);
            if(data && typeof data==='object' && Number.isSafeInteger(data.coins) && data.coins>=0) this.storage.setItem(KEY,old);
          }
        }
      } catch { /* Disabled cloud data or local storage must not break startup. */ }
      this.state = { coins: 0, skins: ['default'], trails: ['cyan'], lasers:['blue'], effects: ['default'], titles: [], crafted:[], lastLogin: 0,
        profileId:'pilot_'+Math.random().toString(36).slice(2), retention:null, play:{}, adReadyAt:0,
        pendingBoost: false, equipped: { skin: 'default', trail: 'cyan', laser:'blue', killEffect: 'default', title: null }, settled: [], receipts: {} };
      this.load();
    }
    load() {
      if (this.remote) return;
      try {
        const serialized = this.storage.getItem(KEY);
        if (serialized?.length > 131072) throw new Error('Save exceeds size limit');
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
          lasers: [...new Set(['blue', ...(Array.isArray(data.lasers) ? data.lasers.filter(id => ids('lasers').includes(id)) : [])])],
          profileId:typeof data.profileId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(data.profileId) ? data.profileId : this.state.profileId,
          retention:global.FleetDailyQuests?.sanitize(data.retention) || null,
          adReadyAt:Number.isSafeInteger(data.adReadyAt) && data.adReadyAt >= 0 ? data.adReadyAt : 0,
          play:Object.fromEntries(Object.entries(data.play && typeof data.play === 'object' ? data.play : {}).filter(([key,p]) =>
            key.length<160 && p && ['kills','seconds','score'].every(k=>Number.isSafeInteger(p[k]) && p[k]>=0)).slice(-128)),
          titles: Array.isArray(data.titles) ? [...new Set(data.titles.filter(title => ['Space Terror', 'Leviathan Slayer', 'Dominator', 'Space Pirate', 'Untouchable'].includes(title)))] : [],
          lastLogin: Number.isFinite(data.lastLogin) ? Math.max(0, data.lastLogin) : 0,
          pendingBoost: data.pendingBoost === true,
          settled: Array.isArray(data.settled) ? data.settled.filter(id => typeof id === 'string').slice(-128) : [],
          receipts: Object.fromEntries(Object.entries(data.receipts || {}).filter(([key, seq]) =>
            key.length < 100 && Number.isSafeInteger(seq) && seq >= 0).slice(-256)),
        };
        this.state.equipped = {skin:'default',trail:'cyan',laser:'blue',killEffect:'default',title:null};
        if (this.state.skins.includes(data.equipped?.skin)) this.state.equipped.skin = data.equipped.skin;
        if (this.state.trails.includes(data.equipped?.trail)) this.state.equipped.trail = data.equipped.trail;
        if (this.state.lasers.includes(data.equipped?.laser)) this.state.equipped.laser = data.equipped.laser;
        if (this.state.titles.includes(data.equipped?.title)) this.state.equipped.title = data.equipped.title;
        if (this.state.effects.includes(data.equipped?.killEffect)) this.state.equipped.killEffect = data.equipped.killEffect;
      } catch {
        // Repair malformed JSON when storage is writable. A blocked storage
        // remains an in-memory fallback; it cannot block boot or gameplay.
        this.save();
      }
    }
    save() {
      if (this.remote) return;
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
      if (this.remote) return false;
      if (this.persistent) this.load();
      if (!this.canClaimDaily()) return false;
      this.state.coins += 500; this.state.lastLogin = this.now(); this.state.pendingBoost = true;
      this.save(); return true;
    }
    consumeBoost() { this.state.pendingBoost = false; this.save(); }
    setServerTime(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) return false;
      this._serverTime = ms; this._monotonicAt = global.performance?.now() ?? this.now(); return true;
    }
    utcNow() { return this._serverTime === undefined ? null : this._serverTime + Math.max(0,(global.performance?.now() ?? this.now())-this._monotonicAt); }
    reserveAd(id) {
      if (this.remote) return this.request('startAd').then(r=>r?.ok?r.ticket:false);
      if(this.persistent) this.load();
      const now=this.utcNow();
      if(now===null || now<this.state.adReadyAt || this._creditAdId) return false;
      this._creditAdId=id; this._creditAdProfile=this.state.profileId; this.state.adReadyAt=Math.floor(now+30000);this.save();return true;
    }
    releaseAd(id) {if(this._creditAdId===id) {this._creditAdId=null;this._creditAdProfile=null;}}
    rewardAd(id) {
      if (this.remote) return this.request('finishAd',{id}).then(r=>r?.ok===true);
      if (this.persistent) this.load();
      const now = this.utcNow();
      if(this._creditAdId===id && this._creditAdProfile!==this.state.profileId) return false;
      if (now === null || now < this.state.adReadyAt && this._creditAdId!==id || typeof id !== 'string' || this.state.settled.includes(id)) return false;
      this.state.adReadyAt = Math.floor(now+30000);
      this.state.coins = Math.min(Number.MAX_SAFE_INTEGER,this.state.coins+500);
      this.state.settled.push(id); this.state.settled=this.state.settled.slice(-128); this.save(); return true;
    }
    recordPlay(id, values, baseline=false) {
      if (this.remote) return 0;
      if (typeof id !== 'string' || id.length>160 || !values || !['kills','seconds','score'].every(k=>Number.isSafeInteger(values[k]) && values[k]>=0)) return 0;
      if (this.persistent) this.load();
      const before = Object.hasOwn(this.state.play,id) ? this.state.play[id] : {kills:0,seconds:0,score:0};
      const delta = Object.fromEntries(['kills','seconds','score'].map(k=>[k,baseline?0:Math.max(0,values[k]-before[k])]));
      Object.defineProperty(this.state.play,id,{value:{kills:Math.max(before.kills,values.kills),seconds:Math.max(before.seconds,values.seconds),score:Math.max(before.score,values.score)},writable:true,configurable:true,enumerable:true});
      for (const key of Object.keys(this.state.play).slice(0,-128)) delete this.state.play[key];
      const earned = delta.kills*50 + delta.seconds;
      this.state.coins=Math.min(Number.MAX_SAFE_INTEGER,this.state.coins+earned);
      const now=this.utcNow();
      if (now !== null && global.FleetDailyQuests) {
        const r=global.FleetDailyQuests.ensure(this.state,now);
        global.FleetDailyQuests.advance(r,delta,values.shipClass);
      }
      // Persist at whole-second granularity, not for every 30Hz snapshot.
      if (baseline || earned || delta.score || values.shipClass !== this._observedClass) this.save();
      this._observedClass=values.shipClass; return earned;
    }
    // Recibos de servidor reutilizan el ledger persistente: snapshots o reenvíos
    // de un mismo premio no suman monedas dos veces.
    credit(id, coins) {
      return this.creditBatch([{ id, coins }]);
    }
    creditBatch(rewards) {
      if (this.remote) return 0;
      if (this.persistent) this.load();
      let total = 0;
      const valid = (Array.isArray(rewards)?rewards:[]).filter(reward => reward && typeof reward.id === 'string' && reward.id.length<160 && Number.isSafeInteger(reward.coins) && reward.coins > 0);
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
          if (sequence <= (Object.hasOwn(this.state.receipts,namespace)?this.state.receipts[namespace]:0)) continue;
          Object.defineProperty(this.state.receipts,namespace,{value:sequence,writable:true,configurable:true,enumerable:true});
        }
        total += coins;
      }
      const keys = Object.keys(this.state.receipts);
      for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete this.state.receipts[key];
      if (total > 0) { this.state.coins = Math.min(Number.MAX_SAFE_INTEGER, this.state.coins + total); this.save(); }
      return total;
    }
    unlockTitle(title) {
      if (this.remote) return;
      if (!['Space Terror', 'Leviathan Slayer', 'Dominator', 'Space Pirate', 'Untouchable'].includes(title)) return;
      if (!this.state.titles.includes(title)) { this.state.titles.push(title); this.save(); }
    }
    settle(id, score) {
      if (this.remote) return 0;
      if (this.persistent) this.load();
      if (this.state.settled.includes(id)) return 0;
      const earned = Number.isFinite(score) ? Math.max(0, Math.floor(score / 50)) : 0;
      this.state.coins = Math.min(Number.MAX_SAFE_INTEGER, this.state.coins + earned);
      this.state.settled.push(id); this.state.settled = this.state.settled.slice(-128);
      this.save(); return earned;
    }
    buy(type, id) {
      if (this.remote) return this.request('buy',{type,id}).then(r=>r?.ok===true);
      if (this.persistent) this.load();
      if (typeof type !== 'string' || !Object.hasOwn(CATALOG,type)) return false;
      const item = CATALOG[type]?.find(item => item.id === id);
      if (!item) return false;
      if (!this.state[type].includes(id)) {
        if (item.exclusive) return false;
        if (this.state.coins < item.price) return false;
        this.state.coins -= item.price; this.state[type].push(id);
      }
      this.state.equipped[type === 'skins' ? 'skin' : type === 'effects' ? 'killEffect' : type === 'lasers' ? 'laser' : 'trail'] = id;
      this.save(); return true;
    }
    bindAccount(socket, changed) {
      this.remote=true;this.socket=socket;this.accountReady=false;this.generation=0;this.revision=-1;
      this.state.coins=0;this.state.skins=['default'];this.state.trails=['cyan'];this.state.lasers=['blue'];this.state.effects=['default'];this.state.titles=[];
      this.state.equipped={skin:'default',trail:'cyan',laser:'blue',killEffect:'default',title:null};this.state.retention=null;this.state.adReadyAt=0;
      this.state.crafted=[];
      this.changed=changed;
      this.accountListener=data=>{if(this.accountReady && data?.state?.profileId===this.state.profileId)this.applyAccount(data);};
      socket.on('accountState',this.accountListener);
      this.disconnected=()=>{this.accountReady=false;this.generation++;};
      socket.on('disconnect',this.disconnected);
    }
    applyAccount(data) {
      if(!data?.ok || !data.state || !Number.isSafeInteger(data.revision) || data.revision<this.revision)return false;
      if(global.FleetExtractionRules){
        // Un cache de navegador nunca se importa ni se mezcla con el stash real.
        // Rechazar un paquete inválido conserva el último estado confirmado.
        const stash=global.FleetExtractionRules.validateStash(data.state.secureStash);
        if(!stash){try{this.storage?.removeItem('fleet_io_stash');}catch{}return false;}
        data={...data,state:{...data.state,secureStash:stash}};
      }
      this.state={...data.state,crafted:global.FleetCraftingRecipes?.sanitize(data.state.crafted) || []};this.revision=data.revision;this.accountReady=true;this.persistent=data.persistent===true;
      this.setServerTime(data.utc);
      try {this.storage?.setItem('fleet_io_account_token',data.token);}catch {}
      this.changed?.();return true;
    }
    openAccount() {
      if(!this.remote)return Promise.resolve(null);
      const generation=++this.generation,connection=this.socket.id;
      this.accountReady=false;this.revision=-1;
      let token;try {token=this.storage?.getItem('fleet_io_account_token');}catch {}
      return new Promise(resolve=>this.socket.timeout(8000).emit('accountOpen',{token},(error,result)=>{
        if(error || this.destroyed || generation!==this.generation || connection!==this.socket.id || !this.socket.connected){resolve(null);return;}
        this.applyAccount(result);resolve(result);
      }));
    }
    request(action,data={}) {
      if(!this.accountReady || !this.socket?.connected || this.destroyed)return Promise.resolve(null);
      const generation=this.generation,connection=this.socket.id;
      return new Promise(resolve=>this.socket.timeout(8000).emit('accountAction',{...data,action},(error,result)=>{
        if(error || this.destroyed || generation!==this.generation || connection!==this.socket.id){resolve(null);return;}
        this.applyAccount(result);resolve(result);
      }));
    }
    claimStreak() {return this.remote?this.request('streak'):Promise.resolve(global.FleetDailyQuests.claimStreak(this));}
    craft(recipeId) {
      if(!this.remote || !this.accountReady || !this.socket?.connected || this.destroyed)return Promise.resolve(null);
      const generation=this.generation,connection=this.socket.id;
      return new Promise(resolve=>this.socket.timeout(8000).emit('craft:request',{recipeId},(error,result)=>{
        if(error || this.destroyed || generation!==this.generation || connection!==this.socket.id){resolve(null);return;}
        this.applyAccount(result);resolve(result);
      }));
    }
    claimQuest(id) {return this.remote?this.request('quest',{id}):Promise.resolve(global.FleetDailyQuests.claimQuest(this,id));}
    equipTitle(id) {return this.request('title',{id});}
    destroy() {this.destroyed=true;this.generation++;this.socket?.off('accountState',this.accountListener);this.socket?.off('disconnect',this.disconnected);this.changed=null;}
  }
  global.FleetEconomy = { Economy, CATALOG };
})(window);

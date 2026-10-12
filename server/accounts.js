'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Q = require('../client/js/daily-quests');
const Extraction=require('./extractionInventory');
const Crafting=require('./craftingRecipes');
const PRICES = {
  skins:{default:0,alien:600,gold:1500,chrome:1000,cyber:600,void:900,solar:1100},
  trails:{cyan:0,orange:400,purple:800}, lasers:{blue:0,green:500,red:500,rainbow:1800},
  effects:{default:0,FROST_SHATTER:900,BLACK_HOLE:1800,NEON_GRAFFITI:1200},
};
const FIELDS={skins:'skin',trails:'trail',lasers:'laser',effects:'killEffect'};
const defaults = id => ({profileId:id,coins:0,skins:['default'],trails:['cyan'],lasers:['blue'],effects:['default'],
  titles:[],equipped:{skin:'default',trail:'cyan',laser:'blue',killEffect:'default',title:null},
  retention:null,adReadyAt:0,pendingBoost:false,lastLogin:0,settled:[],receipts:{},play:{},crafted:[],secureStash:Extraction.emptyStash()});

// Bearer guest identities are signed by the backend; browser saves are caches,
// never imported as balances. Configure a stable secret AND durable file in Render.
class Accounts {
  constructor({secret=process.env.ECONOMY_SECRET || crypto.randomBytes(32).toString('hex'),file=process.env.ECONOMY_FILE,now=Date.now}={}) {
    if(typeof secret!=='string' || Buffer.byteLength(secret)<32 || secret.length>1024)throw new Error('ECONOMY_SECRET must contain at least 32 bytes');
    this.secret=secret;this.file=file;this.now=now;this.records=new Map();this.sessions=new Map();this.timer=null;this.storageError=null;
    this.blackMarket=new (require('./blackMarket').BlackMarket)(this);
    if(file && fs.existsSync(file)) {
      // Fail closed on corrupted authoritative storage: never silently erase wallets.
      const raw=fs.readFileSync(file,'utf8');
      if(raw.length>33554432) throw new Error('Economy storage exceeds size limit');
      const rows=JSON.parse(raw);
      if(!Array.isArray(rows) || rows.length>10000) throw new Error('Invalid economy storage');
      for(const row of rows) {
        if(!row || !/^[a-f0-9]{32}$/.test(row.id) || !Number.isSafeInteger(row.state?.coins) || row.state.coins<0) throw new Error('Invalid wallet record');
        const state=defaults(row.id);state.coins=row.state.coins;
        state.secureStash=Extraction.migrateStash(row.state.secureStash) || Extraction.emptyStash();
        state.crafted=Crafting.sanitize(row.state.crafted);
        for(const type of Object.keys(PRICES)) state[type]=[...new Set([...state[type],...(Array.isArray(row.state[type])?row.state[type]:[]).filter(id=>Object.hasOwn(PRICES[type],id) || type==='skins' && id==='starlight')])];
        state.retention=Q.sanitize(row.state.retention);
        if(state.crafted.includes('void_stalker'))state.skins.push('void_stalker');
        state.adReadyAt=Number.isSafeInteger(row.state.adReadyAt)?Math.max(0,row.state.adReadyAt):0;
        state.titles=(Array.isArray(row.state.titles)?row.state.titles:[]).filter(t=>['Space Terror','Leviathan Slayer','Dominator','Space Pirate','Untouchable'].includes(t));
        for(const [type,key] of Object.entries(FIELDS)) if(state[type].includes(row.state.equipped?.[key])) state.equipped[key]=row.state.equipped[key];
        if(state.titles.includes(row.state.equipped?.title)) state.equipped.title=row.state.equipped.title;
        this.records.set(row.id,{id:row.id,state,revision:0});
      }
    }
  }
  sign(id) {return crypto.createHmac('sha256',this.secret).update(id).digest('hex');}
  identify(token) {
    if(typeof token!=='string' || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return null;
    const [id,mac]=token.split('.');return crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(this.sign(id),'hex'))?id:null;
  }
  open(socket,token) {
    let session=this.sessions.get(socket.id);
    if(session) return this.snapshot(session);
    if(this.sessions.size>=4000)throw new Error('Account session capacity reached');
    let id=this.identify(token),record=id && this.records.get(id);
    if(!record) {
      if(this.records.size>=10000) throw new Error('Wallet capacity reached');
      id=crypto.randomBytes(16).toString('hex');record={id,state:defaults(id),revision:0};this.records.set(id,record);
    }
    session={socket,record,baseline:null,observedAt:0,ticket:null};this.sessions.set(socket.id,session);
    Q.ensure(record.state,this.now());this.dirty();return this.snapshot(session);
  }
  snapshot(s) {return {ok:true,token:s.record.id+'.'+this.sign(s.record.id),revision:s.record.revision,utc:this.now(),persistent:!!this.file && !this.storageError,state:JSON.parse(JSON.stringify(s.record.state))};}
  publish(s) {s.record.revision++;this.dirty();s.socket.emit('accountState',this.snapshot(s));}
  observe(socketId,p,force=false) {
    const s=this.sessions.get(socketId),now=this.now();if(!s || !p || !force && now-s.observedAt<1000)return;
    s.observedAt=now;
    const identity=p;const life=p.matchStartedAt;
    const values={kills:Math.max(0,p.sessionKills || 0),seconds:Math.floor(Math.max(0,p.deathState?.survivedMs ?? now-p.spawnedAt)/1000),score:Math.max(0,p.deathState?.score ?? p.score)};
    // spawnedAt differs in older entities; use the authoritative network duration.
    values.seconds=Math.floor(Math.max(0,p.deathState?.survivedMs ?? p.toNetwork().survivedMs ?? 0)/1000);
    const old=s.baseline?.identity===identity && s.baseline.life===life?s.baseline.values:{kills:0,seconds:0,score:0};
    const delta=Object.fromEntries(Object.keys(values).map(k=>[k,Math.max(0,values[k]-old[k])]));
    s.baseline={identity,life,values};
    const state=s.record.state;state.coins=Math.min(Number.MAX_SAFE_INTEGER,state.coins+delta.kills*50+delta.seconds);
    const r=Q.ensure(state,now);Q.advance(r,delta,p.shipClass);
    for(const reward of p.coinRewards || []) {
      const split=reward.id.lastIndexOf(':'),ns=reward.id.slice(0,split),seq=Number(reward.id.slice(split+1));
      if(Number.isSafeInteger(seq) && seq>(Object.hasOwn(state.receipts,ns)?state.receipts[ns]:0)) {
        state.coins=Math.min(Number.MAX_SAFE_INTEGER,state.coins+reward.coins);state.receipts[ns]=seq;
      }
    }
    for(const key of Object.keys(state.receipts).slice(0,-256))delete state.receipts[key];
    // Once credited by the authoritative wallet, a client ACK is unnecessary.
    // Drain the compatibility queue so it cannot inflate every 30Hz snapshot.
    state.coins=Math.min(Number.MAX_SAFE_INTEGER,state.coins+(p.coinRewardReserve || 0));
    p.coinRewardReserve=0;if(p.coinRewards)p.coinRewards.length=0;
    for(const title of p.titles || []) if(!state.titles.includes(title))state.titles.push(title);
    this.publish(s);
  }
  loadout(socketId,p) {
    const state=this.sessions.get(socketId)?.record.state;if(!state || !p)return;
    require('./cosmetics').apply(p,state.equipped);p.killEffect=state.equipped.killEffect;
    p.titles=[...new Set([...p.titles,...state.titles])];p.equippedTitle=state.equipped.title;
  }
  preparePlayer(socketId,p) {
    const state=this.sessions.get(socketId)?.record.state;
    if(state && p)require('./blackMarket').applyPassives(p,state.crafted);
  }
  action(socketId,data,context={}) {
    const s=this.sessions.get(socketId);if(!s || !data || this.storageError)return {ok:false};
    const state=s.record.state;let ok=false;
    if(data.action==='readStash')return this.snapshot(s);
    if(data.action==='sellResource')return this.sellResource(s,data.resource,data.quantity);
    if(data.action==='upgradeStash') {
      const stash=Extraction.validateStash(state.secureStash),price=stash && Extraction.upgradeCost(stash);
      if(stash && stash.capacity<Extraction.MAX_STASH && state.coins>=price){
        state.coins-=price;state.secureStash={...stash,capacity:stash.capacity+Extraction.STASH_STEP,revision:stash.revision+1};ok=true;
      }
    } else if(data.action==='buy' && typeof data.type==='string' && Object.hasOwn(PRICES,data.type) && typeof data.id==='string' && (Object.hasOwn(PRICES[data.type],data.id) || state[data.type].includes(data.id))) {
      const price=PRICES[data.type][data.id] ?? 0;
      if(state[data.type].includes(data.id) || state.coins>=price) {
        if(!state[data.type].includes(data.id)) {state.coins-=price;state[data.type].push(data.id);}
        state.equipped[FIELDS[data.type]]=data.id;ok=true;
      }
    } else if(data.action==='title' && (data.id===null || state.titles.includes(data.id))) {state.equipped.title=data.id;ok=true;}
    else if(data.action==='streak' || data.action==='quest') {
      const adapter={state,persistent:false,utcNow:()=>this.now(),save:()=>{}};
      ok=data.action==='streak'?Q.claimStreak(adapter):Q.claimQuest(adapter,data.id);
    } else if(data.action==='startAd' && this.now()>=state.adReadyAt && (!s.ticket || this.now()>s.ticket.until)) {
      const revive=data.purpose==='revive';
      if(data.purpose!==undefined && data.purpose!=='credits' && !revive)return {ok:false};
      if(revive && (!context.player?.deathState || context.player.alive || data.roomId!==context.room?.roomId || data.deathId!==context.player.deathId))return {ok:false};
      s.ticket={id:crypto.randomBytes(16).toString('hex'),until:this.now()+150000,purpose:revive?'revive':'credits',roomId:data.roomId,deathId:data.deathId};state.adReadyAt=this.now()+30000;
      this.publish(s);return {...this.snapshot(s),ticket:s.ticket.id};
    } else if(data.action==='finishAd' || data.action==='cancelAd') {
      const t=s.ticket;
      if(!t || typeof data.id!=='string' || data.id!==t.id)return {ok:false};
      s.ticket=null;
      // This is a one-use client attestation, NOT cryptographic ad verification.
      if(t && typeof data.id==='string' && data.id===t.id && this.now()<=t.until) {
        if(data.action==='finishAd') {
          if(t.purpose==='credits')state.coins=Math.min(Number.MAX_SAFE_INTEGER,state.coins+500);
          else s.revivePermit={roomId:t.roomId,deathId:t.deathId,until:this.now()+15000};
        }
        ok=true;
      }
    }
    if(ok)this.publish(s);return {...this.snapshot(s),ok};
  }
  consumeRevive(id,roomId,deathId) {
    const s=this.sessions.get(id),permit=s?.revivePermit;if(s)s.revivePermit=null;
    return !!permit && permit.roomId===roomId && permit.deathId===deathId && this.now()<=permit.until;
  }
  endLife(id) {const s=this.sessions.get(id);if(s){s.baseline=null;s.revivePermit=null;s.ticket=null;}}
  beginLife(id,p) {const s=this.sessions.get(id);if(s)s.baseline={identity:p,life:p.matchStartedAt,values:{kills:0,seconds:0,score:p.score}};}
  close(id) {this.sessions.delete(id);}
  extractionBinding(id) {
    return {
      read:()=>this.sessions.get(id)?.record.state,
      commit:items=>this.storeExtracted(id,items),
      notify:()=>{
        const record=this.sessions.get(id)?.record;
        for(const s of this.sessions.values())if(s.record===record){try{s.socket.emit('accountState',this.snapshot(s));}catch{}}
      },
    };
  }
  storeExtracted(id,items) {
    const s=this.sessions.get(id),cargo=Extraction.validateItems(items,Extraction.MAX_CARGO);
    if(!s || !cargo?.used)return {ok:false,error:'extraction.empty'};
    if(!this.file || this.storageError)return {ok:false,error:'extraction.persistence'};
    const old=s.record.state,stash=Extraction.validateStash(old.secureStash);
    if(!stash || Extraction.weight(stash.items)+cargo.used>stash.capacity)return {ok:false,error:'extraction.stashFull'};
    const merged={...stash.items};for(const [key,count]of Object.entries(cargo.items))merged[key]=(merged[key] || 0)+count;
    s.record.state={...old,secureStash:{schemaVersion:2,capacity:stash.capacity,items:merged,revision:stash.revision+1}};
    // Commit durable en la frontera de extracción, nunca en cada frame.
    // Una sola instancia Node no intercala mensajes entre commit y vaciado.
    this.flush();
    if(this.storageError){s.record.state=old;return {ok:false,error:'extraction.persistence'};}
    s.record.revision++;return {ok:true};
  }
  sellResource(s,id,quantity) {
    const old=s.record.state,stash=Extraction.validateStash(old.secureStash);
    if(!this.file || this.storageError || typeof id!=='string' || !Object.hasOwn(Extraction.RESOURCES,id) ||
      !Number.isSafeInteger(quantity) || quantity<=0 || !stash || quantity>(stash.items[id] || 0))return {ok:false,error:'extraction.saleFailed'};
    const credits=quantity*Extraction.RESOURCES[id].baseCredits;
    if(!Number.isSafeInteger(old.coins+credits))return {ok:false,error:'extraction.saleFailed'};
    const items={...stash.items};items[id]-=quantity;if(!items[id])delete items[id];
    s.record.state={...old,coins:old.coins+credits,secureStash:{...stash,items,revision:stash.revision+1}};
    // Recursos y saldo se guardan juntos; fallo de escritura = rollback de ambos.
    this.flush();if(this.storageError){s.record.state=old;return {ok:false,error:'extraction.persistence'};}
    s.record.revision++;
    for(const peer of this.sessions.values())if(peer.record===s.record){try{peer.socket.emit('accountState',this.snapshot(peer));}catch{}}
    return {...this.snapshot(s),credits};
  }
  dirty() {
    if(!this.file || this.timer)return;
    this.timer=setTimeout(()=>{this.timer=null;this.flush();},1000);this.timer.unref?.();
  }
  flush() {
    if(!this.file)return;
    try {
      fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';
      fs.writeFileSync(temp,JSON.stringify([...this.records.values()].map(r=>({id:r.id,state:r.state}))));fs.renameSync(temp,this.file);this.storageError=null;
    } catch(error) {this.storageError=error.message;console.error('FLEET.IO economy persistence failed');}
  }
  destroy() {clearTimeout(this.timer);this.timer=null;this.flush();this.sessions.clear();this.records.clear();}
}
module.exports={Accounts,PRICES};

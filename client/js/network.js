// Keyframes v2 y deltas v3 relativos a una base fiable: toleran pérdida de paquetes.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports?require('./resource-types'):root.FleetResourceTypes);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetNetwork = api;
})(typeof window !== 'undefined' ? window : globalThis, function (ResourceTypes) {
  'use strict';
  function packPlayer(p, includeRewards = true) {
    const n = p.toNetwork();
    return [n.id, n.x, n.y, n.vx, n.vy, n.rotation, n.score, n.scrap, n.hp, n.maxHp,
      n.level, n.name, n.color, +n.isBot, n.deathId,
      n.deathState ? [n.deathState.score, n.deathState.scrap, n.deathState.drones, n.deathState.totalXp, n.deathState.survivedMs] : null,
      n.maxSpeed, +n.levelUpPending, +n.invulnerable, n.mutations,
      n.drones.map(d => [d.id, +d.x.toFixed(1), +d.y.toFixed(1), d.state, d.attackTimer, +(d.rotation || 0).toFixed(3)]), n.inputSeq,
      [n.xp, n.totalXp, n.attributePoints, [n.attributes.speed, n.attributes.shield, n.attributes.damage, n.attributes.fireRate, n.attributes.regen || 0, n.attributes.vision || 0],
        n.chassis, n.killStreak, n.killedBy, n.skin, n.trail, +n.dashing, +n.slowed, +n.shielded, +n.boosted,
        n.cooldowns, n.abilityDurations, n.survivedMs,
        [n.titles || [], n.killEffect || 'default', includeRewards ? n.coinRewards || [] : []],
        [n.nemesisId,n.kothTime,n.speedMultiplier,+n.isInvulnerable,+n.isParrying,n.revengeRemaining,n.parryRemaining,n.supplyBuff,n.supplyRemaining],
        [n.comboCount,n.comboTimer,n.motionRevision,n.slingshotRemaining,n.teleportRemaining,n.gravityWell,n.kickX,n.kickY,n.kickAppliedX,n.kickAppliedY],
        [n.shipClass || null,n.classRank || 0,n.evolutionPending || 0,n.evolutionRemaining || 0,n.cloakRemaining || 0],
        [n.laserStyle || 'blue',n.sessionKills || 0,n.clanTag || null],
        [n.powerShieldRemaining || 0,n.powerOverclockRemaining || 0,n.powerTripleRemaining || 0,+n.radiation]],
      n.orbitalDrones.map(d => [d.id, Math.round(d.x), Math.round(d.y),d.state || 'ORBIT',d.attackTimer || 0,d.rotation || 0]),
      (n.tacticalDrones || []).map(d => [d.id,+d.x.toFixed(1),+d.y.toFixed(1),d.state,d.attackTimer,+(d.rotation || 0).toFixed(3)]), n.swarmCooldown || 0,
      [n.overdriveRemaining || 0, n.overdriveCooldown || 0, n.revengeShieldRemaining || 0,
        n.equippedSkin || n.skin, n.equippedTrail || n.trail, n.equippedTitle || null, n.contract || null],
      [n.radius, n.fireSeq || 0, n.nextFireTick || 0, n.fireCooldown || 400],[n.activeDroneCount,n.droneCountRevision || 0]];
  }
  function player(a) {
    if (!Array.isArray(a)) return a;
    const r = a[22];
    return { ...(r ? { xp: r[0], totalXp: r[1], attributePoints: r[2],
      attributes: { speed: r[3][0], shield: r[3][1], damage: r[3][2], fireRate: r[3][3], regen:r[3][4] || 0, vision:r[3][5] || 0 },
      shipClass:r[19]?.[0] || null, classRank:r[19]?.[1] || 0, evolutionPending:r[19]?.[2] || 0,
      evolutionRemaining:r[19]?.[3] || 0, cloakRemaining:r[19]?.[4] || 0,
      laserStyle:r[20]?.[0] || 'blue',sessionKills:r[20]?.[1] || 0,
      clanTag:r[20]?.[2] || null,
      powerShieldRemaining:r[21]?.[0] || 0,powerOverclockRemaining:r[21]?.[1] || 0,powerTripleRemaining:r[21]?.[2] || 0,radiation:!!r[21]?.[3],
      chassis: r[4], killStreak: r[5], killedBy: r[6], skin: r[7], trail: r[8],
      dashing: !!r[9], slowed: !!r[10], shielded: !!r[11], boosted: !!r[12],
      cooldowns: r[13], abilityDurations: r[14], survivedMs: r[15],
      titles: r[16]?.[0] || [], killEffect: r[16]?.[1] || 'default', coinRewards: r[16]?.[2] || [],
      nemesisId:r[17]?.[0] || null, kothTime:r[17]?.[1] || 0, speedMultiplier:r[17]?.[2] || 1,
      isInvulnerable:!!r[17]?.[3], isParrying:!!r[17]?.[4], revengeRemaining:r[17]?.[5] || 0,
      parryRemaining:r[17]?.[6] || 0, supplyBuff:r[17]?.[7] || null, supplyRemaining:r[17]?.[8] || 0,
      comboCount:r[18]?.[0] || 0,comboTimer:r[18]?.[1] || 0,motionRevision:r[18]?.[2] || 0,
      slingshotRemaining:r[18]?.[3] || 0,teleportRemaining:r[18]?.[4] || 0,gravityWell:r[18]?.[5] || null,
      kickX:r[18]?.[6] || 0,kickY:r[18]?.[7] || 0,kickAppliedX:r[18]?.[8] || 0,kickAppliedY:r[18]?.[9] || 0 } : {}),
      orbitalDrones: (a[23] || []).map(d => ({ id: d[0], x: d[1], y: d[2],state:d[3] || 'ORBIT',attackTimer:d[4] || 0,rotation:d[5] || 0, autonomous: true })),
      activeDroneCount:a[28]?.[0] ?? ((a[20]?.length || 0)+(a[23]?.length || 0)+(a[24]?.length || 0)),droneCountRevision:a[28]?.[1] || 0,
      tacticalDrones: (a[24] || []).map(d => ({id:d[0],x:d[1],y:d[2],state:d[3],attackTimer:d[4], rotation:d[5] || 0, tactical:true})),
      swarmCooldown: a[25] || 0,
      overdriveRemaining: a[26]?.[0] || 0, overdriveCooldown: a[26]?.[1] || 0, revengeShieldRemaining: a[26]?.[2] || 0,
      equippedSkin: a[26]?.[3] || r?.[7] || 'default', equippedTrail: a[26]?.[4] || r?.[8] || 'cyan',
      equippedTitle: a[26]?.[5] || null, contract: a[26]?.[6] || null,
      id: a[0], x: a[1], y: a[2], vx: a[3], vy: a[4], rotation: a[5], score: a[6],
      scrap: a[7], hp: a[8], maxHp: a[9], level: a[10], name: a[11], color: a[12], isBot: !!a[13],
      deathId: a[14], deathState: a[15] ? { score: a[15][0], scrap: a[15][1], drones: a[15][2],
        totalXp: a[15][3], survivedMs: a[15][4] } : null,
      maxSpeed: a[16], levelUpPending: !!a[17], invulnerable: !!a[18], mutations: a[19],
      drones: a[20].map(d => ({ id: d[0], x: d[1], y: d[2], state:d[3] || 'ORBIT', attackTimer:d[4] || 0, rotation:d[5] || 0 })), inputSeq: a[21], radius: a[27]?.[0] || 18, fireSeq: a[27]?.[1] || 0, nextFireTick: a[27]?.[2] || 0, fireCooldown: a[27]?.[3] || 400 };
  }
  function decode(snap) {
    if (snap.v !== 2) return snap;
    for (const key of ['p','s','b','o']) if (!Array.isArray(snap[key]) || snap[key].length>2000) throw new Error('Invalid collection');
    for(const [key,limit] of [['powerups',24],['environment',3],['gems',360],['resources',128]]) {
      if(snap[key]===undefined)continue;
      if(!Array.isArray(snap[key]) || snap[key].length>limit)throw new Error('Invalid world collection');
      for(const row of snap[key])if(!Array.isArray(row) || typeof row[0]!=='string' || !Number.isFinite(row[1]) || !Number.isFinite(row[2]))throw new Error('Invalid world entity');
      for(const row of snap[key]) {
        if(key==='powerups' && !['SHIELD','OVERCLOCK','TRIPLE'].includes(row[3]))throw new Error('Invalid powerup');
        if(key==='resources' && (!ResourceTypes.isResource(row[3]) || !Number.isSafeInteger(row[4]) || row[4]<=0 || row[4]*ResourceTypes.RESOURCES[row[3]].weight>120))throw new Error('Invalid resource');
        if(key==='environment' && (!Number.isFinite(row[3]) || row[3]<=0 || row[3]>2000 || !['BLACK_HOLE','RADIATION'].includes(row[4])))throw new Error('Invalid zone');
      }
    }
    for (const key of ['p','s','b']) for (const row of snap[key]) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1]) || !Number.isFinite(row[2])) throw new Error('Invalid entity');
    }
    return { ...snap, w: snap.gems ? {...snap.w,g:snap.gems} : snap.w, p: snap.p.map(player),
      s: snap.s.map(a => ({ id: a[0], x: a[1], y: a[2], v: a[3], c: a[4], s: a[5] })),
      b: snap.b.map(a => ({ id: a[0], x: a[1], y: a[2], c: a[3], rotation: a[4], motionRevision:a[5] || 0, ownerId:a[6], vx:a[7] || 0, vy:a[8] || 0, fireSeq:a[9], deathId:a[10], sourceId:a[11] || a[6] })) };
  }
  // Deltas relative to a reliable immutable keyframe: losing a delta is harmless.
  const COLLECTIONS = ['p', 's', 'b', 'o'];
  const idOf = row => Array.isArray(row) ? row[0] : row.id;
  // JSON-shaped snapshots have bounded nesting. Compare directly instead of
  // allocating strings for every drone/attribute array, for every observer.
  function equal(a,b) {
    if(a===b)return true;
    if(!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b))return false;
    if(Array.isArray(a)){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!equal(a[i],b[i]))return false;return true;}
    const keys=Object.keys(a);if(keys.length!==Object.keys(b).length)return false;
    for(const k of keys)if(!Object.hasOwn(b,k) || !equal(a[k],b[k]))return false;
    return true;
  }
  function arrayChanges(before,after,path,changes) {
    if(equal(before,after))return;
    if(Array.isArray(before) && Array.isArray(after) && before.length===after.length && path.length<6) {
      for(let i=0;i<after.length;i++)arrayChanges(before[i],after[i],[...path,i],changes);
    } else changes.push([path,after]);
  }
  function delta(base, current) {
    const packet = { ...current, v: 3, base: base.t };
    if(equal(base.leaderboard,current.leaderboard))delete packet.leaderboard;
    const extra=['powerups','environment','gems','resources'].filter(key=>Array.isArray(base[key]) && Array.isArray(current[key]));
    if(extra.length)packet.worldCollections=extra;
    for (const key of [...COLLECTIONS,...extra]) {
      const old = new Map(base[key].map(row => [idOf(row), row]));
      const present = new Set(), changes = [];
      for (const row of current[key]) {
        const id = idOf(row), previous = old.get(id); present.add(id);
        if (!previous) { changes.push([id, row]); continue; }
        if (!Array.isArray(row)) {
          if (!equal(row,previous)) changes.push([id, row]);
          continue;
        }
        const fields = [], nested=[];
        for (let i = 1; i < row.length; i++) {
          if (row[i] === previous[i]) continue;
          if (typeof row[i] === 'object' && equal(row[i],previous[i])) continue;
          if(Array.isArray(row[i]) && Array.isArray(previous[i]) && row[i].length===previous[i].length) {
            arrayChanges(previous[i],row[i],[i],nested);continue;
          }
          fields.push(i, row[i]);
        }
        if (fields.length || nested.length) changes.push(nested.length?[id,null,fields,nested]:[id,null,fields]);
      }
      packet[key] = [changes, [...old.keys()].filter(id => !present.has(id))];
    }
    return packet;
  }
  class Decoder {
    constructor() { this.reset(); }
    reset() { this.base = null; this.roomId = null; }
    receive(packet) {
      try { return this._receive(packet); } catch (error) { this.reset(); return null; }
    }
    _receive(packet) {
      if (!packet || !Number.isFinite(packet.t) || !Array.isArray(packet.p)) return null;
      if (packet.v !== 3) {
        const decoded = decode(packet);
        if (packet.keyframe !== undefined) { this.base = packet; this.roomId = packet.roomId; }
        return decoded;
      }
      if (!this.base || this.roomId !== packet.roomId || this.base.t !== packet.base) return null;
      const full = { ...packet, v: 2 };
      if(full.leaderboard===undefined)full.leaderboard=this.base.leaderboard;
      const extra=Array.isArray(packet.worldCollections)?packet.worldCollections.filter(key=>key==='powerups' || key==='environment' || key==='gems' || key==='resources'):[];
      for (const key of [...COLLECTIONS,...extra]) {
        const rows = new Map(this.base[key].map(row => [idOf(row), row]));
        const [changes, removed] = packet[key];
        for (const id of removed) rows.delete(id);
        for (const [id, row, fields, nested] of changes) {
          if (row) rows.set(id, row);
          else {
            const changed = rows.get(id).slice();
            if(!Array.isArray(fields) || fields.length%2 || fields.length>128)throw new Error('Invalid delta fields');
            for(let i=0;i<fields.length;i+=2)if(!Number.isInteger(fields[i]) || fields[i]<1 || fields[i]>63)throw new Error('Invalid delta index');
            for (let i = 0; i < fields.length; i += 2) changed[fields[i]] = fields[i + 1];
            if(nested!==undefined) {
              if(!Array.isArray(nested) || nested.length>4096)throw new Error('Invalid nested delta');
              const owned=new WeakSet([changed]);
              for(const [path,value] of nested) {
                if(!Array.isArray(path) || !path.length || path.length>6 || path[0]<1 || path[0]>63 || !path.every(k=>Number.isInteger(k) && k>=0 && k<2000))throw new Error('Invalid delta path');
                let node=changed;
                for(let depth=0;depth<path.length-1;depth++) {
                  const index=path[depth];if(!Array.isArray(node[index]))throw new Error('Invalid delta parent');
                  if(!owned.has(node[index])){node[index]=node[index].slice();owned.add(node[index]);}node=node[index];
                }
                node[path.at(-1)]=value;
              }
            }
            rows.set(id, changed);
          }
        }
        full[key] = [...rows.values()];
      }
      return decode(full);
    }
  }
  function sample(queue, time) {
    let a = queue[0], b = a;
    for (let i = 1; i < queue.length; i++) {
      b = queue[i];
      if (b.t >= time) break;
      a = b;
    }
    const t = Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t || 1)));
    const angle = a.rotation || 0;
    const diff = Math.atan2(Math.sin((b.rotation || 0) - angle), Math.cos((b.rotation || 0) - angle));
    return { a, b, t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rotation: angle + diff * t };
  }
  function connect(global) {
    const backendUrl = global.FLEET_CONFIG?.backendUrl?.trim();
    return backendUrl ? global.io(backendUrl) : global.io();
  }
  return { packPlayer, player, decode, delta, Decoder, sample, connect };
});

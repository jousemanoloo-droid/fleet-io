// Keyframes v2 y deltas v3 relativos a una base fiable: toleran pérdida de paquetes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetNetwork = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function packPlayer(p) {
    const n = p.toNetwork();
    return [n.id, n.x, n.y, n.vx, n.vy, n.rotation, n.score, n.scrap, n.hp, n.maxHp,
      n.level, n.name, n.color, +n.isBot, n.deathId,
      n.deathState ? [n.deathState.score, n.deathState.scrap, n.deathState.drones, n.deathState.totalXp, n.deathState.survivedMs] : null,
      n.maxSpeed, +n.levelUpPending, +n.invulnerable, n.mutations,
      n.drones.map(d => [d.id, d.x, d.y, d.state, d.attackTimer, d.rotation]), n.inputSeq,
      [n.xp, n.totalXp, n.attributePoints, [n.attributes.speed, n.attributes.shield, n.attributes.damage, n.attributes.fireRate],
        n.chassis, n.killStreak, n.killedBy, n.skin, n.trail, +n.dashing, +n.slowed, +n.shielded, +n.boosted,
        n.cooldowns, n.abilityDurations, n.survivedMs,
        [n.titles || [], n.killEffect || 'default', n.coinRewards || []],
        [n.nemesisId,n.kothTime,n.speedMultiplier,+n.isInvulnerable,+n.isParrying,n.revengeRemaining,n.parryRemaining,n.supplyBuff,n.supplyRemaining],
        [n.comboCount,n.comboTimer,n.motionRevision,n.slingshotRemaining,n.teleportRemaining,n.gravityWell,n.kickX,n.kickY,n.kickAppliedX,n.kickAppliedY]],
      n.orbitalDrones.map(d => [d.id, Math.round(d.x), Math.round(d.y)]),
      (n.tacticalDrones || []).map(d => [d.id,d.x,d.y,d.state,d.attackTimer,d.rotation]), n.swarmCooldown || 0];
  }
  function player(a) {
    if (!Array.isArray(a)) return a;
    const r = a[22];
    return { ...(r ? { xp: r[0], totalXp: r[1], attributePoints: r[2],
      attributes: { speed: r[3][0], shield: r[3][1], damage: r[3][2], fireRate: r[3][3] },
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
      orbitalDrones: (a[23] || []).map(d => ({ id: d[0], x: d[1], y: d[2], autonomous: true })),
      tacticalDrones: (a[24] || []).map(d => ({id:d[0],x:d[1],y:d[2],state:d[3],attackTimer:d[4], rotation:d[5] || 0, tactical:true})),
      swarmCooldown: a[25] || 0,
      id: a[0], x: a[1], y: a[2], vx: a[3], vy: a[4], rotation: a[5], score: a[6],
      scrap: a[7], hp: a[8], maxHp: a[9], level: a[10], name: a[11], color: a[12], isBot: !!a[13],
      deathId: a[14], deathState: a[15] ? { score: a[15][0], scrap: a[15][1], drones: a[15][2],
        totalXp: a[15][3], survivedMs: a[15][4] } : null,
      maxSpeed: a[16], levelUpPending: !!a[17], invulnerable: !!a[18], mutations: a[19],
      drones: a[20].map(d => ({ id: d[0], x: d[1], y: d[2], state:d[3] || 'ORBIT', attackTimer:d[4] || 0, rotation:d[5] || 0 })), inputSeq: a[21], radius: 18 };
  }
  function decode(snap) {
    if (snap.v !== 2) return snap;
    return { ...snap, p: snap.p.map(player),
      s: snap.s.map(a => ({ id: a[0], x: a[1], y: a[2], v: a[3], c: a[4], s: a[5] })),
      b: snap.b.map(a => ({ id: a[0], x: a[1], y: a[2], c: a[3], rotation: a[4], motionRevision:a[5] || 0 })) };
  }
  // Deltas relative to a reliable immutable keyframe: losing a delta is harmless.
  const COLLECTIONS = ['p', 's', 'b', 'o'];
  const idOf = row => Array.isArray(row) ? row[0] : row.id;
  function delta(base, current) {
    const packet = { ...current, v: 3, base: base.t };
    for (const key of COLLECTIONS) {
      const old = new Map(base[key].map(row => [idOf(row), row]));
      const present = new Set(), changes = [];
      for (const row of current[key]) {
        const id = idOf(row), previous = old.get(id); present.add(id);
        if (!previous) { changes.push([id, row]); continue; }
        if (!Array.isArray(row)) {
          if (JSON.stringify(row) !== JSON.stringify(previous)) changes.push([id, row]);
          continue;
        }
        const fields = [];
        for (let i = 1; i < row.length; i++) {
          if (row[i] === previous[i]) continue;
          if (typeof row[i] === 'object' && JSON.stringify(row[i]) === JSON.stringify(previous[i])) continue;
          fields.push(i, row[i]);
        }
        if (fields.length) changes.push([id, null, fields]);
      }
      packet[key] = [changes, [...old.keys()].filter(id => !present.has(id))];
    }
    return packet;
  }
  class Decoder {
    constructor() { this.reset(); }
    reset() { this.base = null; this.roomId = null; }
    receive(packet) {
      if (packet.v !== 3) {
        if (packet.keyframe !== undefined) { this.base = packet; this.roomId = packet.roomId; }
        return decode(packet);
      }
      if (!this.base || this.roomId !== packet.roomId || this.base.t !== packet.base) return null;
      const full = { ...packet, v: 2 };
      for (const key of COLLECTIONS) {
        const rows = new Map(this.base[key].map(row => [idOf(row), row]));
        const [changes, removed] = packet[key];
        for (const id of removed) rows.delete(id);
        for (const [id, row, fields] of changes) {
          if (row) rows.set(id, row);
          else {
            const changed = rows.get(id).slice();
            for (let i = 0; i < fields.length; i += 2) changed[fields[i]] = fields[i + 1];
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

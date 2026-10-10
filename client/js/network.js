// Snapshots completos empaquetados: perder un paquete volatile no rompe el estado.
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
      n.drones.map(d => [d.id, d.x, d.y]), n.inputSeq,
      [n.xp, n.totalXp, n.attributePoints, [n.attributes.speed, n.attributes.shield, n.attributes.damage, n.attributes.fireRate],
        n.chassis, n.killStreak, n.killedBy, n.skin, n.trail, +n.dashing, +n.slowed, +n.shielded, +n.boosted,
        n.cooldowns, n.abilityDurations, n.survivedMs],
      n.orbitalDrones.map(d => [d.id, Math.round(d.x), Math.round(d.y)])];
  }
  function player(a) {
    if (!Array.isArray(a)) return a;
    const r = a[22];
    return { ...(r ? { xp: r[0], totalXp: r[1], attributePoints: r[2],
      attributes: { speed: r[3][0], shield: r[3][1], damage: r[3][2], fireRate: r[3][3] },
      chassis: r[4], killStreak: r[5], killedBy: r[6], skin: r[7], trail: r[8],
      dashing: !!r[9], slowed: !!r[10], shielded: !!r[11], boosted: !!r[12],
      cooldowns: r[13], abilityDurations: r[14], survivedMs: r[15] } : {}),
      orbitalDrones: (a[23] || []).map(d => ({ id: d[0], x: d[1], y: d[2], autonomous: true })),
      id: a[0], x: a[1], y: a[2], vx: a[3], vy: a[4], rotation: a[5], score: a[6],
      scrap: a[7], hp: a[8], maxHp: a[9], level: a[10], name: a[11], color: a[12], isBot: !!a[13],
      deathId: a[14], deathState: a[15] ? { score: a[15][0], scrap: a[15][1], drones: a[15][2],
        totalXp: a[15][3], survivedMs: a[15][4] } : null,
      maxSpeed: a[16], levelUpPending: !!a[17], invulnerable: !!a[18], mutations: a[19],
      drones: a[20].map(d => ({ id: d[0], x: d[1], y: d[2] })), inputSeq: a[21], radius: 18 };
  }
  function decode(snap) {
    if (snap.v !== 2) return snap;
    return { ...snap, p: snap.p.map(player),
      s: snap.s.map(a => ({ id: a[0], x: a[1], y: a[2], v: a[3], c: a[4], s: a[5] })),
      b: snap.b.map(a => ({ id: a[0], x: a[1], y: a[2], c: a[3], rotation: a[4] })) };
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
  return { packPlayer, player, decode, sample, connect };
});

'use strict';
const { segmentHit } = require('./combat');
const { tier } = require('./rpg');

// Tactical chassis drones are separate from collectible escorts: a free respawn
// still loses all earned fleet and a rewarded respawn retains exactly half.
class DroneSwarm {
  constructor(room) { this.room = room; this.cells = new Map(); this.pool = []; }
  release(player) {
    for (const drone of player.tacticalDrones || []) if (this.pool.length < 256) this.pool.push(drone);
    player.tacticalDrones = [];
  }
  prepare(player) {
    const count = Math.min(4, 1 + tier(player.level));
    player.tacticalDrones ||= [];
    while (player.tacticalDrones.length < count) {
      const index = player.tacticalDrones.length;
      const drone = this.pool.pop() || {};
      Object.assign(drone, { id: `blitz_${player.id}_${player.deathId}_${index}`, index,
        state: 'ORBIT', x: player.x, y: player.y, offsetX: 0, offsetY: 0, attackTimer: 0, vx: 0, vy: 0, rotation: 0, hazardOffsetX: 0, hazardOffsetY: 0, hazardKickX: 0, hazardKickY: 0 });
      player.tacticalDrones.push(drone);
    }
  }
  trigger(player, now = Date.now()) {
    if (!player.alive || player.hp <= 0 || player.levelUpPending || now < player.empUntil || now < player.swarmUntil) return false;
    this.prepare(player);
    const ready = [...player.tacticalDrones, ...player.drones].filter(d => !d.state || d.state === 'ORBIT');
    if (!ready.length) return false;
    player.swarmUntil = now + 8000;
    for (const d of ready) {
      d.state = 'ATTACK'; d.attackTimer = 3000; d.rotation = player.rotation;
      d.vx = Math.cos(player.rotation) * 900; d.vy = Math.sin(player.rotation) * 900;
    }
    this.sync(player, true);
    return true;
  }
  sync(player, launched = false) {
    this.room.io.to(this.room.roomId).emit('DRONE_STATE_SYNC', { roomId: this.room.roomId,
      playerId: player.id, deathId: player.deathId, launched,
      cooldown: Math.max(0, (player.swarmUntil || 0) - Date.now()),
      drones: [...player.tacticalDrones, ...player.drones].map(d => ({ id: d.id, state: d.state || 'ORBIT',
        x: d.x, y: d.y, offsetX: d.offsetX || 0, offsetY: d.offsetY || 0, attackTimer: d.attackTimer || 0 })) });
  }
  update(dt = 1 / 30, now = Date.now()) {
    this.cells.clear();
    for (const p of this.room.players.values()) if (p.alive) {
      const key = `${Math.floor(p.x / 128)},${Math.floor(p.y / 128)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(p);
    }
    for (const p of this.room.players.values()) {
      if (!p.alive) { if (p.tacticalDrones?.length) this.release(p); continue; }
      this.prepare(p);
      let changed = false;
      const drones = [...p.tacticalDrones, ...p.drones];
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        d.state ||= 'ORBIT';
        const theta = now / 1000 * 0.4 + i * Math.PI * 2 / drones.length;
        d.hazardOffsetX = ((d.hazardOffsetX || 0) + (d.hazardKickX || 0)) * 0.94;
        d.hazardOffsetY = ((d.hazardOffsetY || 0) + (d.hazardKickY || 0)) * 0.94;
        d.hazardKickX = (d.hazardKickX || 0) * 0.9; d.hazardKickY = (d.hazardKickY || 0) * 0.9;
        const tx = p.x + 45 * Math.cos(theta) + d.hazardOffsetX;
        const ty = p.y + 45 * Math.sin(theta) + d.hazardOffsetY;
        if (d.state === 'ATTACK') {
          const x = d.x, y = d.y;
          const nx = Math.max(0, Math.min(this.room.world.width, x + d.vx * dt));
          const ny = Math.max(0, Math.min(this.room.world.height, y + d.vy * dt));
          d.attackTimer = Math.max(0, d.attackTimer - dt * 1000);
          let target = null, earliest = 2;
          // Swept collisions plus spatial buckets prevent tunnelling at 900px/s.
          for (let gx = Math.floor((Math.min(x, nx) - 20) / 128); gx <= Math.floor((Math.max(x, nx) + 20) / 128); gx++) {
            for (let gy = Math.floor((Math.min(y, ny) - 20) / 128); gy <= Math.floor((Math.max(y, ny) + 20) / 128); gy++) {
              for (const enemy of this.cells.get(`${gx},${gy}`) || []) {
                if (enemy === p || !enemy.alive) continue;
                const fraction = segmentHit(x, y, nx, ny, enemy, 20);
                if (fraction !== null && fraction < earliest) { earliest = fraction; target = enemy; }
              }
            }
          }
          d.x = target ? x + (nx - x) * earliest : nx;
          d.y = target ? y + (ny - y) * earliest : ny;
          if (target) {
            target.takeDamage(75, p);
            this.room.impacts.push([d.id, d.x, d.y, 0x00ffff]);
          }
          if (target || d.attackTimer <= 0.000001 || nx === x && ny === y) { d.state = 'RETURNING'; changed = true; }
        } else if (d.state === 'RETURNING') {
          const lerp = 1 - Math.pow(0.85, dt * 30);
          d.x += (tx - d.x) * lerp; d.y += (ty - d.y) * lerp;
          if (Math.hypot(tx - d.x, ty - d.y) <= 5) { d.state = 'ORBIT'; changed = true; }
        } else { d.x = tx; d.y = ty; }
        d.offsetX = d.x - p.x; d.offsetY = d.y - p.y;
      }
      if (changed) this.sync(p);
    }
  }
  destroy() { this.cells.clear(); this.pool.length = 0; }
}
module.exports = { DroneSwarm };

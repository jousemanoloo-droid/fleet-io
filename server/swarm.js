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
        state: 'ORBIT',targetId:null, x: player.x, y: player.y, offsetX: 0, offsetY: 0, attackTimer: 0, vx: 0, vy: 0, rotation: 0, hazardOffsetX: 0, hazardOffsetY: 0, hazardKickX: 0, hazardKickY: 0 });
      player.tacticalDrones.push(drone);
    }
  }
  trigger(player, now = Date.now()) {
    if (!player.alive || player.hp <= 0 || player.levelUpPending || player.evolutionPending || now < player.cloakUntil || now < player.empUntil || now < player.swarmUntil) return false;
    this.prepare(player);
    const ready = [...player.tacticalDrones, ...player.drones,...player.orbitalDrones].filter(d => !d.state || d.state === 'ORBIT');
    if (!ready.length) return false;
    player.swarmUntil = now + 8000;
    const target=this.acquireTarget(player,now);
    for (const d of ready) {
      d.state = target?'ATTACK_SWARM':'DEFENSIVE_SWEEP';d.targetId=target?.id || null;d.attackTimer=6000;d.rotation=player.rotation;
      d.vx=d.vy=0;
    }
    this.sync(player, true);
    return true;
  }
  validTarget(target,player,now){return target && target!==player && target.alive && target.hp>0 && !target.invulnerable && !target.evolutionPending && !(now<target.cloakUntil) && !(now<target.spawnProtectionUntil);}
  acquireTarget(player,now){
    let target=null,best=800*800;
    for(const other of this.room.players.values()){
      if(!this.validTarget(other,player,now))continue;const distance=(other.x-player.x)**2+(other.y-player.y)**2;
      if(distance<=best){target=other;best=distance;}
    }
    const boss=this.room.events?.boss;
    if(this.validTarget(boss,player,now) && (boss.x-player.x)**2+(boss.y-player.y)**2<best)target=boss;
    return target;
  }
  sync(player, launched = false) {
    const payload = { roomId: this.room.roomId,
      playerId: player.id, deathId: player.deathId, launched,
      cooldown: Math.max(0, (player.swarmUntil || 0) - Date.now()),
      drones: [...player.tacticalDrones, ...player.drones,...player.orbitalDrones].map(d => ({ id: d.id, state: d.state || 'ORBIT',targetId:d.targetId || null,
        x: d.x, y: d.y, offsetX: d.offsetX || 0, offsetY: d.offsetY || 0, attackTimer: d.attackTimer || 0 })) };
    if (this.room.emitSpatial) this.room.emitSpatial('DRONE_STATE_SYNC',payload,player.x,player.y);
    else this.room.io.to(this.room.roomId).emit('DRONE_STATE_SYNC',payload);
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
      const drones = [...p.tacticalDrones, ...p.drones,...p.orbitalDrones];
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        d.state ||= 'ORBIT';
        const theta = now / 1000 * 0.4 + i * Math.PI * 2 / drones.length;
        d.hazardOffsetX = ((d.hazardOffsetX || 0) + (d.hazardKickX || 0)) * 0.94;
        d.hazardOffsetY = ((d.hazardOffsetY || 0) + (d.hazardKickY || 0)) * 0.94;
        d.hazardKickX = (d.hazardKickX || 0) * 0.9; d.hazardKickY = (d.hazardKickY || 0) * 0.9;
        const orbitRadius=d.state==='DEFENSIVE_SWEEP'?130:d.autonomous?72:45;
        const tx = Math.max(0,Math.min(this.room.world.width,p.x + orbitRadius * Math.cos(theta) + d.hazardOffsetX));
        const ty = Math.max(0,Math.min(this.room.world.height,p.y + orbitRadius * Math.sin(theta) + d.hazardOffsetY));
        if(d.state==='ATTACK_SWARM'){
          let target=this.room.players.get(d.targetId) || (this.room.events?.boss?.id===d.targetId?this.room.events.boss:null);
          if(!this.validTarget(target,p,now)){target=this.acquireTarget(p,now);d.targetId=target?.id || null;changed=true;}
          if(target){
            const lead=Math.min(.35,Math.hypot(target.x-d.x,target.y-d.y)/900);
            const angle=Math.atan2(target.y+(target.vy || 0)*30*lead-d.y,target.x+(target.vx || 0)*30*lead-d.x);
            const steering=1-Math.exp(-12*dt);d.vx+=(Math.cos(angle)*900-d.vx)*steering;d.vy+=(Math.sin(angle)*900-d.vy)*steering;d.rotation=Math.atan2(d.vy,d.vx);
          }else{d.state='DEFENSIVE_SWEEP';d.vx=d.vy=0;}
        }
        if (d.state === 'ATTACK' || d.state==='ATTACK_SWARM') {
          const x = d.x, y = d.y;
          const nx = Math.max(0, Math.min(this.room.world.width, x + d.vx * dt));
          const ny = Math.max(0, Math.min(this.room.world.height, y + d.vy * dt));
          d.attackTimer = Math.max(0, d.attackTimer - dt * 1000);
          let target = null, earliest = 2;
          // Swept collisions plus spatial buckets prevent tunnelling at 900px/s.
          for (let gx = Math.floor((Math.min(x, nx) - 20) / 128); gx <= Math.floor((Math.max(x, nx) + 20) / 128); gx++) {
            for (let gy = Math.floor((Math.min(y, ny) - 20) / 128); gy <= Math.floor((Math.max(y, ny) + 20) / 128); gy++) {
              for (const enemy of this.cells.get(`${gx},${gy}`) || []) {
                if (!this.validTarget(enemy,p,now)) continue;
                const fraction = segmentHit(x, y, nx, ny, enemy, enemy.radius+4);
                if (fraction !== null && fraction < earliest) { earliest = fraction; target = enemy; }
              }
            }
          }
          const boss=this.room.events?.boss;
          if(this.validTarget(boss,p,now)){
            const fraction=segmentHit(x,y,nx,ny,boss,boss.radius+4);
            if(fraction!==null && fraction<earliest){earliest=fraction;target=boss;}
          }
          d.x = target ? x + (nx - x) * earliest : nx;
          d.y = target ? y + (ny - y) * earliest : ny;
          if (target) {
            if(target===boss)this.room.events.bossHit(75,p);else target.takeDamage(75, p);
            this.room.impacts.push([d.id, d.x, d.y, 0x00ffff]);
          }
          if (target || d.attackTimer <= 0.000001 || nx === x && ny === y) { d.state = 'RETURNING';d.targetId=null; changed = true; }
        } else if(d.state==='DEFENSIVE_SWEEP'){
          d.attackTimer=Math.max(0,d.attackTimer-dt*1000);const blend=1-Math.exp(-8*dt);d.x+=(tx-d.x)*blend;d.y+=(ty-d.y)*blend;
          if(d.attackTimer<=.000001){d.state='RETURNING';changed=true;}
        } else if (d.state === 'RETURNING') {
          const lerp = 1 - Math.pow(0.85, dt * 30);
          d.x += (tx - d.x) * lerp; d.y += (ty - d.y) * lerp;
          if (Math.hypot(tx - d.x, ty - d.y) <= 5) { d.state = 'ORBIT'; changed = true; }
        } else if(!d.autonomous){ d.x = tx; d.y = ty; }
        d.offsetX = d.x - p.x; d.offsetY = d.y - p.y;
      }
      if (changed) this.sync(p);
    }
  }
  destroy() { this.cells.clear(); this.pool.length = 0; }
}
module.exports = { DroneSwarm };

'use strict';

// Fracción de impacto de un segmento contra un círculo: impide atravesar
// naves/obstáculos cuando un proyectil avanza muchos píxeles en un tick.
function segmentHit(x, y, nextX, nextY, target, radius) {
  const dx = nextX - x, dy = nextY - y;
  const ox = x - target.x, oy = y - target.y;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (!a) return null;
  const b = 2 * (ox * dx + oy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function updateCombat(room, tick) {
  const players = [...room.players.values()];
  const RPG = require('./rpg');
  const Classes = require('./shipClasses');
  const now = Date.now();
  const grid=room.combatGrid ||= new (require('./combatGrid').CombatGrid)();
  grid.rebuild(players);
  const nearest = (player, origin, range) => {
    let enemy = null, distance = range;
    for (const other of players) {
      if (other === player || !other.alive || other.invulnerable || other.evolutionPending || now < other.cloakUntil || now < other.spawnProtectionUntil) continue;
      const d = Math.hypot(other.x - origin.x, other.y - origin.y);
      if (d < distance) { enemy = other; distance = d; }
    }
    for (const pod of room.competitive?.pods.values() || []) {
      const d = Math.hypot(pod.x-origin.x,pod.y-origin.y);
      if (d < distance) { enemy=pod; distance=d; }
    }
    const boss = room.events?.boss;
    if (boss?.alive && Math.hypot(boss.x - origin.x, boss.y - origin.y) < distance) {
      enemy = boss; distance = Math.hypot(boss.x - origin.x, boss.y - origin.y);
    }
    if (!enemy && room.events) for (const rock of room.obstacles.values()) {
      const d = Math.hypot(rock.x - origin.x, rock.y - origin.y);
      if (d < Math.min(distance, 400)) { enemy = { ...rock, vx: 0, vy: 0 }; distance = d; }
    }
    return { enemy, distance };
  };
  const fire = (player, origin, enemy, distance, heavy = false) => {
    if (room.projectiles.size >= 240) return;
    const id = `shot_${room.uidCounter++}`;
    const launch = require('../client/js/ballistics').launch(player, origin, enemy, origin.offset || 0, origin === player || origin.main ? player.radius : 8);
    if (origin.main) player.fireSeq = (player.fireSeq || 0) + 1;
    room.projectiles.set(id, { id, ownerId: player.id, ...launch, fireSeq: origin.main ? player.fireSeq : 0, sourceId: player.id, deathId: player.deathId,
      damage: RPG.damage(player) * (heavy ? 1.35 : 1), ttl: 45, color: require('./cosmetics').laserColor(player,tick),
      splash: origin.main ? Classes.definition(player.shipClass)?.splash || 0 : 0,
      piercing: player.supplyBuff === 'PIERCING_LASERS' && now < player.supplyUntil, hitIds: new Set() });
  };
  for (const player of players) {
    if (!player.alive || player.levelUpPending || player.evolutionPending || now < player.cloakUntil || now < player.empUntil) continue;
    if (tick >= (player.nextFireTick || 0)) {
      const { enemy, distance } = nearest(player, player, 550);
      if (enemy) {
        const delay = RPG.cooldown(player) / (1000 / 30);
        // Deadlines fraccionarios conservan la cadencia media de cada stack,
        // evitando que redondear 380 ms a 12 ticks anule el primer bonus.
        const due = player.nextFireTick && player.nextFireTick > tick-delay ? player.nextFireTick : tick;
        player.nextFireTick = due + delay;
        const chassis = RPG.tier(player.level);
        const model={x:player.x,y:player.y,rotation:player.rotation,shipClass:player.shipClass,chassis:Classes.definition(player.shipClass)?.texture || chassis,powerTripleRemaining:Math.max(0,(player.powerTripleUntil || 0)-now)};
        for (const shot of Classes.pattern(model)) {
          fire(player, { ...Classes.muzzle(model,shot.gun),spread:shot.spread }, enemy, distance, !player.shipClass && chassis >= 3);
        }
      }
    }
    if (player.shipClass === 'carrier') player.carrierTarget = nearest(player, player, 450).enemy;
    if (player.orbitalDrones.length && tick >= (player.nextOrbitalFireTick || 0)) {
      player.nextOrbitalFireTick = tick + (now < player.overdriveUntil ? 6 : 12);
      for (const drone of player.orbitalDrones) {
        const { enemy, distance } = nearest(player, drone, 400);
        if (enemy) fire(player,{...Classes.muzzle({x:drone.x,y:drone.y,rotation:drone.state==='ATTACK_SWARM'?drone.rotation:Math.atan2(drone.y-player.y,drone.x-player.x),chassis:1},0,.28),main:false},enemy,distance);
      }
    }
  }
  for (const [id, shot] of room.projectiles) {
    let endX = shot.x + shot.vx, endY = shot.y + shot.vy, consumed = false;
    shot.hitIds ||= new Set();
    // Swept collisions, including several piercing hits in the same server tick.
    for (let pass=0; pass<64; pass++) {
      const portal=room.hazards?.portalHit(shot,'bullet',endX,endY,now);
      let impact=portal?'portal':null, hit=portal, fraction=portal?.fraction ?? Infinity;
      const consider = (target,radius,kind) => {
        if (shot.hitIds.has(target.id)) return;
        const t=segmentHit(shot.x,shot.y,endX,endY,target,radius+3);
        if (t !== null && t < fraction) { fraction=t; impact=kind; hit=target; }
      };
      for (const rock of room.obstacles.values()) consider(rock,rock.radius,'obstacle');
      for (const pod of room.competitive?.pods.values() || []) consider(pod,pod.radius,'pod');
      const boss=room.events?.boss;
      if (boss && boss.id !== shot.ownerId) consider(boss,boss.radius,'boss');
      grid.visit(shot.x,shot.y,endX,endY,(target,p,radius)=>{
        if (p.id === shot.ownerId || !p.alive || p.invulnerable || p.evolutionPending || now < p.spawnProtectionUntil || now < p.revengeUntil || now < p.revengeShieldUntil) return;
        if(target===p) {consider(p,radius,'player');return;}
        if(!p.drones.includes(target) || shot.hitIds.has(target.id))return;
        const t=segmentHit(shot.x,shot.y,endX,endY,target,radius);
        if(t!==null && t<fraction){fraction=t;impact='drone';hit={player:p,drone:target,id:target.id};}
      });
      if (!impact) { shot.x=endX; shot.y=endY; break; }
      shot.x += (endX-shot.x)*fraction; shot.y += (endY-shot.y)*fraction;
      if (impact === 'portal') {
        room.hazards.traverse(shot,'bullet',hit,now);
        endX=shot.x+shot.vx*(1-fraction);endY=shot.y+shot.vy*(1-fraction);
        continue;
      }
      room.impacts?.push([shot.id, +shot.x.toFixed(1), +shot.y.toFixed(1), shot.color]);
      if (impact === 'player' && ((now < hit.parryUntil && (shot.vx * Math.cos(hit.rotation) + shot.vy * Math.sin(hit.rotation)) / (Math.hypot(shot.vx, shot.vy) || 1) <= -0.5) || (hit.supplyBuff === 'MIRROR_SHIELD' && now < hit.supplyUntil))) {
        // Seis rebotes máximos por proyectil: cada reflexión válida mantiene
        // exactamente -2x velocidad y 2x daño sin overflow ni bucles infinitos.
        if ((shot.reflections || 0) >= 6) { consumed=true; break; }
        shot.reflections=(shot.reflections || 0)+1;
        shot.motionRevision=(shot.motionRevision || 0)+1;
        shot.vx = -2*shot.vx; shot.vy = -2*shot.vy;
        shot.ownerId=hit.id; shot.color=hit.color; shot.damage*=2;
        shot.parryOwnerId = now < hit.parryUntil ? hit.id : null;
        shot.hitIds.clear(); shot.piercing=hit.supplyBuff === 'PIERCING_LASERS' && now < hit.supplyUntil;
        const length=Math.hypot(shot.vx,shot.vy) || 1;
        shot.x += shot.vx/length*(hit.radius+5); shot.y += shot.vy/length*(hit.radius+5);
        if (room.emitSpatial) room.emitSpatial('PARRY_REFLECTED',{id:hit.id,x:hit.x,y:hit.y});
        else room.io?.to(room.roomId).emit('PARRY_REFLECTED',{roomId:room.roomId,id:hit.id,x:hit.x,y:hit.y});
        break;
      }
      const attacker=room.players.get(shot.ownerId);
      if (shot.splash) {
        for (const secondary of players) {
          if (secondary === hit || secondary.id === shot.ownerId || !secondary.alive) continue;
          const distance = Math.hypot(secondary.x-shot.x, secondary.y-shot.y);
          if (distance < shot.splash) secondary.takeDamage(shot.damage*.6*(1-distance/shot.splash),attacker);
        }
        shot.piercing = false;
      }
      if (impact === 'player') {
        const before=hit.hp, wasAlive=hit.alive;
        hit.takeDamage(shot.damage,attacker,shot.parryOwnerId === attacker?.id);
        if (boss?.id === shot.ownerId && before > hit.hp) {
          hit.escapeThreat=boss.id;
          if (!hit.alive) hit.killedBy={id:boss.id,name:'Leviathan',chassis:4,skin:'gold',hpPercent:Math.round(boss.hp/boss.maxHp*100),score:0,streak:0,killEffect:'default'};
        }
        if (before > hit.hp) room.io?.to(hit.id).emit('player_hit',{roomId:room.roomId,damage:before-hit.hp,hp:hit.hp,maxHp:hit.maxHp,x:hit.x,y:hit.y});
        if (wasAlive && !hit.alive && attacker?.alive) room.io?.to(room.roomId).emit('kill_streak',{roomId:room.roomId,id:attacker.id,name:attacker.name,streak:attacker.killStreak});
      } else if (impact === 'boss') room.events.bossHit(shot.damage,attacker);
      else if (impact === 'pod') room.competitive.hitPod(hit,shot.damage,attacker);
      else if (impact === 'obstacle' && shot.ownerId !== boss?.id) room.events?.asteroidHit(hit,shot.damage,attacker);
      else if (impact === 'drone') {
        hit.player.drones.splice(hit.player.drones.indexOf(hit.drone),1);
        room.events?.scatter(hit.drone.x,hit.drone.y,20);
      }
      if (!shot.piercing || impact === 'obstacle' || impact === 'pod') { consumed=true; break; }
      shot.hitIds.add(hit.id);
      // Each entity is damaged once for this projectile's lifetime.
      if (pass === 63) { shot.x=endX; shot.y=endY; }
    }
    shot.ttl--;
    if (consumed || shot.ttl <= 0 || shot.x < 0 || shot.y < 0 || shot.x > room.world.width || shot.y > room.world.height) room.projectiles.delete(id);
  }
  // Do not retain a killed/disconnected ship between ticks via scratch buckets.
  grid.clear();
}

function resolveObstacles(player, obstacles) {
  for (const obstacle of obstacles.values()) {
    const dx = player.x - obstacle.x, dy = player.y - obstacle.y;
    const distance = Math.hypot(dx, dy);
    const radius = player.radius + obstacle.radius;
    if (distance >= radius) continue;
    player.x = obstacle.x + (distance ? dx / distance : 1) * radius;
    player.y = obstacle.y + (distance ? dy / distance : 0) * radius;
    player.vx *= 0.5; player.vy *= 0.5;
        for (const key of ['kickX','kickY','kickAppliedX','kickAppliedY']) player[key]=(player[key] || 0)*.5;
  }
}

module.exports = { updateCombat, resolveObstacles, segmentHit };

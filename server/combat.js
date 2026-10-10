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
  const now = Date.now();
  const nearest = (player, origin, range) => {
    let enemy = null, distance = range;
    for (const other of players) {
      if (other === player || !other.alive || other.invulnerable || now < other.spawnProtectionUntil) continue;
      const d = Math.hypot(other.x - origin.x, other.y - origin.y);
      if (d < distance) { enemy = other; distance = d; }
    }
    return { enemy, distance };
  };
  const fire = (player, origin, enemy, distance, heavy = false) => {
    if (room.projectiles.size >= 240) return;
    const flightTicks = distance / 15;
    const angle = Math.atan2(enemy.y + enemy.vy * flightTicks - origin.y,
      enemy.x + enemy.vx * flightTicks - origin.x);
    const id = `shot_${room.uidCounter++}`;
    room.projectiles.set(id, { id, ownerId: player.id, x: origin.x, y: origin.y,
      vx: Math.cos(angle) * 15, vy: Math.sin(angle) * 15,
      damage: RPG.damage(player) * (heavy ? 1.35 : 1), ttl: 45, color: player.color });
  };
  for (const player of players) {
    if (!player.alive || player.levelUpPending || now < player.empUntil) continue;
    if (tick >= (player.nextFireTick || 0)) {
      const { enemy, distance } = nearest(player, player, 550);
      if (enemy) {
        player.nextFireTick = tick + Math.ceil(RPG.cooldown(player) / (1000 / 30));
        const chassis = RPG.tier(player.level);
        const offsets = chassis === 4 ? [-15, -5, 5, 15] : chassis >= 2 ? [-5, 5] : [0];
        const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
        for (const y of offsets) {
          fire(player, { x: player.x + Math.cos(angle) * 10 - Math.sin(angle) * y,
            y: player.y + Math.sin(angle) * 10 + Math.cos(angle) * y }, enemy, distance, chassis >= 3);
        }
      }
    }
    if (player.level === 40 && tick >= (player.nextOrbitalFireTick || 0)) {
      player.nextOrbitalFireTick = tick + 12;
      for (const drone of player.orbitalDrones) {
        const { enemy, distance } = nearest(player, drone, 400);
        if (enemy) fire(player, drone, enemy, distance);
      }
    }
  }
  for (const [id, shot] of room.projectiles) {
    const nextX = shot.x + shot.vx, nextY = shot.y + shot.vy;
    let impact = null, hit = null, fraction = Infinity;
    const consider = (target, radius, kind) => {
      const t = segmentHit(shot.x, shot.y, nextX, nextY, target, radius + 3);
      if (t !== null && t < fraction) { fraction = t; impact = kind; hit = target; }
    };
    for (const obstacle of room.obstacles.values()) consider(obstacle, obstacle.radius, 'obstacle');
    for (const player of players) {
      if (player.id === shot.ownerId || !player.alive || player.invulnerable ||
          Date.now() < player.spawnProtectionUntil) continue;
      consider(player, player.radius, 'player');
      for (const drone of player.drones) {
        const t = segmentHit(shot.x, shot.y, nextX, nextY, drone, 8);
        if (t !== null && t < fraction) {
          fraction = t; impact = 'drone'; hit = { player, drone };
        }
      }
    }
    if (impact) room.impacts?.push([shot.id,
      +(shot.x + (nextX - shot.x) * fraction).toFixed(1),
      +(shot.y + (nextY - shot.y) * fraction).toFixed(1), shot.color]);
    if (impact === 'player') {
      const attacker = room.players.get(shot.ownerId);
      const before = hit.hp, wasAlive = hit.alive;
      hit.takeDamage(shot.damage, attacker);
      if (before > hit.hp) room.io?.to(hit.id).emit('player_hit', { roomId: room.roomId, damage: before - hit.hp, x: hit.x, y: hit.y });
      if (wasAlive && !hit.alive && attacker) room.io?.to(room.roomId).emit('kill_streak', {
        roomId: room.roomId, id: attacker.id, name: attacker.name, streak: attacker.killStreak });
    }
    if (impact === 'drone') hit.player.drones.splice(hit.player.drones.indexOf(hit.drone), 1);
    shot.x = nextX; shot.y = nextY; shot.ttl--;
    if (impact || shot.ttl <= 0 || nextX < 0 || nextY < 0 ||
        nextX > room.world.width || nextY > room.world.height) room.projectiles.delete(id);
  }
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
  }
}

module.exports = { updateCombat, resolveObstacles, segmentHit };

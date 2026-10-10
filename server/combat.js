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
  for (const player of players) {
    if (!player.alive || !player.drones.length || player.levelUpPending ||
        tick < (player.nextFireTick || 0) || room.projectiles.size >= 240) continue;
    let enemy = null, distance = 550;
    for (const other of players) {
      if (other === player || !other.alive || other.invulnerable ||
          Date.now() < other.spawnProtectionUntil) continue;
      const d = Math.hypot(other.x - player.x, other.y - player.y);
      if (d < distance) { enemy = other; distance = d; }
    }
    if (!enemy) continue;
    player.nextFireTick = tick + 12;
    const flightTicks = distance / 15;
    const angle = Math.atan2(enemy.y + enemy.vy * flightTicks - player.y,
      enemy.x + enemy.vx * flightTicks - player.x);
    const id = `shot_${room.uidCounter++}`;
    room.projectiles.set(id, {
      id, ownerId: player.id, x: player.x + Math.cos(angle) * (player.radius + 8),
      y: player.y + Math.sin(angle) * (player.radius + 8),
      vx: Math.cos(angle) * 15, vy: Math.sin(angle) * 15,
      damage: 5 + Math.min(12, player.drones.length), ttl: 45, color: player.color,
    });
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
    if (impact === 'player') hit.takeDamage(shot.damage);
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

'use strict';
const Progression = require('../client/js/progression');
const LIMITS = Object.freeze({ speed: 10, shield: 10, damage: 10, fireRate: 20 });
const ABILITIES = Object.freeze({ dash: { cooldown: 3000, duration: 250 },
  shield: { cooldown: 12000, duration: 2000 }, emp: { cooldown: 15000, duration: 1500 } });

function init(p) {
  p.xp = 0; p.totalXp = 0; p.attributePoints = 0;
  p.attributes = { speed: 0, shield: 0, damage: 0, fireRate: 0 };
  p.pendingLevelUps = []; p.killStreak = 0; p.killedBy = null;
  p.abilityReady = { dash: 0, shield: 0, emp: 0 };
  p.dashUntil = p.shieldUntil = p.empUntil = 0;
  p.orbitalDrones = []; p.orbitAngle = 0; p.matchStartedAt = Date.now();
  p.skin = 'default'; p.trail = 'cyan'; p.dailyBoostUntil = 0; p.dailyBoostUsed = false;
}
function tier(level) { return level >= 40 ? 4 : level >= 25 ? 3 : level >= 10 ? 2 : 1; }
function addXP(p, amount) {
  // XP residual para la barra y XP acumulada para restaurar una vida recompensada.
  // Un drop puede cruzar varios niveles: cada subida concede sus propios puntos.
  if (!Number.isFinite(amount) || amount <= 0) return;
  p.totalXp += Math.floor(amount); p.xp += Math.floor(amount);
  while (p.level < 40 && p.xp >= Progression.requiredXP(p.level)) {
    p.xp -= Progression.requiredXP(p.level); p.level++; p.attributePoints += 3;
    if (p.level % 10 === 0) { p.levelUpPending = true; p.invulnerable = true; }
    p.pendingLevelUps.push({ level: p.level, attributePoints: p.attributePoints, chassis: tier(p.level) });
  }
  if (p.level === 40) p.xp = Math.min(p.xp, Progression.requiredXP(40));
}
function restoreXP(p, total) {
  p.totalXp = Math.max(0, Math.floor(total));
  p.level = Progression.levelForXP(p.totalXp);
  p.xp = Math.min(Progression.requiredXP(p.level), p.totalXp - Progression.thresholdXP(p.level));
  p.pendingLevelUps = [];
}
function allocate(p, attribute, points = 1) {
  // Velocidad interna en píxeles/tick; la UI expresa el incremento en px/s.
  // Comprobar todo antes de descontar evita compras parciales o puntos negativos.
  if (!Object.hasOwn(LIMITS, attribute) || !Number.isSafeInteger(points) || points < 1 ||
      points > p.attributePoints || p.attributes[attribute] + points > LIMITS[attribute]) return false;
  p.attributePoints -= points; p.attributes[attribute] += points;
  if (attribute === 'speed') p.maxSpeed += points * 15 / 30;
  if (attribute === 'shield') { p.maxHp += points * 50; p.hp = Math.min(p.maxHp, p.hp + points * 50); }
  return true;
}
const cooldown = p => Math.max(100, 400 - p.attributes.fireRate * 15);
const damage = p => (5 + Math.min(12, p.drones.length)) * (1 + p.attributes.damage * 0.1);

function activate(p, type, room, now = Date.now()) {
  if (!Object.hasOwn(ABILITIES, type)) return false;
  const config = ABILITIES[type];
  if (!config || !p.alive || p.hp <= 0 || p.levelUpPending || now < p.empUntil ||
      now < p.abilityReady[type]) return false;
  p.abilityReady[type] = now + config.cooldown;
  if (type === 'dash') {
    p.dashUntil = now + config.duration;
    // Mantener la inercia al terminar; el modelo compartido limita el burst.
    p.vx *= 2.8; p.vy *= 2.8;
  } else if (type === 'shield') p.shieldUntil = now + config.duration;
  else for (const other of room.players.values()) {
    if (other !== p && other.alive && Math.hypot(other.x - p.x, other.y - p.y) <= 350) {
      other.empUntil = Math.max(other.empUntil, now + config.duration);
    }
  }
  return true;
}
function movement(p, now = Date.now()) {
  p.dashing = now < p.dashUntil;
  p.slowed = now < p.empUntil;
  p.boosted = now < p.dailyBoostUntil;
}
function orbit(p) {
  if (p.level < 40 || !p.alive) { p.orbitalDrones = []; return; }
  p.orbitAngle = (p.orbitAngle + Math.PI / 30) % (2 * Math.PI);
  p.orbitalDrones = [0, 1].map(index => ({ id: `orbital_${p.id}_${index}`, autonomous: true,
    x: p.x + Math.cos(p.orbitAngle + index * Math.PI) * 72,
    y: p.y + Math.sin(p.orbitAngle + index * Math.PI) * 72 }));
}
function killerInfo(p) {
  return { id: p.id, name: p.name, skin: p.skin, chassis: tier(p.level),
    hpPercent: Math.round(p.hp / p.maxHp * 100), score: p.score, streak: p.killStreak };
}
function network(p, now = Date.now()) {
  // Enviar duraciones restantes evita depender del reloj del navegador remoto.
  return { xp: p.xp, totalXp: p.totalXp, attributePoints: p.attributePoints,
    attributes: { ...p.attributes }, chassis: tier(p.level), killStreak: p.killStreak,
    killedBy: p.killedBy, skin: p.skin, trail: p.trail,
    dashing: now < p.dashUntil, slowed: now < p.empUntil, shielded: now < p.shieldUntil,
    boosted: now < p.dailyBoostUntil,
    cooldowns: Object.fromEntries(Object.entries(p.abilityReady).map(([key, value]) => [key, Math.max(0, value - now)])),
    abilityDurations: { dash: Math.max(0, p.dashUntil - now), shield: Math.max(0, p.shieldUntil - now),
      emp: Math.max(0, p.empUntil - now), boost: Math.max(0, p.dailyBoostUntil - now) },
    survivedMs: Math.max(0, now - p.matchStartedAt),
  };
}
// Revenge conserva un reinicio gratuito y evita asteroides/solapamientos.
function revengeSpawn(p, killer, room) {
  if (!killer?.alive) return false;
  for (let i = 0; i < 72; i++) {
    const angle = i * 2.39996, radius = 400 + (i % 11) * 10;
    const x = killer.x + Math.cos(angle) * radius, y = killer.y + Math.sin(angle) * radius;
    if (x < p.radius || y < p.radius || x > room.world.width - p.radius || y > room.world.height - p.radius) continue;
    if ([...room.obstacles.values()].some(o => Math.hypot(x - o.x, y - o.y) < o.radius + p.radius + 8)) continue;
    if ([...room.players.values()].some(o => o !== p && o.alive && Math.hypot(x - o.x, y - o.y) < o.radius + p.radius + 20)) continue;
    p.x = p.targetX = x; p.y = p.targetY = y;
    return true;
  }
  return false;
}
module.exports = { init, addXP, restoreXP, allocate, tier, cooldown, damage, activate, movement, orbit,
  killerInfo, network, revengeSpawn, LIMITS, ABILITIES };

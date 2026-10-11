'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RPG = require('../server/rpg');
const P = require('../client/js/progression');
const Network = require('../client/js/network');
const { Player } = require('../server/entities');
const { updateCombat } = require('../server/combat');

function room(...players) {
  return { roomId: 'test', world: { width: 4000, height: 4000 }, players: new Map(players.map(p => [p.id, p])),
    obstacles: new Map(), projectiles: new Map(), impacts: [], uidCounter: 1, io: { to: () => ({ emit() {} }) } };
}
function pilot(id = 'pilot') { const p = new Player(id, id); p.x = p.y = p.targetX = p.targetY = 2000; return p; }

test('XP has exact per-level costs, 3 points per level and four evolution tiers', () => {
  const p = pilot();
  for (let level = 1; level < 40; level++) {
    p.levelUpPending = false; p.invulnerable = false;
    const remaining = P.requiredXP(level) - p.xp;
    RPG.addXP(p, remaining - 1); assert.equal(p.level, level);
    RPG.addXP(p, 1); assert.equal(p.level, level + 1);
    assert.equal(p.attributePoints, level * 3);
    assert.equal(p.xp, 0);
  }
  RPG.addXP(p, 1000000); assert.equal(p.level, 40); assert.equal(p.attributePoints, 117);
  assert.deepEqual([1, 10, 25, 40].map(RPG.tier), [1, 2, 3, 4]);
  assert.equal(p.pendingLevelUps.length, 39);
});

test('attribute allocation rejects overspending and enforces exact caps', () => {
  const p = pilot(); p.attributePoints = 117;
  assert.equal(RPG.allocate(p, 'speed', 10), true); assert.equal(p.maxSpeed, 12.5);
  assert.equal(RPG.allocate(p, 'speed'), false);
  assert.equal(RPG.allocate(p, 'shield', 10), true); assert.equal(p.maxHp, 600);
  assert.equal(RPG.allocate(p, 'damage', 10), true); assert.equal(RPG.damage(p), 10);
  assert.equal(RPG.allocate(p, 'fireRate', 20), true); assert.equal(RPG.cooldown(p), 100);
  for (const [key, points] of [['damage', 1], ['speed', -1], ['bogus', 1], ['shield', 0.5], ['fireRate', 999]]) {
    assert.equal(RPG.allocate(p, key, points), false);
  }
  assert.equal(p.attributePoints, 67);
});

test('abilities validate cooldowns, exact durations, protection and EMP range', () => {
  const p = pilot(), near = pilot('near'), far = pilot('far');
  for (const invalid of ['toString', '__proto__', 'constructor', 'unknown']) {
    assert.equal(RPG.activate(p, invalid, room(p, near, far)), false);
  }
  near.x += 349; far.x += 351; const r = room(p, near, far), now = Date.now();
  p.vx = 2;
  assert.equal(RPG.activate(p, 'dash', r, now), true); assert.equal(p.vx, 5.6);
  assert.equal(p.dashUntil, now + 250); assert.equal(p.abilityReady.dash, now + 3000);
  assert.equal(p.takeDamage(20), false); assert.equal(RPG.activate(p, 'dash', r, now + 100), false);
  assert.equal(RPG.activate(p, 'shield', r, now), true); assert.equal(p.shieldUntil, now + 2000);
  assert.equal(RPG.activate(p, 'emp', r, now), true);
  assert.equal(near.empUntil, now + 1500); assert.equal(far.empUntil, 0);
  RPG.movement(near, now); assert.equal(near.slowed, true);
  RPG.movement(near, now + 1501); assert.equal(near.slowed, false);
  assert.equal(RPG.activate(near, 'emp', r, now + 100), false);
  assert.equal(RPG.activate(p, 'unknown', r, now), false);
});

test('chassis fire one/two/two/four cannons; EMP disables all weapons', () => {
  for (const [level, shots] of [[1, 1], [10, 2], [25, 2], [40, 4]]) {
    const p = pilot(), enemy = pilot('enemy'); p.level = level; enemy.x += 300;
    enemy.nextFireTick = 999; const r = room(p, enemy);
    updateCombat(r, 1); assert.equal(r.projectiles.size, shots);
    r.projectiles.clear(); p.nextFireTick = 0; p.empUntil = Date.now() + 1500;
    updateCombat(r, 2); assert.equal(r.projectiles.size, 0);
  }
});

test('dreadnought has two autonomous drones with a 2-second orbit and 400px weapons', () => {
  const p = pilot(), enemy = pilot('enemy'); p.level = 40; enemy.x += 200; enemy.nextFireTick = 999;
  const r = room(p, enemy);
  for (let i = 0; i < 60; i++) RPG.orbit(p);
  assert.equal(p.orbitalDrones.length, 2);
  assert.ok(Math.abs(p.orbitalDrones[0].x - (p.x + 72)) < 0.001);
  updateCombat(r, 1); assert.equal(r.projectiles.size, 6);
});

test('killer capture and streak credit occur only once and revenge spawn respects distance', () => {
  const p = pilot(), attacker = pilot('attacker'); const r = room(p, attacker);
  p.takeDamage(1000, attacker); p.takeDamage(1000, attacker);
  assert.equal(attacker.killStreak, 1); assert.equal(attacker.score, 100);
  assert.equal(p.killedBy.name, 'attacker'); assert.equal(p.killedBy.hpPercent, 100);
  assert.equal(p.killStreak, 0);
  assert.equal(RPG.revengeSpawn(p, attacker, r), true);
  const distance = Math.hypot(p.x - attacker.x, p.y - attacker.y);
  assert.ok(distance >= 400 && distance <= 500);
  attacker.alive = false; assert.equal(RPG.revengeSpawn(p, attacker, r), false);
});

test('RPG snapshot roundtrip preserves abilities, XP, attributes, cosmetics and killer info', () => {
  const p = pilot(), attacker = pilot('attacker'); RPG.addXP(p, P.thresholdXP(25));
  p.skin = 'gold'; p.trail = 'purple'; p.applyUpgrade('nano_armor'); p.takeDamage(1000, attacker);
  const n = Network.player(Network.packPlayer(p));
  assert.equal(n.level, 25); assert.equal(n.chassis, 3); assert.equal(n.attributePoints, 72);
  assert.equal(n.skin, 'gold'); assert.equal(n.trail, 'purple'); assert.equal(n.killedBy.id, 'attacker');
  assert.equal(n.deathState.totalXp, p.totalXp);
});

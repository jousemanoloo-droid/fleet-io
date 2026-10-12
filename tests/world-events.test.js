'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorldEvents } = require('../server/worldEvents');
const { Player } = require('../server/entities');
const Network = require('../client/js/network');

function fixture(...ids) {
  const messages = [];
  const room = { roomId: 'room-test', world: { width: 4000, height: 4000 },
    players: new Map(), obstacles: new Map(), projectiles: new Map(),
    io: { to: id => ({ emit: (name, payload) => messages.push({ id, name, payload }) }) } };
  for (const id of ids) {
    const p = new Player(id, id); p.x = p.y = 2000; p.spawnProtectionUntil = 0; room.players.set(id, p);
  }
  room.events = new WorldEvents(room, 0, 0);
  return { room, events: room.events, messages, player: id => room.players.get(id) };
}
const sum = (iterable, key) => [...iterable].reduce((total, item) => total + item[key], 0);

test('death scatters 24 gems and a 50% total-XP core exactly once, expiring at 45 seconds', () => {
  const { events, player } = fixture('p'); const p = player('p');
  p.totalXp = 1001; p.xp = 1; p.die();
  events.death(p, 0); events.death(p, 0);
  assert.equal(events.gems.size, 24); assert.equal(events.cores.size, 1);
  assert.equal(sum(events.gems.values(), 'xp'), 501);
  assert.equal([...events.cores.values()][0].xp, 500);
  assert.equal(events.coreTarget(p, 44999).expiresIn, 1);
  events.update(45000); assert.equal(events.cores.size, 0); assert.equal(events.gems.size, 0);
});
test('scatter applies 0.92 friction before 300ms and magnetizes only living nearby collectors', () => {
  const { events, player } = fixture('p'); const p = player('p'); p.x = 2100;
  events.scatter(2000, 2000, 24, 0, 24, 0);
  const gem = events.gems.values().next().value, vx = gem.vx, vy = gem.vy;
  events.update(100); assert.ok(Math.abs(gem.vx - vx * 0.92) < 1e-8);
  assert.ok(Math.abs(gem.vy - vy * 0.92) < 1e-8);
  gem.x = 2000; gem.y = 2000; gem.vx = gem.vy = 0;
  events.update(300); assert.ok(gem.vx > 0); assert.equal(gem.vy, 0);
  p.die(); gem.vx = 0; events.update(334); assert.equal(gem.vx, 0);
});
test('physical gem and core collection grants XP once; other players can steal a core', () => {
  const { events, player, messages } = fixture('owner', 'thief'); const owner = player('owner'), thief = player('thief');
  owner.totalXp = 200; owner.die(); events.death(owner, 0);
  events.gems.clear(); events.update(301);
  assert.equal(events.cores.size, 0); assert.equal(thief.totalXp, 100);
  assert.equal(messages.find(m => m.name === 'core_collected').payload.recovered, false);
  events.update(400); assert.equal(thief.totalXp, 100);
});
test('narrow escape grants 200 XP after 3 damage-free seconds and never while dead', () => {
  const { events, player } = fixture('p', 'enemy'); const p = player('p');
  p.takeDamage(95, player('enemy')); p.lastDamageAt = 1000;
  events.update(3999); assert.equal(p.totalXp, 0);
  events.update(4000); assert.equal(p.totalXp, 200);
  events.update(5000); assert.equal(p.totalXp, 200);
  p.takeDamage(1); p.lastDamageAt = 5000; p.die(); events.update(9000);
  assert.equal(p.totalXp, 200);
});
test('eliminating the close-call attacker grants escape immediately', () => {
  const { events, player } = fixture('p', 'enemy'); const p = player('p'), enemy = player('enemy');
  p.takeDamage(95, enemy); enemy.takeDamage(100, p); events.death(enemy, 0);
  assert.equal(p.totalXp, 300); assert.equal(p.escapePending, false);
});
test('bounties issue once at ten kills or level 40 and award 5000 coins to the killer', () => {
  const { events, player, messages } = fixture('target', 'killer');
  const target = player('target'), killer = player('killer'); target.killStreak = 10;
  events.update(0); events.update(10);
  assert.equal(messages.filter(m => m.name === 'BOUNTY_ANNOUNCEMENT').length, 1);
  assert.ok(target.titles.includes('Space Terror'));
  target.takeDamage(100, killer); events.death(target, 20); events.death(target, 20);
  assert.equal(killer.coinRewards.length, 1); assert.equal(killer.coinRewards[0].coins, 5000);
  assert.equal(events.bounties.size, 0);
  target.respawn(false, events.room.players); target.level = 40; events.update(30);
  assert.equal(events.bounties.size, 1);
});
test('meteor warning precedes a bounded 15-rock storm by 15 seconds; gold has triple HP and fivefold yield', () => {
  const { events, room, messages } = fixture();
  events.nextBoss=1000000000;
  events.update(224999); assert.equal(messages.length, 0);
  events.update(225000); assert.equal(messages[0].name, 'METEOR_WARN');
  events.update(240000); assert.equal(room.obstacles.size, 15);
  for (const rock of room.obstacles.values()) {
    assert.equal(rock.maxHp, 300); assert.ok(Math.hypot(rock.x, rock.y) <= 600);
  }
  const rock = room.obstacles.values().next().value;
  events.asteroidHit(rock, 300); assert.equal(room.obstacles.size, 14);
  assert.equal(sum(events.gems.values(), 'xp'), 500); assert.equal(sum(events.gems.values(), 'coins'), 50);
  events.update(480000); assert.equal(room.obstacles.size, 15);
});
test('Leviathan patrol/aggression salvo and proportional 60/40 loot conserve XP and coins', () => {
  const { events, player, room } = fixture('a', 'b');
  player('a').x = player('b').x = 3500;
  events.spawnBoss();events.boss.x=events.boss.y=2000;events.nextBoss=1000000000;
  events.update(600000); assert.equal(events.boss.state, 'PATROL');
  player('a').x = player('a').y = 2000;
  events.update(600001); assert.equal(events.boss.state, 'AGGRESSION'); assert.equal(room.projectiles.size, 24);
  events.update(602999); assert.equal(room.projectiles.size, 24);
  events.update(603001); assert.equal(room.projectiles.size, 48);
  events.bossHit(3000, player('a')); events.bossHit(9000, player('b'));
  assert.equal(events.boss, null); assert.equal(player('a').totalXp, 1500); assert.equal(player('b').totalXp, 4500);
  assert.equal(sum(player('a').coinRewards, 'coins'), 750); assert.equal(sum(player('b').coinRewards, 'coins'), 2250);
  assert.equal(sum(events.gems.values(), 'xp'), 4000); assert.equal(sum(events.gems.values(), 'coins'), 2000);
  assert.ok(player('b').titles.includes('Leviathan Slayer'));
});
test('scatter pooling remains bounded and preserves all XP and coin values under repeated bursts', () => {
  const { events } = fixture();
  for (let i = 0; i < 100; i++) events.scatter(2000, 2000, 100, 50);
  assert.equal(events.gems.size, 360); assert.equal(sum(events.gems.values(), 'xp'), 10000);
  assert.equal(sum(events.gems.values(), 'coins'), 5000);
  events.destroy(); assert.equal(events.gems.size, 0); assert.equal(events.cores.size, 0);
});
test('packed player metadata preserves server awards and persistent cosmetic titles', () => {
  const { events, player } = fixture('p'); const p = player('p');
  events.award(p, 5000, 'bounty'); events.title(p, 'Space Terror'); p.killEffect = 'FROST_SHATTER';
  const decoded = Network.player(Network.packPlayer(p));
  assert.equal(decoded.killEffect, 'FROST_SHATTER'); assert.deepEqual(decoded.titles, ['Space Terror']);
  assert.equal(decoded.coinRewards[0].coins, 5000);
});
test('dead boss contributors retain event XP until respawn without adding a dead-life killstreak', () => {
  const { events, player, room } = fixture('dead', 'alive'); const dead = player('dead'), alive = player('alive');
  events.spawnBoss(); events.bossHit(6000, dead); dead.die();
  events.bossHit(6000, alive);
  assert.equal(dead.pendingEventXP, 3000); assert.equal(dead.totalXp, 0);
  dead.respawn(false, room.players); assert.equal(dead.totalXp, 3000); assert.equal(dead.pendingEventXP, 0);
  dead.die(); alive.spawnProtectionUntil = 0; alive.invulnerable = false;
  alive.takeDamage(alive.hp, dead); assert.equal(dead.killStreak, 0);
});

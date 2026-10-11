'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Player } = require('../server/entities');
const RPG = require('../server/rpg'), Progression = require('../client/js/progression');
const Movement = require('../client/js/movement'), Network = require('../client/js/network');
const { WorldEvents } = require('../server/worldEvents');
const { Engagement } = require('../server/engagement');
const { updateCombat } = require('../server/combat');
function fixture() {
  const now = Date.now(), emitted = [];
  const room = { roomId: 'engagement', world: { width: 4000, height: 4000 }, players: new Map(), obstacles: new Map(),
    projectiles: new Map(), impacts: [], uidCounter: 1, io: { to: target => ({ emit: (event, data) => emitted.push({ target, event, data }) }) } };
  room.events = new WorldEvents(room, now); room.engagement = new Engagement(room, now, now);
  const p = new Player('pilot', 'Pilot'); p.x = p.y = 1000; p.nextFireTick = Infinity;
  room.players.set(p.id, p); room.engagement.attach(p, now);
  return { room, p, now, emitted, e: room.engagement };
}
test('contracts begin at 90 seconds, expire once, stay individual and never reward dead players', () => {
  const { e, p, now, emitted } = fixture();
  e.update(now + 89999); assert.equal(p.contract, undefined);
  e.update(now + 90000); assert.ok(p.contract); assert.equal(p.nextContractAt, now + 180000);
  const c = p.contract; e.update(c.expires); assert.equal(c.status, 'EXPIRED');
  const count = emitted.filter(x => x.data.status === 'EXPIRED').length;
  e.update(c.expires + 1); assert.equal(emitted.filter(x => x.data.status === 'EXPIRED').length, count);
  e.assign(p, 'PARRY_KILLS', c.expires + 2); p.die(); e.add(p, 2, c.expires + 3);
  assert.equal(p.contract.status, 'FAILED'); assert.equal(p.coinRewards.length, 0);
  for (const event of emitted.filter(x => x.event.startsWith('contract_'))) assert.equal(event.target, p.id);
});
test('no-damage contract counts collected XP only, fails on accepted damage and rewards once with current-level XP x3', () => {
  const { e, p, now } = fixture();
  e.assign(p, 'NO_DAMAGE_XP', now); RPG.addXP(p, 100); assert.equal(p.contract.progress, 0);
  p.collectScrap({ value: 39 }); assert.equal(p.contract.progress, 390);
  const before = p.totalXp + 10, level = Progression.levelForXP(before), expected = Progression.requiredXP(level) * 3;
  p.collectScrap({ value: 1 }); assert.equal(p.contract.status, 'COMPLETE');
  assert.equal(p.totalXp, before + expected); assert.ok(p.titles.includes('Untouchable'));
  assert.equal(p.coinRewards[0].coins, 50); e.collectedXP(p, 400); assert.equal(p.coinRewards.length, 1);
  p.levelUpPending = p.invulnerable = false; e.assign(p, 'NO_DAMAGE_XP', now);
  p.takeDamage(1); assert.equal(p.contract.status, 'FAILED');
  assert.equal(p.contract.duration, 40000);
});
test('KotH contract accumulates exactly 15 seconds across visits and stops outside the zone', () => {
  const { e, p, now } = fixture(); e.assign(p, 'ZONE_HOLD', now); p.x = p.y = 50;
  for (let i = 0; i < 225; i++) e.update(now + i * 1000 / 30);
  p.x = p.y = 1000; const progress = p.contract.progress; e.update(now + 9000); assert.equal(p.contract.progress, progress);
  p.x = p.y = 50;
  for (let i = 0; i < 225; i++) e.update(now + 10000 + i * 1000 / 30);
  assert.equal(p.contract.progress, 15); assert.equal(p.contract.status, 'COMPLETE'); assert.equal(p.coinRewards.length, 1);
});
test('parry projectile provenance earns contract kills; normal shots cannot advance it', () => {
  const { e, p, room, now } = fixture(); e.assign(p, 'PARRY_KILLS', now); p.parryUntil = now + 10000; p.rotation = 0;
  for (let i = 0; i < 2; i++) {
    const enemy = new Player('enemy' + i, 'Enemy'); enemy.x = 1050; enemy.y = p.y; enemy.nextFireTick = Infinity;
    room.players.set(enemy.id, enemy); e.attach(enemy, now);
    const shot = { id: 'shot' + i, ownerId: enemy.id, x: 1038, y: p.y, vx: -30, vy: 0, damage: 100, ttl: 45, hitIds: new Set() };
    room.projectiles.set(shot.id, shot); updateCombat(room, i * 2 + 1); updateCombat(room, i * 2 + 2);
    assert.equal(enemy.alive, false); assert.equal(p.contract.progress, i + 1);
  }
  assert.equal(p.contract.status, 'COMPLETE');
  e.assign(p, 'PARRY_KILLS', now); e.kill(p, false); assert.equal(p.contract.progress, 0);
  for (let i = 0; i < 3; i++) e.kill(p, false); assert.ok(p.titles.includes('Space Pirate'));
});
test('global frenzy respects 10/30 second phases, exactly 20 gems, radiation and cleanup without catch-up bursts', () => {
  const { e, p, now, room } = fixture(); p.x = p.y = 2000;
  e.update(now + 180000); assert.equal(e.frenzy.phase, 'WARNING'); assert.equal(p.hp, 100); assert.equal(room.events.gems.size, 0);
  e.update(now + 190000); assert.equal(e.frenzy.phase, 'ACTIVE'); assert.equal(p.hp, 95); assert.equal(p.totalXp, 100);
  assert.equal(room.events.gems.size, 20); assert.equal([...room.events.gems.values()].reduce((s, g) => s + g.coins, 0), 20);
  assert.ok([...room.events.gems.values()].every(g => g.xp === 100));
  e.update(now + 190001); assert.equal(p.hp, 95);
  e.update(now + 195000); assert.equal(p.hp, 90); assert.equal(p.totalXp, 200);
  e.update(now + 220000); assert.equal(e.frenzy, null); assert.equal(room.events.gems.size, 0);
  e.update(now + 400000); assert.equal(e.frenzy.phase, 'WARNING');
});
test('overdrive lasts 6 seconds, cooldown 45 seconds, halves parry cooldown and synchronizes prediction expiry', () => {
  const { e, p, now, room } = fixture(); p.hp = 14;
  assert.equal(e.overdrive(p, now), true); assert.equal(p.overdriveUntil, now + 6000);
  assert.equal(p.overdriveReadyAt, now + 45000); assert.equal(e.overdrive(p, now + 6000), false);
  assert.ok(RPG.cooldown(p) <= 200); assert.ok(RPG.activate(p, 'parry', room, now)); assert.equal(p.abilityReady.parry, now + 2500);
  const a = { x: 500, y: 500, vx: 0, vy: 0, overdriveRemaining: 6000 }, b = { ...a, overdriveRemaining: 0 };
  for (let i = 0; i < 100; i++) { Movement.step(a, { tx: 3900, ty: 500 }); Movement.step(b, { tx: 3900, ty: 500 }); }
  assert.ok(a.vx > b.vx * 1.34); for (let i = 0; i < 81; i++) Movement.step(a, { tx: 3900, ty: 500 });
  assert.equal(a.overdriveRemaining, 0); assert.equal(e.overdrive(p, now + 45000), true);
  p.die(); assert.equal(p.overdriveUntil, 0); assert.equal(e.overdrive(p, now + 90000), false);
});
test('revenge restores half once with exact 3s protection, near killer or fallback; dead-life contracts never resume', () => {
  const { e, p, now, room } = fixture(); const killer = new Player('killer', 'Killer'); killer.x = killer.y = 2000;
  room.players.set(killer.id, killer); RPG.addXP(p, 150); p.score = 100; p.killedBy = RPG.killerInfo(killer); p.die();
  assert.equal(e.revive(p, now), true); assert.equal(p.totalXp, 75); assert.equal(p.score, 50);
  assert.equal(p.revengeShieldUntil, now + 3000); assert.ok(Math.hypot(p.x - killer.x, p.y - killer.y) <= 500);
  assert.equal(p.takeDamage(500), false); assert.equal(e.revive(p, now), false);
  p.die(); room.players.delete(killer.id); assert.equal(e.revive(p, now), true); assert.equal(p.revengeTarget, null);
  p.spawnProtectionUntil = p.revengeShieldUntil = now - 1; assert.equal(p.takeDamage(1), true);
});
test('new state roundtrips compact snapshots and cleanup drops retained player/event references', () => {
  const { e, p, now, room } = fixture(); e.assign(p, 'ZONE_HOLD', now); p.hp = 14; e.overdrive(p, now);
  p.equippedSkin = p.skin = 'void'; p.equippedTrail = p.trail = 'purple'; p.equippedTitle = 'Space Pirate';
  const n = Network.player(Network.packPlayer(p)); assert.equal(n.equippedSkin, 'void'); assert.equal(n.equippedTitle, 'Space Pirate');
  assert.equal(n.contract.type, 'ZONE_HOLD'); assert.ok(n.overdriveRemaining > 0);
  e.update(now + 190000); e.destroy(); assert.equal(e.frenzy, null); assert.equal(p.engagement, null); assert.equal(p.contract, null);
  assert.equal(room.events.gems.size, 0);
});

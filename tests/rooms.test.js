'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../server/roomManager');
const { Bot } = require('../server/bot');
const { Player, Scrap } = require('../server/entities');
const { segmentHit, updateCombat } = require('../server/combat');

function harness(t, options) {
  const events = [];
  const io = { to: room => ({
    emit: (name, data) => events.push({ room, name, data }),
    volatile: { emit: (name, data) => events.push({ room, name, data }) },
  }) };
  const manager = new RoomManager(io, options);
  t.after(() => manager.destroy());
  const socket = id => ({ id, rooms: new Set(), join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); } });
  return { manager, events, socket };
}

test('matchmaking respects capacity and selects least populated public room', t => {
  const { manager, socket } = harness(t, { publicCapacity: 2 });
  const a = manager.findRoom('public');
  manager.transfer(socket('a'), a, 'A');
  manager.transfer(socket('b'), a, 'B');
  const b = manager.findRoom('');
  assert.notEqual(a.roomId, b.roomId);
  manager.transfer(socket('c'), b, 'C');
  assert.equal(manager.findRoom('public'), b);
  assert.equal(a.players.size, 2);
});

test('private codes are unique, normalized and full-room transfer preserves old membership', t => {
  const { manager, socket } = harness(t, { privateCapacity: 1 });
  const a = manager.create('private'), b = manager.create('private');
  assert.match(a.code, /^[A-Z2-9]{6}$/);
  assert.notEqual(a.code, b.code);
  const user = socket('user');
  manager.transfer(user, a, 'User');
  manager.transfer(socket('other'), b, 'Other');
  assert.throws(() => manager.findRoom(b.code, user.id), /llena/);
  assert.throws(() => manager.transfer(user, b, 'User'), /llena/);
  assert.equal(manager.current('user'), a);
  assert.equal(manager.findRoom(a.code.toLowerCase(), user.id), a);
  assert.throws(() => manager.findRoom('bad!'), /Código|código/);
});

test('rooms isolate snapshots, collection, projectiles, mutations and cleanup timers', t => {
  const { manager, events, socket } = harness(t);
  const a = manager.create('private'), b = manager.create('private');
  const user = socket('a');
  const pa = manager.transfer(user, a, 'A');
  const pb = manager.transfer(socket('b'), b, 'B');
  a.scraps.clear(); b.scraps.clear();
  a.spawnScrap(pa.x, pa.y, 10);
  b.spawnScrap(pb.x + 500, pb.y + 500, 3);
  a.loop._checkScrapCollection();
  assert.equal(pa.scrapCollected, 10);
  assert.equal(pb.scrapCollected, 0);
  assert.equal(b.scraps.size, 1);
  assert.equal(pa.upgradeOptions.length, 3);
  a.loop._broadcastState(); b.loop._broadcastState();
  const states = events.filter(event => event.name === 'gameState');
  assert.equal(states[0].room, a.roomId);
  assert.equal(states[0].data.roomId, a.roomId);
  assert.deepEqual(states[0].data.p.map(p => p.id), ['a']);
  assert.deepEqual(states[1].data.p.map(p => p.id), ['b']);
  manager.leave(user);
  assert.equal(a.loop._interval, null);
  manager.sweep(a.emptySince + 59999);
  assert.ok(manager.rooms.has(a.roomId));
  manager.sweep(a.emptySince + 60000);
  assert.equal(manager.rooms.has(a.roomId), false);
  assert.equal(manager.codes.has(a.code), false);
  assert.equal(a.players.size + a.scraps.size + a.obstacles.size + a.projectiles.size, 0);
});

test('singleplayer contains seven bots, rejects another human and is immediately disposed on exit', t => {
  const { manager, socket } = harness(t);
  const room = manager.create('singleplayer');
  const user = socket('human');
  manager.transfer(user, room, 'Human');
  assert.equal(room.botCount, 7);
  assert.equal(room.humanCount, 1);
  assert.throws(() => manager.transfer(socket('second'), room, 'Second'), /llena/);
  for (const bot of room.players.values()) {
    if (bot.isBot) { assert.match(bot.name, /^\[BOT\]/); assert.equal(bot.toNetwork().isBot, true); }
  }
  manager.leave(user);
  assert.equal(manager.rooms.has(room.roomId), false);
  assert.equal(room.loop._interval, null);
});

test('bot priorities cover flee, valuable collection, flanking and automatic mutation selection', () => {
  const bot = new Bot('bot', 'Nexus');
  const human = new Player('human', 'Human');
  bot.x = bot.y = 1000; human.x = 1100; human.y = 1000;
  const room = { players: new Map([['bot', bot], ['human', human]]), scraps: new Map(),
    obstacles: new Map(), world: { width: 4000, height: 4000 } };
  bot.hp = 20;
  bot.think(room, 1);
  assert.equal(bot.aiState, 'flee');
  assert.ok(bot.targetX < bot.x);
  bot.hp = 100;
  room.scraps.set('cheap', new Scrap('cheap', 1040, 1000, 1));
  room.scraps.set('rich', new Scrap('rich', 1080, 1000, 3));
  bot.think(room, 10);
  assert.equal(bot.aiState, 'collect');
  assert.equal(bot.targetX, 1080);
  for (let i = 0; i < 6; i++) bot.addDrone(`d${i}`);
  room.scraps.clear();
  bot.think(room, 20);
  assert.equal(bot.aiState, 'flank');
  assert.ok(Math.abs(bot.targetY - human.y) > 0);
  bot.levelUpPending = true;
  bot.chooseUpgrade([{ type: 'heavy_swarm' }, { type: 'nano_armor' }]);
  assert.equal(bot.levelUpPending, false);
  assert.equal(bot.drones.length, 8);
});

test('bot death drops conserved scrap only once and respawns after three seconds', t => {
  const { manager, socket } = harness(t);
  const room = manager.create('singleplayer');
  manager.transfer(socket('human'), room, 'Human');
  room.loop.stop(); room.scraps.clear(); room.obstacles.clear();
  const bot = [...room.players.values()].find(p => p.isBot);
  bot.scrapCollected = 37; bot.score = 370; bot.die();
  room.loop._processDeaths();
  assert.equal(room.scraps.size, 20);
  assert.equal([...room.scraps.values()].reduce((sum, scrap) => sum + scrap.value, 0), 37);
  room.loop._processDeaths();
  assert.equal(room.scraps.size, 20);
  assert.equal(bot.alive, false);
  bot.respawnAt = Date.now() - 1;
  room.loop._processDeaths();
  assert.equal(bot.alive, true);
  assert.equal(bot.hp, bot.maxHp);
  assert.equal(bot.scrapCollected, 0);
  assert.equal(bot.drones.length, 0);
});

test('swept projectile collisions damage only room entities and honor spawn protection', () => {
  assert.equal(segmentHit(0, 0, 100, 0, { x: 50, y: 0 }, 10), 0.4);
  const victim = new Player('victim', 'Victim');
  victim.x = 50; victim.y = 100;
  const room = { players: new Map([['victim', victim]]), obstacles: new Map(),
    projectiles: new Map([['shot', { id: 'shot', ownerId: 'enemy', x: 0, y: 100,
      vx: 100, vy: 0, damage: 20, ttl: 10 }]]), world: { width: 4000, height: 4000 } };
  updateCombat(room, 1);
  assert.equal(victim.hp, 80);
  assert.equal(room.projectiles.size, 0);
  victim.spawnProtectionUntil = Date.now() + 3000;
  room.projectiles.set('protected', { id: 'protected', ownerId: 'enemy', x: 0, y: 100,
    vx: 100, vy: 0, damage: 20, ttl: 10 });
  updateCombat(room, 2);
  assert.equal(victim.hp, 80);
});

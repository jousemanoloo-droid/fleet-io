'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Player } = require('../server/entities');
const { DroneSwarm } = require('../server/swarm');
const Network = require('../client/js/network');
const { updateCombat } = require('../server/combat');

function fixture() {
  const events = [];
  const room = { roomId: 'swarm', world: { width: 4000, height: 4000 }, players: new Map(),
    impacts: [], obstacles: new Map(), projectiles: new Map(),
    io: { to: () => ({ emit: (event, data) => events.push({ event, data }) }) } };
  const swarm = new DroneSwarm(room);
  for (const id of ['a', 'b']) {
    const p = new Player(id, id); p.x = 1000; p.y = 1000; p.rotation = 0;
    p.spawnProtectionUntil = 0; p.nextFireTick = Infinity; p.swarm = swarm;
    room.players.set(id, p);
  }
  const a = room.players.get('a'), b = room.players.get('b'); b.x = 1500;
  return { room, swarm, a, b, events };
}
test('chassis supplies 2–4 tactical drones without changing earned fleet or rewarded conservation', () => {
  const { room, swarm, a } = fixture();
  for (const [level, count] of [[1, 2], [10, 3], [25, 4], [40, 4]]) {
    a.level = level; swarm.prepare(a); assert.equal(a.tacticalDrones.length, count);
    assert.equal(a.drones.length, 0);
  }
  for (let i = 0; i < 5; i++) a.addDrone(`earned${i}`);
  a.die(); assert.equal(a.tacticalDrones.length, 0); assert.equal(a.deathState.drones, 5);
  a.respawn(true, room.players, room.world, room.obstacles); swarm.prepare(a);
  assert.equal(a.drones.length, 2); assert.ok(a.tacticalDrones.length >= 2);
});
test('swarm has strict 8-second cooldown and rejects dead, mutation and EMP states', () => {
  const { swarm, a } = fixture(); swarm.update(1 / 30, 1000);
  assert.equal(swarm.trigger(a, 1000), true); assert.equal(a.swarmUntil, 9000);
  a.tacticalDrones.forEach(d => d.state = 'ORBIT');
  assert.equal(swarm.trigger(a, 8999), false); assert.equal(swarm.trigger(a, 9000), true);
  a.swarmUntil = 0; a.empUntil = 10000; assert.equal(swarm.trigger(a, 9000), false);
  a.empUntil = 0; a.levelUpPending = true; assert.equal(swarm.trigger(a, 9000), false);
  a.levelUpPending = false; a.die(); assert.equal(swarm.trigger(a, 9000), false);
});
test('swept blitz hits closest enemy once for 75, returns and pools dead-life objects', () => {
  const { room, swarm, a, b, events } = fixture(); swarm.prepare(a);
  a.tacticalDrones[0].x = 1000; a.tacticalDrones[0].y = 1000;
  a.tacticalDrones[1].x = 1000; a.tacticalDrones[1].y = 1100;
  b.x = 1025;
  assert.equal(swarm.trigger(a, 1000), true);
  swarm.update(1 / 30, 1033);
  assert.equal(b.hp, 25); assert.equal(a.tacticalDrones[0].state, 'RETURNING');
  assert.equal(room.impacts.length, 1);
  for (let i = 0; i < 200; i++) swarm.update(1 / 30, 1066 + i * 1000 / 30);
  assert.equal(b.hp, 25); assert.ok(a.tacticalDrones.every(d => d.state === 'ORBIT'));
  assert.ok(events.some(e => e.event === 'DRONE_STATE_SYNC' && e.data.launched));
  const drone = a.tacticalDrones[0]; a.die(); assert.ok(swarm.pool.includes(drone));
  swarm.destroy(); assert.equal(swarm.pool.length, 0); assert.equal(swarm.cells.size, 0);
});
test('attack expires after three seconds even without targets and earned escorts also launch', () => {
  const { swarm, a, b } = fixture(); b.y = 3000; a.addDrone('earned');
  swarm.update(1 / 30, 1000); swarm.trigger(a, 1000);
  for (let i = 0; i < 91; i++) swarm.update(1 / 30, 1000 + i * 1000 / 30);
  assert.ok([...a.tacticalDrones, ...a.drones].every(d => d.state !== 'ATTACK'));
});
const snapshot = (t, players = [], scraps = []) => ({ v: 2, roomId: 'room', t, ts: t * 33,
  p: players.map(Network.packPlayer), s: scraps, b: [], o: [], i: [], w: {}, keyframe: t });
test('keyframe deltas survive skipped packets, additions/removals and never mutate their baseline', () => {
  const a = new Player('a', 'A'), b = new Player('b', 'B');
  const base = JSON.parse(JSON.stringify(snapshot(1, [a], [['s', 1, 2, 1, 12, 0]])));
  const serialized = JSON.stringify(base), decoder = new Network.Decoder(); decoder.receive(base);
  a.x += 10; const skipped = Network.delta(base, snapshot(2, [a]));
  assert.equal(skipped.v, 3);
  a.x += 25; a.hp = 45;
  const current = snapshot(4, [a, b]), result = decoder.receive(Network.delta(base, current));
  assert.equal(result.p[0].x, current.p[0][1]); assert.equal(result.p[0].hp, 45);
  assert.equal(result.p[1].name, 'B'); assert.equal(result.s.length, 0);
  const removed = decoder.receive(Network.delta(base, snapshot(5, [b])));
  assert.deepEqual(removed.p.map(p => p.id), ['b']); assert.equal(JSON.stringify(base), serialized);
});
test('missing/new-room baseline requires recovery and static entity compression reduces bytes', () => {
  const a = new Player('a', 'A');
  const scraps = Array.from({ length: 150 }, (_, i) => [`s${i}`, i, i, 1, 12345, 0]);
  const base = snapshot(1, [a], scraps), current = snapshot(2, [a], scraps);
  const packet = Network.delta(base, current), decoder = new Network.Decoder();
  assert.equal(decoder.receive(packet), null); decoder.receive(base);
  assert.ok(decoder.receive(packet)); assert.equal(decoder.receive({ ...packet, roomId: 'other' }), null);
  assert.ok(JSON.stringify(packet).length < JSON.stringify(current).length * 0.3);
  decoder.reset(); assert.equal(decoder.receive(packet), null);
});
test('120-degree directional parry accepts frontal fire and rejects rear fire', () => {
  for (const frontal of [true, false]) {
    const { room, a, b } = fixture(); b.x = 1100; b.rotation = 0; b.parryUntil = Date.now() + 300;
    room.projectiles.set('shot', { id: 'shot', ownerId: a.id, x: frontal ? 1130 : 1070,
      y: 1000, vx: frontal ? -40 : 40, vy: 0, damage: 10, ttl: 40, color: 0xffffff });
    updateCombat(room, 1);
    assert.equal(b.hp, frontal ? 100 : 90);
    if (frontal) assert.equal(room.projectiles.get('shot').ownerId, b.id);
  }
});

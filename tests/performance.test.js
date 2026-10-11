'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Movement = require('../client/js/movement');
const Network = require('../client/js/network');
const Progression = require('../client/js/progression');
const { Player, Scrap } = require('../server/entities');
const { GameLoop } = require('../server/gameLoop');

function prediction(state) {
  const window = { FleetMovement: Movement };
  vm.runInNewContext(fs.readFileSync('client/js/player.js', 'utf8'), { window });
  return new window.FleetPredictedPlayer(state);
}
const initial = () => ({ x: 1000, y: 1000, vx: 0, vy: 0, radius: 18, maxSpeed: Movement.BASE_SPEED, hp: 100 });

test('base and upgraded ships reach their speed cap despite friction', () => {
  for (const maxSpeed of [Movement.BASE_SPEED, Movement.BASE_SPEED + 5]) {
    const p = { ...initial(), maxSpeed };
    for (let i = 0; i < 120; i++) Movement.step(p, { tx: 3900, ty: 1000 });
    assert.ok(Math.abs(p.vx - maxSpeed) < 0.0001);
    assert.equal(p.vy, 0);
  }
});

test('local prediction advances immediately and fixed simulation matches 60/120/144 Hz', () => {
  const results = [];
  for (const hz of [60, 120, 144]) {
    const p = prediction(initial());
    const target = { tx: 3000, ty: 1000 };
    let sequence = 0;
    assert.ok(p.advance(1000 / hz, target, undefined, [], () => null).x > 1000);
    p.reset(initial());
    for (let frame = 0; frame < hz * 2; frame++) {
      p.advance(1000 / hz, target, undefined, [], command => ({ ...command, seq: ++sequence }));
    }
    results.push(p.state.x);
    assert.ok(p.pending.length <= 120);
  }
  assert.ok(Math.max(...results) - Math.min(...results) < 0.0001, 'same simulated distance at all refresh rates');
});

test('reconciliation replays unacknowledged input and eases large corrections without teleporting', () => {
  const p = prediction(initial());
  let seq = 0;
  const target = { tx: 3000, ty: 1000 };
  for (let i = 0; i < 12; i++) p.advance(Movement.STEP_MS, target, undefined, [], input => ({ ...input, seq: ++seq }));
  const before = p.state.x + p.offsetX;
  p.reconcile({ ...initial(), x: 1100, inputSeq: 10 }, undefined, []);
  assert.deepEqual(Array.from(p.pending, input => input.seq), [11, 12]);
  assert.ok(Math.abs(p.state.x + p.offsetX - before) < 0.001);
  const offset = Math.abs(p.offsetX);
  p.advance(16.667, target, undefined, [], () => null);
  assert.ok(Math.abs(p.offsetX) < offset);
  p.reset({ ...initial(), x: 3000 });
  assert.equal(p.pending.length, 0);
  assert.equal(p.offsetX, 0);
});

test('sustained movement never stalls or reverses under jitter and a slower server clock', () => {
  // Reproduce el enganche: servidor 25–30 Hz, cliente 60/120/144 Hz, red variable.
  // El umbral anterior de 15 px + lerp sin límite causaba frames negativos aquí.
  for (const hz of [60, 120, 144]) {
    for (const serverInterval of [33, 35, 40]) {
      const predicted = prediction(initial());
      const server = new Player('pilot', 'Pilot');
      // Con la nueva velocidad, un objetivo a 3000 se alcanza antes de acabar
      // la prueba. Mantener recorrido libre para medir tirones, no frenado final.
      Object.assign(server, initial()); server.setTarget(3900, 1000);
      let seq = 0, serverAt = serverInterval, lastX = 1000;
      const commands = [], snapshots = [];
      for (let now = 1000 / hz; now < 10000; now += 1000 / hz) {
        while (commands.length && commands[0].at <= now) {
          server.inputQueue.push(commands.shift().input);
          if (server.inputQueue.length > 6) server.inputQueue.shift();
        }
        while (serverAt <= now) {
          server.update();
          snapshots.push({ at: serverAt + 60, state: server.toNetwork() });
          serverAt += serverInterval;
        }
        while (snapshots.length && snapshots[0].at <= now) {
          predicted.reconcile(snapshots.shift().state);
        }
        const view = predicted.advance(1000 / hz, { tx: 3900, ty: 1000 }, undefined, [], target => {
          const input = { ...target, seq: ++seq };
          commands.push({ at: now + 60 + Math.sin(seq * 0.07) * 40, input });
          return input;
        });
        if (now > 1500) {
          assert.ok(view.x - lastX > 0.3,
            `${hz} Hz / servidor ${serverInterval} ms: avance ${view.x - lastX}`);
        }
        lastX = view.x;
      }
      assert.ok(predicted.pending.length < 15, 'no se acumulan entradas sin confirmar');
      assert.ok(Math.abs(predicted.offsetX) < 12, 'la corrección converge sin alejarse del servidor');
    }
  }
});

test('small authoritative errors also rebase simulation and visual correction is bounded per second', () => {
  const p = prediction(initial());
  p.reconcile({ ...initial(), x: 1008 });
  assert.equal(p.state.x, 1008);
  assert.equal(p.state.x + p.offsetX, 1000, 'no snap visible tampoco para errores menores de 15 px');
  p.advance(1000 / 120, { tx: 3000, ty: 1000 }, undefined, [], () => null);
  assert.ok(8 - Math.abs(p.offsetX) <= 12 / 120 + 0.001);
});

test('shared movement matches authoritative inertia, limits and obstacle damping', () => {
  const p = new Player('pilot', 'Pilot');
  Object.assign(p, initial()); p.setTarget(3000, 1000);
  const client = initial();
  for (let i = 0; i < 60; i++) {
    p.update(); Movement.step(client, { tx: 3000, ty: 1000 });
  }
  assert.equal(client.x, p.x); assert.equal(client.vx, p.vx);
  client.x = 2000; client.y = 2000;
  Movement.step(client, { tx: 3000, ty: 2000 }, undefined, [{ x: 2000, y: 2000, radius: 80 }]);
  assert.ok(Math.hypot(client.x - 2000, client.y - 2000) >= 98 - 0.001);
});

test('snapshot queue selects actual bracketing states and shortest rotation through PI', () => {
  const queue = [0, 33, 66, 99, 132].map((t, i) => ({ t, x: i * 10, y: 0, rotation: i < 2 ? 3.1 : -3.1 }));
  const result = Network.sample(queue, 49.5);
  assert.equal(result.x, 15);
  assert.ok(Math.abs(Math.abs(result.rotation) - Math.PI) < 0.05);
  assert.equal(Network.sample(queue, 500).x, 40);
});

test('packed self-contained snapshots preserve economy, mutations, death and input acknowledgments', () => {
  const p = new Player('pilot', 'Pilot');
  p.inputSeq = 23; p.collectScrap(new Scrap('loot', 0, 0, 90));
  p.applyUpgrade('plasma_thrusters'); p.addDrone('drone'); p.die();
  const packed = Network.packPlayer(p), decoded = Network.player(packed);
  assert.equal(decoded.score, p.score);
  assert.deepEqual(decoded.mutations, p.mutations);
  assert.deepEqual(decoded.deathState, p.deathState);
  assert.equal(decoded.inputSeq, 23);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(p.toNetwork()).length * 0.7);
});

test('mutations unlock at levels 10 and 20, never at ordinary level increments', () => {
  const p = new Player('pilot', 'Pilot');
  for (let level = 2; level <= 20; level++) {
    p.collectScrap({ value: Progression.cost(level - 1) });
    assert.equal(p.level, level);
    assert.equal(p.levelUpPending, level % 10 === 0);
    if (p.levelUpPending) p.applyUpgrade('nano_armor');
  }
});

test('30 server ticks broadcast 30 snapshots and consume only one queued command per tick', () => {
  const p = new Player('pilot', 'Pilot');
  p.inputQueue.push({ seq: 1, tx: 2000, ty: 2000 }, { seq: 2, tx: 3000, ty: 3000 });
  const loop = new GameLoop({ players: { pilot: p }, scraps: {} }, {});
  let broadcasts = 0;
  for (const method of ['_updateScrap', '_checkScrapCollection', '_maybeSpawnScrap', '_processDeaths']) loop[method] = () => {};
  loop._broadcastState = () => broadcasts++;
  loop._tick(); assert.equal(p.inputSeq, 1);
  loop._tick(); assert.equal(p.inputSeq, 2);
  for (let i = 2; i < 30; i++) loop._tick();
  assert.equal(broadcasts, 30);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture(density = 1) {
  const window = {}, camera = { zoom: 1, width: 1280, height: 720, scrollX: 0, scrollY: 0,
    worldView: { contains: () => true }, setZoom(value) { this.zoom = value; }, shake() {} };
  vm.runInNewContext(fs.readFileSync('client/js/cyber.js', 'utf8'), {
    window, Phaser: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } },
    performance: { now: () => 1000 },
    document: { activeElement: null },
  });
  const cyber = Object.create(window.FleetCyber.Cyber.prototype);
  const grid = { setVisible() { return this; }, setPosition() { return this; }, setSize() { return this; } };
  Object.assign(cyber, { scene: { cameras: { main: camera }, tweens: { timeScale: 1 },
    children: { list: [{ type: 'ParticleEmitter', timeScale: 1 }] }, _obstacles: [], _effectVisible: () => true },
    C: { myId: 'a', dead: false, menuOpen: false, joined: true,
      playerStates: new Map([['a', { hp: 100, receivedAt: 0, swarmCooldown: 0 }]]),
      renderState: new Map(Array.from({ length: density }, (_, i) => [i, { x: 1, y: 1, drones: [] }])) },
    lastImpact: -Infinity, densityAt: 0, emitAt: 0, targetZoom: 1.2, chromatic: {}, grid,
    trail: { emitParticleAt() {} }, cooldownUntil: 0, button: { style: { setProperty() {} } },
  });
  return { cyber, camera };
}
test('density zoom damping matches 60/120/144 Hz and stays within 0.75–1.2', () => {
  for (const count of [1, 20]) {
    const values = [];
    for (const hz of [60, 120, 144]) {
      const { cyber, camera } = fixture(count);
      for (let i = 0; i < hz; i++) cyber.update(i * 1000 / hz, 1000 / hz, false);
      assert.ok(camera.zoom >= 0.75 && camera.zoom <= 1.2); values.push(camera.zoom);
    }
    assert.ok(Math.max(...values) - Math.min(...values) < 1e-10);
  }
});
test('hit-stop lasts 30ms, freezes only visual clocks and releases chromatic/tween/particle state', () => {
  const { cyber, camera } = fixture(); let shake;
  camera.shake = (...args) => shake = args;
  cyber.impact(1000); assert.equal(cyber.scene._hitStopUntil, 1030); assert.deepEqual(shake, [150, 0.015]);
  cyber.update(1010, 16, true);
  assert.equal(cyber.scene.tweens.timeScale, 0); assert.equal(cyber.scene.children.list[0].timeScale, 0);
  assert.ok(cyber.chromatic.amount > 0); assert.equal(camera.zoom, 1);
  cyber.update(1030, 16, false); assert.equal(cyber.scene.tweens.timeScale, 1);
  assert.equal(cyber.scene.children.list[0].timeScale, 1);
  cyber.update(1150, 16, false); assert.equal(cyber.chromatic.amount, 0);
});
test('late swarm acknowledgement cannot clear a newer request or apply cooldown to another room', () => {
  const { cyber } = fixture(); const callbacks = [];
  cyber.C.connected = true; cyber.C.room = { roomId: 'first' };
  cyber.C.playerStates.get('a').deathId = 0;
  cyber.C.socket = { timeout() { return this; }, emit(_event, _data, ack) { callbacks.push(ack); } };
  cyber.launch(); assert.equal(cyber.pending, true);
  cyber.pending = false; cyber.pendingRequest = null; // Same invalidation used by death/reset.
  cyber.launch(); callbacks[0](null, { ok: true, cooldown: 8000 });
  assert.equal(cyber.pending, true); assert.equal(cyber.cooldownUntil, 0);
  cyber.C.room = { roomId: 'second' }; callbacks[1](null, { ok: true, cooldown: 8000 });
  assert.equal(cyber.pending, false); assert.equal(cyber.cooldownUntil, 0);
});

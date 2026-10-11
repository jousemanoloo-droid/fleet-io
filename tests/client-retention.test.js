'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  let now = 1000, created = 0;
  const window = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync('client/js/retention.js', 'utf8'), { window, performance: { now: () => now } });
  const instance = Object.create(window.FleetRetention.Retention.prototype);
  const image = (x, y) => {
    const result = { x, y, setPosition(x, y) { this.x = x; this.y = y; return this; } };
    for (const key of ['setTexture', 'setScale', 'setVisible', 'setTint', 'setRotation', 'clearTint', 'setDepth', 'setAlpha'])
      result[key] = () => result;
    return result;
  };
  instance.scene = { scale: { width: 1280, height: 720 }, _obstacles: [], _effectVisible: () => true,
    add: { image: (x, y) => { created++; return image(x, y); } } };
  instance.C = { renderState: new Map(), myId: 'p' };
  Object.assign(instance, { world: { g: [], c: [], q: [], boss: null }, objects: new Map(), pool: [],
    indicators: new Map(), spirals: new Set(), lastPickup: 0, comboPickupCount: 0, lastAura: 0,
    rewards: new Map(), lastRewardFlush: 0,
    vignette: { setDisplaySize() {} }, banner: { textContent: '' }, bossBar: { hidden: true } });
  return { instance, advance: ms => { now += ms; }, count: () => created };
}
test('pickup pitch escalates to 2.2 and resets after a 1.5-second gap', () => {
  const { instance, advance } = fixture(); const pitches = [];
  instance.tone = pitch => pitches.push(pitch);
  for (let i = 0; i < 30; i++) { instance.pickup(); advance(25); }
  assert.equal(pitches[0], 1.05); assert.equal(pitches.at(-1), 2.2);
  advance(1501); instance.pickup(); assert.equal(pitches.at(-1), 1.05);
});
test('successive gem bursts reuse pooled images rather than allocate per snapshot', () => {
  const { instance, count } = fixture();
  for (let burst = 0; burst < 100; burst++) {
    instance.world.g = Array.from({ length: 24 }, (_, i) => [`${burst}:${i}`, 2000, 2000, 10, 0]);
    instance.update(1000 + burst * 100, 16.67);
    instance.world.g = []; instance.update(1050 + burst * 100, 16.67);
  }
  assert.equal(count(), 24); assert.equal(instance.objects.size, 0); assert.equal(instance.pool.length, 24);
});
test('meteor warnings remain visible when a lower-priority boss notice arrives', () => {
  const { instance, advance } = fixture();
  instance.notify('Storm in 15s', 15000, 2); instance.notify('Boss spawned', 8000);
  assert.equal(instance.banner.textContent, 'Storm in 15s');
  advance(15001); instance.notify('Storm started', 5000); assert.equal(instance.banner.textContent, 'Storm started');
});
test('room lifecycle resets bypass event room guard; world events remain room-isolated', () => {
  const { instance } = fixture(); const handlers = {}; let resets = 0, pickups = 0;
  instance.handlers = {}; instance.C.room = { roomId: 'current' };
  instance.C.socket = { on: (event, handler) => { handlers[event] = handler; } };
  instance.reset = () => resets++; instance.pickup = () => pickups++;
  instance.bind();
  handlers.welcome({ room: { roomId: 'current' } }); handlers.disconnect('transport close');
  assert.equal(resets, 2);
  handlers.gem_collected({ roomId: 'old-room' }); assert.equal(pickups, 0);
  handlers.gem_collected({ roomId: 'current' }); assert.equal(pickups, 1);
});

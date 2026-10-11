'use strict';
const i18n = () => require('../client/js/i18n')(require('../client/js/translations'));
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  const window = { FleetI18n: i18n(), AdManager: { busy: false } };
  const document = { activeElement: null, createElement: () => ({ textContent: '' }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/features.js'), 'utf8'), { window, document });
  const feature = Object.create(window.FleetFeatures.Features.prototype);
  return { feature, window };
}

test('feature modal changes visibility before CrazyGames lifecycle tracking', () => {
  const { feature, window } = fixture();
  const classes = new Set(['hidden']), observations = [];
  feature.modal = { classList: { remove: key => classes.delete(key), add: key => classes.add(key) } };
  feature.panel = { replaceChildren() {}, append() {} };
  feature.track = () => observations.push(!classes.has('hidden'));
  assert.equal(feature.open('Shop'), true);
  assert.equal(feature.blocking, true);
  feature.close();
  assert.equal(feature.blocking, false);
  assert.deepEqual(observations, [true, false]);
  window.AdManager.busy = true;
  assert.equal(feature.open('Shop'), false);
  assert.equal(classes.has('hidden'), true, 'ads cannot be obscured by feature panels');
});

test('late ability acknowledgement cannot reconcile a new life or another room', () => {
  const { feature } = fixture();
  let ack, reconciles = 0;
  feature.C = { connected: true, joined: true, dead: false, myId: 'pilot', room: { roomId: 'a' },
    playerStates: new Map(), socket: { timeout() { return this; }, emit(_event, _data, callback) { ack = callback; } } };
  feature.me = { deathId: 0, cooldowns: {} }; feature.abilityPending = new Set();
  feature.scene = { _prediction: { reconcile() { reconciles++; } } };
  feature.ability('shield');
  feature.me = { deathId: 1, cooldowns: {} };
  ack(null, { ok: true, player: { deathId: 0 } });
  assert.equal(reconciles, 0); assert.equal(feature.me.deathId, 1);
  feature.ability('emp'); feature.C.room = { roomId: 'b' };
  ack(null, { ok: true, player: { deathId: 1 } });
  assert.equal(reconciles, 0);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const data = new Map(); const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const window = { localStorage: storage };
  vm.runInNewContext(fs.readFileSync('client/js/economy.js', 'utf8'), { window });
  let time = 100000000; const economy = new window.FleetEconomy.Economy(storage, () => time);
  return { economy, data, window, storage, advance: ms => { time += ms; } };
}
test('daily claim is exactly +500 once per rolling 24h and boost is consumed once', () => {
  const { economy, data, advance } = fixture();
  assert.equal(economy.claimDaily(), true); assert.equal(economy.state.coins, 500);
  assert.equal(economy.claimDaily(), false); assert.equal(economy.state.pendingBoost, true);
  economy.consumeBoost(); assert.equal(economy.state.pendingBoost, false);
  advance(86400000 - 1); assert.equal(economy.claimDaily(), false);
  advance(1); assert.equal(economy.claimDaily(), true); assert.equal(economy.state.coins, 1000);
  assert.equal(data.get('fleet_io_coins'), '1000'); assert.ok(data.has('fleet_io_last_login'));
});
test('match settlement is idempotent; purchases deduct once, equip and survive reload', () => {
  const { economy, storage, window } = fixture();
  assert.equal(economy.settle('match-a', 30000), 600); assert.equal(economy.settle('match-a', 30000), 0);
  assert.equal(economy.buy('skins', 'alien'), true); assert.equal(economy.state.coins, 0);
  assert.equal(economy.buy('skins', 'alien'), true); assert.equal(economy.state.coins, 0);
  assert.equal(economy.buy('trails', 'purple'), false);
  assert.equal(economy.buy('bogus', 'alien'), false);
  const restored = new window.FleetEconomy.Economy(storage);
  assert.equal(restored.state.equipped.skin, 'alien'); assert.equal(restored.settle('match-a', 30000), 0);
});
test('corrupt or disabled localStorage never breaks game startup', () => {
  const { window } = fixture();
  const broken = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Quota'); } };
  const economy = new window.FleetEconomy.Economy(broken);
  assert.equal(economy.persistent, false); assert.equal(economy.settle('session', 500), 10);
  assert.equal(economy.state.coins, 10);
});
test('server receipts remain idempotent after many later awards and reload; effect purchases persist', () => {
  const { economy, window, storage } = fixture();
  economy.credit('room:reward:1', 5000);
  for (let i = 2; i <= 200; i++) economy.credit(`room:reward:${i}`, 1);
  assert.equal(economy.credit('room:reward:1', 5000), 0);
  assert.equal(economy.state.coins, 5199);
  assert.equal(economy.buy('effects', 'FROST_SHATTER'), true);
  economy.unlockTitle('Space Terror');
  const restored = new window.FleetEconomy.Economy(storage);
  assert.equal(restored.state.equipped.killEffect, 'FROST_SHATTER');
  assert.ok(restored.state.titles.includes('Space Terror'));
  assert.equal(restored.credit('room:reward:1', 5000), 0);
});
test('burst coin rewards use one persistence transaction and sort snapshot receipts', () => {
  const { economy, storage } = fixture(); let saves = 0;
  const setItem = storage.setItem; storage.setItem = (key, value) => { if (key === 'fleet_io_economy_state') saves++; setItem(key, value); };
  assert.equal(economy.creditBatch([{ id: 'room:reward:3', coins: 10 }, { id: 'room:reward:1', coins: 5 },
    { id: 'room:reward:2', coins: 8 }, { id: 'room:reward:1', coins: 5 }]), 23);
  assert.equal(saves, 1); assert.equal(economy.state.coins, 23);
  assert.equal(economy.creditBatch([{ id: 'room:reward:1', coins: 5 }]), 0); assert.equal(saves, 1);
});

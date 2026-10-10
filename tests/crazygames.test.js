'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client/monetization.js'), 'utf8');

function fixture(environment = 'crazygames', init = async () => {}) {
  const calls = [];
  const requests = [];
  const SDK = {
    environment, init,
    game: { gameplayStart: () => calls.push('start'), gameplayStop: () => calls.push('stop') },
    ad: { requestAd(type, callbacks) { requests.push({ type, callbacks }); return Promise.resolve(); } },
  };
  const window = { CrazyGames: { SDK } };
  vm.runInNewContext(source, { window, setTimeout, clearTimeout });
  return { manager: window.AdManager, SDK, calls, requests };
}

test('SDK initialization gates telemetry and repeated gameplay transitions are idempotent', async () => {
  let initialized;
  const { manager, calls } = fixture('crazygames', () => new Promise(resolve => { initialized = resolve; }));
  manager.gameplayStart();
  assert.deepEqual(calls, []);
  initialized();
  assert.equal(await manager.ready, 'crazygames');
  manager.gameplayStart();
  manager.gameplayStop();
  manager.gameplayStop();
  assert.deepEqual(calls, ['start', 'stop']);
});

test('rewarded grants exactly once only after adFinished and restores hooks and gameplay', async () => {
  const { manager, requests, calls } = fixture();
  await manager.ready;
  let paused = 0, resumed = 0, rewards = 0, failures = 0;
  manager.setGameHooks({ onAdStarted: () => paused++, onAdEnded: () => resumed++ });
  manager.gameplayStart();
  const pending = manager.showRewardedAd(() => rewards++, () => failures++);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].type, 'rewarded');
  assert.equal(rewards, 0, 'requestAd promise fulfillment must never grant reward');
  assert.equal(manager.busy, true);
  const callbacks = requests[0].callbacks;
  callbacks.adStarted(); callbacks.adStarted();
  assert.equal(paused, 1);
  callbacks.adFinished(); callbacks.adFinished(); callbacks.adError(Error('late'));
  assert.equal(await pending, true);
  assert.equal(rewards, 1);
  assert.equal(failures, 0);
  assert.equal(resumed, 1);
  assert.equal(manager.busy, false);
  assert.deepEqual(calls, ['start', 'stop', 'start']);
});

test('ad errors restore audio hooks, release lock and never reward', async () => {
  const { manager, requests } = fixture();
  await manager.ready;
  let muted = false, rewarded = false, failure;
  manager.setGameHooks({ onAdStarted: () => { muted = true; }, onAdEnded: () => { muted = false; } });
  const pending = manager.showRewardedAd(() => { rewarded = true; }, error => { failure = error; });
  await new Promise(resolve => setImmediate(resolve));
  requests[0].callbacks.adStarted();
  requests[0].callbacks.adError(Error('No inventory'));
  assert.equal(await pending, false);
  assert.equal(muted, false);
  assert.equal(rewarded, false);
  assert.equal(failure.message, 'No inventory');
  assert.equal(manager.busy, false);
});

test('midgame completes callback and synchronous SDK failure remains recoverable', async () => {
  const { manager, SDK, requests } = fixture();
  await manager.ready;
  let result;
  const pending = manager.showInterstitialAd(completed => { result = completed; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].type, 'midgame');
  requests[0].callbacks.adFinished();
  assert.equal(await pending, true);
  assert.equal(result, true);
  SDK.ad.requestAd = () => { throw Error('Unavailable'); };
  assert.equal(await manager.showInterstitialAd((completed, error) => {
    assert.equal(completed, false); assert.equal(error.message, 'Unavailable');
  }), false);
  assert.equal(manager.busy, false);
});

test('local, disabled and absent SDK use simulation; portal initialization failure cannot reward', async () => {
  for (const environment of ['local', 'disabled']) {
    const { manager, calls } = fixture(environment);
    assert.equal(await manager.ready, 'simulation');
    manager.gameplayStart();
    assert.deepEqual(calls, []);
  }
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(await window.AdManager.ready, 'simulation');
  const { manager } = fixture('crazygames', async () => { throw Error('Initialization failed'); });
  assert.equal(await manager.ready, 'unavailable');
  assert.equal(await manager.showRewardedAd(() => assert.fail('must not simulate portal rewards')), false);
});

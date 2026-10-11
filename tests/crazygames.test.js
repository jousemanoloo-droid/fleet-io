'use strict';
const i18n = () => require('../client/js/i18n')(require('../client/js/translations'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client/monetization.js'), 'utf8');

function fixture(environment = 'crazygames', init = async () => {}, hostname = 'localhost') {
  const calls = [];
  const requests = [];
  const SDK = {
    environment, init,
    game: { loadingStart() {}, loadingStop() {}, gameplayStart: () => calls.push('start'), gameplayStop: () => calls.push('stop') },
    ad: { requestAd(type, callbacks) { requests.push({ type, callbacks }); return Promise.resolve(); } },
  };
  const window = { location: {hostname}, FleetI18n: i18n(), CrazyGames: { SDK } };
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
  const window = { location:{hostname:'localhost'}, FleetI18n: i18n() };
  vm.runInNewContext(source, { window });
  assert.equal(await window.AdManager.ready, 'simulation');
  const { manager } = fixture('crazygames', async () => { throw Error('Initialization failed'); }, 'games.crazygames.com');
  assert.equal(await manager.ready, 'unavailable');
  assert.equal(await manager.showRewardedAd(() => assert.fail('must not simulate portal rewards')), false);
});

test('loading telemetry waits for init, starts before stop and is sent once', async () => {
  let resolveInit;
  const f = fixture('crazygames', () => new Promise(resolve => { resolveInit = resolve; }));
  const loading = [];
  f.SDK.game.loadingStart = () => loading.push('start');
  f.SDK.game.loadingStop = () => loading.push('stop');
  f.manager.loadingStart(); f.manager.loadingStop();
  assert.deepEqual(loading, []);
  resolveInit(); await f.manager.ready;
  f.manager.loadingStop(); f.manager.loadingStart(); f.manager.loadingStop();
  assert.deepEqual(loading, ['start', 'stop']);
});

test('no public hostname or iframe can activate simulated rewards', async () => {
  for (const hostname of ['games.crazygames.com', 'abc.builds.gamedistribution.com', 'fleet-io-d45d5.web.app']) {
    for (const environment of ['local', 'disabled']) {
      const {manager} = fixture(environment, async () => {}, hostname);
      assert.equal(await manager.ready, 'unavailable');
      assert.equal(manager.canShowAds(), false);
      assert.throws(() => manager.setAdapter({showRewardedAd() {}, showInterstitialAd() {}}), /local-only/);
      assert.equal(await manager.showRewardedAd(() => assert.fail('fake public reward')), false);
    }
    const window = { location: {hostname}, self: {}, top: {}, FleetI18n: i18n() };
    vm.runInNewContext(source, {window});
    assert.equal(await window.AdManager.ready, 'unavailable');
  }
});

test('Basic Launch, adblock and inventory errors disable offers without granting rewards', async () => {
  for (const code of ['adsDisabledBasicLaunch', 'adblock', 'unfilled', 'adCooldown']) {
    const {manager, requests} = fixture(); await manager.ready;
    const pending = manager.showRewardedAd(() => assert.fail('error must not grant reward'));
    await new Promise(resolve => setImmediate(resolve));
    requests[0].callbacks.adError({code, message: 'Unavailable'});
    assert.equal(await pending, false);
    assert.equal(manager.canShowAds(), false);
    assert.equal(manager.busy, false);
    if (code === 'unfilled' || code === 'adCooldown') assert.ok(manager.retryAt > Date.now());
  }
});

test('a missing callback times out, releases the lock and ignores late completion', async () => {
  const timers = new Map(); let next = 0, callbacks;
  const window = { location: {hostname: 'games.crazygames.com'}, FleetI18n: i18n(), CrazyGames: {SDK: {
    init: async () => {}, environment: 'crazygames', game: {loadingStart() {}, gameplayStop() {}},
    ad: {requestAd(type, cb) {callbacks = cb;}}
  }}};
  vm.runInNewContext(source, {window, setTimeout(fn, ms) {timers.set(++next, {fn, ms}); return next;}, clearTimeout(id) {timers.delete(id);}});
  await window.AdManager.ready;
  const pending = window.AdManager.showRewardedAd(() => assert.fail('timed out request must not reward'));
  await new Promise(resolve => setImmediate(resolve));
  [...timers.values()].find(timer => timer.ms === 12000).fn();
  assert.equal(await pending, false);
  callbacks.adFinished();
  assert.equal(window.AdManager.busy, false);
});

test('portal origins match exact HTTPS DNS suffixes, never lookalike domains', () => {
  const {portalOrigin} = require('../server/origins');
  for (const origin of ['https://crazygames.com', 'https://games.crazygames.com', 'https://preview.games.crazygames.com', 'https://abc.builds.gamedistribution.com']) assert.equal(portalOrigin(origin), true, origin);
  for (const origin of ['https://evilcrazygames.com', 'https://crazygames.com.evil.test', 'http://games.crazygames.com', 'https://games.crazygames.com:444', 'https://user@games.crazygames.com', 'null', undefined]) assert.equal(portalOrigin(origin), false, String(origin));
});

'use strict';
const i18n = () => require('../client/js/i18n')(require('../client/js/translations'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Player } = require('../server/entities');
const { GameLoop } = require('../server/gameLoop');

function fleet() {
  const player = new Player('pilot', 'Pilot');
  player.score = 110;
  player.scrapCollected = 11;
  for (let i = 0; i < 5; i++) player.addDrone(`d${i}`);
  return player;
}

test('death preserves economy once; rewarded respawn restores half and full HP', () => {
  const p = fleet();
  p.maxHp = 125;
  assert.equal(p.takeDamage(1000), true);
  const saved = p.deathState;
  assert.equal(p.die(), false);
  assert.equal(p.deathState, saved);
  assert.equal(p.drones.length, 0);
  assert.equal(p.alive, false);
  assert.equal(p.respawn(true, { pilot: p }), true);
  assert.equal(p.score, 55);
  assert.equal(p.scrapCollected, 5);
  assert.equal(p.drones.length, 2);
  assert.equal(p.hp, 125);
  assert.equal(p.takeDamage(10), false, 'spawn protection');
  assert.equal(p.targetX, p.x);
  assert.equal(p.respawn(true, { pilot: p }), false, 'reward is single use');
});

test('ordinary restart clears economy and mutations', () => {
  const p = fleet();
  p.applyUpgrade('nano_armor');
  p.applyUpgrade('plasma_thrusters');
  p.die();
  p.respawn(false, { pilot: p });
  assert.equal(p.score, 0);
  assert.equal(p.scrapCollected, 0);
  assert.equal(p.drones.length, 0);
  assert.equal(p.maxHp, 100);
  assert.equal(p.maxSpeed, 7.5);
  assert.deepEqual(p.mutations, []);
});

test('dead fleets do not move or collect; death notification is reliable and unique', () => {
  const p = fleet();
  p.takeDamage(1000);
  const emitted = [];
  const loop = new GameLoop({ players: { pilot: p }, scraps: {} }, {
    to: () => ({ emit: (...args) => emitted.push(args) }),
  });
  const x = p.x;
  loop._updatePlayers();
  loop._updatePlayers();
  loop._checkScrapCollection();
  assert.equal(p.x, x);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], 'playerDied');
});

test('safe spawn chooses clearance from other fleets', () => {
  const p = fleet();
  const enemy = new Player('enemy', 'Enemy');
  enemy.x = enemy.y = 2000;
  p.die();
  p.respawn(true, { pilot: p, enemy });
  assert.ok(p.distanceTo(enemy) >= 300);
  assert.ok(p.x >= 100 && p.x <= 3900);
  assert.ok(p.y >= 100 && p.y <= 3900);
});

function adManager() {
  const window = { FleetI18n: i18n() };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/monetization.js'), 'utf8'), { window });
  return window.AdManager;
}

test('ad adapter grants success only on completion; cancellation and exceptions fail', async () => {
  const manager = adManager();
  let rewards = 0;
  let failures = 0;
  manager.setAdapter({ showRewardedAd: async () => true, showInterstitialAd: async () => true });
  assert.equal(await manager.showRewardedAd(() => rewards++, () => failures++), true);
  assert.equal(await manager.showInterstitialAd(), true);
  manager.setAdapter({ showRewardedAd: async () => false, showInterstitialAd: async () => false });
  assert.equal(await manager.showRewardedAd(() => rewards++, () => failures++), false);
  manager.setAdapter({ showRewardedAd: async () => { throw Error('SDK unavailable'); }, showInterstitialAd: async () => false });
  assert.equal(await manager.showRewardedAd(() => rewards++, () => failures++), false);
  assert.equal(rewards, 1);
  assert.equal(failures, 2);
  assert.equal(manager.busy, false);
});

test('ad manager rejects simultaneous ads and releases lock', async () => {
  const manager = adManager();
  let complete;
  manager.setAdapter({ showRewardedAd: () => new Promise(resolve => { complete = resolve; }), showInterstitialAd: async () => true });
  const pending = manager.showRewardedAd();
  assert.equal(await manager.showInterstitialAd(), false);
  assert.throws(() => manager.setAdapter({}));
  complete(true);
  assert.equal(await pending, true);
  assert.equal(manager.busy, false);
});

test('socket handlers reject living, duplicate and stale requests; ignore client economy', t => {
  let onConnection;
  const handlers = {};
  const emitted = [];
  class FakeIO {
    on(name, fn) { if (name === 'connection') onConnection = fn; }
    emit() {}
    to() { return { emit() {}, volatile: { emit() {} } }; }
  }
  const fakeServer = { listen() {}, close() {} };
  const fakeExpress = () => ({ use() {}, disable() {}, get() {} });
  fakeExpress.static = () => {};
  const context = {
    require(name) {
      if (name === 'express') return fakeExpress;
      if (name === 'http') return { createServer: () => fakeServer };
      if (name === 'socket.io') return { Server: FakeIO };
      if (name === './entities') return require('../server/entities');
      if (name === './rpg') return require('../server/rpg');
      if (name === './worldEvents') return require('../server/worldEvents');
      if (name === './gameLoop') return { GameLoop: class { start() {} } };
      if (name === './roomManager') return require('../server/roomManager');
      return require(name);
    },
    __dirname: path.join(__dirname, '../server'),
    process: { env: {}, on() {} }, console,
  };
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  vm.runInNewContext(source + '\nglobalThis.state = roomManager;', context);
  t.after(() => context.state.destroy());
  onConnection({ id: 'pilot', join() {}, leave() {}, on: (name, fn) => { handlers[name] = fn; }, emit: (...args) => emitted.push(args) });
  handlers.join({ name: 'Pilot' });
  const p = context.state.current('pilot').players.get('pilot');
  let result;
  const ack = data => { result = data; };
  handlers.requestRewardedRespawn({ deathId: 0 }, ack);
  assert.equal(result.ok, false);
  p.score = 110; p.scrapCollected = 11;
  for (let i = 0; i < 5; i++) p.addDrone(`d${i}`);
  p.die();
  handlers.requestRewardedRespawn({ deathId: 999 }, ack);
  assert.equal(result.ok, false);
  handlers.requestRewardedRespawn({ deathId: p.deathId, score: 999999, drones: 100 }, ack);
  assert.equal(result.ok, true);
  assert.equal(p.score, 55);
  assert.equal(p.drones.length, 2);
  handlers.requestRewardedRespawn({ deathId: p.deathId }, ack);
  assert.equal(result.ok, false);
  handlers.join({ name: 'Exploit' });
  assert.equal(context.state.current('pilot').players.get('pilot'), p);
  assert.equal(emitted.filter(([name]) => name === 'respawned').length, 2);
  const room = context.state.current('pilot');
  p.attributePoints = 3;
  handlers.allocateAttribute({ roomId: 'old', attribute: 'shield' }, ack);
  assert.equal(result.ok, false);
  handlers.allocateAttribute({ roomId: room.roomId, deathId: 0, attribute: 'shield' }, ack);
  assert.equal(result.ok, false, 'a request from a previous life is rejected');
  handlers.allocateAttribute({ roomId: room.roomId, deathId: p.deathId, attribute: 'shield' }, ack);
  assert.equal(result.ok, true); assert.equal(p.attributePoints, 2); assert.equal(p.maxHp, 150);
  handlers.useAbility({ roomId: room.roomId, type: 'shield' }, ack);
  assert.equal(result.ok, true);
  handlers.useAbility({ roomId: room.roomId, type: 'shield' }, ack);
  assert.equal(result.ok, false, 'cooldown cannot be bypassed');
  handlers.claimDailyBoost({}, ack); assert.equal(result.ok, true);
  handlers.claimDailyBoost({}, ack); assert.equal(result.ok, false);
  room.events.award(p, 5000, 'bounty');
  const reward = p.coinRewards[0];
  handlers.ackCoinReward({ roomId: 'old-room', id: reward.id });
  assert.equal(p.coinRewards.length, 1);
  handlers.ackCoinReward({ roomId: room.roomId, id: reward.id, coins: 999999 });
  assert.equal(p.coinRewards.length, 0);
  handlers.ackCoinReward({ roomId: room.roomId, id: reward.id });
  assert.equal(p.coinRewards.length, 0, 'coin receipt acknowledgement is idempotent');
  const killer = new Player('killer', 'Killer'); killer.x = killer.y = 2000;
  room.players.set(killer.id, killer); room.obstacles.clear();
  p.shieldUntil = p.spawnProtectionUntil = 0;
  p.takeDamage(p.hp, killer);
  handlers.requestRevengeRespawn({ roomId: room.roomId, deathId: p.deathId }, ack);
  assert.equal(result.ok, true);
  assert.ok(Math.hypot(p.x - killer.x, p.y - killer.y) >= 400);
  assert.ok(Math.hypot(p.x - killer.x, p.y - killer.y) <= 500);
  assert.equal(p.score, 0); assert.equal(p.level, 1); assert.equal(p.hp, 100);
  handlers.requestRevengeRespawn({ roomId: room.roomId, deathId: p.deathId }, ack);
  assert.equal(result.ok, false, 'revenge cannot resurrect twice');
});

test('client death modal blocks input, retries cancelled ads and waits for server respawn', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, {
        textContent: '', style: {}, disabled: false, focusCount: 0,
        focus() { this.focusCount++; },
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name), toggle() {},
        },
      });
    }
    return nodes.get(id);
  };
  const handlers = {};
  const requests = [];
  const socket = {
    on: (name, fn) => { handlers[name] = fn; }, io: { on() {} },
    timeout: () => socket,
    emit: (...args) => requests.push(args),
  };
  let success, failure;
  const gameplay = [];
  const context = {
    Phaser: { Scene: class {} }, performance: { now: () => 1000 }, io: () => socket,
    document: { readyState: 'loading', addEventListener() {}, getElementById: node },
    window: { FleetI18n: i18n(), io: () => socket, AdManager: {
      showRewardedAd(ok, fail) { success = ok; failure = fail; },
      gameplayStart() { gameplay.push('start'); }, gameplayStop() { gameplay.push('stop'); },
    } },
  };
  let source = fs.readFileSync(path.join(__dirname, '../client/js/game-scene.js'), 'utf8');
  for (const file of ['movement', 'progression', 'player', 'network']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/' + file + '.js'), 'utf8'), context);
  }
  source = source.replace('  async function bootPhaser() {', '  globalThis.testing = { C, GameScene };\n  async function bootPhaser() {');
  vm.runInNewContext(source, context);
  const { C, GameScene } = context.testing;
  const scene = new GameScene();
  scene.cameras = { main: { centerOn() {} } };
  scene._explodePlayer = () => {};
  scene._setupDeathUI();
  scene._setupSocket();
  C.socket = socket;
  C.myId = 'pilot'; C.connected = true; C.joined = true;
  const dead = { id: 'pilot', hp: 0, maxHp: 100, level: 1, score: 110, scrap: 11,
    drones: [], deathId: 1, deathState: { score: 110, scrap: 11, drones: 5 } };
  scene._syncLocalState(dead);
  scene._syncLocalState(dead);
  assert.equal(C.dead, true);
  assert.ok(gameplay.includes('stop'));
  assert.equal(node('death-overlay').classList.contains('hidden'), false);
  assert.equal(node('rewarded-respawn-btn').focusCount, 1, 'repeated snapshots preserve modal');
  scene._handleInput(1000);
  assert.equal(requests.length, 0);
  node('rewarded-respawn-btn').onclick();
  node('restart-btn').onclick();
  assert.equal(requests.length, 0, 'restart blocked during ad');
  failure();
  assert.equal(C.respawnBusy, false);
  assert.equal(C.dead, true);
  node('rewarded-respawn-btn').onclick();
  success();
  assert.equal(requests[0][0], 'requestRewardedRespawn');
  assert.equal(requests[0][1].deathId, 1);
  assert.equal(C.dead, true, 'ad success alone does not resurrect locally');
  assert.equal(gameplay.includes('start'), false);
  requests[0][2](null, { ok: false, error: 'Rejected' });
  assert.equal(C.respawnBusy, false);
  node('restart-btn').onclick();
  assert.equal(requests[1][0], 'requestRespawn');
  handlers.respawned({ ...dead, hp: 100, score: 0, scrap: 0, x: 300, y: 400, deathState: null });
  assert.equal(C.dead, false);
  assert.equal(gameplay.at(-1), 'start', 'start gameplay only after authoritative respawn');
  assert.equal(node('death-overlay').classList.contains('hidden'), true);
  assert.equal(node('hud-score').textContent, '0');
  assert.equal(C.renderState.get('pilot').x, 300);
  C.room = { roomId: 'current-room' };
  scene._onSnapshot({ roomId: 'old-room', p: [dead] });
  handlers.playerDied({ ...dead, roomId: 'old-room' });
  assert.equal(C.dead, false, 'packets from the previous room must be ignored');
});

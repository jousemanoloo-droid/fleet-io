'use strict';
const i18n = () => require('../client/js/i18n')(require('../client/js/translations'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client() {
  const source = fs.readFileSync(path.join(__dirname, '../client/js/game-scene.js'), 'utf8')
    .replace('  async function bootPhaser() {', '  globalThis.testing = { C, GameScene };\n  async function bootPhaser() {');
  const context = {
    Phaser: { Scene: class {} }, performance: { now: () => 1000 }, window: { FleetI18n: i18n() },
    document: { readyState: 'loading', addEventListener() {} },
  };
  for (const file of ['movement', 'progression', 'player', 'network']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/' + file + '.js'), 'utf8'), context);
  }
  vm.runInNewContext(source, context);
  const { C, GameScene } = context.testing;
  return { C, scene: new GameScene() };
}

function graphics() {
  const object = {};
  return new Proxy(object, { get(target, key) { return key in target ? target[key] : () => object; } });
}

test('camera follows the interpolated local container with positive lerp and fixed viewport', () => {
  const { C, scene } = client();
  let calls = 0, titleColorWrites = 0;
  const camera = {
    x: 0, y: 0,
    centerOn(x, y) { this.scrollX = x - 400; this.scrollY = y - 300; },
    startFollow(target, roundPixels, lerpX, lerpY, offsetX, offsetY) {
      calls++;
      this.target = target;
      assert.equal(roundPixels, false);
      assert.equal(lerpX, 0.1);
      assert.equal(lerpY, 0.1);
      assert.equal(offsetX, 0);
      assert.equal(offsetY, 0);
    },
    stopFollow() { this.target = null; },
  };
  scene.cameras = { main: camera };
  scene.add = {
    container: () => ({
      list: [], setScale(value) { this.scale = value; return this; },
      setScrollFactor(value) { this.scrollFactor = value; return this; },
      setDepth() { return this; },
      add(child) { this.list.push(child); },
      getByName(name) { return this.list.find(child => child.name === name); },
      setVisible(value) { this.visible = value; }, destroy() {},
    }),
    graphics,
    image: () => ({ setScale() { return this; }, setVisible() { return this; }, setTexture() { return this; }, setTint() { return this; } }),
    text: () => ({ text: '', style: { color: '' }, setColor(value) { this.style.color = value; titleColorWrites++; return this; }, setOrigin() { return this; }, setText(value) { this.text = value; } }),
  };
  C.myId = 'local';
  const meta = { hp: 100, name: 'Local' };
  scene._ensurePlayerSprite('local', meta, { x: 2000, y: 1800, drones: [] });
  scene._followCamera();
  const target = scene._playerSprites.get('local');
  assert.equal(camera.target, target);
  assert.equal(target.x, 2000);
  assert.equal(target.y, 1800);
  assert.equal(target.scale, 1);
  assert.equal(target.scrollFactor, 1);
  assert.equal(camera.scrollX, 1600);
  scene._ensurePlayerSprite('local', meta, { x: 2100, y: 1900, drones: [] });
  scene._followCamera();
  assert.equal(camera.target.x, 2100);
  assert.equal(camera.target.y, 1900);
  assert.equal(calls, 1, 'follow must not be restarted each frame');
  assert.equal(titleColorWrites, 1, 'title texture must not rebuild its color every frame');
  assert.equal(camera.x, 0);
  assert.equal(camera.y, 0);
  scene._removePlayer('local');
  assert.equal(camera.target, null);
});

test('pointer uses current camera transform and absolute world coordinates, even without mouse motion', () => {
  const { C, scene } = client();
  let scrollX = 1000;
  const sent = [];
  scene.cameras = { main: { getWorldPoint(x, y) { return { x: scrollX + x / 2, y: 800 + y / 2 }; } } };
  const pointer = { x: 600, y: 400, worldX: -999, worldY: -999, manager: {} };
  C.joined = true;
  C.socket = { emit: (name, data) => sent.push({ name, ...data }) };
  scene._onPointerMove(pointer);
  scene._handleInput(1000);
  assert.deepEqual(sent[0], { name: 'playerMove', tx: 1300, ty: 1000 });
  scrollX = 1100;
  scene._handleInput(1040);
  assert.equal(sent[1].tx, 1400, 'stationary pointer must use updated camera');
  scrollX = 5000;
  scene._handleInput(1080);
  assert.equal(sent[2].tx, 4000, 'target stays inside map bounds');
});

test('frame updates interpolated entities before attaching the camera follow target', () => {
  const { C, scene } = client();
  scene.cameras = { main: { setLerp() {} } };
  C.joined = true;
  const order = [];
  for (const method of ['_handleInput', '_interpolateEntities', '_predictLocal', '_render', '_followCamera', '_renderThrust', '_drawMinimap']) {
    scene[method] = () => order.push(method);
  }
  scene.update(1000, 16);
  assert.ok(order.indexOf('_interpolateEntities') < order.indexOf('_render'));
  assert.ok(order.indexOf('_render') < order.indexOf('_followCamera'));
  assert.ok(order.indexOf('_predictLocal') < order.indexOf('_render'));
  assert.ok(order.indexOf('_handleInput') < order.indexOf('_followCamera'));
});

test('keyboard prediction uses absolute targets and keeps braking after release until mouse movement', () => {
  const { C, scene } = client();
  C.joined = true;
  scene._prediction = { state: { x: 1200, y: 1300 } };
  scene._keys = Object.fromEntries(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT'].map(key => [key, { isDown: false }]));
  scene._keys.D.isDown = true;
  scene._handleInput(1000, 16);
  assert.equal(C.targetWorld.x, 1700);
  assert.equal(C.targetWorld.y, 1300);
  scene._keys.D.isDown = false;
  scene._handleInput(1016, 16);
  scene._handleInput(1032, 16);
  assert.equal(C.targetWorld.x, 1200);
  assert.equal(C.targetWorld.y, 1300);
  scene.cameras = { main: { getWorldPoint: () => ({ x: 2400, y: 2200 }) } };
  scene._onPointerMove({ x: 50, y: 50, manager: {} });
  assert.equal(C.targetWorld.x, 2400);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Progression = require('../client/js/progression');
const { Player } = require('../server/entities');

test('RPG costs follow the requested XP power curve and cap progression at 40', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(Progression.cost), [10, 27, 46, 70, 95, 123]);
  for (let level = 2; level < 40; level++) {
    const threshold = Progression.threshold(level);
    assert.ok(Progression.cost(level) > Progression.cost(level - 1));
    assert.equal(Progression.levelForScrap(threshold - 1), level - 1);
    assert.equal(Progression.levelForScrap(threshold), level);
    assert.equal(threshold - Progression.threshold(level - 1), Progression.cost(level - 1));
  }
  assert.deepEqual(Progression.progress(35), { level: 2, collected: 25, required: 27 });
  assert.deepEqual(Progression.progress(37), { level: 3, collected: 0, required: 46 });
  assert.equal(Progression.levelForXP(Number.MAX_SAFE_INTEGER), 40);
});

test('large scrap drops skip levels correctly and trigger mutation only when crossing a tenth level', () => {
  const p = new Player('pilot', 'Pilot');
  p.collectScrap({ value: Progression.threshold(9) });
  assert.equal(p.level, 9);
  assert.equal(p.levelUpPending, false);
  p.collectScrap({ value: Progression.threshold(10) - p.scrapCollected });
  assert.equal(p.level, 10);
  assert.equal(p.levelUpPending, true);
  p.applyUpgrade('nano_armor');
  p.collectScrap({ value: Progression.threshold(25) - p.scrapCollected });
  assert.equal(p.level, 25);
  assert.equal(p.levelUpPending, true);
});

test('rewarded respawn recalculates curved level from retained scrap and free restart resets it', () => {
  const p = new Player('pilot', 'Pilot');
  p.collectScrap({ value: Progression.threshold(10) });
  p.applyUpgrade('nano_armor');
  p.die();
  assert.equal(p.respawn(true, new Map([[p.id, p]])), true);
  assert.equal(p.scrapCollected, Math.floor(Progression.threshold(10) / 2));
  assert.equal(p.level, Progression.levelForXP(Math.floor(Progression.threshold(10) * 10 / 2)));
  assert.deepEqual(p.mutations, ['nano_armor']);
  p.die();
  p.respawn(false, new Map([[p.id, p]]));
  assert.equal(p.scrapCollected, 0);
  assert.equal(p.level, 1);
});

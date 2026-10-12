'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dictionaries = require('../client/js/translations');
const create = require('../client/js/i18n');

test('first visit always uses English, regardless of browser language; only valid saved preferences override it', () => {
  for (const saved of [null, '', 'fr', 'ES', 'undefined']) {
    const i = create(dictionaries, { navigator: { language: 'es-ES' }, localStorage: { getItem: () => saved } });
    assert.equal(i.language, 'en');
    assert.equal(i.t('death.title'), 'FLEET DESTROYED');
  }
  assert.equal(create(dictionaries, { localStorage: { getItem: () => 'es' } }).language, 'es');
});

test('both dictionaries cover the same keys and parameters; all static UI and mutation/catalog entries have translations', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.es).sort());
  const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, value] of Object.entries(dictionaries.en)) {
    assert.ok(value && dictionaries.es[key], key);
    assert.deepEqual(parameters(value), parameters(dictionaries.es[key]), key);
  }
  const html = fs.readFileSync('client/index.html', 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-placeholder|-aria-label|-content)?="([^"]+)"/g)) assert.ok(dictionaries.en[match[1]], match[1]);
  assert.ok(html.indexOf('js/i18n.js') < html.indexOf('monetization.js'));
  const window = {};
  require('node:vm').runInNewContext(fs.readFileSync('client/js/economy.js', 'utf8'), { window });
  const { CATALOG } = window.FleetEconomy;
  for (const items of Object.values(CATALOG)) for (const item of items) assert.ok(dictionaries.en[item.nameKey]);
  for (const type of ['plasma_thrusters', 'quantum_magnet', 'nano_armor', 'heavy_swarm']) {
    assert.ok(dictionaries.en[`mutation.${type}.name`]); assert.ok(dictionaries.en[`mutation.${type}.desc`]);
  }
});

test('switch updates live DOM, attributes and Phaser text, with current numbers and untranslated player names', () => {
  const saved = new Map(), i = create(dictionaries, { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } });
  const dom = { textContent: '', setAttribute(key, value) { this[key] = value; } };
  const text = { type: 'Text', scene: {}, text: '', setText(value) { this.text = value; } };
  i.render(dom, i.m('death.summary', { score: 0, scrap: 7, drones: 3 }));
  i.render(dom, i.m('death.avatar'), '@alt');
  i.render(text, i.m('mutation.applied', { icon: '*', name: i.m('mutation.plasma_thrusters.name') }), 'phaserText');
  let calls = 0; const unsubscribe = i.subscribe(() => calls++);
  i.setLanguage('es');
  assert.match(dom.textContent, /Puntuación: 0/); assert.match(dom.textContent, /7/);
  assert.equal(dom.alt, dictionaries.es['death.avatar']);
  assert.equal(text.text, '* ' + dictionaries.es['mutation.plasma_thrusters.name']);
  assert.equal(saved.get('fleetio.language'), 'es');
  i.render(text, i.m('pvp.king', { name: '<Pilot> José', seconds: 12 }), 'phaserText');
  i.setLanguage('en'); assert.equal(text.text, 'ZONE KING: <Pilot> José (12s)');
  assert.equal(calls, 2); unsubscribe(); i.unbind(text);
  i.setLanguage('es'); assert.equal(calls, 2); assert.equal(text.text, 'ZONE KING: <Pilot> José (12s)');
});

test('static refresh preserves the latest runtime room/status binding and never resurrects cleared notifications', () => {
  const node = { nodeType: 1, isConnected: true, dataset: { i18n: 'menu.prompt' }, textContent: '' };
  const document = { documentElement: {}, querySelectorAll: selector => selector === '[data-i18n]' ? [node] : [], getElementById: () => null };
  const i = create(dictionaries, { document });
  i.render(node, i.m('room.info', { mode: i.m('room.private'), humans: 2, bots: 0 }));
  i.setLanguage('es'); assert.match(node.textContent, /SALA PRIVADA/); assert.match(node.textContent, /2 pilotos/);
  i.render(node, ''); i.setLanguage('en'); assert.equal(node.textContent, ''); assert.equal(document.documentElement.lang, 'en');
});

test('disabled storage and legacy Spanish backend errors cannot break English UI', () => {
  const i = create(dictionaries, { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  assert.equal(i.language, 'en');
  assert.equal(String(i.error(dictionaries.es['error.fullRoom'])), 'Room is full.');
  assert.equal(String(i.error('unknown internal error')), dictionaries.en['status.noReply']);
  i.setLanguage('es'); assert.equal(String(i.error(dictionaries.en['error.fullRoom'])), dictionaries.es['error.fullRoom']);
  i.setLanguage('invalid'); assert.equal(i.language, 'es');
});

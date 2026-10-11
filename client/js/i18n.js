(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.FleetI18n = factory(root.FleetTranslations, root);
})(typeof window !== 'undefined' ? window : globalThis, function (dictionaries, environment) {
  'use strict';
  environment ||= {};
  const storageKey = 'fleetio.language', listeners = new Set(), bindings = new Map();
  let language = 'en', nextId = 0;
  try { const saved = environment.localStorage?.getItem(storageKey); if (saved === 'en' || saved === 'es') language = saved; } catch { /* Storage may be disabled in an iframe. */ }
  function t(key, params = {}) {
    const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ''));
  }
  function m(key, params = {}) { return { key, params, toString() { return t(this.key, this.params); } }; }
  const records = new WeakMap();
  function prune(removeDisconnected = false) {
    for (const [id, reference] of bindings) {
      const target = reference.deref();
      if (!target || removeDisconnected && target.nodeType && !target.isConnected || target.type === 'Text' && !target.scene) bindings.delete(id);
    }
  }
  function render(target, message, property = 'textContent') {
    if (!target) return target;
    let record = records.get(target);
    if (!record) {
      record = { id: ++nextId, fields: new Map() }; records.set(target, record);
      if (nextId % 64 === 0) prune();
    }
    if (!bindings.has(record.id)) bindings.set(record.id, new WeakRef(target));
    record.fields.set(property, message);
    const value = String(message ?? '');
    if (property === 'phaserText') { if (target.text !== value) target.setText(value); }
    else if (property.startsWith('@')) target.setAttribute(property.slice(1), value);
    else if (target[property] !== value) target[property] = value;
    return target;
  }
  function unbind(target) { const record = records.get(target); if (record) bindings.delete(record.id); records.delete(target); }
  function apply(document = environment.document) {
    if (!document) return;
    document.documentElement.lang = language;
    for (const target of document.querySelectorAll('[data-i18n]')) {
      // Runtime messages replace the initial static binding without being reset on a switch.
      if (!records.get(target)?.fields.has('textContent')) render(target, m(target.dataset.i18n));
    }
    for (const property of ['placeholder', 'aria-label', 'content']) {
      for (const target of document.querySelectorAll(`[data-i18n-${property}]`)) render(target, m(target.getAttribute(`data-i18n-${property}`)), '@' + property);
    }
    const button = document.getElementById('language-toggle');
    if (button) {
      render(button, m('language.switch')); render(button, m('language.label'), '@aria-label');
      button.setAttribute('aria-pressed', String(language === 'es'));
    }
  }
  function setLanguage(value) {
    if (value !== 'en' && value !== 'es' || value === language) return;
    language = value;
    try { environment.localStorage?.setItem(storageKey, value); } catch { /* Still switch for this session. */ }
    prune(true);
    for (const reference of bindings.values()) {
      const target = reference.deref(), record = target && records.get(target);
      if (record) for (const [property, message] of record.fields) render(target, message, property);
    }
    apply(); for (const listener of listeners) listener(language);
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function error(value, fallback = 'status.noReply') {
    for (const key of Object.keys(dictionaries.en)) if (key.startsWith('error.') &&
      (value === dictionaries.en[key] || value === dictionaries.es[key] || value === key)) return m(key);
    return m(fallback);
  }
  const document = environment.document;
  if (document) {
    document.documentElement.lang = language;
    const boot = () => {
      apply(); const button = document.getElementById('language-toggle');
      if (button) button.onclick = () => setLanguage(language === 'en' ? 'es' : 'en');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
  return { t, m, render, unbind, apply, setLanguage, subscribe, error, get language() { return language; } };
});

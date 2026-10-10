// Reglas RPG compartidas por servidor y HUD; XP residual por nivel, máximo 40.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetProgression = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_LEVEL = 40, XP_PER_SCRAP = 10;
  const thresholds = [0];
  const requiredXP = level => Math.floor(100 * Math.pow(Math.max(1, Math.min(40, level)), 1.4));
  function thresholdXP(level) {
    level = Math.max(1, Math.min(MAX_LEVEL, level));
    while (thresholds.length < level) {
      thresholds.push(thresholds.at(-1) + requiredXP(thresholds.length));
    }
    return thresholds[level - 1];
  }
  function levelForXP(total) {
    total = Number.isFinite(total) ? Math.max(0, total) : 0;
    let level = 1;
    while (level < MAX_LEVEL && total >= thresholdXP(level + 1)) level++;
    return level;
  }
  const threshold = level => Math.ceil(thresholdXP(level) / XP_PER_SCRAP);
  const cost = level => level >= MAX_LEVEL ? 0 : threshold(level + 1) - threshold(level);
  const levelForScrap = scrap => levelForXP(Math.max(0, scrap || 0) * XP_PER_SCRAP);
  function progress(scrap) {
    const level = levelForScrap(scrap);
    return { level, collected: Math.max(0, scrap) - threshold(level), required: cost(level) };
  }
  return { MAX_LEVEL, XP_PER_SCRAP, requiredXP, thresholdXP, levelForXP, threshold, cost, levelForScrap, progress };
});

'use strict';
const Rules = require('../client/js/ship-classes');
const Cargo=require('./extractionInventory');
const CHOICE_MS = 20000;
function init(p) {
  p.shipClass = null; p.classRank = 0; p.classChoices = [];
  p.evolutionPending = 0; p.evolutionExpiresAt = 0; p.cloakUntil = 0;
}
function apply(p, id, rank) {
  const previous = Rules.definition(p.shipClass), next = Rules.definition(id);
  // Remove old multipliers before applying the new class, preserving upgrades.
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
  p.maxSpeed = p.maxSpeed / (previous?.speed || 1) * (next?.speed || 1);
  p.maxHp = p.maxHp / (previous?.hp || 1) * (next?.hp || 1);
  p.hp = Math.min(p.maxHp, p.maxHp * ratio);
  p.shipClass = next ? id : null; p.classRank = next ? rank : 0;
  p.radius = next?.radius || (p.level >= 40 ? 44 : p.level >= 25 ? 34 : p.level >= 10 ? 26 : 18);
  p.cloakUntil = 0; p.orbitalDrones.length = 0; p.carrierTarget = null;
  p.swarm?.release(p);
  p.motionRevision = (p.motionRevision || 0) + 1;
  p.inputQueue.length = 0; p.vx = p.vy = 0;
  p.targetX = p.x; p.targetY = p.y;
  p.extractionInventory?.sync(p);
}
function offer(p, now = Date.now()) {
  if (!p.alive || p.evolutionPending) return;
  const next = Rules.MILESTONES[p.classChoices.length];
  if (next && p.level >= next) {
    p.evolutionPending = next; p.evolutionExpiresAt = now + CHOICE_MS;
    p.cloakUntil = 0; p.inputQueue.length = 0; p.vx = p.vy = 0;
  }
}
function choose(p, id, milestone, now = Date.now()) {
  if (!p.alive || p.hp <= 0 || !Rules.definition(id) || !Number.isSafeInteger(milestone) ||
      milestone !== p.evolutionPending || milestone !== Rules.MILESTONES[p.classChoices.length] || p.level < milestone || Cargo.weight(p.inRunInventory || {})>Cargo.capacity(id)) return false;
  p.classChoices.push(id); apply(p, id, p.classChoices.length);
  p.evolutionPending = 0; p.evolutionExpiresAt = 0;
  offer(p, now); return true;
}
function tick(p, dt = 1/30, now = Date.now()) {
  offer(p, now);
  // Tick deadline instead of player-owned timers: no disconnected-player timers.
  if (p.evolutionPending && (p.isBot || now >= p.evolutionExpiresAt)) {
    const id=[p.shipClass,'hunter','battleship','carrier','stealth'].find(id=>Rules.definition(id) && Cargo.weight(p.inRunInventory || {})<=Cargo.capacity(id));
    choose(p,id,p.evolutionPending,now);
  }
  if (!p.radiation && !p.evolutionPending && !p.levelUpPending && now - (p.lastDamageAt || 0) >= 3000 && p.hp < p.maxHp)
    p.hp = Math.min(p.maxHp, p.hp + (2 + (p.attributes.regen || 0)*2) * dt);
}
function restore(p, rewarded) {
  if (!rewarded) { init(p); p.radius = 18; p.inputQueue.length = 0; return; }
  const rank = Rules.MILESTONES.filter(level => level <= p.level).length;
  p.classChoices.length = Math.min(p.classChoices.length, rank);
  apply(p, p.classChoices.at(-1) || null, p.classChoices.length);
  p.evolutionPending = 0; p.evolutionExpiresAt = 0;
}
module.exports = { ...Rules, init, apply, offer, choose, tick, restore, CHOICE_MS };

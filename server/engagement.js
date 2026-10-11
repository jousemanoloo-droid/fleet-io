'use strict';
const RPG = require('./rpg');
const Progression = require('../client/js/progression');
const EPOCH = Date.now();
const TYPES = ['PARRY_KILLS', 'NO_DAMAGE_XP', 'ZONE_HOLD'];

// Tick-owned state: no per-player intervals or delayed callbacks survive a room.
class Engagement {
  constructor(room, now = Date.now(), epoch = EPOCH) {
    this.room = room; this.epoch = epoch; this.sequence = 0;
    this.frenzy = null; this.phaseKey = ''; this.nextPulse = now;
  }
  emit(event, data, player) {
    this.room.io?.to(player?.id || this.room.roomId).emit(event, { ...data, roomId: this.room.roomId });
  }
  attach(p, now = Date.now()) {
    p.engagement = this;
    p.nextContractAt ??= now + 90000;
  }
  assign(p, type = TYPES[Math.floor(Math.random() * TYPES.length)], now = Date.now()) {
    if (!p.alive || p.isBot || !TYPES.includes(type)) return null;
    const duration = type === 'NO_DAMAGE_XP' ? 40000 : 60000;
    p.contract = { id: `${p.id}:${p.deathId}:${++this.sequence}`, deathId: p.deathId, type, progress: 0,
      goal: type === 'PARRY_KILLS' ? 2 : type === 'NO_DAMAGE_XP' ? 400 : 15,
      started: now, expires: now + duration, duration, status: 'ACTIVE', lastSent: -1 };
    this.progress(p, now); return p.contract;
  }
  view(p, now = Date.now()) {
    const c = p.contract;
    return c ? { id: c.id, type: c.type, progress: Math.floor(c.progress), goal: c.goal,
      remaining: Math.max(0, c.expires - now), duration: c.duration, status: c.status, deathId: c.deathId } : null;
  }
  progress(p, now = Date.now()) {
    const c = p.contract;
    if (!c || c.lastSent === Math.floor(c.progress)) return;
    c.lastSent = Math.floor(c.progress); this.emit('contract_progress', this.view(p, now), p);
  }
  add(p, amount, now = Date.now()) {
    const c = p.contract;
    if (!c || c.status !== 'ACTIVE' || !p.alive || now >= c.expires) return;
    c.progress = Math.min(c.goal, c.progress + amount);
    if (c.goal - c.progress < 1e-8) c.progress = c.goal;
    this.progress(p, now);
    if (c.progress < c.goal) return;
    // Set terminal status before granting XP: XP hooks cannot recursively pay rewards.
    c.status = 'COMPLETE';
    const xp = Progression.requiredXP(p.level) * 3;
    RPG.addXP(p, xp); this.room.events.award(p, 50, 'contract');
    if (c.type === 'NO_DAMAGE_XP') this.room.events.title(p, 'Untouchable');
    this.emit('contract_complete', { ...this.view(p, now), xp, credits: 50 }, p);
  }
  collectedXP(p, xp, now = Date.now()) {
    if (p.contract?.type === 'NO_DAMAGE_XP') this.add(p, xp, now);
  }
  fail(p, reason, now = Date.now()) {
    if (p.contract?.status !== 'ACTIVE') return;
    p.contract.status = reason;
    this.emit('contract_progress', this.view(p, now), p);
  }
  damage(p, now = Date.now()) {
    if (p.contract?.type === 'NO_DAMAGE_XP') this.fail(p, 'FAILED', now);
    this.overdrive(p, now);
  }
  overdrive(p, now = Date.now()) {
    if (!p.alive || p.hp <= 0 || p.hp >= p.maxHp * .15 || now < (p.overdriveReadyAt || 0)) return false;
    p.overdriveUntil = now + 6000; p.overdriveReadyAt = now + 45000;
    // Existing parry cooldown also benefits, once, when rage starts.
    if (p.abilityReady.parry > now) p.abilityReady.parry = now + (p.abilityReady.parry - now) / 2;
    this.emit('overdrive_activate', { id: p.id, deathId: p.deathId, duration: 6000, x: p.x, y: p.y });
    return true;
  }
  kill(killer, reflected, now = Date.now()) {
    if (!killer?.alive) return;
    killer.sessionKills = (killer.sessionKills || 0) + 1;
    if (killer.sessionKills >= 5) this.room.events.title(killer, 'Space Pirate');
    if (reflected && killer.contract?.type === 'PARRY_KILLS') this.add(killer, 1, now);
  }
  revive(p, now = Date.now()) {
    if (!p || p.alive || !p.deathState) return false;
    const killer = this.room.players.get(p.killedBy?.id);
    const target = killer?.alive ? killer.id : null;
    // The normal safe spawn is retained if the killer left or all nearby points are blocked.
    if (!p.respawn(true, this.room.players, this.room.world, this.room.obstacles)) return false;
    if (target) RPG.revengeSpawn(p, killer, this.room);
    p.revengeShieldUntil = p.spawnProtectionUntil = now + 3000;
    p.motionRevision++;
    p.revengeTarget = target;
    // The retained 50% is already restored; its matching core cannot be collected twice.
    for (const [id, core] of this.room.events.cores) if (core.ownerId === p.id) this.room.events.cores.delete(id);
    return true;
  }
  clearFrenzy() {
    for (const [id, gem] of this.room.events.gems) if (gem.frenzy) this.room.events.gems.delete(id);
    this.frenzy = null;
  }
  update(now = Date.now(), dt = 1 / 30) {
    for (const p of this.room.players.values()) {
      this.attach(p, now);
      if (!p.alive) { this.fail(p, 'FAILED', now); p.overdriveUntil = 0; continue; }
      this.overdrive(p, now);
      if (!p.isBot && now >= p.nextContractAt) {
        p.nextContractAt = now + 90000; this.assign(p, undefined, now);
      }
      if (p.contract?.status === 'ACTIVE') {
        if (now >= p.contract.expires) this.fail(p, 'EXPIRED', now);
        else if (p.contract.type === 'ZONE_HOLD' && Math.hypot(p.x, p.y) <= 400 && !p.levelUpPending) this.add(p, dt, now);
      }
    }
    // 180s rest + 10s warning + 30s active, shared phase across all rooms.
    const elapsed = Math.max(0, now - this.epoch), cycle = Math.floor(elapsed / 220000), age = elapsed % 220000;
    const phase = age >= 190000 ? 'ACTIVE' : age >= 180000 ? 'WARNING' : null;
    const key = `${cycle}:${phase}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key; this.clearFrenzy();
      if (phase) {
        const ends = this.epoch + cycle * 220000 + (phase === 'WARNING' ? 190000 : 220000);
        this.frenzy = { phase, x: this.room.world.width / 2, y: this.room.world.height / 2, radius: 400, ends };
        this.emit(phase === 'WARNING' ? 'supernova_warning' : 'supernova_frenzy', this.snapshot(now));
        this.nextPulse = now;
        if (phase === 'ACTIVE') {
          // Exactly 20 tagged drops, each 5x a normal 20-XP gem and one Neon Credit.
          for (let i = 0; i < 20; i++) {
            if (this.room.events.gems.size >= 360) {
              const [a, b] = this.room.events.gems.values();
              if (a && b) { a.xp += b.xp; a.coins += b.coins; this.room.events.gems.delete(b.id); }
            }
            const a = i / 20 * Math.PI * 2, id = this.room.events.id('frenzy');
            this.room.events.gems.set(id, { id, x: this.frenzy.x + Math.cos(a) * 100, y: this.frenzy.y + Math.sin(a) * 100,
              vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, xp: 100, coins: 1, born: now, expires: ends, frenzy: true });
          }
        }
      } else this.emit('supernova_frenzy_end', {});
    }
    if (phase === 'ACTIVE' && now >= this.nextPulse) {
      this.nextPulse = now + 1000; // No reward bursts after event-loop stalls.
      for (const p of this.room.players.values()) if (p.alive && !p.levelUpPending &&
          Math.hypot(p.x - this.frenzy.x, p.y - this.frenzy.y) <= this.frenzy.radius) {
        RPG.addXP(p, 100); p.takeDamage(p.maxHp * .05);
      }
    }
  }
  snapshot(now = Date.now()) { return this.frenzy ? { ...this.frenzy, remaining: Math.max(0, this.frenzy.ends - now) } : null; }
  remove(p) { if (p) { p.contract = null; p.engagement = null; p.overdriveUntil = 0; } }
  destroy() { this.clearFrenzy(); for (const p of this.room.players.values()) this.remove(p); }
}
module.exports = { Engagement, TYPES };

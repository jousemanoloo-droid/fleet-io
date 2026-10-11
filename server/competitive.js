'use strict';
const RPG = require('./rpg');
const BUFFS = ['DOUBLE_FIRE_RATE', 'PIERCING_LASERS', 'MIRROR_SHIELD'];
// Un calendario por sala; los deadlines se verifican además del timer de respawn.
class Competitive {
  constructor(room, now = Date.now()) {
    this.room = room; this.killTracker = Object.create(null); this.pods = new Map();
    this.timers = new Map(); this.nextZone = now+1000; this.nextLeader = now+2000;
    this.nextPod = now + 90000; this.sequence = 0; this.leader = null;
  }
  emit(event, data, target) { this.room.io?.to(target || this.room.roomId).emit(event, { ...data, roomId: this.room.roomId }); }
  kill(killer, victim) {
    if (!killer || killer === victim) return;
    const reverse = this.killTracker[victim.id];
    if (killer.nemesisId === victim.id) {
      this.room.events.grantXP(killer, 1500); killer.nemesisId = null;
      this.emit('NEMESIS_DESTROYED', { killerName: killer.name, victimName: victim.name });
    }
    if (reverse) reverse[killer.id] = 0;
    const row = this.killTracker[killer.id] ||= Object.create(null);
    row[victim.id] = (row[victim.id] || 0) + 1;
    if (row[victim.id] >= 2 && victim.nemesisId !== killer.id) {
      victim.nemesisId = killer.id;
      this.emit('NEMESIS_ASSIGNED', { nemesisId: killer.id, username: killer.name }, victim.id);
    }
    this.clearBuffs(victim); victim.kothTime = 0;
  }
  clearBuffs(p) {
    clearTimeout(this.timers.get(p.id)); this.timers.delete(p.id);
    p.revengeUntil = p.parryUntil = p.supplyUntil = 0;
    p.isInvulnerable = p.isParrying = false; p.speedMultiplier = 1; p.supplyBuff = null;
  }
  respawn(p, now = Date.now()) {
    this.clearBuffs(p); p.kothTime = 0;
    if (!p.nemesisId || !this.room.players.has(p.nemesisId)) { p.nemesisId = null; return; }
    p.revengeUntil = now + 3000; p.isInvulnerable = true; p.speedMultiplier = 1.5;
    const deathId = p.deathId;
    const timer = setTimeout(() => {
      if (p.deathId === deathId) { p.revengeUntil = 0; p.isInvulnerable = false; p.speedMultiplier = 1; }
      this.timers.delete(p.id);
    }, 3000);
    timer.unref?.(); this.timers.set(p.id, timer);
  }
  update(now = Date.now()) {
    for (const p of this.room.players.values()) {
      p.isParrying = p.alive && now < p.parryUntil;
      p.isInvulnerable = p.alive && now < p.revengeUntil;
      p.speedMultiplier = p.isInvulnerable ? 1.5 : 1;
      if (!p.alive || now >= p.supplyUntil) { p.supplyBuff = null; p.supplyUntil = 0; }
      if (!p.alive || Math.hypot(p.x, p.y) > 400) p.kothTime = 0;
    }
    if (now >= this.nextZone) {
      // Sin catch-up de premios: una pausa del proceso no genera ráfagas de XP.
      this.nextZone += (Math.floor((now-this.nextZone)/1000)+1)*1000;
      for (const p of this.room.players.values()) if (p.alive && p.hp > 0 && Math.hypot(p.x, p.y) <= 400) {
        RPG.addXP(p, 50); this.room.events.award(p, 5, 'koth'); p.kothTime++;
      }
    }
    if (now >= this.nextLeader) {
      this.nextLeader += (Math.floor((now-this.nextLeader)/2000)+1)*2000;
      const p = [...this.room.players.values()].filter(p => p.alive && p.kothTime > 0)
        .sort((a,b) => b.kothTime - a.kothTime || a.id.localeCompare(b.id))[0];
      this.leader = p ? { socketId: p.id, username: p.name, time: p.kothTime } : null;
      this.emit('KOTH_LEADER_UPDATE', this.leader || { socketId: null, username: '', time: 0 });
    }
    if (now >= this.nextPod) { this.nextPod += (Math.floor((now-this.nextPod)/90000)+1)*90000; this.spawnPod(); }
  }
  spawnPod() {
    // Uno activo: reemplazo anunciado por snapshot, sin crecimiento de entidades.
    let point;
    for (let i=0; i<64; i++) {
      const x = 60 + Math.random() * (this.room.world.width - 120);
      const y = 60 + Math.random() * (this.room.world.height - 120);
      if (Math.hypot(x,y) >= 800 && ![...this.room.obstacles.values()].some(o => Math.hypot(x-o.x,y-o.y) < o.radius+50)) { point = {x,y}; break; }
    }
    if (!point) return null;
    this.pods.clear(); const pod = { id: `pod:${++this.sequence}`, ...point, radius: 32, hp: 1500, maxHp: 1500, vx:0, vy:0 };
    this.pods.set(pod.id, pod); this.emit('POD_SPAWNED', pod); return pod;
  }
  hitPod(pod, damage, killer, now = Date.now()) {
    if (!this.pods.has(pod.id) || !Number.isFinite(damage) || damage <= 0) return;
    pod.hp = Math.max(0, pod.hp-damage); if (pod.hp) return;
    this.pods.delete(pod.id);
    const buffType = BUFFS[Math.floor(Math.random()*BUFFS.length)];
    if (killer?.alive) { killer.supplyBuff = buffType; killer.supplyUntil = now+15000; }
    this.emit('POD_DESTROYED', {id:pod.id,killerName:killer?.name || 'Leviathan',buffType: killer?.alive ? buffType : null});
  }
  remove(id) {
    const p = this.room.players.get(id); if (p) this.clearBuffs(p);
    delete this.killTracker[id]; for (const row of Object.values(this.killTracker)) delete row[id];
    for (const other of this.room.players.values()) if (other.nemesisId === id) other.nemesisId = null;
    if (this.leader?.socketId === id) this.leader = null;
  }
  snapshot() { return { pods: [...this.pods.values()].map(p => [p.id,p.x,p.y,p.hp,p.maxHp]), leader:this.leader }; }
  destroy() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.pods.clear(); this.killTracker = Object.create(null); }
}
module.exports = { Competitive, BUFFS };

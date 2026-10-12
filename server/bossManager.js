'use strict';
// One manager per room. No intervals: scheduling and expiry use the room tick.
class BossManager {
  constructor(room, events, now=Date.now()) {
    this.room=room; this.events=events; this.boss=null;
    this.nextSpawn=now+this.interval();
  }
  interval() {return 180000+Math.floor(Math.random()*120001);}
  id(kind) {return this.events.id(kind);}
  emit(name,data) {this.events.emit(name,data);}
  title(p,title) {this.events.title(p,title);}
  escape(p) {this.events.escape(p);}
  grantXP(p,xp) {this.events.grantXP(p,xp);}
  award(p,coins,reason) {this.events.award(p,coins,reason);}
  scatter(...args) {this.events.scatter(...args);}
  update(players,now=Date.now()) {
    if(this.boss && now>=this.boss.expires) this.clear();
    if(now>=this.nextSpawn) {if(!this.boss)this.spawnBoss(now);this.nextSpawn=now+this.interval();}
    if(this.boss)for(const id of this.boss.damageMap.keys()) if(!this.room.players.has(id)) this.boss.damageMap.delete(id);
    this.updateBoss(players,now);
  }
  clear() {
    const boss=this.boss;
    if(!boss)return;
    for(const [id,shot] of this.room.projectiles) if(shot.ownerId===boss.id || shot.sourceId===boss.id) this.room.projectiles.delete(id);
    boss.damageMap.clear(); this.boss=null;
  }
  destroy() {this.clear();this.events=null;this.room=null;}
  spawnBoss(now=Date.now()) {
    if(this.boss) return;
    this.boss = { id: this.id('boss'), x: 200 + Math.random() * (this.room.world.width-400), y: 200 + Math.random() * (this.room.world.height-400),
      vx: 0, vy: 0, radius: 100, hp: 12000, maxHp: 12000, alive: true, state: 'PATROL',
      damageMap: new Map(), nextSalvo: 0, rotation: 0 };
    this.boss.expires = now+180000; this.emit('BOSS_SPAWN', { id: this.boss.id, x:this.boss.x, y:this.boss.y });
  }
  updateBoss(players, now) {
    const b = this.boss; if (!b) return;
    let target = null, distance = 800;
    for (const p of players) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < distance) { target = p; distance = d; }
    }
    b.state = target ? 'AGGRESSION' : 'PATROL';
    const tx = target?.x ?? this.room.world.width / 2 + Math.cos(now / 12000) * 220;
    const ty = target?.y ?? this.room.world.height / 2 + Math.sin(now / 12000) * 220;
    const angle = Math.atan2(ty - b.y, tx - b.x); b.rotation = angle;
    b.vx = Math.cos(angle) * 35 / 30; b.vy = Math.sin(angle) * 35 / 30;
    b.x = Math.max(b.radius, Math.min(this.room.world.width - b.radius, b.x + b.vx + (b.hazardKickX || 0)));
    b.y = Math.max(b.radius, Math.min(this.room.world.height - b.radius, b.y + b.vy + (b.hazardKickY || 0)));
    b.hazardKickX=(b.hazardKickX || 0)*.9;b.hazardKickY=(b.hazardKickY || 0)*.9;
    if (target && now >= b.nextSalvo) {
      b.nextSalvo = now + 3000;
      for (let i = 0; i < 24 && this.room.projectiles.size < 240; i++) {
        const a = i / 24 * Math.PI * 2, id = this.id('salvo');
        this.room.projectiles.set(id, { id, ownerId: b.id, sourceId:b.id, x: b.x + Math.cos(a) * 105,
          y: b.y + Math.sin(a) * 105, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12,
          damage: 18, ttl: 75, color: 0xffb830 });
      }
    }
  }
  bossHit(damage, attacker) {
    const b = this.boss; if (!b?.alive || !attacker || !Number.isFinite(damage) || damage <= 0) return;
    const dealt = Math.min(b.hp, Math.max(0, damage)); b.hp -= dealt;
    b.damageMap.set(attacker.id, (b.damageMap.get(attacker.id) || 0) + dealt);
    if (b.hp > 0) return;
    b.alive = false; this.title(attacker, 'Leviathan Slayer');
    if (attacker.escapeThreat === b.id) this.escape(attacker);
    for(const id of b.damageMap.keys()) if(!this.room.players.has(id)) b.damageMap.delete(id);
    const total = [...b.damageMap.values()].reduce((a, v) => a + v, 0);
    // Método de restos mayores: repartir el 60% exacto, sin acuñar por redondeo.
    const distribute = (amount, grant) => {
      const parts = [...b.damageMap].map(([id, dmg]) => ({ id, exact: amount * dmg / total }));
      let remainder = amount - parts.reduce((sum, p) => sum + Math.floor(p.exact), 0);
      parts.sort((a, c) => (c.exact % 1) - (a.exact % 1));
      for (const part of parts) grant(this.room.players.get(part.id), Math.floor(part.exact) + (remainder-- > 0 ? 1 : 0));
    };
    distribute(6000, (p, xp) => this.grantXP(p, xp));
    distribute(3000, (p, coins) => this.award(p, coins, 'boss'));
    this.scatter(b.x, b.y, 4000, 2000, 30);
    this.emit('BOSS_DEFEATED', { id: b.id, username: attacker.name, x: b.x, y: b.y });
    this.room.powerups?.drop(b.x,b.y,3); this.clear();
    require('./resourceTypes').globalBossLoot(this.room.extraction,b);
  }
}
module.exports={BossManager};

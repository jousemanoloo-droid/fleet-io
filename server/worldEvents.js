'use strict';
const RPG = require('./rpg');
const {BossManager}=require('./bossManager');
const Loot=require('./resourceTypes');
const EPOCH = Date.now();
const TITLES = ['Space Terror', 'Leviathan Slayer', 'Dominator', 'Space Pirate', 'Untouchable'];
const EFFECTS = ['default', 'FROST_SHATTER', 'BLACK_HOLE', 'NEON_GRAFFITI'];

// Todas las salas comparten la fase del calendario. El único temporizador sigue
// siendo el tick existente: destruir una sala no deja callbacks ni timers vivos.
class WorldEvents {
  constructor(room, now = Date.now(), epoch = EPOCH) {
    this.room = room; this.gems = new Map(); this.cores = new Map(); this.bounties = new Map();
    this.bossManager = new BossManager(room,this,now); this.sequence = 0; this.warned = false;
    this.nextMeteor = epoch + (Math.floor((now - epoch) / 240000) + 1) * 240000;

  }
  emit(event, data, playerId) {
    if (!playerId && ['death_fx','asteroid_destroyed'].includes(event) && this.room.emitSpatial) {
      this.room.emitSpatial(event,data); return;
    }
    this.room.io?.to(playerId || this.room.roomId).emit(event, { ...data, roomId: this.room.roomId });
  }
  id(kind) { return kind === 'reward' ? `${this.room.roomId}:${kind}:${++this.sequence}` : `${kind}:${++this.sequence}`; }
  award(p, coins, reason) {
    if (!p || p.isBot || !Number.isSafeInteger(coins) || coins <= 0) return;
    p.coinRewards ||= [];
    // Los mensajes pendientes son inmutables: un reenvío conserva id e importe.
    if (p.coinRewards.length >= 64) { p.coinRewardReserve += coins; return; }
    const reward = { id: this.id('reward'), coins, reason }; p.coinRewards.push(reward);
    this.emit('coin_reward', reward, p.id);
  }
  title(p, title) {
    p.titles ||= [];
    if (!p.titles.includes(title)) {
      p.titles.push(title);
      if (!p.equippedTitle) p.equippedTitle = title; this.emit('profile_unlock', { title }, p.id);
    }
  }
  // Reparto entero conserva exactamente el premio incluso cuando es <24 XP.
  scatter(x, y, xp, coins = 0, count = 24, now = Date.now()) {
    xp = Math.max(0, Math.floor(xp)); coins = Math.max(0, Math.floor(coins));
    count = Math.max(20, Math.min(30, count));
    for (let i = 0; i < count; i++) {
      const value = Math.floor(xp / count) + (i < xp % count ? 1 : 0);
      const gold = Math.floor(coins / count) + (i < coins % count ? 1 : 0);
      if (this.gems.size >= 360) {
        const oldest = this.gems.values().next().value;
        oldest.xp += value; oldest.coins += gold; oldest.expires = Math.max(oldest.expires, now + 45000);
        continue;
      }
      const angle = Math.random() * Math.PI * 2, speed = 180 + Math.random() * 180;
      const id = this.id('gem');
      this.gems.set(id, { id, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        xp: value, coins: gold, born: now, expires: now + 45000 });
    }
  }
  death(p, now = Date.now()) {
    if (!p.deathState || p._worldDeathId === p.deathId) return;
    p._worldDeathId = p.deathId;
    // totalXp es XP acumulada de la sesión; xp solo es el residuo del nivel actual.
    const total = p.deathState?.totalXp || 0, coreXP = Math.floor(total * 0.5);
    this.scatter(p.x, p.y, total - coreXP, 0, 24, now);
    for (const [id, core] of this.cores) if (core.ownerId === p.id) this.cores.delete(id);
    if (coreXP > 0) {
      if (this.cores.size >= 64) this.cores.delete(this.cores.keys().next().value);
      const id = this.id('core');
      this.cores.set(id, { id, ownerId: p.id, x: p.x, y: p.y, xp: coreXP, expires: now + 45000 });
    }
    this.emit('death_fx', { id: `${p.id}:${p.deathId}`, x: p.x, y: p.y,
      killerId: p.killedBy?.id || null, effect: p.killedBy?.killEffect || 'default', chassis: p.killedBy?.chassis || 1 });
    const bounty = this.bounties.get(p.id);
    const killer = this.room.players.get(p.killedBy?.id);
    Loot.shipLoot(this.room.extraction,p,killer);
    if (bounty) {
      this.bounties.delete(p.id);
      if (killer && killer.id !== p.id) {
        this.award(killer, 5000, 'bounty');
        this.emit('BOUNTY_CLAIMED', { id: bounty.id, username: killer.name, killerId: killer.id });
      }
    }
    if (killer?.alive && killer.escapeThreat === p.id) this.escape(killer);
  }
  coreTarget(p, now = Date.now()) {
    for (const core of this.cores.values()) if (core.ownerId === p.id && core.expires > now)
      return { id: core.id, x: core.x, y: core.y, expiresIn: core.expires - now };
    return null;
  }
  escape(p) {
    if (!p.escapePending || !p.alive) return;
    p.escapePending = false; RPG.addXP(p, 200);
    this.emit('NARROW_ESCAPE', { x: p.x, y: p.y, xp: 200 }, p.id);
  }
  grantXP(p, xp) {
    if (!p) return;
    if (p.alive) RPG.addXP(p, xp);
    else p.pendingEventXP += xp;
  }
  // Una rejilla de 250 px reduce el magnetismo a las celdas vecinas, evitando
  // gemas × todos los jugadores. La simulación se mantiene en pasos de 1/30 s.
  grid(players) {
    const cells = new Map();
    for (const p of players) {
      const key = `${Math.floor(p.x / 250)},${Math.floor(p.y / 250)}`;
      if (!cells.has(key)) cells.set(key, []); cells.get(key).push(p);
    }
    return cells;
  }
  nearby(cells, x, y) {
    const found = [], cx = Math.floor(x / 250), cy = Math.floor(y / 250);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = cells.get(`${cx + dx},${cy + dy}`); if (bucket) found.push(...bucket);
    }
    return found;
  }
  update(now = Date.now()) {
    const players = [...this.room.players.values()].filter(p => p.alive && p.hp > 0);
    const collectors = players.filter(p => !p.levelUpPending), cells = this.grid(collectors);
    for (const p of players) {
      if (p.escapePending && now - p.lastDamageAt >= 3000) this.escape(p);
      if ((p.level >= 40 || p.killStreak >= 10) && !this.bounties.has(p.id)) {
        const bounty = { id: this.id('bounty'), targetSocketId: p.id, targetUsername: p.name, bountyValue: 5000 };
        this.bounties.set(p.id, bounty); this.title(p, 'Space Terror');
        this.emit('BOUNTY_ISSUED', bounty); this.emit('BOUNTY_ANNOUNCEMENT', bounty);
      }
    }
    for (const [id] of this.bounties) if (!this.room.players.has(id)) this.bounties.delete(id);
    const king = players.reduce((best, p) => !best || p.score > best.score ? p : best, null);
    if (king) this.title(king, 'Dominator');
    for (const [id, gem] of this.gems) {
      if (now >= gem.expires) { this.gems.delete(id); continue; }
      if (now - gem.born < 300) { gem.vx *= 0.92; gem.vy *= 0.92; }
      else {
        let target = null, distance = 250;
        for (const p of this.nearby(cells, gem.x, gem.y)) {
          const d = Math.hypot(gem.x - p.x, gem.y - p.y);
          if (d < distance) { distance = d; target = p; }
        }
        if (target) {
          // A_base=1200 px/s². Clamp requerido: 200–1200 px/s².
          const acceleration = Math.max(200, Math.min(1200, 1200 * (1 - distance / 250) ** 2));
          gem.vx += (target.x - gem.x) / (distance || 1) * acceleration / 30;
          gem.vy += (target.y - gem.y) / (distance || 1) * acceleration / 30;
          gem.vx *= 0.98; gem.vy *= 0.98;
          if (distance <= target.collectRadius + 6) {
            this.collect(target, gem); this.gems.delete(id); continue;
          }
        } else { gem.vx *= 0.92; gem.vy *= 0.92; }
      }
      gem.x = Math.max(6, Math.min(this.room.world.width - 6, gem.x + gem.vx / 30));
      gem.y = Math.max(6, Math.min(this.room.world.height - 6, gem.y + gem.vy / 30));
    }
    for (const [id, core] of this.cores) {
      if (now >= core.expires) { this.cores.delete(id); continue; }
      const p = this.nearby(cells, core.x, core.y).find(p => Math.hypot(p.x - core.x, p.y - core.y) <= p.collectRadius + 16);
      if (p) {
        RPG.addXP(p, core.xp); p.engagement?.collectedXP(p, core.xp); this.cores.delete(id);
        this.emit('core_collected', { id, xp: core.xp, recovered: p.id === core.ownerId }, p.id);
      }
    }
    if (!this.warned && now >= this.nextMeteor - 15000) {
      this.warned = true; this.emit('METEOR_WARN', { inMs: Math.max(0, this.nextMeteor - now) });
    }
    if (now >= this.nextMeteor) {
      this.meteors(); this.warned = false;
      this.nextMeteor += (Math.floor((now - this.nextMeteor) / 240000) + 1) * 240000;
    }
    this.bossManager.update(players, now);
  }
  collect(p, gem) {
    RPG.addXP(p, gem.xp); p.engagement?.collectedXP(p, gem.xp); this.award(p, gem.coins, 'gem');
    this.emit('gem_collected', { id: gem.id, xp: gem.xp }, p.id);
  }
  meteors() {
    // La especificación fija origen (0,0): muestrear el cuadrante jugable del disco.
    for (const [id, rock] of this.room.obstacles) if (rock.gold) this.room.obstacles.delete(id);
    for (let i = 0; i < 15; i++) {
      const angle = (i + 0.5) / 15 * Math.PI / 2, radius = 100 + Math.sqrt(Math.random()) * 490;
      const id = this.id('gold'); this.room.obstacles.set(id, { id, x: Math.max(30, Math.cos(angle) * radius),
        y: Math.max(30, Math.sin(angle) * radius), radius: 25, hp: 300, maxHp: 300, gold: true });
    }
    this.emit('METEOR_START', { count: 15, x: 0, y: 0 });
  }
  asteroidHit(rock, damage, attacker) {
    if (rock.volatile && this.room.hazards) return this.room.hazards.asteroidHit(rock,damage,attacker);
    rock.maxHp ||= 100; rock.hp ??= rock.maxHp;
    rock.hp = Math.max(0, rock.hp - damage);
    if (rock.hp > 0 || !this.room.obstacles.has(rock.id)) return;
    this.room.obstacles.delete(rock.id);
    Loot.asteroidLoot(this.room.extraction,rock);
    this.scatter(rock.x, rock.y, rock.gold ? 500 : 100, rock.gold ? 50 : 10);
    if(rock.gold || rock.radius >= 45) this.room.powerups?.drop(rock.x,rock.y,1);
    this.emit('asteroid_destroyed', { id: rock.id, x: rock.x, y: rock.y, gold: !!rock.gold });
  }
  get boss() {return this.bossManager.boss;}
  set boss(value) {this.bossManager.boss=value;}
  get nextBoss() {return this.bossManager.nextSpawn;}
  set nextBoss(value) {this.bossManager.nextSpawn=value;}
  spawnBoss() {this.bossManager.spawnBoss();}
  updateBoss(players,now) {this.bossManager.updateBoss(players,now);}
  bossHit(damage,attacker) {this.bossManager.bossHit(damage,attacker);}
  snapshot(now = Date.now()) {
    return { g: [...this.gems.values()].map(g => [g.id, +g.x.toFixed(1), +g.y.toFixed(1), g.xp, g.coins]),
      c: [...this.cores.values()].map(c => [c.id, c.ownerId, Math.round(c.x), Math.round(c.y), c.xp, Math.max(0, c.expires - now)]),
      q: [...this.bounties.values()].map(b => { const p = this.room.players.get(b.targetSocketId);
        return [b.targetSocketId, b.targetUsername, p?.x || 0, p?.y || 0, b.bountyValue]; }),
      boss: this.boss ? [this.boss.id, this.boss.x, this.boss.y, this.boss.hp, this.boss.maxHp,
        this.boss.rotation, this.boss.state] : null,
      meteorIn: Math.max(0, this.nextMeteor - now) };
  }
  destroy() { this.gems.clear(); this.cores.clear(); this.bounties.clear(); this.bossManager.destroy(); }
}
module.exports = { WorldEvents, TITLES, EFFECTS };

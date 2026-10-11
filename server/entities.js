// ============================================================================
// FLEET.IO - Server Entities
// Definiciones de clases para Jugadores, Drones (escoltas) y Chatarra
// ============================================================================

const WORLD = {
  width: 4000,
  height: 4000,
};
const Movement = require('../client/js/movement');
const Progression = require('../client/js/progression');
const RPG = require('./rpg');

class Entity {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
  }

  distanceTo(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

// ----------------------------------------------------------------------------
// SCRAP (Chatarra)
// ----------------------------------------------------------------------------
class Scrap extends Entity {
  constructor(id, x, y, value = 1) {
    super(x, y, 6);
    this.id = id;
    this.value = value;
    this.color = Scrap.randomColor();
    this.spin = Math.random() * Math.PI * 2;
    this.spinSpeed = (Math.random() - 0.5) * 0.05;
  }

  static randomColor() {
    const palette = [
      0x88aaff, 0xaaff88, 0xffaa88, 0xff88aa,
      0x88ffff, 0xffff88, 0xaa88ff, 0xdddddd,
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  update() {
    this.spin += this.spinSpeed;
  }

  toNetwork() {
    return {
      id: this.id,
      x: Math.round(this.x),
      y: Math.round(this.y),
      v: this.value,
      c: this.color,
      s: this.spin,
    };
  }
}

// ----------------------------------------------------------------------------
// DRONE (Escolta flotante)
// ----------------------------------------------------------------------------
class Drone {
  constructor(id, ownerId, index) {
    this.id = id;
    this.ownerId = ownerId;
    this.index = index;
    this.angle = Math.random() * Math.PI * 2;
    this.orbitRadius = 45;
    this.speed = 2.2;
    this.health = 1;
    this.state = 'ORBIT'; this.attackTimer = 0;
  }

  update(owner, deltaSeconds = 1 / 30) {
    if (this.state !== 'ORBIT') return;
    this.angle += this.speed * deltaSeconds;
    const angleOffset = this.index * (Math.PI * 2 / 6);
    this.hazardOffsetX = ((this.hazardOffsetX || 0)+(this.hazardKickX || 0))*.94;
    this.hazardOffsetY = ((this.hazardOffsetY || 0)+(this.hazardKickY || 0))*.94;
    this.hazardKickX=(this.hazardKickX || 0)*.9;this.hazardKickY=(this.hazardKickY || 0)*.9;
    this.x = owner.x + Math.cos(this.angle + angleOffset) * this.orbitRadius + this.hazardOffsetX;
    this.y = owner.y + Math.sin(this.angle + angleOffset) * this.orbitRadius + this.hazardOffsetY;
  }

  toNetwork() {
    return {
      id: this.id,
      x: Math.round(this.x),
      y: Math.round(this.y),
      state: this.state, attackTimer: Math.ceil(this.attackTimer), rotation: this.rotation || 0,
    };
  }
}

// ----------------------------------------------------------------------------
// PLAYER (Nave nodriza)
// ----------------------------------------------------------------------------
class Player extends Entity {
  constructor(id, name) {
    const spawnX = Math.random() * WORLD.width;
    const spawnY = Math.random() * WORLD.height;
    super(spawnX, spawnY, 18);

    this.id = id;
    this.name = name;
    this.color = Player.randomColor();

    // --- Movimiento con inercia ---
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = Movement.BASE_SPEED;
    this.acceleration = Movement.BASE_ACCELERATION;
    this.friction = 0.92;

    this.targetX = spawnX;
    this.targetY = spawnY;

    // --- Economía / progresión ---
    this.score = 0;
    this.scrapCollected = 0;
    this.drones = [];
    this.nextDroneIndex = 0;
    this.tacticalDrones = []; this.swarmUntil = 0;

    // --- Sistema de niveles y mutaciones (roguelite) ---
    this.hp = 100;
    this.maxHp = 100;
    this.level = 1;
    this.collectRadius = this.radius + 12;  // radio de absorción base
    this.mutations = [];                // lista de mutaciones aplicadas
    this.levelUpPending = false;        // true mientras el jugador elige carta
    this.invulnerable = false;          // invulnerable temporal durante elección

    this.alive = true;
    this.deathId = 0;
    this.deathState = null;
    this.spawnProtectionUntil = 0;
    this.rotation = 0;
    this.inputSeq = 0;
    this.inputQueue = [];
    RPG.init(this);
  }

  static randomColor() {
    const palette = [
      0x00d4ff, 0xff00aa, 0x00ff88, 0xffaa00,
      0xaa00ff, 0x00ffcc, 0xff3366, 0x88ff00,
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  setTarget(tx, ty) {
    this.targetX = Math.max(0, Math.min(WORLD.width, tx));
    this.targetY = Math.max(0, Math.min(WORLD.height, ty));
  }

  update() {
    if (this.hp <= 0) this.die();
    if (!this.alive) return;

    const input = this.inputQueue.shift();
    if (input) { this.setTarget(input.tx, input.ty); this.inputSeq = input.seq; }
    RPG.movement(this);
    Movement.step(this, { tx: this.targetX, ty: this.targetY }, WORLD);
    RPG.orbit(this);

    if (!this.swarm) for (const drone of this.drones) drone.update(this);
  }

  addDrone(droneId) {
    const drone = new Drone(droneId, this.id, this.nextDroneIndex++);
    drone.x = this.x;
    drone.y = this.y;
    this.drones.push(drone);
    return drone;
  }

  // Captura autoritativa e inmutable de la economía antes de limpiar la flota.
  die() {
    if (this.deathState) return false;
    this.deathId++;
    this.deathState = Object.freeze({
      score: this.score, scrap: this.scrapCollected, drones: this.drones.length,
      totalXp: this.totalXp, survivedMs: Date.now() - this.matchStartedAt,
    });
    this.hp = 0;
    this.engagement?.fail(this, 'FAILED'); this.overdriveUntil = this.revengeShieldUntil = 0;
    this.competitive?.clearBuffs(this); this.kothTime = 0;
    this.alive = false;
    this.vx = this.vy = 0;
    this.inputQueue.length = 0;
    this.swarm?.release(this); this.swarmUntil = 0;
    this.drones = [];
    this.orbitalDrones = [];
    this.killStreak = 0;
    this.escapePending = false;
    this.comboCount = this.comboTimer = this.slingshotRemaining = this.teleportRemaining = 0;
    this.kickX = this.kickY = this.kickAppliedX = this.kickAppliedY = 0; this.gravityWell = null;
    this.fireRateMultiplier = this.moveSpeedMultiplier = 1;
    this.dashUntil = this.shieldUntil = this.empUntil = this.dailyBoostUntil = 0;
    this.levelUpPending = false;
    this.invulnerable = false;
    this.upgradeOptions = [];
    return true;
  }

  respawn(rewarded, players, world = WORLD, obstacles = new Map()) {
    if (!this.deathState || this.alive) return false;
    const saved = this.deathState;
    this.contract = null; // A new life cannot resume a failed contract from the previous fleet.
    const fraction = rewarded ? 0.5 : 0;
    this.score = Math.floor(saved.score * fraction);
    this.scrapCollected = Math.floor(saved.scrap * fraction);
    this.drones = [];
    this.nextDroneIndex = 0;
    if (!rewarded) {
      this.maxHp = 100;
      this.maxSpeed = Movement.BASE_SPEED;
      this.collectRadius = this.radius + 12;
      this.mutations = [];
      this.attributes = { speed: 0, shield: 0, damage: 0, fireRate: 0 };
      this.attributePoints = 0;
    }
    RPG.restoreXP(this, (saved.totalXp || saved.scrap * 10) * fraction);
    this.killedBy = null;
    this.matchStartedAt = Date.now();
    this.abilityReady = { dash: 0, shield: 0, emp: 0, parry: 0 };
    // Buscar separación respecto a naves y escoltas. En mapas saturados,
    // escoger el punto más alejado y conceder protección temporal.
    let best = null;
    for (let i = 0; i < 64; i++) {
      const candidate = {
        x: 100 + Math.random() * (world.width - 200),
        y: 100 + Math.random() * (world.height - 200),
      };
      let clearance = Infinity;
      for (const other of players instanceof Map ? players.values() : Object.values(players)) {
        if (other.id === this.id || !other.alive || other.hp <= 0) continue;
        for (const threat of [other, ...other.drones]) {
          clearance = Math.min(clearance, Math.hypot(candidate.x - threat.x, candidate.y - threat.y));
        }
      }
      for (const obstacle of obstacles.values()) {
        clearance = Math.min(clearance,
          Math.hypot(candidate.x - obstacle.x, candidate.y - obstacle.y) - obstacle.radius - this.radius);
      }
      if (!best || clearance > best.clearance) best = { ...candidate, clearance };
      if (clearance >= 300) break;
    }
    this.x = this.targetX = best.x;
    this.y = this.targetY = best.y;
    this.vx = this.vy = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.deathState = null;
    this.levelUpPending = false;
    this.spawnProtectionUntil = Date.now() + 3000;
    for (let i = 0; i < Math.floor(saved.drones * fraction); i++) {
      this.addDrone(`respawn_${this.id}_${this.deathId}_${i}`).update(this);
    }
    RPG.addXP(this, this.pendingEventXP);
    this.pendingEventXP = 0;
    this.competitive?.respawn(this);
    return true;
  }

  takeDamage(amount, attacker = null, reflected = false) {
    if (!this.alive || this.invulnerable || Date.now() < this.revengeUntil || Date.now() < this.revengeShieldUntil || Date.now() < this.spawnProtectionUntil ||
        Date.now() < this.dashUntil || Date.now() < this.shieldUntil ||
        !Number.isFinite(amount) || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.lastDamageAt = Date.now();
    this.engagement?.damage(this, this.lastDamageAt);
    if (this.hp > 0 && this.hp / this.maxHp < 0.1) {
      this.escapePending = true; this.escapeThreat = attacker?.id || null;
    }
    if (this.hp <= 0) {
      if (attacker && attacker !== this) {
        if (attacker.alive) {
          attacker.killStreak++; attacker.score += 100;
          RPG.addXP(attacker, 100);
        }
        this.killedBy = RPG.killerInfo(attacker);
      }
      this.die();
      this.engagement?.kill(attacker, reflected);
    }
    return true;
  }

  // Recolecta chatarra. Devuelve cuántos drones se ganaron (incluye drops grandes).
  // Además detecta hitos de nivel mediante la curva de coste creciente.
  collectScrap(scrap) {
    const previousMilestone = Math.floor(this.scrapCollected / 5);
    this.scrapCollected += scrap.value;
    this.score += scrap.value * 10;

    const gainedDrone = Math.max(0, Math.min(12 - this.drones.length,
      Math.floor(this.scrapCollected / 5) - previousMilestone));

    // Detección de subida de nivel
    const previousLevel = this.level;
    RPG.addXP(this, scrap.value * Progression.XP_PER_SCRAP);
    this.engagement?.collectedXP(this, scrap.value * Progression.XP_PER_SCRAP);
    if (this.level > previousLevel) {
      const milestone = Math.floor(this.level / 10) > Math.floor(previousLevel / 10);
      if (milestone) {
        this.levelUpPending = true;
        this.invulnerable = true;
      }
    }

    return gainedDrone;
  }

  // Aplica una mutación al jugador. Devuelve un objeto resumen.
  applyUpgrade(type) {
    const result = { type, name: '', desc: '' };
    this.mutations.push(type);

    switch (type) {
      case 'plasma_thrusters':
        this.maxSpeed *= 1.2;
        result.name = 'Propulsores de Plasma';
        result.desc = `Velocidad máxima +20% (${this.maxSpeed.toFixed(2)})`;
        break;
      case 'quantum_magnet':
        this.collectRadius *= 1.5;
        result.name = 'Imán Cuántico';
        result.desc = `Radio de absorción +50% (${this.collectRadius.toFixed(1)})`;
        break;
      case 'nano_armor':
        this.maxHp += 25;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
        result.name = 'Blindaje Nanotecnológico';
        result.desc = `+25 HP máx. y curación 50% (${Math.round(this.hp)}/${this.maxHp})`;
        break;
      case 'heavy_swarm': {
        const added = [];
        for (let i = 0; i < 2; i++) {
          if (this.drones.length < 18) {
            const d = this.addDrone(`drone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
            added.push(d.id);
          }
        }
        result.name = 'Enjambre Pesado';
        result.desc = `+2 drones escolta (total ${this.drones.length})`;
        result.droneIds = added;
        break;
      }
      default:
        result.name = 'Mutación desconocida';
        result.desc = '';
    }

    // Fin del estado de mutación pendiente
    this.levelUpPending = false;
    this.invulnerable = false;

    return result;
  }

  toNetwork() {
    return {
      id: this.id,
      name: this.name,
      isBot: !!this.isBot,
      x: Math.round(this.x),
      y: Math.round(this.y),
      vx: +this.vx.toFixed(2),
      vy: +this.vy.toFixed(2),
      rotation: +this.rotation.toFixed(4),
      maxSpeed: this.maxSpeed,
      inputSeq: this.inputSeq,
      color: this.color,
      score: this.score,
      scrap: this.scrapCollected,
      radius: this.radius,
      hp: Math.ceil(Math.max(0, this.hp)),
      alive: this.alive,
      deathId: this.deathId,
      deathState: this.deathState,
      maxHp: this.maxHp,
      level: this.level,
      collectRadius: Math.round(this.collectRadius),
      mutations: this.mutations,
      levelUpPending: this.levelUpPending,
      invulnerable: this.invulnerable || Date.now() < this.spawnProtectionUntil,
      drones: this.drones.map((d) => d.toNetwork()),
      tacticalDrones: this.tacticalDrones.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), state: d.state, attackTimer: Math.ceil(d.attackTimer), rotation: d.rotation || 0 })),
      swarmCooldown: Math.max(0, this.swarmUntil - Date.now()),
      orbitalDrones: this.orbitalDrones,
      ...RPG.network(this),
    };
  }
}

module.exports = {
  Entity,
  Scrap,
  Drone,
  Player,
  WORLD,
};

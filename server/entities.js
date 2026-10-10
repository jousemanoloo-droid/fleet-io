// ============================================================================
// FLEET.IO - Server Entities
// Definiciones de clases para Jugadores, Drones (escoltas) y Chatarra
// ============================================================================

const WORLD = {
  width: 4000,
  height: 4000,
};

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
  }

  update(owner) {
    this.angle += this.speed * 0.016;
    const angleOffset = this.index * (Math.PI * 2 / 6);
    this.x = owner.x + Math.cos(this.angle + angleOffset) * this.orbitRadius;
    this.y = owner.y + Math.sin(this.angle + angleOffset) * this.orbitRadius;
  }

  toNetwork() {
    return {
      id: this.id,
      x: Math.round(this.x),
      y: Math.round(this.y),
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
    this.maxSpeed = 4.5;
    this.acceleration = 0.35;
    this.friction = 0.92;

    this.targetX = spawnX;
    this.targetY = spawnY;

    // --- Economía / progresión ---
    this.score = 0;
    this.scrapCollected = 0;
    this.drones = [];
    this.nextDroneIndex = 0;

    // --- Sistema de niveles y mutaciones (roguelite) ---
    this.hp = 100;
    this.maxHp = 100;
    this.level = 1;
    this.scrapPerLevel = 10;            // piezas necesarias para subir de nivel
    this.collectRadius = this.radius + 12;  // radio de absorción base
    this.mutations = [];                // lista de mutaciones aplicadas
    this.levelUpPending = false;        // true mientras el jugador elige carta
    this.invulnerable = false;          // invulnerable temporal durante elección

    this.alive = true;
    this.deathId = 0;
    this.deathState = null;
    this.spawnProtectionUntil = 0;
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

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Durante la elección de mutación, el jugador se ralentiza (70% de velocidad)
    const speedMul = this.levelUpPending ? 0.3 : 1;

    if (dist > 2) {
      const nx = dx / dist;
      const ny = dy / dist;
      this.vx += nx * this.acceleration;
      this.vy += ny * this.acceleration;
    }

    this.vx *= this.friction;
    this.vy *= this.friction;

    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const effectiveMax = this.maxSpeed * speedMul;
    if (speed > effectiveMax) {
      this.vx = (this.vx / speed) * effectiveMax;
      this.vy = (this.vy / speed) * effectiveMax;
    }

    this.x += this.vx;
    this.y += this.vy;

    this.x = Math.max(this.radius, Math.min(WORLD.width - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(WORLD.height - this.radius, this.y));

    for (const drone of this.drones) {
      drone.update(this);
    }
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
    });
    this.hp = 0;
    this.alive = false;
    this.vx = this.vy = 0;
    this.drones = [];
    this.levelUpPending = false;
    this.invulnerable = false;
    return true;
  }

  respawn(rewarded, players, world = WORLD, obstacles = new Map()) {
    if (!this.deathState || this.alive) return false;
    const saved = this.deathState;
    const fraction = rewarded ? 0.5 : 0;
    this.score = Math.floor(saved.score * fraction);
    this.scrapCollected = Math.floor(saved.scrap * fraction);
    this.drones = [];
    this.nextDroneIndex = 0;
    if (!rewarded) {
      this.maxHp = 100;
      this.maxSpeed = 4.5;
      this.collectRadius = this.radius + 12;
      this.mutations = [];
    }
    this.level = Math.floor(this.scrapCollected / this.scrapPerLevel) + 1;
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
    return true;
  }

  takeDamage(amount) {
    if (!this.alive || this.invulnerable || Date.now() < this.spawnProtectionUntil ||
        !Number.isFinite(amount) || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.die();
    return true;
  }

  // Recolecta chatarra. Devuelve cuántos drones se ganaron (incluye drops grandes).
  // Además detecta hitos de nivel (cada scrapPerLevel piezas).
  collectScrap(scrap) {
    const previousMilestone = Math.floor(this.scrapCollected / 5);
    this.scrapCollected += scrap.value;
    this.score += scrap.value * 10;

    const gainedDrone = Math.max(0, Math.min(12 - this.drones.length,
      Math.floor(this.scrapCollected / 5) - previousMilestone));

    // Detección de subida de nivel
    const newLevel = Math.floor(this.scrapCollected / this.scrapPerLevel) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.levelUpPending = true;
      this.invulnerable = true;
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

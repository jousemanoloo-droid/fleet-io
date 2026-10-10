'use strict';
const { Player } = require('./entities');

// FSM de coste acotado: decisiones estratégicas a 5 Hz; evasión y movimiento
// a 30 Hz. Los bots usan la misma física/economía que los jugadores humanos.
class Bot extends Player {
  constructor(id, name, index = 0) {
    super(id, `[BOT] ${name}`);
    this.isBot = true;
    this.aiState = 'collect';
    this.nextDecisionTick = index % 6;
    this.orbitSide = index % 2 ? 1 : -1;
    this.respawnAt = 0;
  }

  think(room, tick) {
    if (!this.alive) return;
    let nearest = null;
    let distance = Infinity;
    for (const other of room.players.values()) {
      if (other === this || !other.alive || other.hp <= 0) continue;
      const d = Math.hypot(other.x - this.x, other.y - this.y);
      if (d < distance) { nearest = other; distance = d; }
    }
    const danger = nearest && distance < 600 &&
      (this.hp < this.maxHp * 0.3 || nearest.drones.length > this.drones.length + 3);
    if (danger) {
      this.aiState = 'flee';
      let dx = this.x - nearest.x;
      let dy = this.y - nearest.y;
      const length = Math.hypot(dx, dy) || 1;
      if (dx === 0 && dy === 0) dx = 1;
      // Componente tangencial: salir de esquinas sin insistir contra el borde.
      this._steer(room, this.x + dx / length * 450 - dy / length * 180 * this.orbitSide,
        this.y + dy / length * 450 + dx / length * 180 * this.orbitSide);
      return;
    }
    if (tick < this.nextDecisionTick) return;
    this.nextDecisionTick = tick + 6;
    let best = null;
    let utility = Infinity;
    for (const scrap of room.scraps.values()) {
      const d = Math.hypot(scrap.x - this.x, scrap.y - this.y);
      // No regalar la flota para recoger material debajo de un enemigo superior.
      if (nearest && nearest.drones.length > this.drones.length + 3 &&
          Math.hypot(scrap.x - nearest.x, scrap.y - nearest.y) < 200) continue;
      const score = d / scrap.value;
      if (score < utility) { utility = score; best = scrap; }
    }
    if (best && (this.drones.length <= 5 || utility < 160 || distance > 650)) {
      this.aiState = 'collect';
      this._steer(room, best.x, best.y);
    } else if (this.drones.length > 5 && nearest) {
      this.aiState = 'flank';
      const leadX = nearest.x + nearest.vx * 20;
      const leadY = nearest.y + nearest.vy * 20;
      const angle = Math.atan2(this.y - leadY, this.x - leadX) + this.orbitSide * 0.6;
      this._steer(room, leadX + Math.cos(angle) * 220, leadY + Math.sin(angle) * 220);
    } else if (best) {
      this.aiState = 'collect';
      this._steer(room, best.x, best.y);
    } else {
      this.aiState = 'patrol';
      const angle = tick / 150 + this.orbitSide;
      this._steer(room, room.world.width / 2 + Math.cos(angle) * 900,
        room.world.height / 2 + Math.sin(angle) * 900);
    }
  }

  _steer(room, x, y) {
    for (const obstacle of room.obstacles.values()) {
      const distance = Math.hypot(this.x - obstacle.x, this.y - obstacle.y);
      if (distance < obstacle.radius + this.radius + 100) {
        const angle = Math.atan2(this.y - obstacle.y, this.x - obstacle.x) + this.orbitSide * 0.7;
        x = obstacle.x + Math.cos(angle) * (obstacle.radius + 160);
        y = obstacle.y + Math.sin(angle) * (obstacle.radius + 160);
        break;
      }
    }
    this.setTarget(Math.max(80, Math.min(room.world.width - 80, x)),
      Math.max(80, Math.min(room.world.height - 80, y)));
  }

  chooseUpgrade(options) {
    const preference = this.hp < this.maxHp * 0.6
      ? ['nano_armor', 'heavy_swarm', 'quantum_magnet', 'plasma_thrusters']
      : ['heavy_swarm', 'quantum_magnet', 'plasma_thrusters', 'nano_armor'];
    const choice = preference.find(type => options.some(option => option.type === type));
    if (choice) this.applyUpgrade(choice);
  }
}

module.exports = { Bot };

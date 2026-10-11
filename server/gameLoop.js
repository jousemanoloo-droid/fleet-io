// ============================================================================
// FLEET.IO - Game Loop Autoritativo (Servidor)
// Bucle a 30 TPS que procesa movimientos, colisiones y sincroniza estado
// ============================================================================

const TICK_RATE = 30;
const TICK_INTERVAL = 1000 / TICK_RATE;
const { updateCombat, resolveObstacles } = require('./combat');
const Network = require('../client/js/network');
const RPG = require('./rpg');
const { WorldEvents } = require('./worldEvents');

class GameLoop {
  constructor(gameState, io) {
    this.state = gameState;
    // Migración compatible con fixtures antiguos; cada GameRoom usa Maps.
    for (const key of ['players', 'scraps', 'obstacles', 'projectiles']) {
      if (!(gameState[key] instanceof Map)) gameState[key] = new Map(Object.entries(gameState[key] || {}));
    }
    this.io = io;
    this.running = false;
    this.tickCount = 0;
    this._interval = null;
    this.keyframe = null;
    this._lastScrapSpawn = 0;
    gameState.swarm ||= new (require('./swarm').DroneSwarm)(gameState);
    gameState.events ||= new WorldEvents(gameState);
    gameState.competitive ||= new (require('./competitive').Competitive)(gameState);
    gameState.engagement ||= new (require('./engagement').Engagement)(gameState);
    gameState.hazards ||= new (require('./hazards').Hazards)(gameState);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._interval = setInterval(() => this._tick(), TICK_INTERVAL);
  }

  stop() {
    this.running = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _tick() {
    this.tickCount++;

    this.state.competitive.update();
    this.state.hazards.update();
    this._updatePlayers();
    this.state.impacts = [];
    this.state.swarm.update();
    updateCombat(this.state, this.tickCount);
    this._processDeaths();
    this._updateScrap();
    this._checkScrapCollection();
    this._maybeSpawnScrap();
    this.state.engagement.update();
    this._processDeaths();
    this.state.events.update();
    this._flushProgression();

    this._broadcastState(); // 30 snapshots/s, independiente del refresco del cliente.
  }

  _updatePlayers() {
    this._processDeaths();
    for (const p of this.state.players.values()) {
      this.state.engagement.attach(p);
      p.competitive = this.state.competitive;
      p.swarm = this.state.swarm;
      if (p.alive) {
        if (p.isBot) p.think(this.state, this.tickCount);
        p.update();
        resolveObstacles(p, this.state.obstacles);
        this.state.hazards.traverse(p);
        this.state.hazards.combo(p);
      }
    }
  }

  _processDeaths() {
    const now = Date.now();
    for (const p of this.state.players.values()) {
      if (p.hp > 0 && p.alive) continue;
      p.die();
      if (p._notifiedDeathId !== p.deathId) {
        p._notifiedDeathId = p.deathId;
        this.state.competitive.kill(this.state.players.get(p.killedBy?.id), p);
        this.state.hazards.kill(this.state.players.get(p.killedBy?.id));
        this.state.events.death(p, now);
        if (p.isBot) {
          p.respawnAt = now + 3000;
          // Drop acotado para no inflar la red ni duplicar material por cada tick.
          const count = Math.min(20, p.deathState.scrap, 250 - this.state.scraps.size);
          if (count === 0 && p.deathState.scrap > 0) {
            // Si el mapa está lleno, consolidar el drop en una pieza existente.
            const scrap = this.state.scraps.values().next().value;
            if (scrap) { scrap.x = p.x; scrap.y = p.y; scrap.value += p.deathState.scrap; }
          }
          for (let i = 0; i < count; i++) {
            const angle = i * 2.39996;
            const value = Math.floor(p.deathState.scrap / count) +
              (i < p.deathState.scrap % count ? 1 : 0);
            this.state.spawnScrap(p.x + Math.cos(angle) * (20 + i * 3),
              p.y + Math.sin(angle) * (20 + i * 3), value);
          }
        } else {
          this.io.to(p.id).emit('playerDied', { ...p.toNetwork(), roomId: this.state.roomId });
        }
      }
      if (p.isBot && now >= p.respawnAt) {
        p.respawn(false, this.state.players, this.state.world, this.state.obstacles);
        p.nextDecisionTick = this.tickCount;
        p.nextFireTick = this.tickCount;
      }
    }
  }

  _updateScrap() {
    for (const s of this.state.scraps.values()) s.update();
  }

  _flushProgression() {
    for (const player of this.state.players.values()) {
      if (player.alive && player.levelUpPending && !player.upgradeOptions?.length) {
        const options = generateRandomUpgrades(3, player.mutations);
        if (player.isBot) player.chooseUpgrade(options);
        else {
          player.upgradeOptions = options.map(option => option.type);
          this.io.to(player.id).emit('showLevelUpOptions', { roomId: this.state.roomId, level: player.level, options });
        }
      }
      for (const event of player.pendingLevelUps.splice(0)) {
        if (!player.isBot) this.io.to(player.id).emit('level_up', { ...event, roomId: this.state.roomId });
      }
      if (player.isBot && player.attributePoints > 0) {
        for (const key of ['damage', 'shield', 'speed', 'fireRate']) {
          const points = Math.min(player.attributePoints, RPG.LIMITS[key] - player.attributes[key]);
          if (points > 0) RPG.allocate(player, key, points);
        }
      }
    }
  }

  _checkScrapCollection() {
    for (const [pid, player] of this.state.players) {
      if (!player || !player.alive || player.hp <= 0) continue;

      // Si el jugador está eligiendo una mutación, no recoge chatarra
      if (player.levelUpPending) continue;

      const collectRadius = player.collectRadius;

      for (const [sid, scrap] of this.state.scraps) {

        const dx = scrap.x - player.x;
        const dy = scrap.y - player.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= collectRadius * collectRadius) {
          const gainedDrone = player.collectScrap(scrap);
          this.state.scraps.delete(sid);

          if (gainedDrone) {
            for (let i = 0; i < gainedDrone; i++) {
              const droneId = `drone_${this.state.uidCounter++}`;
              player.addDrone(droneId);
            }
          }

          if (!player.isBot) this.io.to(pid).emit('scrapCollected', {
            roomId: this.state.roomId,
            scrapId: sid,
            value: scrap.value,
            score: player.score,
            scrapTotal: player.scrapCollected,
            droneGained: gainedDrone,
            droneCount: player.drones.length,
            hp: Math.round(player.hp),
            maxHp: player.maxHp,
            level: player.level,
          });

          // Si la recogida provocó una subida de nivel, mostrar opciones de mutación
          if (player.levelUpPending) {
            const options = generateRandomUpgrades(3, player.mutations);
            if (player.isBot) player.chooseUpgrade(options);
            else {
              player.upgradeOptions = options.map(option => option.type);
              this.io.to(pid).emit('showLevelUpOptions', {
                roomId: this.state.roomId,
                level: player.level,
                options,
              });
            }
            // Solo se procesa una subida por tick para evitar spamm
            break;
          }
        }
      }
    }
  }

  _maybeSpawnScrap() {
    this._lastScrapSpawn++;
    if (this._lastScrapSpawn < 10) return;
    this._lastScrapSpawn = 0;

    const maxScraps = 250;
    const currentCount = this.state.scraps.size;
    if (currentCount >= maxScraps) return;

    const toSpawn = Math.min(8, maxScraps - currentCount);
    for (let i = 0; i < toSpawn; i++) {
      const value = Math.random() < 0.15 ? 3 : Math.random() < 0.4 ? 2 : 1;
      this.state.spawnScrap(undefined, undefined, value);
    }
  }

  _broadcastState() {
    const king = Array.from(this.state.players.values()).filter(p => p.alive).sort((a, b) => b.score - a.score)[0];
    const playersPayload = Array.from(this.state.players.values(), Network.packPlayer);
    const scrapsPayload = Array.from(this.state.scraps.values(), s =>
      [s.id, Math.round(s.x), Math.round(s.y), s.value, s.color, +s.spin.toFixed(2)]);

    const snapshot = {
      v: 2,
      t: this.tickCount,
      ts: Date.now(),
      roomId: this.state.roomId,
      p: playersPayload,
      s: scrapsPayload,
      b: Array.from(this.state.projectiles.values(), b =>
        [b.id, +b.x.toFixed(1), +b.y.toFixed(1), b.color, +Math.atan2(b.vy, b.vx).toFixed(4), b.motionRevision || 0]),
      o: Array.from(this.state.obstacles.values()),
      i: this.state.impacts || [],
      kingId: king?.id || null,
      king: king ? { id: king.id, x: king.x, y: king.y } : null,
      w: this.state.events.snapshot(),
      competitive: this.state.competitive.snapshot(),
      hazards: this.state.hazards.snapshot(),
      engagement: this.state.engagement.snapshot(),
    };

    if (!this.keyframe || this.tickCount - this.keyframe.t >= 30) {
      snapshot.keyframe = snapshot.t;
      // Freeze the baseline by copying mutable RPG arrays and world objects once/s.
      this.keyframe = JSON.parse(JSON.stringify(snapshot));
      this.io.to(this.state.roomId).emit('gameState', this.keyframe);
    } else {
      this.io.to(this.state.roomId).volatile.emit('gameState', Network.delta(this.keyframe, snapshot));
    }
  }
}

// ----------------------------------------------------------------------------
// Catálogo de mutaciones y generador aleatorio
// ----------------------------------------------------------------------------
const UPGRADE_CATALOG = [
  {
    type: 'plasma_thrusters',
    icon: '⚡',
    name: 'Propulsores de Plasma',
    desc: 'Velocidad máxima +20%',
    rarity: 'comun',
  },
  {
    type: 'quantum_magnet',
    icon: '🧲',
    name: 'Imán Cuántico',
    desc: 'Radio de absorción de chatarra +50%',
    rarity: 'comun',
  },
  {
    type: 'nano_armor',
    icon: '🛡️',
    name: 'Blindaje Nanotecnológico',
    desc: '+25 HP máximos y curación instantánea del 50%',
    rarity: 'raro',
  },
  {
    type: 'heavy_swarm',
    icon: '🛸',
    name: 'Enjambre Pesado',
    desc: 'Añade instantáneamente +2 drones escolta',
    rarity: 'raro',
  },
];

// Devuelve `count` opciones de mutación únicas (sin repetir tipo).
function generateRandomUpgrades(count, ownedMutations = []) {
  const pool = UPGRADE_CATALOG.filter((u) => !ownedMutations.includes(u.type));
  const available = pool.length >= count ? pool : UPGRADE_CATALOG.slice();
  const shuffled = available.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((u) => ({
    type: u.type,
    icon: u.icon,
    name: u.name,
    desc: u.desc,
    rarity: u.rarity,
  }));
}

module.exports = { GameLoop, TICK_RATE, TICK_INTERVAL, generateRandomUpgrades, UPGRADE_CATALOG };

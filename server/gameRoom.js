'use strict';
const { Player, Scrap, WORLD } = require('./entities');
const { Bot } = require('./bot');
const { GameLoop } = require('./gameLoop');

class GameRoom {
  constructor({ roomId, type, code = null, io, maxPlayers, botCount = 7 }) {
    this.roomId = roomId;
    this.type = type;
    this.code = code;
    this.maxPlayers = maxPlayers;
    this.world = { ...WORLD };
    this.players = new Map();
    this.scraps = new Map();
    this.obstacles = new Map();
    this.projectiles = new Map();
    this.uidCounter = 0;
    this.Scrap = Scrap;
    this.io = io;
    this.emptySince = Date.now();
    this.destroyed = false;
    this.loop = new GameLoop(this, io);
    for (let i = 0; i < 12; i++) {
      const id = `rock_${i}`;
      this.obstacles.set(id, { id, x: 300 + Math.random() * 3400,
        y: 300 + Math.random() * 3400, radius: 28 + Math.random() * 30 });
    }
    for (let i = 0; i < 150; i++) this.spawnScrap();
    if (type === 'singleplayer') {
      const names = ['Nexus', 'Vortex', 'Nyx', 'Atlas', 'Echo', 'Ion', 'Nova', 'Zenith', 'Flux', 'Orion'];
      for (let i = 0; i < Math.max(5, Math.min(10, botCount)); i++) {
        const bot = new Bot(`bot_${roomId}_${i}`, names[i], i);
        this.placePlayer(bot);
        this.players.set(bot.id, bot);
      }
    }
  }

  get humanCount() {
    let count = 0;
    for (const player of this.players.values()) if (!player.isBot) count++;
    return count;
  }

  get botCount() { return this.players.size - this.humanCount; }
  get full() { return this.humanCount >= this.maxPlayers; }

  spawnScrap(x, y, value = 1) {
    const id = `scrap_${this.uidCounter++}`;
    // Evitar material inaccesible dentro de asteroides.
    for (let attempt = 0; attempt < 20; attempt++) {
      const sx = x ?? Math.random() * this.world.width;
      const sy = y ?? Math.random() * this.world.height;
      if ([...this.obstacles.values()].some(o => Math.hypot(sx - o.x, sy - o.y) < o.radius + 10)) {
        x = y = undefined;
        continue;
      }
      const scrap = new Scrap(id, Math.max(8, Math.min(this.world.width - 8, sx)),
        Math.max(8, Math.min(this.world.height - 8, sy)), value);
      this.scraps.set(id, scrap);
      return scrap;
    }
    return null;
  }

  placePlayer(player) {
    // Reutilizar la búsqueda de spawn seguro sin conservar economía.
    player.die();
    player.respawn(false, this.players, this.world, this.obstacles);
    player.deathId = 0;
  }

  addHuman(id, name) {
    if (this.destroyed || this.full) throw new Error('La sala está llena.');
    const player = new Player(id, name);
    this.placePlayer(player);
    this.players.set(id, player);
    this.emptySince = null;
    this.loop.start();
    this.broadcastInfo();
    return player;
  }

  removeHuman(id) {
    this.players.delete(id);
    for (const [key, shot] of this.projectiles) if (shot.ownerId === id) this.projectiles.delete(key);
    if (this.humanCount === 0) {
      this.emptySince = Date.now();
      this.loop.stop(); // No gastar ticks en salas sin observadores.
    }
    this.io.to(this.roomId).emit('playerLeft', { id, roomId: this.roomId });
    this.broadcastInfo();
  }

  info() {
    return { roomId: this.roomId, type: this.type, code: this.code,
      humans: this.humanCount, bots: this.botCount, capacity: this.maxPlayers };
  }
  broadcastInfo() { this.io.to(this.roomId).emit('roomInfo', this.info()); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.players.clear(); this.scraps.clear();
    this.obstacles.clear(); this.projectiles.clear();
  }
}

module.exports = { GameRoom };

'use strict';
const { randomUUID, randomInt } = require('node:crypto');
const { GameRoom } = require('./gameRoom');
const {Clans}=require('./clans');
const {Leaderboard}=require('./leaderboard');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomManager {
  constructor(io, { maxRooms = 100, publicCapacity = 30, privateCapacity = 8 } = {}) {
    this.io = io;
    this.rooms = new Map();
    this.codes = new Map();
    this.memberships = new Map();
    this.maxRooms = maxRooms;
    this.publicCapacity = publicCapacity;
    this.privateCapacity = privateCapacity;
    this.clans=new Clans();this.leaderboard=new Leaderboard(io,this,this.clans);
    this.cleanupTimer = setInterval(() => this.sweep(), 5000);
    this.cleanupTimer.unref();
  }

  create(type) {
    if (!['public', 'private', 'singleplayer'].includes(type)) throw new Error('Modo inválido.');
    if (this.rooms.size >= this.maxRooms) throw new Error('Servidor lleno. Reintenta más tarde.');
    let code = null;
    if (type === 'private') {
      do {
        code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      } while (this.codes.has(code));
    }
    const room = new GameRoom({ roomId: randomUUID(), type, code, io: this.io,
      maxPlayers: type === 'public' ? this.publicCapacity : type === 'private' ? this.privateCapacity : 1 });
    this.rooms.set(room.roomId, room);
    if (code) this.codes.set(code, room.roomId);
    return room;
  }

  findRoom(code, playerId) {
    if (typeof code !== 'string') throw new Error('Código de sala inválido.');
    const normalized = code.trim().toUpperCase().replace(/^FLEET-/,'');
    if (!normalized || normalized === 'PUBLIC') {
      let best = null;
      for (const room of this.rooms.values()) {
        if (room.type !== 'public' || room.full) continue;
        if (!best || room.humanCount < best.humanCount) best = room;
      }
      return best || this.create('public');
    }
    if (!/^[A-Z2-9]{6}$/.test(normalized)) throw new Error('El código debe tener 6 caracteres alfanuméricos.');
    const room = this.rooms.get(this.codes.get(normalized));
    if (!room) throw new Error('La sala no existe o ha caducado.');
    if (room.full && !room.players.has(playerId)) throw new Error('La sala está llena.');
    return room;
  }

  current(playerId) { return this.rooms.get(this.memberships.get(playerId)); }

  transfer(socket, room, name) {
    const old = this.current(socket.id);
    if (old === room) return room.players.get(socket.id);
    // Validar y reservar capacidad ANTES de retirar al jugador de su sala anterior.
    if (room.destroyed || room.full) throw new Error('La sala está llena.');
    const player = room.addHuman(socket.id, name);
    player.clanTag=this.clans.tag(socket.id);
    if (old) {
      this.leaderboard.observe(old.players.get(socket.id));
      socket.leave(old.roomId);
      old.removeHuman(socket.id);
      if (old.type === 'singleplayer') this.delete(old.roomId);
    }
    socket.join(room.roomId); // Adaptador Socket.IO local, síncrono, un único proceso.
    this.memberships.set(socket.id, room.roomId);
    room.broadcastInfo();
    return player;
  }

  leave(socket) {
    const room = this.current(socket.id);
    this.memberships.delete(socket.id);
    if (!room) return;
    this.leaderboard.observe(room.players.get(socket.id));
    socket.leave(room.roomId);
    room.removeHuman(socket.id);
    if (room.type === 'singleplayer') this.delete(room.roomId);
  }

  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.humanCount === 0 && room.emptySince !== null && now - room.emptySince >= 60000) {
        this.delete(room.roomId);
      }
    }
  }

  delete(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    if (room.code) this.codes.delete(room.code);
    for (const [playerId, roomId] of this.memberships) if (roomId === id) this.memberships.delete(playerId);
    room.destroy();
    this.rooms.delete(id);
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    this.leaderboard.destroy();this.clans.destroy();
    for (const id of this.rooms.keys()) this.delete(id);
  }
}

module.exports = { RoomManager };

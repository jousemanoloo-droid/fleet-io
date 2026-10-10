// ============================================================================
// FLEET.IO - Server Principal
// Node.js + Express + Socket.io
// ============================================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');

const { RoomManager } = require('./roomManager');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || '')
  .split(',').map(origin => origin.trim()).filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ----------------------------------------------------------------------------
// Configuración de Express + HTTP + Socket.io
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
// La URL del backend puede cambiar sin servir una configuración antigua en caché.
app.get('/config.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(CLIENT_DIR, 'config.js'));
});
app.use(express.static(CLIENT_DIR));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGINS.length ? CLIENT_ORIGINS : !IS_PRODUCTION,
    methods: ['GET', 'POST'],
  },
  // CORS cubre polling; verificar también el origen del handshake WebSocket.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch { /* sin Origin */ }
    callback(null, !origin || sameOrigin || CLIENT_ORIGINS.includes(origin) ||
      (!IS_PRODUCTION && CLIENT_ORIGINS.length === 0));
  },
  pingInterval: 15000,
  pingTimeout: 30000,
});

// ----------------------------------------------------------------------------
// Estado Global Autoritativo del Juego
// ----------------------------------------------------------------------------
const roomManager = new RoomManager(io);

// Cada evento resuelve la membresía actual: nunca hay referencias a una sala
// anterior después de un cambio de modo. Los clientes no deciden economía/HP.
io.on('connection', (socket) => {
  let lastRoomRequest = -Infinity;
  const current = () => {
    const room = roomManager.current(socket.id);
    return { room, player: room?.players.get(socket.id) };
  };
  const enter = (mode, data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const now = Date.now();
    if (now - lastRoomRequest < 1000) {
      reply({ ok: false, error: 'Espera un segundo antes de cambiar de sala.' });
      return;
    }
    lastRoomRequest = now;
    let created = null;
    try {
      if (data?.roomCode !== undefined && typeof data.roomCode !== 'string') {
        throw new Error('Código de sala inválido.');
      }
      const name = sanitizeName(data?.name) || current().player?.name || 'Piloto';
      const room = mode === 'private' || mode === 'singleplayer'
        ? (created = roomManager.create(mode))
        : roomManager.findRoom(data?.roomCode || '', socket.id);
      const player = roomManager.transfer(socket, room, name);
      socket.emit('welcome', {
        yourId: player.id, room: room.info(), world: room.world, tick: room.loop.tickCount,
      });
      socket.emit('respawned', { ...player.toNetwork(), roomId: room.roomId });
      room.broadcastInfo();
      reply({ ok: true, room: room.info(), roomCode: room.code });
    } catch (error) {
      if (created && created.humanCount === 0) roomManager.delete(created.roomId);
      reply({ ok: false, error: error.message });
    }
  };
  socket.on('join', (data, ack) => enter('public', data, ack)); // Cliente antiguo.
  socket.on('joinRoom', (data, ack) => enter('public', data, ack));
  socket.on('createPrivateRoom', (data, ack) => enter('private', data, ack));
  socket.on('startSinglePlayer', (data, ack) => enter('singleplayer', data, ack));
  socket.on('leaveRoom', (_data, ack) => {
    roomManager.leave(socket);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('playerMove', data => {
    const { player } = current();
    if (!player || !player.alive || player.hp <= 0 || !data) return;
    const tx = Number(data.tx), ty = Number(data.ty);
    if (Number.isFinite(tx) && Number.isFinite(ty)) player.setTarget(tx, ty);
  });

  socket.on('selectUpgrade', data => {
    const { room, player } = current();
    if (!player || !player.alive || player.hp <= 0 || !player.levelUpPending || !data) return;
    const type = String(data.type || '');
    if (!player.upgradeOptions?.includes(type)) return;
    player.applyUpgrade(type);
    player.upgradeOptions = [];
    socket.emit('upgradeApplied', { ...player.toNetwork(), type, name: 'Mutación aplicada',
      droneCount: player.drones.length, roomId: room.roomId });
  });

  // Demo: reemplazar por validación de recompensa del proveedor antes de producción.
  const handleRespawn = (rewarded, data, ack) => {
    const { room, player } = current();
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!player || !player.deathState || player.alive || data?.deathId !== player.deathId ||
        (data?.roomId && data.roomId !== room.roomId)) {
      reply({ ok: false, error: 'La resurrección ya no está disponible.' });
      return;
    }
    player.respawn(rewarded, room.players, room.world, room.obstacles);
    socket.emit('respawned', { ...player.toNetwork(), roomId: room.roomId });
    reply({ ok: true });
  };
  socket.on('requestRewardedRespawn', (data, ack) => handleRespawn(true, data, ack));
  socket.on('requestRespawn', (data, ack) => handleRespawn(false, data, ack));
  socket.on('disconnect', () => roomManager.leave(socket));
});

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : null;
}

// ----------------------------------------------------------------------------
// Arranque del Servidor
// ----------------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  const env = process.env.NODE_ENV || 'development';
  console.log('');
  console.log('+-------------------------------------------------+');
  console.log('|          FLEET.IO  -  Servidor Listo            |');
  console.log('+-------------------------------------------------+');
  console.log('|  Entorno : ' + env.padEnd(33) + '|');
  console.log('|  Puerto  : ' + String(PORT).padEnd(33) + '|');
  console.log('|  URL     : http://localhost:' + String(PORT).padEnd(20) + '|');
  console.log('+-------------------------------------------------+');
  console.log('');
});

// Docker y las plataformas cloud usan SIGTERM al reemplazar una instancia.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[FLEET.IO] Deteniendo servidor...');
  roomManager.destroy();
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  io.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

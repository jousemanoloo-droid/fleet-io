// ============================================================================
// FLEET.IO - Server Principal
// Node.js + Express + Socket.io
// ============================================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');

const { RoomManager } = require('./roomManager');
const RPG = require('./rpg');
const Classes = require('./shipClasses');
const { portalOrigin } = require('./origins');
const {register} = require('./socketSafety');
const {Accounts} = require('./accounts');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// The published Firebase client must be able to reach the separate Render backend.
// Keep an exact allowlist; CLIENT_ORIGINS can add other hosted frontends.
const CLIENT_ORIGINS = [...new Set([
  ...(IS_PRODUCTION ? [
    'https://fleet-io-d45d5.web.app',
    'https://fleet-io-d45d5.firebaseapp.com',
  ] : []),
  ...(process.env.CLIENT_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean),
])];

// ----------------------------------------------------------------------------
// Configuración de Express + HTTP + Socket.io
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/version',(_req,res)=>res.set('Cache-Control','no-store').json({build:'polish-20261012'}));
// La URL del backend puede cambiar sin servir una configuración antigua en caché.
app.get('/config.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(CLIENT_DIR, 'config.js'));
});
app.use(express.static(CLIENT_DIR));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // Gameplay messages contain a few primitives, never asset-sized uploads.
  maxHttpBufferSize: 16384,
  cors: {
    origin: (origin, callback) => callback(null, !origin || CLIENT_ORIGINS.includes(origin) || portalOrigin(origin) ||
      (!IS_PRODUCTION && CLIENT_ORIGINS.length === 0)),
    methods: ['GET', 'POST'],
  },
  // CORS cubre polling; verificar también el origen del handshake WebSocket.
  allowRequest: (req, callback) => {
    if(io.engine.clientsCount>=4000){callback(null,false);return;}
    const origin = req.headers.origin;
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch { /* sin Origin */ }
    callback(null, !origin || sameOrigin || CLIENT_ORIGINS.includes(origin) || portalOrigin(origin) ||
      (!IS_PRODUCTION && CLIENT_ORIGINS.length === 0));
  },
  pingInterval: 15000,
  pingTimeout: 30000,
});

// ----------------------------------------------------------------------------
// Estado Global Autoritativo del Juego
// ----------------------------------------------------------------------------
const roomManager = new RoomManager(io);
const accounts = new Accounts();

// Cada evento resuelve la membresía actual: nunca hay referencias a una sala
// anterior después de un cambio de modo. Los clientes no deciden economía/HP.
io.on('connection', (socket) => {
  const on = register(socket);
  socket.emit('leaderboards',roomManager.leaderboard.snapshot());
  socket.emit('clanState',{tag:roomManager.clans.tag(socket.id)});
  on('accountOpen', (data, ack) => {
    // Nunca aceptar inventario o stash aportados por un navegador, válidos o no.
    if(data && (Object.hasOwn(data,'secureStash') || Object.hasOwn(data,'inRunInventory'))){
      if(typeof ack==='function')ack({ok:false,error:'extraction.invalid'});return;
    }
    if(typeof ack==='function')ack(accounts.open(socket,data?.token));
  });
  on('accountAction', (data, ack) => {
    const result=accounts.action(socket.id,data,{room:roomManager.current(socket.id),player:roomManager.current(socket.id)?.players.get(socket.id)});
    accounts.loadout(socket.id,roomManager.current(socket.id)?.players.get(socket.id));
    if(typeof ack==='function') ack(result);
  });
  let lastClanChange=-Infinity;
  const changeClan=(data,ack,leave=false)=>{
    const now=Date.now();
    if(now-lastClanChange<1000) {if(typeof ack==='function')ack({ok:false,error:'error.clanCooldown'});return;}
    lastClanChange=now;
    const result=leave?{ok:true,tag:null}:roomManager.clans.join(socket.id,data?.tag);
    if(leave)roomManager.clans.leave(socket.id);
    if(result.ok) {
      const p=roomManager.current(socket.id)?.players.get(socket.id);if(p)p.clanTag=result.tag;
      socket.emit('clanState',{tag:result.tag});
    }
    if(typeof ack==='function')ack(result);
  };
  on('joinClan',(data,ack)=>changeClan(data,ack));
  on('leaveClan',(data,ack)=>changeClan(data,ack,true));
  let lastRoomRequest = -Infinity;
  const current = () => {
    const room = roomManager.current(socket.id);
    return { room, player: room?.players.get(socket.id) };
  };
  on('craft:request',(data,ack)=>{
    const result=accounts.blackMarket.request(socket.id,data,current());
    if(typeof ack==='function')ack(result);
  });
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
      const name = sanitizeName(data?.name) || current().player?.name || 'Pilot';
      const room = mode === 'private' || mode === 'singleplayer'
        ? (created = roomManager.create(mode))
        : roomManager.findRoom(data?.roomCode || '', socket.id);
      accounts.open(socket,data?.accountToken || socket.handshake?.auth?.token);
      const previousPlayer=current().player;
      accounts.observe(socket.id,previousPlayer,true);
      const player = roomManager.transfer(socket, room, name);
      player.account={observe:force=>accounts.observe(socket.id,player,force)};
      accounts.loadout(socket.id,player);
      if(previousPlayer!==player){
        accounts.preparePlayer(socket.id,player);
        accounts.endLife(socket.id);accounts.beginLife(socket.id,player);
        room.extraction.attach(player,accounts.extractionBinding(socket.id));
        room.playerExtraction.attach(player,packet=>{
          try{
            accounts.observe(socket.id,player,true);accounts.endLife(socket.id);
            socket.emit('extraction:success',packet);
          }finally{roomManager.leave(socket);}
        });
      }
      socket.emit('welcome', {
        yourId: player.id, room: room.info(), world: room.world, tick: room.loop.tickCount,
      });
      socket.emit('respawned', { ...player.toNetwork(), roomId: room.roomId, coreTarget: room.events.coreTarget(player) });
      room.extraction.sync(player);
      room.extractionGates.sync(socket.id);
      room.broadcastInfo();
      reply({ ok: true, room: room.info(), roomCode: room.code });
    } catch (error) {
      if (created && created.humanCount === 0) roomManager.delete(created.roomId);
      reply({ ok: false, error: error.message });
    }
  };
  on('join', (data, ack) => enter('public', data, ack)); // Cliente antiguo.
  on('joinRoom', (data, ack) => enter('public', data, ack));
  on('createPrivateRoom', (data, ack) => enter('private', data, ack));
  on('startSinglePlayer', (data, ack) => enter('singleplayer', data, ack));
  on('leaveRoom', (_data, ack) => {
    accounts.observe(socket.id,current().player,true);
    accounts.endLife(socket.id);
    roomManager.leave(socket);
    if (typeof ack === 'function') ack({ ok: true });
  });

  on('playerMove', data => {
    const { player, room } = current();
    if (!player || !player.alive || player.hp <= 0 || !data) return;
    if (data.roomId !== room.roomId || data.deathId !== player.deathId) return;
    if (data.motionRevision !== player.motionRevision) return;
    const tx = Number(data.tx), ty = Number(data.ty);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    if (Number.isSafeInteger(data.seq) && data.seq > 0) {
      const last = player.inputQueue.at(-1)?.seq || player.inputSeq;
      if (data.seq <= last) return;
      player.inputQueue.push({ tx, ty, seq: data.seq });
      if (player.inputQueue.length > 6) player.inputQueue.shift();
    } else player.setTarget(tx, ty); // Compatibilidad con clientes anteriores.
  });

  on('selectUpgrade', data => {
    const { room, player } = current();
    if (!player || !player.alive || player.hp <= 0 || !player.levelUpPending || !data) return;
    if (data.roomId !== room.roomId || data.deathId !== player.deathId || typeof data.type !== 'string') return;
    const type = data.type;
    if (!player.upgradeOptions?.includes(type)) return;
    player.applyUpgrade(type);
    player.upgradeOptions = [];
    socket.emit('upgradeApplied', { ...player.toNetwork(), type, name: 'Mutación aplicada',
      droneCount: player.drones.length, roomId: room.roomId });
  });

  const reply = (ack, result) => { if (typeof ack === 'function') ack(result); };
  // Lectura exclusivamente: no hay RPC para depositar, recoger o importar stash.
  on('inventory:request',(data,ack)=>{
    const {room,player}=current();
    reply(ack,room && player && data?.roomId===room.roomId && data?.deathId===player.deathId?
      {ok:true,...room.extraction.packet(player)}:{ok:false});
  });
  on('getServerTime', (_data, ack) => reply(ack,{ok:true,utc:Date.now()}));
  const valid = data => {
    const state = current();
    return state.player?.alive && data?.roomId === state.room.roomId &&
      data?.deathId === state.player.deathId ? state : null;
  };
  let lastSnapshotRequest = 0;
  on('requestSnapshot', data => {
    const state = current(), now = Date.now();
    if (!state.room || data?.roomId !== state.room.roomId || now - lastSnapshotRequest < 500) return;
    lastSnapshotRequest = now;
    state.room.loop.requestSnapshot(socket.id);
  });
  on('TRIGGER_DRONE_SWARM', (data, ack) => {
    const state = valid(data);
    const ok = !!state && state.room.swarm.trigger(state.player);
    reply(ack, { ok, cooldown: state?.player.swarmUntil ? Math.max(0, state.player.swarmUntil - Date.now()) : 0 });
  });
  on('allocateAttribute', (data, ack) => {
    const state = valid(data);
    if (!state || !RPG.allocate(state.player, data?.attribute, data?.points ?? 1)) {
      reply(ack, { ok: false, error: 'Puntos o atributo inválidos.' }); return;
    }
    reply(ack, { ok: true, player: state.player.toNetwork() });
  });
  on('chooseShipClass', (data, ack) => {
    const state = valid(data);
    // Require a complete current-life identity, even when other legacy events
    // permit omitted identity fields. No client-supplied level or stats trusted.
    const ok = !!state && data?.roomId === state.room.roomId && data?.deathId === state.player.deathId &&
      Classes.choose(state.player, data?.classId, data?.milestone);
    reply(ack, ok ? {ok:true, player:state.player.toNetwork()} : {ok:false, error:'error.classChoice'});
  });
  on('useAbility', (data, ack) => {
    const state = valid(data);
    if (!state || !RPG.activate(state.player, data?.type, state.room)) {
      reply(ack, { ok: false, error: 'Habilidad en recarga o no disponible.' }); return;
    }
    const effect = {roomId:state.room.roomId,id:state.player.id,type:data.type,x:state.player.x,y:state.player.y};
    if (state.room.emitSpatial) state.room.emitSpatial('ability_used',effect);
    else state.room.io.to(state.room.roomId).emit('ability_used',effect);
    reply(ack, { ok: true, player: state.player.toNetwork() });
  });
  on('setCosmetics', data => {
    const state = valid(data);
    if (!state) return;
    // Ignore client inventory/title lists. Only the server wallet owns loadouts.
    accounts.loadout(socket.id,state.player);
  });
  on('ackCoinReward', data => {
    const { room, player } = current();
    if (!player || data?.roomId !== room.roomId || typeof data?.id !== 'string') return;
    const index = player.coinRewards.findIndex(reward => reward.id === data.id);
    if (index < 0) return;
    accounts.observe(socket.id,player,true);
    player.coinRewards.splice(index, 1);
    if (player.coinRewardReserve > 0) {
      const coins = player.coinRewardReserve; player.coinRewardReserve = 0;
      room.events.award(player, coins, 'world-events');
    }
  });
  on('claimDailyBoost', (_data, ack) => {
    const state = current();
    if (!accounts.sessions.get(socket.id)?.record.state.pendingBoost || !state.player?.alive || state.player.dailyBoostUsed) { reply(ack, { ok: false }); return; }
    accounts.sessions.get(socket.id).record.state.pendingBoost=false;
    state.player.dailyBoostUsed = true; state.player.dailyBoostUntil = Date.now() + 15000;
    reply(ack, { ok: true });
  });

  const revengeRespawn = (data, ack) => {
    const { room, player } = current();
    if (!room || data?.roomId !== room.roomId || data?.deathId !== player?.deathId ||
        !player || player.alive) { reply(ack,{ok:false,error:'error.respawn'}); return; }
    accounts.observe(socket.id,player,true);
    if (!accounts.consumeRevive(socket.id,room.roomId,player.deathId) || !room.engagement.revive(player)) {
      reply(ack, { ok: false, error: 'error.respawn' }); return;
    }
    accounts.beginLife(socket.id,player);
    accounts.preparePlayer(socket.id,player);
    socket.emit('respawned', { ...player.toNetwork(), roomId: room.roomId,
      revengeTarget: player.revengeTarget, coreTarget: room.events.coreTarget(player) });
    reply(ack, { ok: true });
  };
  on('request_revenge_respawn', revengeRespawn);
  on('requestRevengeRespawn', revengeRespawn); // Legacy event alias.

  // El SDK confirma la finalización en el cliente; deathId y la economía retenida
  // siguen siendo autoritativos y cada muerte solo admite una resurrección.
  const handleRespawn = (rewarded, data, ack) => {
    const { room, player } = current();
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!player || !player.deathState || player.alive || data?.deathId !== player.deathId ||
        data?.roomId !== room.roomId) {
      reply({ ok: false, error: 'La resurrección ya no está disponible.' });
      return;
    }
    if(rewarded && !accounts.consumeRevive(socket.id,room.roomId,player.deathId)){reply({ok:false,error:'error.respawn'});return;}
    accounts.observe(socket.id,player,true);
    player.respawn(rewarded, room.players, room.world, room.obstacles);
    accounts.preparePlayer(socket.id,player);
    accounts.beginLife(socket.id,player);
    socket.emit('respawned', { ...player.toNetwork(), roomId: room.roomId, coreTarget: room.events.coreTarget(player) });
    reply({ ok: true });
  };
  on('requestRewardedRespawn', (data, ack) => handleRespawn(true, data, ack));
  on('requestRespawn', (data, ack) => handleRespawn(false, data, ack));
  on('disconnect', () => { accounts.observe(socket.id,current().player,true);roomManager.leave(socket);roomManager.clans.leave(socket.id);accounts.close(socket.id); });
});

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.normalize('NFKC').replace(/[^\p{L}\p{N} ._-]/gu,'').trim().slice(0, 16);
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
  accounts.destroy();
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  io.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============================================================================
// FLEET.IO - Cliente Phaser 3
// Renderizado, input, interpolación de red y HUD
// ============================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Configuración global
  // ------------------------------------------------------------------
  const SERVER_TICK = 30;
  const SERVER_INTERVAL = 1000 / SERVER_TICK;
  const MOVE_THROTTLE_MS = 33;
  const INTERP_BUFFER_MS = 100;
  const THRUST_INTERVAL_MS = 40;

  // Minimapa
  const MINIMAP_SIZE = 200;
  const MINIMAP_FPS = 15;
  const MINIMAP_INTERVAL = 1000 / MINIMAP_FPS;

  // Estado del cliente
  const C = {
    socket: null,
    connected: false,
    joined: false,
    dead: false,
    deathId: null,
    respawnBusy: false,
    myId: null,
    room: null,
    menuOpen: false,
    mutationsOpen: false,
    world: { width: 4000, height: 4000 },
    tick: 0,
    lastServerTime: 0,
    playerStates: new Map(),
    renderState: new Map(),
    scraps: new Map(),
    leaderboard: [],
    leaderboardCache: new Map(),
    ping: 0,
    lastMoveSentAt: 0,
    targetWorld: { x: 2000, y: 2000 },
    _renderTick: 0,
    _joinedAt: 0,
    _score: 0,
    _scrap: 0,
    _drones: 0,
    _hp: 100,
    _maxHp: 100,
    _level: 1,
    _mutations: [],
    _playerCount: 0,
    _minimap: {
      canvas: null,
      ctx: null,
      lastRender: 0,
      size: MINIMAP_SIZE,
      padding: 12,
    },
  };

  // ------------------------------------------------------------------
  // Fase: Boot (carga mínima)
  // ------------------------------------------------------------------
  class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }
    create() {
      this.scene.start('GameScene');
    }
  }

  // ------------------------------------------------------------------
  // Fase: Juego
  // ------------------------------------------------------------------
  class GameScene extends Phaser.Scene {
    constructor() {
      super('GameScene');
      this._stars = [];
      this._playerSprites = new Map();
      this._droneSprites = new Map();
      this._droneContainers = new Map();
      this._scrapSprites = new Map();
      this._scrapTexts = new Map();
      this._nameTexts = new Map();
      this._cursors = null;
      this._pointer = null;
      this._cameraTarget = null;
      this._projectileStates = new Map();
      this._obstacles = [];
      this._bg = null;
      this._minimapLast = 0;
    }

    create() {
      this._pointer = this.input.activePointer;
      const camera = this.cameras.main;
      camera.setPosition(0, 0);
      camera.setOrigin(0.5, 0.5);
      camera.setBounds(0, 0, C.world.width, C.world.height);
      camera.setBackgroundColor('#03040c');
      this.input.on('pointermove', this._onPointerMove, this);
      this.events.once('shutdown', () => {
        this.input.off('pointermove', this._onPointerMove, this);
        camera.stopFollow();
        this._cameraTarget = null;
      });

      this._buildStars();
      this._buildWorldBounds();
      this._initMinimap();
      this._initJuice();
      this._setupAdHooks();

      C.socket = this._setupSocket();

      setupUI();
      this._setupDeathUI();
    }

    _setupAdHooks() {
      let previousMute = false, pausedByAd = false;
      window.AdManager?.setGameHooks({
        onAdStarted: () => {
          previousMute = this.sound?.mute || false;
          if (this.sound) this.sound.mute = true;
          pausedByAd = this.scene.isActive();
          if (pausedByAd) this.scene.pause();
        },
        onAdEnded: () => {
          if (this.sound) this.sound.mute = previousMute;
          if (pausedByAd) this.scene.resume();
          pausedByAd = false;
          syncGameplayTracking();
        },
      });
      this.events.once('shutdown', () => {
        window.AdManager?.setGameHooks({});
        window.AdManager?.gameplayStop();
      });
    }

    _setupDeathUI() {
      document.getElementById('rewarded-respawn-btn').onclick = () => {
        if (!C.dead || C.respawnBusy || !C.connected) return;
        const deathId = C.deathId;
        const playerId = C.myId;
        const roomId = C.room?.roomId;
        this._setRespawnBusy(true, 'Reproduciendo anuncio…');
        window.AdManager.showRewardedAd(() => {
          // Ignorar resultados de un anuncio perteneciente a otra sesión/muerte.
          if (C.dead && C.deathId === deathId && C.myId === playerId && C.room?.roomId === roomId) {
            this._requestRespawn(true, deathId);
          }
        }, () => {
          if (C.dead && C.deathId === deathId && C.myId === playerId && C.room?.roomId === roomId) {
            this._setRespawnBusy(false, 'Anuncio cancelado o no disponible. Puedes reintentar o reiniciar.');
          }
        });
      };
      document.getElementById('restart-btn').onclick = () => {
        if (!C.dead || C.respawnBusy || !C.connected) return;
        this._requestRespawn(false, C.deathId);
      };
    }

    _setRespawnBusy(busy, message = '') {
      C.respawnBusy = busy;
      for (const id of ['rewarded-respawn-btn', 'restart-btn']) {
        document.getElementById(id).disabled = busy || !C.connected;
      }
      document.getElementById('death-status').textContent = message;
    }

    _showDeath(me) {
      window.AdManager?.gameplayStop?.();
      if (C.dead && C.deathId === me.deathId) return;
      C.dead = true;
      C.deathId = me.deathId;
      C.mutationsOpen = false;
      document.getElementById('mutate-overlay').classList.add('hidden');
      const saved = me.deathState || { score: me.score, scrap: me.scrap, drones: me.drones.length };
      document.getElementById('death-summary').textContent =
        `Puntuación: ${saved.score} · Chatarra: ${saved.scrap} · Escoltas: ${saved.drones}`;
      document.getElementById('death-overlay').classList.remove('hidden');
      this._setRespawnBusy(false, window.AdManager?.mode === 'simulation' ? 'Anuncios en modo demostración.' : '');
      document.getElementById('rewarded-respawn-btn').focus();
    }

    _requestRespawn(rewarded, deathId) {
      if (!C.connected) {
        this._setRespawnBusy(false, 'Sin conexión al servidor.');
        return;
      }
      this._setRespawnBusy(true, 'Restaurando nave…');
      const playerId = C.myId;
      const roomId = C.room?.roomId;
      C.socket.timeout(8000).emit(
        rewarded ? 'requestRewardedRespawn' : 'requestRespawn', { deathId, roomId },
        (error, result) => {
          if (!C.dead || C.deathId !== deathId || C.myId !== playerId || C.room?.roomId !== roomId) return;
          if (error || !result?.ok) {
            this._setRespawnBusy(false, result?.error || 'No hubo respuesta. Puedes reintentar.');
          }
        }
      );
    }

    _syncLocalState(me) {
      C._score = me.score;
      C._scrap = me.scrap;
      C._drones = me.drones.length;
      C._hp = me.hp;
      C._maxHp = me.maxHp;
      C._level = me.level;
      C._mutations = me.mutations || [];
      updateHUD();
      if (me.hp <= 0) this._showDeath(me);
      else if (C.dead) {
        C.dead = false;
        C.deathId = null;
        this._setRespawnBusy(false);
        document.getElementById('death-overlay').classList.add('hidden');
        // Teletransportar la interpolación: evita atravesar el mapa al revivir.
        const state = { ...me, t: performance.now() };
        C._prevStates?.set(me.id, [state, state]);
        C.renderState.set(me.id, { x: me.x, y: me.y, drones: me.drones });
        C.targetWorld = { x: me.x, y: me.y };
        this.cameras.main.centerOn(me.x, me.y);
      }
      syncGameplayTracking();
    }

    _initJuice() {
      // Una textura procedural y dos pools compartidos para toda la flota.
      const key = 'fleet-plasma';
      if (!this.textures.exists(key)) {
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 0.12).fillCircle(8, 8, 8);
        g.fillStyle(0xffffff, 0.35).fillCircle(8, 8, 5);
        g.fillStyle(0xffffff, 1).fillCircle(8, 8, 2);
        g.generateTexture(key, 16, 16);
        g.destroy();
      }
      this._thrust = this.add.particles(0, 0, key, {
        emitting: false, lifespan: { min: 180, max: 320 },
        speed: { min: 35, max: 85 }, tint: [0x00d4ff, 0x88ffff, 0xffffff],
        scale: { start: 0.55, end: 0 }, alpha: { start: 0.8, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 128, maxAliveParticles: 128,
      });
      this._explosions = this.add.particles(0, 0, key, {
        emitting: false, lifespan: { min: 280, max: 650 },
        speed: { min: 45, max: 200 }, angle: { min: 0, max: 360 },
        tint: [0xffffff, 0xffdd66, 0xff8833, 0x00d4ff],
        scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 256, maxAliveParticles: 256,
      }).setDepth(10);
      this._lastThrustAt = -Infinity;
      this._hudPulses = new Map();
      this.events.once('shutdown', () => {
        for (const animation of this._hudPulses.values()) animation.cancel();
        this._hudPulses.clear();
      });
    }

    _effectVisible(x, y, padding = 80) {
      const view = this.cameras.main.worldView;
      return x >= view.x - padding && x <= view.right + padding &&
        y >= view.y - padding && y <= view.bottom + padding;
    }

    _explodeAt(x, y, isShip = false) {
      if (!this._effectVisible(x, y)) return;
      this._explosions.emitParticleAt(x, y, isShip ? 32 : 10);
      // No reiniciar una sacudida activa por cada dron de una misma explosión.
      const camera = this.cameras.main;
      if (!camera.shakeEffect.isRunning) {
        camera.shake(isShip ? 180 : 90, isShip ? 0.004 : 0.0015, false);
      }
    }

    _renderThrust(now) {
      if (!C.connected || now - this._lastThrustAt < THRUST_INTERVAL_MS) return;
      this._lastThrustAt = now;
      for (const [id, pos] of C.renderState) {
        const meta = C.playerStates.get(id);
        if (!meta || meta.hp <= 0 || Math.hypot(meta.vx, meta.vy) < 0.15 ||
            !this._effectVisible(pos.x, pos.y)) continue;
        const angle = Math.atan2(meta.vy, meta.vx);
        const rear = meta.radius + 4;
        const degrees = angle * 180 / Math.PI + 180;
        this._thrust.setEmitterAngle({ min: degrees - 18, max: degrees + 18 });
        this._thrust.emitParticleAt(
          pos.x - Math.cos(angle) * rear, pos.y - Math.sin(angle) * rear, 1
        );
      }
    }

    _pulseCollectionHUD() {
      for (const id of ['hud-score', 'hud-scrap']) {
        const element = document.getElementById(id);
        if (!element || !element.animate) continue;
        this._hudPulses.get(id)?.cancel();
        const animation = element.animate([
          { transform: 'scale(1)', textShadow: '0 0 0 transparent' },
          { transform: 'scale(1.2)', textShadow: '0 0 14px #88ffff', offset: 0.25 },
          { transform: 'scale(1)', textShadow: '0 0 0 transparent' },
        ], { duration: 280, easing: 'ease-out' });
        this._hudPulses.set(id, animation);
        animation.onfinish = () => {
          if (this._hudPulses.get(id) === animation) this._hudPulses.delete(id);
        };
      }
    }

    _buildStars() {
      const w = C.world.width;
      const h = C.world.height;

      this._layers = {
        starsFar: this.add.graphics(),
        starsMid: this.add.graphics(),
        starsNear: this.add.graphics(),
        scraps: this.add.graphics(),
        combat: this.add.graphics(),
        entities: this.add.container(0, 0),
        ui: this.add.container(0, 0),
      };
      // El paralaje lo aplica Phaser al scroll del mundo, sin mover el viewport.
      this._layers.starsFar.setScrollFactor(0.85);
      this._layers.starsMid.setScrollFactor(0.65);
      this._layers.starsNear.setScrollFactor(0.4);

      const starField = (g, count, size, color, alpha) => {
        g.fillStyle(color, alpha);
        for (let i = 0; i < count; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          g.fillCircle(x, y, size);
        }
      };

      starField(this._layers.starsFar, 600, 0.8, 0x3a4a80, 0.35);
      starField(this._layers.starsMid, 300, 1.4, 0x88aaff, 0.5);
      starField(this._layers.starsNear, 150, 2.2, 0xffffff, 0.7);
    }

    _buildWorldBounds() {
      const g = this.add.graphics();
      g.lineStyle(2, 0x00d4ff, 0.2);
      g.strokeRect(0, 0, C.world.width, C.world.height);

      const grid = this.add.graphics();
      grid.lineStyle(1, 0x1a2a4a, 0.15);
      const step = 400;
      for (let x = step; x < C.world.width; x += step) {
        grid.lineBetween(x, 0, x, C.world.height);
      }
      for (let y = step; y < C.world.height; y += step) {
        grid.lineBetween(0, y, C.world.width, y);
      }
    }

    _initMinimap() {
      const canvas = document.getElementById('minimap-canvas');
      if (!canvas) return;
      canvas.width = C._minimap.size;
      canvas.height = C._minimap.size;
      C._minimap.canvas = canvas;
      C._minimap.ctx = canvas.getContext('2d');
      C._minimap.lastRender = 0;
    }

    _setupSocket() {
      // Socket.IO negocia polling/WebSocket automáticamente; el origen compartido
      // funciona sin URL y el hosting estático puede definir un backend remoto.
      const backendUrl = window.FLEET_CONFIG?.backendUrl?.trim();
      const socket = backendUrl ? io(backendUrl) : io();
      const inRoom = data => !data.roomId || data.roomId === C.room?.roomId;

      socket.on('connect', () => {
        C.connected = true;
        setStatus('Conectado al servidor - listo para lanzar', '');
      });

      socket.on('disconnect', () => {
        window.AdManager?.gameplayStop?.();
        C.connected = false;
        C.joined = false;
        C.dead = false;
        C.myId = null;
        C.room = null;
        C.menuOpen = true;
        C._joinPending = false;
        for (const id of ['join-btn', 'create-room-btn', 'join-room-btn', 'singleplayer-btn']) {
          const button = document.getElementById(id);
          if (button) button.disabled = false;
        }
        updateRoomHUD(null);
        C.respawnBusy = false;
        C.playerStates.clear();
        C.renderState.clear();
        C._prevStates?.clear();
        for (const id of this._playerSprites.keys()) this._removePlayer(id);
        document.getElementById('death-overlay').classList.add('hidden');
        document.getElementById('mutate-overlay').classList.add('hidden');
        document.getElementById('overlay').classList.remove('hidden');
        document.getElementById('join-btn').disabled = false;
        setStatus('Desconectado. Reconectando...', 'error');
      });

      socket.on('connect_error', () => {
        setStatus('Error de conexión. Reintentando...', 'error');
      });

      socket.on('welcome', (data) => {
        window.AdManager?.gameplayStop?.();
        C.joined = false;
        // Cambio de sala = nueva línea temporal. No interpolar entidades de
        // mundos diferentes ni conservar las opciones de mutación anteriores.
        for (const id of this._playerSprites.keys()) this._removePlayer(id);
        C.playerStates.clear(); C.renderState.clear(); C.scraps.clear();
        C._prevStates?.clear();
        this._projectileStates.clear(); this._obstacles = [];
        this._thrust?.killAll(); this._explosions?.killAll();
        C.dead = false; C.deathId = null; C.respawnBusy = false;
        document.getElementById('death-overlay').classList.add('hidden');
        hideMutations();
        const leaderboard = document.getElementById('lb-rows');
        if (leaderboard) leaderboard.replaceChildren();
        C.room = data.room || null;
        updateRoomHUD(C.room);
        C.myId = data.yourId;
        C.world = data.world || C.world;
        C.tick = data.tick || 0;
        C._joinedAt = performance.now();
        C.joined = true;
        hideOverlay();
        setStatus('¡Nave lanzada. Buena suerte, piloto!', '');

        this.cameras.main.setBounds(0, 0, C.world.width, C.world.height);
        this.physics?.world?.setBounds?.(0, 0, C.world.width, C.world.height);
      });

      socket.on('playerJoined', (data) => {
        // inicializado con estado parcial; el siguiente gameState traerá la entidad completa
      });

      socket.on('playerLeft', (data) => {
        if (!inRoom(data)) return;
        const id = data.id;
        C.playerStates.delete(id);
        C.renderState.delete(id);
        C._prevStates?.delete(id);
        this._removePlayer(id);
      });

      socket.on('playerCount', (n) => {
        C._playerCount = n;
        document.getElementById('hud-players').textContent = String(n);
      });
      socket.on('roomInfo', info => {
        if (info.roomId !== C.room?.roomId) return;
        C.room = info;
        updateRoomHUD(info);
      });

      socket.on('scrapCollected', (data) => {
        if (!inRoom(data)) return;
        C._score = data.score || C._score;
        C._scrap = data.scrapTotal || C._scrap;
        C._drones = data.droneCount || C._drones;
        if (typeof data.hp === 'number') C._hp = data.hp;
        if (typeof data.maxHp === 'number') C._maxHp = data.maxHp;
        if (typeof data.level === 'number') C._level = data.level;
        updateHUD();
        this._pulseCollectionHUD();
        if (data.droneGained) {
          spawnFloatText(this, C.myId, '+1 DRÓN', 0xff00aa);
        }
      });

      // Servidor pide mostrar las 3 cartas de mutación
      socket.on('showLevelUpOptions', (data) => {
        if (!inRoom(data)) return;
        if (C.dead) return;
        C._level = data.level || C._level;
        updateHUD();
        showMutations(data.options || [], data.level || C._level);
      });

      // Servidor confirma la mutación aplicada
      socket.on('upgradeApplied', (data) => {
        if (!inRoom(data)) return;
        if (typeof data.hp === 'number') C._hp = data.hp;
        if (typeof data.maxHp === 'number') C._maxHp = data.maxHp;
        if (typeof data.level === 'number') C._level = data.level;
        if (typeof data.droneCount === 'number') C._drones = data.droneCount;
        if (Array.isArray(data.mutations)) C._mutations = data.mutations;
        updateHUD();
        hideMutations();
        spawnFloatText(this, C.myId, `${data.icon || '✦'} ${data.name || 'Mutación'}`, 0x00ff88);
      });

      socket.on('gameState', (snap) => {
        this._onSnapshot(snap);
      });

      socket.on('playerDied', (me) => {
        if (!inRoom(me)) return;
        if (me.id !== C.myId) return;
        const previous = C.playerStates.get(me.id);
        if (previous && previous.hp > 0) this._explodePlayer(me.id, previous);
        C.playerStates.set(me.id, me);
        this._syncLocalState(me);
      });
      socket.on('respawned', (me) => {
        if (!inRoom(me)) return;
        if (me.id !== C.myId) return;
        C.playerStates.set(me.id, me);
        this._syncLocalState(me);
      });

      socket.io.on('ping', () => { C._pingSentAt = performance.now(); });
      socket.io.on('pong', () => {
        if (C._pingSentAt) {
          C.ping = Math.round(performance.now() - C._pingSentAt);
          document.getElementById('hud-ping').textContent = String(C.ping);
        }
      });

      return socket;
    }

    _onSnapshot(snap) {
      if (snap.roomId && snap.roomId !== C.room?.roomId) return;
      const now = performance.now();
      C.lastServerTime = now;
      C.tick = snap.t;
      const players = snap.p || [];
      const scrapsSnap = snap.s || [];
      const respawnedPlayers = new Set();
      this._obstacles = snap.o || [];
      const shots = new Set();
      for (const shot of snap.b || []) {
        shots.add(shot.id);
        const previous = this._projectileStates.get(shot.id)?.[1];
        const current = { ...shot, t: now };
        this._projectileStates.set(shot.id, [previous || current, current]);
      }
      for (const id of this._projectileStates.keys()) if (!shots.has(id)) this._projectileStates.delete(id);

      // Los snapshots son completos. Comparar IDs evita confundir reordenaciones
      // de drones con bajas y usa su última posición interpolada para el estallido.
      const activePlayers = new Set(players.map(p => p.id));
      for (const [id, previous] of C.playerStates) {
        if (activePlayers.has(id)) continue;
        if (previous.hp > 0) this._explodePlayer(id, previous);
        C.playerStates.delete(id);
        C.renderState.delete(id);
        C._prevStates?.delete(id);
        this._removePlayer(id);
      }

      for (const p of players) {
        const previous = C.playerStates.get(p.id);
        if (previous && previous.hp <= 0 && p.hp > 0) respawnedPlayers.add(p.id);
        if (previous && previous.hp > 0) {
          if (typeof p.hp === 'number' && p.hp <= 0) {
            this._explodePlayer(p.id, previous);
          } else {
            const remaining = new Set((p.drones || []).map(d => d.id));
            const rendered = C.renderState.get(p.id);
            for (const drone of previous.drones) {
              if (!remaining.has(drone.id)) {
                const pos = rendered?.drones.find(d => d.id === drone.id) || drone;
                this._explodeAt(pos.x, pos.y);
              }
            }
          }
        }
        const state = {
          id: p.id,
          name: p.name || 'Piloto',
          isBot: !!p.isBot,
          color: p.color || 0x00d4ff,
          score: p.score || 0,
          scrap: p.scrap || 0,
          radius: p.radius || 18,
          x: p.x, y: p.y,
          vx: p.vx || 0,
          vy: p.vy || 0,
          drones: p.drones || [],
          hp: typeof p.hp === 'number' ? p.hp : 100,
          maxHp: typeof p.maxHp === 'number' ? p.maxHp : 100,
          level: typeof p.level === 'number' ? p.level : 1,
          levelUpPending: !!p.levelUpPending,
          invulnerable: !!p.invulnerable,
          deathId: p.deathId,
          deathState: p.deathState,
          mutations: p.mutations || [],
          receivedAt: now,
        };
        C.playerStates.set(p.id, state);
      }

      if (!C._prevStates) C._prevStates = new Map();
      for (const p of players) {
        const prevSnap = {
          x: p.x,
          y: p.y,
          vx: p.vx || 0,
          vy: p.vy || 0,
          drones: (p.drones || []).map(d => ({ id: d.id, x: d.x, y: d.y })),
          t: now,
        };
        if (C._prevStates.has(p.id) && !respawnedPlayers.has(p.id)) {
          const last = C._prevStates.get(p.id);
          C._prevStates.set(p.id, [last[1] || last, prevSnap]);
        } else {
          C._prevStates.set(p.id, [prevSnap, prevSnap]);
        }
      }

      const activeScraps = new Set();
      for (const s of scrapsSnap) {
        activeScraps.add(s.id);
        const existing = C.scraps.get(s.id);
        if (existing) {
          existing.x = s.x;
          existing.y = s.y;
          existing.v = s.v;
          existing.c = s.c;
          existing.s = s.s;
        } else {
          C.scraps.set(s.id, { x: s.x, y: s.y, v: s.v, c: s.c, s: s.s, _t: now });
        }
      }
      for (const [sid] of C.scraps) {
        if (!activeScraps.has(sid)) C.scraps.delete(sid);
      }

      this._updateLeaderboard(players);

      if (C.myId && C.playerStates.has(C.myId)) {
        const me = C.playerStates.get(C.myId);
        this._syncLocalState(me);
      }
    }

    _updateLeaderboard(players) {
      const sorted = [...players]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);
      C.leaderboard = sorted;

      const box = document.getElementById('lb-rows');
      if (!box) return;

      // 1. FLIP: capturar posiciones ANTES de actualizar el DOM
      const first = new Map();
      const rows = box.querySelectorAll('.lb-row');
      rows.forEach((row) => {
        first.set(row.dataset.id, { top: row.offsetTop, height: row.offsetHeight });
      });

      // 2. Construir nuevo DOM (solo actualizamos lo que cambia para preservar nodos)
      const newIds = new Set(sorted.map((p) => p.id));

      // Eliminar filas que ya no están (con animación de salida)
      rows.forEach((row) => {
        if (!newIds.has(row.dataset.id)) {
          row.classList.add('exit');
          setTimeout(() => row.remove(), 250);
        }
      });

      // Actualizar o crear filas
      const newOrder = [];
      sorted.forEach((p, i) => {
        const rank = i + 1;
        let row = box.querySelector(`.lb-row[data-id="${cssEscape(p.id)}"]`);
        const isNew = !row;
        if (!row) {
          row = document.createElement('div');
          row.className = 'lb-row';
          row.dataset.id = p.id;
          row.dataset.score = String(p.score || 0);
          row.innerHTML = buildLbRowInner(p, rank);
          box.appendChild(row);
        } else {
          const prevScore = Number(row.dataset.score) || 0;
          row.innerHTML = buildLbRowInner(p, rank);
          row.dataset.score = String(p.score || 0);
          if ((p.score || 0) > prevScore && prevScore > 0) {
            flashScoreDelta(row, p.score - prevScore);
          }
        }

        // Aplicar clases de posición
        row.classList.toggle('me', p.id === C.myId);
        row.classList.toggle('top-1', rank === 1);
        row.classList.toggle('top-2', rank === 2);
        row.classList.toggle('top-3', rank === 3);

        if (isNew) {
          row.classList.add('enter');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => row.classList.add('enter-active'));
          });
          setTimeout(() => row.classList.remove('enter', 'enter-active'), 320);
        }

        newOrder.push(row);
      });

      // Reordenar nodos en el DOM (sin recrearlos para que FLIP funcione)
      newOrder.forEach((row) => box.appendChild(row));

      // 3. FLIP: calcular delta y animar (last)
      newOrder.forEach((row) => {
        const prev = first.get(row.dataset.id);
        if (!prev) return;
        const firstTop = prev.top;
        const lastTop = row.offsetTop;
        const delta = firstTop - lastTop;
        if (delta !== 0) {
          row.animate(
            [
              { transform: `translateY(${delta}px)` },
              { transform: 'translateY(0)' },
            ],
            {
              duration: 320,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'none',
            }
          );
        }
      });
    }

    update(time, delta) {
      if (!C.joined) return;
      const now = performance.now();
      C._renderTick++;

      // Transformar el ratón con la cámara de la vista actualmente mostrada.
      this._handleInput(now);
      this._interpolateEntities(now);
      this._render();
      // Phaser actualiza el seguimiento al preparar la cámara para renderizar,
      // después de colocar el contenedor en la posición interpolada de este frame.
      this._followCamera();
      this._renderThrust(now);

      // Minimapa renderizado a 15 FPS para no penalizar el render principal
      if (now - C._minimap.lastRender >= MINIMAP_INTERVAL) {
        C._minimap.lastRender = now;
        this._drawMinimap();
      }
    }

    // ======================================================================
    // MINIMAPA GLOBAL EN TIEMPO REAL
    // Render a ~15 FPS en canvas DOM 2D independiente (no impacta Phaser)
    // ======================================================================
    _drawMinimap() {
      const ctx = C._minimap.ctx;
      if (!ctx) return;

      const W = C._minimap.size;
      const H = C._minimap.size;
      const WW = C.world.width;
      const WH = C.world.height;
      const scaleX = W / WW;
      const scaleY = H / WH;

      // 1. Limpiar (en lugar de clearRect usamos un degradado sutil de fondo)
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);

      // 2. Borde interior circular para enfatizar
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
      ctx.clip();

      // 3. Cúmulos de chatarra (downsample espacial: grid 20x20 buckets)
      // Para no dibujar 300+ círculos, discretizamos y pintamos un punto por cúmulo
      const GRID = 18;
      const buckets = new Uint8Array(GRID * GRID);
      const cellW = WW / GRID;
      const cellH = WH / GRID;
      for (const [, scrap] of C.scraps) {
        const gx = Math.min(GRID - 1, Math.floor(scrap.x / cellW));
        const gy = Math.min(GRID - 1, Math.floor(scrap.y / cellH));
        buckets[gy * GRID + gx]++;
      }
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const n = buckets[gy * GRID + gx];
          if (n < 2) continue;
          const intensity = Math.min(1, n / 8);
          const bx = (gx + 0.5) * cellW * scaleX;
          const by = (gy + 0.5) * cellH * scaleY;
          ctx.beginPath();
          ctx.fillStyle = `rgba(0, 212, 255, ${0.25 + intensity * 0.5})`;
          const r = 1 + intensity * 2;
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Jugadores enemigos (rojo, priorización por cercanía al jugador local si existe)
      let enemyList = [];
      let myPos = null;
      for (const [id, p] of C.renderState) {
        if (id === C.myId) {
          myPos = { x: p.x, y: p.y };
        } else {
          enemyList.push({ id, x: p.x, y: p.y });
        }
      }

      if (myPos) {
        enemyList.sort((a, b) => {
          const da = (a.x - myPos.x) ** 2 + (a.y - myPos.y) ** 2;
          const db = (b.x - myPos.x) ** 2 + (b.y - myPos.y) ** 2;
          return da - db;
        });
      }

      const maxEnemiesShown = 50;
      for (let i = 0; i < Math.min(enemyList.length, maxEnemiesShown); i++) {
        const e = enemyList[i];
        const mx = e.x * scaleX;
        const my = e.y * scaleY;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 51, 102, 0.9)';
        ctx.shadowColor = 'rgba(255, 51, 102, 0.7)';
        ctx.shadowBlur = 4;
        ctx.arc(mx, my, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // 5. Jugador local (verde neón, con halo y cono de dirección)
      if (myPos && C.myId) {
        const mx = myPos.x * scaleX;
        const my = myPos.y * scaleY;

        // Halo exterior
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 14);
        grad.addColorStop(0, 'rgba(0, 255, 136, 0.45)');
        grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, 14, 0, Math.PI * 2);
        ctx.fill();

        // Punto central
        ctx.beginPath();
        ctx.fillStyle = '#00ff88';
        ctx.shadowColor = 'rgba(0, 255, 136, 1)';
        ctx.shadowBlur = 6;
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Anillo exterior
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
        ctx.lineWidth = 1;
        ctx.arc(mx, my, 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 6. Rectángulo del viewport actual (cámara)
      const cam = this.cameras.main;
      if (cam) {
        const view = cam.worldView;
        const vx = view.x * scaleX;
        const vy = view.y * scaleY;
        const vw = view.width * scaleX;
        const vh = view.height * scaleY;
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(vx, vy, vw, vh);
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    _onPointerMove(pointer) {
      this._pointer = pointer;
      if (!C.joined || C.menuOpen || C.dead || C.respawnBusy || window.AdManager?.busy) return;
      this._updatePointerTarget(pointer);
    }

    _updatePointerTarget(pointer) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (!Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) return false;
      C.targetWorld.x = Math.max(0, Math.min(C.world.width, worldPoint.x));
      C.targetWorld.y = Math.max(0, Math.min(C.world.height, worldPoint.y));
      return true;
    }

    _handleInput(now) {
      if (C.menuOpen || C.dead || C.respawnBusy || window.AdManager?.busy) return;
      if (!this._pointer || !this._pointer.manager) return;
      // Recalcular también con el ratón quieto: la cámara puede haber avanzado.
      if (!this._updatePointerTarget(this._pointer)) return;

      if (now - C.lastMoveSentAt > MOVE_THROTTLE_MS && C.socket && C.joined) {
        C.lastMoveSentAt = now;
        C.socket.emit('playerMove', {
          tx: Math.round(C.targetWorld.x),
          ty: Math.round(C.targetWorld.y),
        });
      }
    }

    _interpolateEntities(now) {
      const render = now - INTERP_BUFFER_MS;

      const prevMap = C._prevStates || new Map();
      for (const [id, snapPair] of prevMap) {
        const [a, b] = snapPair;
        const total = b.t - a.t || 1;
        const local = render - a.t;
        let t = local / total;
        t = Math.max(0, Math.min(1, t));

        const cur = C.renderState.get(id) || { x: a.x, y: a.y, drones: [] };
        cur.x = a.x + (b.x - a.x) * t;
        cur.y = a.y + (b.y - a.y) * t;

        const dA = a.drones || [];
        const dB = b.drones || [];
        const len = dB.length;
        if (!cur.drones || cur.drones.length !== len) cur.drones = new Array(len);
        for (let i = 0; i < len; i++) {
          const bi = dB[i];
          const ai = dA.find(d => d.id === bi.id) || bi;
          if (!cur.drones[i]) cur.drones[i] = {};
          cur.drones[i].id = bi.id;
          cur.drones[i].x = ai.x + (bi.x - ai.x) * t;
          cur.drones[i].y = ai.y + (bi.y - ai.y) * t;
        }
        C.renderState.set(id, cur);
      }

      if (!C._prevStates) return;
      for (const [id] of C.renderState) {
        if (!C._prevStates.has(id)) C.renderState.delete(id);
      }
    }

    _render() {
      this._renderScraps();
      this._renderCombat();
      this._renderPlayers();
    }

    _renderCombat() {
      const g = this._layers.combat;
      g.clear();
      for (const obstacle of this._obstacles) {
        g.fillStyle(0x18243b, 1);
        g.fillCircle(obstacle.x, obstacle.y, obstacle.radius);
        g.lineStyle(2, 0x58728e, 0.65);
        g.strokeCircle(obstacle.x, obstacle.y, obstacle.radius);
      }
      const renderTime = performance.now() - INTERP_BUFFER_MS;
      for (const [a, b] of this._projectileStates.values()) {
        const t = Math.max(0, Math.min(1, (renderTime - a.t) / (b.t - a.t || 1)));
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        g.fillStyle(b.c, 0.25); g.fillCircle(x, y, 7);
        g.fillStyle(0xffffff, 1); g.fillCircle(x, y, 2.5);
      }
    }

    _renderScraps() {
      const g = this._layers.scraps;
      g.clear();
      const t = C._renderTick * 0.04;

      for (const [sid, s] of C.scraps) {
        const radius = 5 + Math.min(3, s.v);
        const spin = (s.s || 0) + t;
        const col = s.c || 0x88aaff;

        g.save();
        g.translateCanvas(s.x, s.y);
        g.rotateCanvas(spin);

        if (s.v >= 3) {
          g.fillStyle(0xffff88, 0.25);
          g.fillCircle(0, 0, radius + 4);
        } else if (s.v >= 2) {
          g.fillStyle(0x88ffff, 0.2);
          g.fillCircle(0, 0, radius + 2);
        }

        g.fillStyle(col, 0.95);
        g.fillTriangle(0, -radius, radius, radius, -radius, radius);
        g.lineStyle(1, 0xffffff, 0.5);
        g.strokeTriangle(0, -radius, radius, radius, -radius, radius);

        g.restore();
      }
    }

    _renderPlayers() {
      const ids = new Set();
      for (const [id, state] of C.renderState) {
        ids.add(id);
        const meta = C.playerStates.get(id);
        if (!meta) continue;
        this._ensurePlayerSprite(id, meta, state);
      }

      for (const id of this._playerSprites.keys()) {
        if (!ids.has(id)) this._removePlayer(id);
      }
    }

    _ensurePlayerSprite(id, meta, renderPos) {
      const isMe = id === C.myId;
      const color = meta.color || 0x00d4ff;
      const radius = meta.radius || 18;

      let cont = this._playerSprites.get(id);
      if (!cont) {
        cont = this.add.container(0, 0).setScale(1).setScrollFactor(1);
        this._playerSprites.set(id, cont);

        const halo = this.add.graphics();
        halo.name = 'halo';
        cont.add(halo);

        const body = this.add.graphics();
        body.name = 'body';
        cont.add(body);

        const core = this.add.graphics();
        core.name = 'core';
        cont.add(core);

        const dronesCont = this.add.container(0, 0);
        dronesCont.name = 'drones';
        cont.add(dronesCont);
        this._droneContainers.set(id, dronesCont);

        const nameText = this.add.text(0, -(radius + 18), '', {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '12px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        }).setOrigin(0.5);
        nameText.name = 'name';
        if (meta.isBot) nameText.setColor('#ffbb66');
        cont.add(nameText);
        this._nameTexts.set(id, nameText);
      }

      cont.x = renderPos.x;
      cont.y = renderPos.y;
      cont.setVisible(meta.hp > 0);

      const nameText = cont.getByName('name');
      if (nameText && meta.name && nameText.text !== meta.name) {
        nameText.setText(escapeHtml(meta.name).slice(0, 16));
      }

      const haloG = cont.getByName('halo');
      const bodyG = cont.getByName('body');
      const coreG = cont.getByName('core');
      haloG.clear();
      bodyG.clear();
      coreG.clear();

      if (isMe) {
        haloG.fillStyle(color, 0.15);
        haloG.fillCircle(0, 0, radius + 14);
        haloG.lineStyle(2, color, 0.4);
        haloG.strokeCircle(0, 0, radius + 14);
      } else {
        haloG.lineStyle(1, color, 0.2);
        haloG.strokeCircle(0, 0, radius + 6);
      }

      bodyG.fillStyle(color, 0.9);
      bodyG.fillCircle(0, 0, radius);
      bodyG.lineStyle(2, 0xffffff, 0.35);
      bodyG.strokeCircle(0, 0, radius);

      const angle = Math.atan2(meta.vy || 0, meta.vx || 1);
      bodyG.save();
      bodyG.rotateCanvas(angle);
      bodyG.fillStyle(0xffffff, 0.85);
      bodyG.fillTriangle(radius * 0.4, -radius * 0.6, radius * 1.25, 0, radius * 0.4, radius * 0.6);
      bodyG.restore();

      coreG.fillStyle(0xffffff, 0.95);
      coreG.fillCircle(0, 0, radius * 0.38);
      coreG.fillStyle(color, 1);
      coreG.fillCircle(0, 0, radius * 0.22);

      this._renderDrones(id, renderPos, meta, color);
    }

    _renderDrones(id, renderPos, meta, color) {
      const dronesCont = this._droneContainers.get(id);
      if (!dronesCont) return;

      const drones = renderPos.drones || [];
      const needed = drones.length;
      const list = dronesCont.list;

      while (list.length < needed) {
        const d = this.add.graphics();
        dronesCont.add(d);
      }
      while (list.length > needed) {
        const d = dronesCont.last;
        d.destroy();
      }

      for (let i = 0; i < needed; i++) {
        const g = list[i];
        if (!g) continue;
        const dp = drones[i];
        if (!dp) continue;
        g.clear();
        const lx = dp.x - renderPos.x;
        const ly = dp.y - renderPos.y;
        g.x = lx;
        g.y = ly;

        g.fillStyle(color, 0.95);
        g.fillCircle(0, 0, 5);
        g.lineStyle(1, 0xffffff, 0.6);
        g.strokeCircle(0, 0, 5);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(0, 0, 1.8);
      }
    }

    _followCamera() {
      if (!C.myId) return;
      const target = this._playerSprites.get(C.myId);
      if (!target || this._cameraTarget === target) return;
      const cam = this.cameras.main;
      // El contenedor tiene exactamente (renderPos.x, renderPos.y).
      // Centrar al aparecer evita recorrer el mapa desde el origen del mundo.
      cam.centerOn(target.x, target.y);
      cam.startFollow(target, false, 0.1, 0.1, 0, 0);
      this._cameraTarget = target;
    }

    _removePlayer(id) {
      const cont = this._playerSprites.get(id);
      if (cont && cont === this._cameraTarget) {
        this.cameras.main.stopFollow();
        this._cameraTarget = null;
      }
      if (cont) {
        cont.destroy();
        this._playerSprites.delete(id);
      }
      this._droneContainers.delete(id);
      this._nameTexts.delete(id);
    }

    _explodePlayer(id, meta) {
      const pos = C.renderState.get(id) || meta;
      this._explodeAt(pos.x, pos.y, true);
      for (const drone of pos.drones || []) this._explodeAt(drone.x, drone.y);
    }
  }

  // ------------------------------------------------------------------
  // HUD / UI helpers
  // ------------------------------------------------------------------
  function setupUI() {
    const input = document.getElementById('name-input');
    const codeInput = document.getElementById('room-code-input');
    input.value = localStorage.getItem('fleetio.name') || '';
    const buttons = ['join-btn', 'create-room-btn', 'join-room-btn', 'singleplayer-btn'];
    const setJoining = busy => {
      C._joinPending = busy;
      for (const id of buttons) document.getElementById(id).disabled = busy;
    };
    const enter = (event, roomCode = '') => {
      if (C._joinPending) return;
      if (!C.socket || !C.connected) {
        setStatus('Aún conectando al servidor…', 'connecting');
        return;
      }
      const name = input.value.trim() || 'Piloto';
      localStorage.setItem('fleetio.name', name);
      setJoining(true);
      setStatus('Preparando sala…', 'connecting');
      C.socket.timeout(10000).emit(event, { name, roomCode }, (error, result) => {
        setJoining(false);
        if (error || !result?.ok) {
          setStatus(result?.error || 'El servidor no respondió. Puedes reintentar.', 'error');
        }
      });
    };
    document.getElementById('join-btn').onclick = () => enter('joinRoom', 'public');
    document.getElementById('create-room-btn').onclick = () => enter('createPrivateRoom');
    document.getElementById('singleplayer-btn').onclick = () => enter('startSinglePlayer');
    document.getElementById('join-room-btn').onclick = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        setStatus('Introduce un código de 6 caracteres alfanuméricos.', 'error');
        return;
      }
      enter('joinRoom', code);
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') enter('joinRoom', 'public');
    });
    codeInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') document.getElementById('join-room-btn').click();
    });
    document.getElementById('menu-btn').onclick = () => {
      if (window.AdManager?.busy) return;
      C.menuOpen = true;
      window.AdManager?.gameplayStop?.();
      document.getElementById('overlay').classList.remove('hidden');
      document.getElementById('resume-btn').hidden = !C.joined;
      setStatus('Elige una sala o vuelve a tu partida.', '');
    };
    document.getElementById('resume-btn').onclick = hideOverlay;
    document.getElementById('copy-room-btn').onclick = async () => {
      const code = C.room?.code;
      if (!code) return;
      const status = document.getElementById('room-copy-status');
      try {
        await navigator.clipboard.writeText(code);
        status.textContent = 'Código copiado.';
      } catch {
        status.textContent = 'Copia manualmente el código mostrado arriba.';
      }
    };
    setTimeout(() => input.focus(), 100);
  }

  function updateRoomHUD(room) {
    const label = document.getElementById('hud-room');
    if (label) label.textContent = room
      ? (room.type === 'private' ? 'SALA PRIVADA' : room.type === 'singleplayer' ? 'MODO: SOLITARIO' : 'MODO: PÚBLICO') +
        ' · ' + room.humans + ' pilotos · ' + room.bots + ' bots'
      : 'MODO: SIN SALA';
    const codePanel = document.getElementById('room-code-panel');
    if (codePanel) codePanel.hidden = !room?.code;
    const code = document.getElementById('hud-room-code');
    if (code) code.textContent = room?.code || '';
    const count = document.getElementById('hud-players');
    if (count) count.textContent = String((room?.humans || 0) + (room?.bots || 0));
    const status = document.getElementById('room-copy-status');
    if (status) status.textContent = '';
  }

  function setStatus(text, cls) {
    const s = document.getElementById('status');
    if (!s) return;
    s.className = 'status' + (cls ? ' ' + cls : '');
    s.textContent = text;
  }

  function hideOverlay() {
    C.menuOpen = false;
    const o = document.getElementById('overlay');
    if (o) o.classList.add('hidden');
    syncGameplayTracking();
  }

  function syncGameplayTracking() {
    const playing = C.connected && C.joined && !C.dead && !C.menuOpen && !C.mutationsOpen;
    window.AdManager?.[playing ? 'gameplayStart' : 'gameplayStop']?.();
  }

  function updateHUD() {
    const score = document.getElementById('hud-score');
    const scrap = document.getElementById('hud-scrap');
    const drones = document.getElementById('hud-drones');
    if (score) score.textContent = String(C._score || 0);
    if (scrap) scrap.textContent = String(C._scrap || 0);
    if (drones) drones.textContent = `${C._drones || 0} / 12`;
    const hp = document.getElementById('hud-hp');
    const level = document.getElementById('hud-level');
    const bar = document.getElementById('hud-hp-bar');
    if (hp) hp.textContent = `${C._hp}/${C._maxHp}`;
    if (level) level.textContent = String(C._level);
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, C._hp / C._maxHp * 100))}%`;
      bar.classList.toggle('low', C._hp / C._maxHp < 0.3);
    }
  }

  function hideMutations() {
    C.mutationsOpen = false;
    document.getElementById('mutate-overlay').classList.add('hidden');
    syncGameplayTracking();
  }

  function showMutations(options, level) {
    C.mutationsOpen = true;
    window.AdManager?.gameplayStop?.();
    const box = document.getElementById('mutate-options');
    box.replaceChildren();
    document.getElementById('mutate-level').textContent = String(level);
    for (const option of options) {
      const button = document.createElement('button');
      button.className = `mutate-option ${option.rarity === 'raro' ? 'raro' : ''}`;
      button.textContent = `${option.icon || '✦'} ${option.name} — ${option.desc}`;
      button.onclick = () => {
        if (C.dead || !C.connected) return;
        C.socket.emit('selectUpgrade', { type: option.type });
        for (const sibling of box.children) sibling.disabled = true;
      };
      box.append(button);
    }
    document.getElementById('mutate-overlay').classList.remove('hidden');
  }

  function spawnFloatText(scene, playerId, text, color) {
    const pos = C.renderState.get(playerId);
    if (!pos) return;
    const t = scene.add.text(pos.x, pos.y - 40, text, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '14px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    scene.tweens.add({
      targets: t,
      y: pos.y - 90,
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Escapa un id para usarlo con seguridad en un selector de atributos CSS
  function cssEscape(id) {
    return String(id).replace(/["\\]/g, '\\$&');
  }

  // Construye el HTML interno de una fila del leaderboard (rank, medalla, nombre, score)
  function buildLbRowInner(p, rank) {
    const name = escapeHtml((p.name || 'Piloto').slice(0, 16));
    const score = p.score || 0;
    const rankClass = rank <= 3 ? `r${rank}` : '';
    const medalGlyph = rank === 1 ? '1' : rank === 2 ? '2' : rank === 3 ? '3' : String(rank);
    return `
      <span class="lb-rank ${rankClass}">${rank}.</span>
      <span class="lb-medal ${rankClass}">${medalGlyph}</span>
      <span class="lb-name" title="${name}">${name}</span>
      <span class="lb-score">${score.toLocaleString()}</span>
    `;
  }

  // Flash de incremento de puntuación en una fila del leaderboard
  function flashScoreDelta(row, delta) {
    let badge = row.querySelector('.lb-score-delta');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'lb-score-delta up';
      row.appendChild(badge);
    }
    badge.textContent = `+${delta}`;
    badge.classList.add('show');
    clearTimeout(badge._t);
    badge._t = setTimeout(() => badge.classList.remove('show'), 900);
  }

  // ------------------------------------------------------------------
  // Configuración y arranque de Phaser
  // ------------------------------------------------------------------
  async function bootPhaser() {
    await window.AdManager?.ready;
    const scaleMode = Phaser.Scale.RESIZE;
    const parent = document.getElementById('game');

    const config = {
      type: Phaser.AUTO,
      parent: 'game',
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
      backgroundColor: '#03040c',
      scale: {
        mode: scaleMode,
        parent: 'game',
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BootScene, GameScene],
      fps: {
        target: 60,
        forceSetTimeOut: false,
      },
      render: {
        antialias: true,
        pixelArt: false,
        powerPreference: 'high-performance',
      },
    };

    const game = new Phaser.Game(config);
    // También detectar cambios del contenedor sin un resize de window (iframe).
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) game.scale.resize(Math.round(width), Math.round(height));
      });
      observer.observe(parent);
      game.events.once('destroy', () => observer.disconnect());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPhaser);
  } else {
    bootPhaser();
  }
})();

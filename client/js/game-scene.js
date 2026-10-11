// ============================================================================
// FLEET.IO - Cliente Phaser 3
// Renderizado, input, interpolación de red y HUD
// ============================================================================

(function () {
  'use strict';
  const I = window.FleetI18n, M = I.m;

  // ------------------------------------------------------------------
  // Configuración global
  // ------------------------------------------------------------------
  const MOVE_THROTTLE_MS = 33;
  const INTERP_BUFFER_MS = 80;
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
    _xp: 0,
    kingId: null,
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
    preload() {
      this.load.audio('overdrive-activate', 'assets/audio/overdrive_activate.wav');
      this.load.audio('drone-launch', 'assets/audio/drone_launch.wav');
      // Optional audio must not trap the startup scene (network / decoding stall).
      this._assetDeadline = setTimeout(() => {
        this._assetDeadline = null;
        this.load.reset();
        this.scene.start('UIScene');
      }, 8000);
      this.events.once('shutdown', () => clearTimeout(this._assetDeadline));
    }
    create() {
      clearTimeout(this._assetDeadline); this._assetDeadline = null;
      this.scene.start('UIScene');
    }
  }

  // ------------------------------------------------------------------
  // Fase: Juego
  // ------------------------------------------------------------------
  class GameScene extends Phaser.Scene {
    constructor() {
      super('GameScene');
      this._decoder = new window.FleetNetwork.Decoder();
      this._resyncAt = -Infinity;
      this._stars = [];
      this._trailQuotas = new Map();
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
      this._laserSprites = new Map();
      this._obstacleSprites = new Map();
      this._prediction = null;
      this._inputSeq = 0;
      this._inputMode = 'pointer';
      this._visualTime = 0;
      this._leaderboardAt = -Infinity;
      this._obstacles = [];
      this._bg = null;
      this._minimapLast = 0;
    }

    create() {
      this._ui = this.scene.get('UIScene');
      this.scene.bringToTop('UIScene');
      this._pointer = this.input.activePointer;
      const camera = this.cameras.main;
      camera.setPosition(0, 0);
      camera.setOrigin(0.5, 0.5);
      camera.setBounds(0, 0, C.world.width, C.world.height);
      camera.setBackgroundColor('#000000');
      this.input.on('pointermove', this._onPointerMove, this);
      this.events.once('shutdown', () => {
        this.input.off('pointermove', this._onPointerMove, this);
        camera.stopFollow();
        this._cameraTarget = null;
      });

      window.FleetVisuals.textures(this);
      this._buildStars();
      this._buildWorldBounds();
      this._initMinimap();
      this._initJuice();
      this._bullets = new window.FleetProjectiles(this, C);
      this._setupAdHooks();
      this._keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');

      C.socket = this._setupSocket();

      setupUI();
      this._setupDeathUI();
      if (window.FleetFeatures) this._features = new window.FleetFeatures.Features(this, C, syncGameplayTracking);
      if (window.FleetRetention) this._retention = new window.FleetRetention.Retention(this, C);
      if (window.FleetCompetitive) this._competitive = new window.FleetCompetitive.Competitive(this,C);
      if (window.FleetHazards) this._hazards = new window.FleetHazards.Hazards(this,C);
      if (window.FleetEngagement) this._engagement = new window.FleetEngagement.Engagement(this, C);
      this._cyber = new window.FleetCyber.Cyber(this, C);
      const unsubscribe = I.subscribe(() => {
        updateHUD();
        this._updateLeaderboard(C.leaderboard || []);
      });
      this.events.once('shutdown', unsubscribe);
      this._menuReady=true; this._finishInitialLoading();
    }

    _finishInitialLoading() {
      // The menu is interactive before the backend connects. A cold Render
      // server is a connection state, not an unfinished asset load.
      if (!this._menuReady || this._initialLoadingDone) return;
      this._initialLoadingDone = true;
      document.getElementById('game-loading')?.classList.add('hidden');
      window.AdManager?.loadingStop?.();
      if (!C.connected) setStatus(M('status.loadingRetry'), '');
    }

    _setupAdHooks() {
      let previousMute = false, previousFeatureMute = false;
      let pausedScenes = [], contexts = [], media = [];
      window.AdManager?.setGameHooks({
        onLoadingTimeout: () => this._finishInitialLoading(),
        onAdStarted: () => {
          previousMute = this.sound?.mute || false;
          previousFeatureMute = this._features?.muted || false;
          contexts = [...new Set([this.sound?.context, this._features?.audio].filter(ctx => ctx?.state === 'running'))];
          media = [...new Set([this._cyber?.audio, ...document.querySelectorAll('audio,video')]
            .filter(node => node && !node.paused && !node.ended))];
          if (this.sound) this.sound.mute = true;
          if (this._features) this._features.muted = true;
          for (const ctx of contexts) { try { ctx.suspend()?.catch?.(() => {}); } catch {} }
          for (const node of media) node.pause();
          pausedScenes = ['GameScene','UIScene'].filter(key => this.scene.isActive(key));
          for (const key of pausedScenes) this.scene.pause(key);
        },
        onAdEnded: () => {
          if (this.sound) this.sound.mute = previousMute;
          if (this._features) this._features.muted = previousFeatureMute;
          for (const ctx of contexts) { try { ctx.resume()?.catch?.(() => {}); } catch {} }
          for (const node of media) { try { node.play()?.catch?.(() => {}); } catch {} }
          contexts = []; media = [];
          for (const key of pausedScenes) this.scene.resume(key);
          pausedScenes = []; syncGameplayTracking();
        },
      });
      this.events.once('shutdown', () => {
        window.AdManager?.setGameHooks({}); window.AdManager?.gameplayStop();
      });
    }

    _setupDeathUI() {
      document.getElementById('rewarded-respawn-btn').onclick = () => {
        if (!C.dead || C.respawnBusy || !C.connected || !C.rewardOffer || !window.AdManager.canShowAds()) return;
        const deathId = C.deathId;
        const playerId = C.myId;
        const roomId = C.room?.roomId;
        this._setRespawnBusy(true, M('ad.playing'));
        window.AdManager.showRewardedAd(() => {
          // Ignorar resultados de un anuncio perteneciente a otra sesión/muerte.
          if (C.dead && C.deathId === deathId && C.myId === playerId && C.room?.roomId === roomId) {
            this._requestRespawn(true, deathId);
          }
        }, () => {
          if (C.dead && C.deathId === deathId && C.myId === playerId && C.room?.roomId === roomId) {
            this._setRespawnBusy(false, M('ad.failure'));
            this._updateRewardAvailability();
          }
        });
      };
      document.getElementById('restart-btn').onclick = async () => {
        if (!C.dead || C.respawnBusy || !C.connected) return;
        const life=C.deathId, room=C.room?.roomId, pilot=C.myId;
        this._setRespawnBusy(true, M('status.restoring'));
        // Never combine an offered rewarded revive and a midgame at the same death.
        if (!C.rewardOfferWasShown && window.AdManager?.canShowAds()) {
          await window.AdManager.showInterstitialAd();
        }
        if (C.dead && C.deathId===life && C.room?.roomId===room && C.myId===pilot) this._requestRespawn(false,life);
      };
    }

    _updateRewardAvailability() {
      if (!window.AdManager?.canShowAds()) C.rewardOffer = false;
      const button=document.getElementById('rewarded-respawn-btn');
      button.hidden=!C.rewardOffer;
      button.disabled=!C.rewardOffer || C.respawnBusy || !C.connected;
    }

    _setRespawnBusy(busy, message = '') {
      C.respawnBusy = busy;
      for (const id of ['rewarded-respawn-btn', 'restart-btn']) {
        document.getElementById(id).disabled = busy || !C.connected;
      }
      this._updateRewardAvailability();
      I.render(document.getElementById('death-status'), message);
    }

    _showDeath(me) {
      window.AdManager?.gameplayStop?.();
      if (C.dead && C.deathId === me.deathId) return;
      C.dead = true;
      C.deathId = me.deathId;
      C._deathCount=(C._deathCount||0)+1;
      C.rewardOffer = C._deathCount%2===1 && Date.now()>=(C._nextRewardOffer||0) && !!window.AdManager?.canShowAds();
      C.rewardOfferWasShown=C.rewardOffer;
      if (C.rewardOffer) C._nextRewardOffer=Date.now()+120000;
      C.mutationsOpen = false;
      document.getElementById('mutate-overlay').classList.add('hidden');
      const saved = me.deathState || { score: me.score, scrap: me.scrap, drones: me.drones.length };
      I.render(document.getElementById('death-summary'), M('death.summary', saved));
      document.getElementById('death-overlay').classList.remove('hidden');
      this._setRespawnBusy(false, C.rewardOffer ? (window.AdManager?.mode === 'simulation' ? M('ad.demo') : '') : M('ad.unavailable'));
      this._features?.died(me);
      document.getElementById('restart-btn').focus();
    }

    _requestRespawn(rewarded, deathId) {
      if (!C.connected) {
        this._setRespawnBusy(false, M('status.offline'));
        return;
      }
      this._setRespawnBusy(true, M('status.restoring'));
      const playerId = C.myId;
      const roomId = C.room?.roomId;
      C.socket.timeout(8000).emit(
        rewarded ? 'request_revenge_respawn' : 'requestRespawn', { deathId, roomId },
        (error, result) => {
          if (!C.dead || C.deathId !== deathId || C.myId !== playerId || C.room?.roomId !== roomId) return;
          if (error || !result?.ok) {
            this._setRespawnBusy(false, I.error(result?.error));
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
      C._xp = me.xp || 0;
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
        this._prediction = new window.FleetPredictedPlayer(me);
        this.cameras.main.centerOn(me.x, me.y);
      }
      syncGameplayTracking();
      this._features?.sync(me);
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
        emitting: false, lifespan: { min: 200, max: 400 },
        speed: { min: 35, max: 85 }, tint: [0x00d4ff, 0x88ffff, 0xffffff],
        scale: { start: 0.6, end: 0 }, alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 128, maxAliveParticles: 128,
      });
      this._explosions = this.add.particles(0, 0, key, {
        emitting: false, lifespan: { min: 280, max: 650 },
        speed: { min: 45, max: 200 }, angle: { min: 0, max: 360 },
        tint: [0xffffff, 0xffdd66, 0xff8833, 0x00d4ff],
        scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 256, maxAliveParticles: 256,
      }).setDepth(10);
      this._royalAura = this.add.particles(0, 0, key, {
        emitting: false, lifespan: 650, speed: { min: 8, max: 22 }, tint: 0xffd260,
        scale: { start: 0.35, end: 0 }, alpha: { start: 0.5, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 32, maxAliveParticles: 32,
      }).setDepth(2);
      this._laserTrail = this.add.particles(0, 0, 'fleet-plasma', {
        emitting: false, lifespan: 150, speed: 0, tint: 0x00ffff,
        scale: { start: 0.22, end: 0 }, alpha: { start: 0.5, end: 0 },
        blendMode: Phaser.BlendModes.ADD, maxParticles: 192, maxAliveParticles: 192,
      }).setDepth(4);
      this._laserTrailAt = 0;
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
        camera.shake(isShip ? 200 : 50, isShip ? 0.008 : 0.002, false);
      }
    }

    _emitShipTrail(emitter, id, x, y, count, now) {
      // All trail variants share 25 reusable timestamp slots per pilot.
      // Their maximum lifetime is <= 400ms; hidden ships never emit.
      if (!this._effectVisible(x, y, 0)) return;
      let quota = this._trailQuotas.get(id);
      if (!quota) { quota = { times: new Float64Array(25).fill(-Infinity), head: 0 }; this._trailQuotas.set(id, quota); }
      for (let i=0; i<count; i++) {
        if (now-quota.times[quota.head]<400) break;
        quota.times[quota.head]=now; quota.head=(quota.head+1)%25;
        emitter.emitParticleAt(x,y,1);
      }
    }

    _renderThrust(now) {
      if (!C.connected || now - this._lastThrustAt < THRUST_INTERVAL_MS) return;
      this._lastThrustAt = now;
      for (const [id, pos] of C.renderState) {
        const meta = C.playerStates.get(id);
        if (!meta || meta.hp <= 0 || Math.hypot(pos.vx ?? meta.vx, pos.vy ?? meta.vy) < 0.15 ||
            !this._effectVisible(pos.x, pos.y)) continue;
        const angle = pos.rotation ?? Math.atan2(meta.vy, meta.vx);
        const rear = meta.radius + 4;
        const degrees = angle * 180 / Math.PI + 180;
        this._thrust.setEmitterAngle({ min: degrees - 18, max: degrees + 18 });
        this._thrust.setParticleTint(window.FleetFeatures?.TRAIL_COLORS[meta.trail] || (id === C.myId ? 0x20dfff : 0xff406e));
        this._emitShipTrail(this._thrust, id,
          pos.x - Math.cos(angle) * rear, pos.y - Math.sin(angle) * rear, 1, now
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
      this._parallax = window.FleetVisuals.background(this);
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
      const socket = window.FleetNetwork.connect(window);
      const inRoom = data => !data.roomId || data.roomId === C.room?.roomId;

      socket.on('connect', () => {
        C.connected = true;
        setStatus(M('status.connected'), '');
        this._finishInitialLoading();
      });

      socket.on('disconnect', () => {
        this._features?.settle();
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
        this._bullets?.reset(); this._decoder.reset(); C.nemesisPosition=null;
        for (const id of this._playerSprites.keys()) this._removePlayer(id);
        document.getElementById('death-overlay').classList.add('hidden');
        document.getElementById('mutate-overlay').classList.add('hidden');
        document.getElementById('overlay').classList.remove('hidden');
        document.getElementById('join-btn').disabled = false;
        setStatus(M('status.disconnect'), 'error');
      });

      socket.on('connect_error', () => {
        setStatus(M('status.error'), 'error');
        const loading=document.querySelector('#game-loading span');
        if (loading) I.render(loading,M('status.loadingRetry'));
      });

      socket.on('welcome', (data) => {
        this._features?.settle();
        window.AdManager?.gameplayStop?.();
        C.joined = false;
        C.lastServerTime = 0;
        // Cambio de sala = nueva línea temporal. No interpolar entidades de
        // mundos diferentes ni conservar las opciones de mutación anteriores.
        for (const id of this._playerSprites.keys()) this._removePlayer(id);
        C.playerStates.clear(); C.renderState.clear(); C.scraps.clear();
        this._prediction = null;
        this._leaderboardAt = -Infinity;
        C._prevStates?.clear();
        this._projectileStates.clear(); this._bullets?.reset(); this._obstacles = [];
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
        setStatus(M('status.launched'), '');

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
        I.render(document.getElementById('hud-players'), String(n));
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
          spawnFloatText(this, C.myId, M('drone.gained'), 0xff00aa);
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
        spawnFloatText(this, C.myId, M('mutation.applied', { icon: data.icon || '✦', name: M(data.type ? 'mutation.' + data.type + '.name' : 'mutation.generic') }), 0x00ff88);
      });

      socket.on('gameState', (snap) => {
        try { this._onSnapshot(snap); } catch (error) {
          console.warn('Discarded invalid game snapshot');
          this._decoder.reset();
        }
      });

      socket.on('playerDied', (me) => {
        if (!inRoom(me)) return;
        if (me.id !== C.myId) return;
        // Stop gameplay before visual work can fail or delay the death modal.
        window.AdManager?.gameplayStop?.();
        const previous = C.playerStates.get(me.id);
        if (previous && previous.hp > 0) this._explodePlayer(me.id, previous);
        C.playerStates.set(me.id, me);
        this._syncLocalState(me);
      });
      socket.on('respawned', (me) => {
        if (!inRoom(me)) return;
        if (me.id !== C.myId) return;
        C.playerStates.set(me.id, me);
        this._features?.begin(me);
        this._retention?.sync(me);
        this._syncLocalState(me);
      });

      socket.io.on('ping', () => { C._pingSentAt = performance.now(); });
      socket.io.on('pong', () => {
        if (C._pingSentAt) {
          C.ping = Math.round(performance.now() - C._pingSentAt);
          I.render(document.getElementById('hud-ping'), String(C.ping));
        }
      });

      return socket;
    }

    _onSnapshot(snap) {
      if (!snap || (snap.roomId && snap.roomId !== C.room?.roomId)) return;
      const decoded = this._decoder.receive(snap);
      if (!decoded) {
        const now = performance.now();
        if (now - this._resyncAt > 500) {
          this._resyncAt = now; C.socket.emit('requestSnapshot', { roomId: C.room?.roomId });
        }
        return;
      }
      if (snap.t <= C.tick && C.lastServerTime) return;
      snap = decoded;
      const now = performance.now();
      C.lastServerTime = now;
      C.tick = snap.t;
      C.kingId = snap.kingId || null;
      C.kingPosition = snap.king || null;
      C.nemesisPosition = snap.nemesis || null;
      const players = snap.p || [];
      const scrapsSnap = snap.s || [];
      const respawnedPlayers = new Set();
      this._obstacles = snap.o || [];
      this._retention?.snapshot(snap);
      this._competitive?.snapshot(snap);
      this._hazards?.snapshot(snap);
      this._engagement?.snapshot(snap);
      this._bullets?.snapshot(snap.b || [], players.find(p => p.id === C.myId), now);
      for (const [, x, y] of snap.i || []) {
        if (this._explosions && this._effectVisible(x, y)) this._explosions.emitParticleAt(x, y, 6);
      }

      // Los snapshots son completos. Comparar IDs evita confundir reordenaciones
      // de drones con bajas y usa su última posición interpolada para el estallido.
      const activePlayers = new Set(players.map(p => p.id));
      for (const [id, previous] of C.playerStates) {
        if (activePlayers.has(id)) continue;
        if (!snap.aoi && previous.hp > 0) this._explodePlayer(id, previous);
        C.playerStates.delete(id);
        C.renderState.delete(id);
        C._prevStates?.delete(id);
        this._removePlayer(id);
      }

      for (const p of players) {
        const previous = C.playerStates.get(p.id);
        if (previous && previous.hp <= 0 && p.hp > 0) respawnedPlayers.add(p.id);
        if (p.id === C.myId && previous && p.hp > 0 && p.hp < previous.hp && p.hp / p.maxHp <= 0.25) this._cyber?.impact();
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
        if ((p.motionRevision || 0) < (C.playerStates.get(p.id)?.motionRevision || 0)) continue;
        const state = {
          ...p,
          id: p.id,
          name: p.name || I.t('pilot'),
          isBot: !!p.isBot,
          color: p.color || 0x00d4ff,
          score: p.score || 0,
          scrap: p.scrap || 0,
          radius: p.radius || 18,
          x: p.x, y: p.y,
          vx: p.vx || 0,
          vy: p.vy || 0,
          rotation: p.rotation ?? Math.atan2(p.vy || 0, p.vx || 1),
          maxSpeed: p.maxSpeed || window.FleetMovement.BASE_SPEED,
          inputSeq: p.inputSeq || 0,
          drones: p.drones || [],
          hp: typeof p.hp === 'number' ? p.hp : 100,
          maxHp: typeof p.maxHp === 'number' ? p.maxHp : 100,
          level: typeof p.level === 'number' ? p.level : 1,
          levelUpPending: !!p.levelUpPending,
          invulnerable: !!p.invulnerable,
          deathId: p.deathId,
          deathState: p.deathState,
          mutations: p.mutations || [],
          receivedAt: now, motionRevision:p.motionRevision || 0,
        };
        C.playerStates.set(p.id, state);
      }

      if (!C._prevStates) C._prevStates = new Map();
      for (const p of players) {
        if ((p.motionRevision || 0) < (C.playerStates.get(p.id)?.motionRevision || 0)) continue;
        const prevSnap = {
          x: p.x,
          y: p.y,
          vx: p.vx || 0,
          vy: p.vy || 0,
          rotation: p.rotation ?? Math.atan2(p.vy || 0, p.vx || 1),
          drones: [...(p.drones || []), ...(p.orbitalDrones || []), ...(p.tacticalDrones || [])].map(d => ({ id: d.id, x: d.x, y: d.y, state:d.state, rotation:d.rotation, tactical:!!d.tactical, autonomous: !!d.autonomous })),
          t: now, motionRevision:p.motionRevision || 0,
        };
        if (C._prevStates.has(p.id) && !respawnedPlayers.has(p.id) && C._prevStates.get(p.id).at(-1).motionRevision === (p.motionRevision || 0)) {
          const last = C._prevStates.get(p.id);
          last.push(prevSnap);
          if (last.length > 5) last.shift();
        } else {
          C._prevStates.set(p.id, [prevSnap]);
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

      if (now - this._leaderboardAt >= 250) {
        this._leaderboardAt = now;
        this._updateLeaderboard(snap.leaderboard || players);
      }

      if (C.myId && C.playerStates.has(C.myId)) {
        const me = C.playerStates.get(C.myId);
        if (me.hp > 0) {
          if (!this._prediction || C.dead) this._prediction = new window.FleetPredictedPlayer(me);
          else this._prediction.reconcile(me, C.world, this._obstacles);
        }
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
      if (!C.joined) { this._cyber?.idle(); return; }
      const now = performance.now();
      this._features?.update(now);
      this._retention?.update(now, delta);

      C._renderTick++;
      window.FleetRenderer?.metrics(this, now);
      // Slowdown visual de escape: nunca altera delta de predicción ni ticks.
      this._visualTime += Math.min(delta, 100) / 1000 * (now < (this._retention?.slowUntil || 0) ? 0.5 : 1);

      // Transformar el ratón con la cámara de la vista actualmente mostrada.
      this._handleInput(now, delta);
      this._interpolateEntities(now);
      this._predictLocal(delta);
      this._bullets?.update(now, delta);
      const frozen = now < (this._hitStopUntil || 0);
      if (!frozen) this._render();
      this._cyber?.update(now, delta, frozen);
      this._competitive?.update(now);
      this._hazards?.update(now);
      this._engagement?.update(now);
      // Phaser actualiza el seguimiento al preparar la cámara para renderizar,
      // después de colocar el contenedor en la posición interpolada de este frame.
      this._followCamera();
      const cameraLerp = 1 - Math.pow(0.9, Math.min(delta, 100) / (1000 / 60));
      this.cameras.main.setLerp?.(cameraLerp, cameraLerp);
      this._renderThrust(now);
      for (const layer of this._parallax || []) {
        layer.sprite.tilePositionX = this.cameras.main.scrollX * layer.factor + this._visualTime * layer.factor * 4;
        layer.sprite.tilePositionY = this.cameras.main.scrollY * layer.factor;
      }

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

      // El líder emite una coordenada global independiente de la interpolación.
      if (C.kingPosition) {
        const x = C.kingPosition.x * scaleX, y = C.kingPosition.y * scaleY;
        ctx.fillStyle = '#ffd260'; ctx.beginPath();
        ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = 1; ctx.stroke();
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
      if (!C.joined || C.menuOpen || C.dead || C.respawnBusy || this._features?.blocking || window.AdManager?.busy) return;
      this._inputMode = 'pointer';
      this._updatePointerTarget(pointer);
    }

    _updatePointerTarget(pointer) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (!Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) return false;
      C.targetWorld.x = Math.max(0, Math.min(C.world.width, worldPoint.x));
      C.targetWorld.y = Math.max(0, Math.min(C.world.height, worldPoint.y));
      return true;
    }

    _handleInput(now, delta) {
      if (C.menuOpen || C.dead || C.respawnBusy || this._features?.blocking || window.AdManager?.busy) return;
      const keys = this._keys;
      const dx = keys ? Number(keys.D.isDown || keys.RIGHT.isDown) - Number(keys.A.isDown || keys.LEFT.isDown) : 0;
      const dy = keys ? Number(keys.S.isDown || keys.DOWN.isDown) - Number(keys.W.isDown || keys.UP.isDown) : 0;
      const position = this._prediction?.state;
      if ((dx || dy) && position) {
        this._inputMode = 'keyboard';
        C.targetWorld.x = Math.max(0, Math.min(C.world.width, position.x + dx * 500));
        C.targetWorld.y = Math.max(0, Math.min(C.world.height, position.y + dy * 500));
      } else if (this._inputMode === 'keyboard' && position) {
        C.targetWorld.x = position.x; C.targetWorld.y = position.y;
      } else if (!this._pointer?.manager || !this._updatePointerTarget(this._pointer)) return;
      // Recalcular también con el ratón quieto: la cámara puede haber avanzado.
      // Durante la partida las entradas se envían desde el paso fijo predictivo.
      if (!this._prediction && now - C.lastMoveSentAt > MOVE_THROTTLE_MS && C.socket && C.joined) {
        C.lastMoveSentAt = now;
        C.socket.emit('playerMove', {
          tx: Math.round(C.targetWorld.x),
          ty: Math.round(C.targetWorld.y),
        });
      }
    }

    _predictLocal(delta) {
      if (!this._prediction || C.dead || !C.connected) return;
      const blocked = C.menuOpen || C.respawnBusy || this._features?.blocking || window.AdManager?.busy;
      const p = this._prediction.state;
      const target = blocked ? { tx: p.x, ty: p.y } : { tx: C.targetWorld.x, ty: C.targetWorld.y };
      const result = this._prediction.advance(delta, target, C.world, this._obstacles, input => {
        const command = { tx: Math.round(input.tx), ty: Math.round(input.ty), seq: ++this._inputSeq,
          roomId: C.room?.roomId, deathId: this._prediction.state.deathId, motionRevision:this._prediction.state.motionRevision || 0 };
        C.socket.emit('playerMove', command);
        return command;
      });
      const current = C.renderState.get(C.myId) || { drones: [] };
      const dx = result.x - current.x, dy = result.y - current.y;
      for (const drone of current.drones) { if (drone.state !== 'ATTACK' && drone.state !== 'RETURNING') { drone.x += dx; drone.y += dy; } }
      Object.assign(current, result);
      C.renderState.set(C.myId, current);
    }

    _interpolateEntities(now) {
      const render = now - INTERP_BUFFER_MS;

      const prevMap = C._prevStates || new Map();
      for (const [id, queue] of prevMap) {
        const { a, b, t, x, y, rotation } = window.FleetNetwork.sample(queue, render);

        const cur = C.renderState.get(id) || { x: a.x, y: a.y, drones: [] };
        cur.x = x; cur.y = y; cur.rotation = rotation;
        cur.vx = b.vx || 0; cur.vy = b.vy || 0;

        const dA = a.drones || [];
        const dB = b.drones || [];
        const len = dB.length;
        if (!cur.drones || cur.drones.length !== len) cur.drones = new Array(len);
        for (let i = 0; i < len; i++) {
          const bi = dB[i];
          const ai = dA.find(d => d.id === bi.id) || bi;
          if (!cur.drones[i]) cur.drones[i] = {};
          cur.drones[i].id = bi.id;
          cur.drones[i].autonomous = !!bi.autonomous;
          cur.drones[i].state = bi.state; cur.drones[i].rotation = bi.rotation; cur.drones[i].tactical = bi.tactical;
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
      const visible = (sprite, x, y, padding = 80) => sprite.setVisible(this._effectVisible(x, y, padding));
      const obstacleIds = new Set();
      for (const o of this._obstacles) {
        obstacleIds.add(o.id);
        let sprite = this._obstacleSprites.get(o.id);
        if (!sprite) {
          sprite = this.add.image(o.x, o.y, 'fleet-asteroid').setDepth(1);
          sprite.setDisplaySize(o.radius * 2, o.radius * 2);
          this._obstacleSprites.set(o.id, sprite);
        }
        visible(sprite, o.x, o.y, o.radius + 80);
        const tint = o.volatile ? 0xff3348 : o.gold ? 0xffcf50 : 0xffffff;
        if (sprite._rockTint !== tint) { sprite.setTint(tint); sprite._rockTint=tint; }
      }
      for (const [id, sprite] of this._obstacleSprites) if (!obstacleIds.has(id)) {
        sprite.destroy(); this._obstacleSprites.delete(id);
      }

    }

    _renderScraps() {
      for (const [id, s] of C.scraps) {
        let sprite = this._scrapSprites.get(id);
        if (!sprite) {
          sprite = this.add.image(s.x, s.y, 'fleet-scrap').setDepth(0);
          this._scrapSprites.set(id, sprite);
        }
        sprite.x = s.x; sprite.y = s.y;
        sprite.rotation = (s.s || 0) + this._visualTime * 0.6;
        if (sprite._value !== s.v || sprite._color !== s.c) {
          sprite.setTint(s.c || 0x88aaff).setScale(0.5 + Math.min(3, s.v) * 0.15);
          sprite._value = s.v; sprite._color = s.c;
        }
        sprite.setVisible(this._effectVisible(s.x, s.y));
      }
      for (const [id, sprite] of this._scrapSprites) if (!C.scraps.has(id)) {
        sprite.destroy(); this._scrapSprites.delete(id);
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
      const team = isMe ? 'blue' : 'red';
      let cont = this._playerSprites.get(id);
      if (!cont) {
        cont = this.add.container(0, 0).setScale(1).setScrollFactor(1).setDepth(3);
        this._playerSprites.set(id, cont);
        const shield = this.add.image(0, 0, 'fleet-shield').setScale(0.6);
        shield.name = 'shield'; cont.add(shield);
        const body = this.add.image(0, 0, 'ship-' + team + '-1').setScale(0.55);
        body.name = 'body'; cont.add(body);
        const dronesCont = this.add.container(0, 0);
        dronesCont.name = 'drones'; cont.add(dronesCont);
        this._droneContainers.set(id, dronesCont);
        const label = this.add.text(0, -38, '', {
          fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: isMe ? '#88efff' : '#ff9db5',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5);
        label.name = 'name'; cont.add(label);
        const crown = this.add.image(0, -40, 'fleet-crown').setScale(0.6);
        crown.name = 'crown'; cont.add(crown);
        this._nameTexts.set(id, label);
      }
      cont.x = renderPos.x; cont.y = renderPos.y;
      cont.setVisible(meta.hp > 0 && (isMe || this._effectVisible(cont.x, cont.y, 120)));
      if (!cont.visible) return;
      const label = cont.getByName('name');
      label.y = id === C.kingId ? -62 : -38;
      const name = (meta.name || I.t('pilot')).slice(0, 16);
      const title = meta.equippedTitle && meta.titles?.includes(meta.equippedTitle) ? meta.equippedTitle : '';
      I.render(label, name, 'phaserText');
      let titleLabel = cont.getByName('title');
      if (!titleLabel) {
        titleLabel = this.add.text(0, -56, '', { fontFamily: 'system-ui', fontSize: '11px', fontStyle: 'bold', stroke: '#04101e', strokeThickness: 3 }).setOrigin(.5);
        titleLabel.name = 'title'; cont.add(titleLabel);
      }
      I.render(titleLabel, title ? M('title.' + title) : '', 'phaserText');
      titleLabel.y = label.y - 19;
      const titleColor = title === 'Untouchable' ? '#92ffff' : title === 'Space Pirate' ? '#ffb3e1' : '#ffdc7c';
      // Text color changes rebuild the canvas texture: never request it every frame.
      if (titleLabel.style?.color !== titleColor) titleLabel.setColor(titleColor);
      const body = cont.getByName('body');
      const texture = 'ship-' + team + '-' + (meta.chassis || 1);
      if (body._chassisTexture !== texture) { body.setTexture(texture); body._chassisTexture = texture; }
      body.setScale(meta.chassis === 4 ? 0.85 : meta.chassis === 3 ? 0.7 : meta.chassis === 2 ? 0.6 : 0.55);
      body.setTint(isMe && meta.isInvulnerable ? 0x00ffff : window.FleetFeatures?.SKIN_COLORS[meta.skin] || 0xffffff);
      if (isMe && meta.isInvulnerable && !body._revengeTween) {
        body._revengeTween = this.tweens.add({targets:body,alpha:.4,duration:180,yoyo:true,repeat:-1});
      } else if (!meta.isInvulnerable && body._revengeTween) { body._revengeTween.stop();body._revengeTween=null;body.setAlpha(1); }
      cont.getByName('crown').setVisible(id === C.kingId);
      body.rotation = renderPos.rotation ?? Math.atan2(meta.vy || 0, meta.vx || 1);
      const shield = cont.getByName('shield');
      shield.setVisible(isMe || meta.invulnerable || meta.shielded || meta.isParrying || meta.revengeShieldRemaining > 0 || meta.supplyBuff === 'MIRROR_SHIELD');
      shield.setTint(meta.revengeShieldRemaining > 0 ? 0xffd454 : meta.isParrying ? 0x00ffff : 0xffffff);
      shield.setScale(meta.shielded ? 0.9 + Math.sin(this._visualTime * 8) * 0.1 : 0.6);
      shield.alpha = meta.revengeShieldRemaining > 0 ? .8 : meta.invulnerable ? 0.65 + Math.sin(this._visualTime * 5) * 0.2 : 0.4;
      this._renderDrones(id, renderPos, meta, team);
    }

    _renderDrones(id, renderPos, meta, team) {
      const container = this._droneContainers.get(id);
      if (!container) return;
      const drones = renderPos.drones || [];
      while (container.list.length < drones.length) {
        container.add(this.add.image(0, 0, 'ship-' + team + '-1').setScale(0.18));
      }
      while (container.list.length > drones.length) container.last.destroy();
      for (let i = 0; i < drones.length; i++) {
        const sprite = container.list[i], drone = drones[i];
        sprite.x = drone.x - renderPos.x; sprite.y = drone.y - renderPos.y;
        sprite.rotation = drone.state === 'ATTACK' ? (drone.rotation || 0) + Math.PI / 2 : Math.atan2(sprite.y, sprite.x) + Math.PI / 2;
        sprite.setScale(drone.autonomous ? 0.28 : 0.18);
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
      this._trailQuotas.delete(id);
      const cont = this._playerSprites.get(id);
      if (cont && cont === this._cameraTarget) {
        this.cameras.main.stopFollow();
        this._cameraTarget = null;
      }
      if (cont) {
        const body = cont.getByName('body');
        if (body?._revengeTween) this.tweens.killTweensOf(body);
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
    try { input.value = localStorage.getItem('fleetio.name') || ''; } catch { input.value = ''; }
    const buttons = ['join-btn', 'create-room-btn', 'join-room-btn', 'singleplayer-btn'];
    const setJoining = busy => {
      C._joinPending = busy;
      for (const id of buttons) document.getElementById(id).disabled = busy;
    };
    const enter = (event, roomCode = '') => {
      if (C._joinPending) return;
      if (!C.socket || !C.connected) {
        setStatus(M('status.connecting'), 'connecting');
        return;
      }
      const name = input.value.trim() || I.t('pilot');
      try { localStorage.setItem('fleetio.name', name); } catch { /* Optional in-memory profile. */ }
      setJoining(true);
      setStatus(M('status.room'), 'connecting');
      C.socket.timeout(10000).emit(event, { name, roomCode }, (error, result) => {
        setJoining(false);
        if (error || !result?.ok) {
          setStatus(I.error(result?.error), 'error');
        }
      });
    };
    document.getElementById('join-btn').onclick = () => enter('joinRoom', 'public');
    document.getElementById('create-room-btn').onclick = () => enter('createPrivateRoom');
    document.getElementById('singleplayer-btn').onclick = () => enter('startSinglePlayer');
    document.getElementById('join-room-btn').onclick = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        setStatus(M('status.code'), 'error');
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
      setStatus(M('status.menu'), '');
    };
    document.getElementById('resume-btn').onclick = hideOverlay;
    document.getElementById('copy-room-btn').onclick = async () => {
      const code = C.room?.code;
      if (!code) return;
      const status = document.getElementById('room-copy-status');
      try {
        await navigator.clipboard.writeText(code);
        I.render(status, M('status.copied'));
      } catch {
        I.render(status, M('status.copyManual'));
      }
    };
    setTimeout(() => input.focus(), 100);
  }

  function updateRoomHUD(room) {
    const label = document.getElementById('hud-room');
    if (label) I.render(label, room
      ? M('room.info', { mode: M('room.' + (room.type === 'private' ? 'private' : room.type === 'singleplayer' ? 'solo' : 'public')), humans: room.humans, bots: room.bots })
      : M('room.none'));
    const codePanel = document.getElementById('room-code-panel');
    if (codePanel) codePanel.hidden = !room?.code;
    const code = document.getElementById('hud-room-code');
    if (code) I.render(code, room?.code || '');
    const count = document.getElementById('hud-players');
    if (count) I.render(count, String((room?.humans || 0) + (room?.bots || 0)));
    const status = document.getElementById('room-copy-status');
    if (status) I.render(status, '');
  }

  function setStatus(text, cls) {
    const s = document.getElementById('status');
    if (!s) return;
    s.className = 'status' + (cls ? ' ' + cls : '');
    I.render(s, text);
  }

  function hideOverlay() {
    C.menuOpen = false;
    const o = document.getElementById('overlay');
    if (o) o.classList.add('hidden');
    syncGameplayTracking();
  }

  function syncGameplayTracking() {
    const playing = C.connected && C.joined && !C.dead && !C.menuOpen && !C.mutationsOpen &&
      !document.querySelector?.('.feature-modal:not(.hidden)');
    window.AdManager?.[playing ? 'gameplayStart' : 'gameplayStop']?.();
  }

  function updateHUD() {
    const score = document.getElementById('hud-score');
    const scrap = document.getElementById('hud-scrap');
    const drones = document.getElementById('hud-drones');
    if (score && score.textContent !== String(C._score || 0)) I.render(score, String(C._score || 0));
    if (scrap && scrap.textContent !== String(C._scrap || 0)) I.render(scrap, String(C._scrap || 0));
    if (drones && drones.textContent !== `${C._drones || 0} / 12`) I.render(drones, `${C._drones || 0} / 12`);
    const hp = document.getElementById('hud-hp');
    const level = document.getElementById('hud-level');
    const bar = document.getElementById('hud-hp-bar');
    if (hp && hp.textContent !== `${C._hp}/${C._maxHp}`) I.render(hp, `${C._hp}/${C._maxHp}`);
    if (level && level.textContent !== String(C._level)) I.render(level, String(C._level));
    const progressNode = document.getElementById('hud-level-progress');
    if (progressNode && window.FleetProgression) {
      const text = C._level >= 40 ? M('level.max') : `${C._xp} / ${window.FleetProgression.requiredXP(C._level)} XP`;
      if (progressNode.textContent !== String(text)) I.render(progressNode, text);
    }
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
    I.render(document.getElementById('mutate-level'), String(level));
    for (const option of options) {
      const button = document.createElement('button');
      button.className = `mutate-option ${option.rarity === 'raro' ? 'raro' : ''}`;
      I.render(button, M('mutation.card', { icon: option.icon || '✦', name: M('mutation.' + option.type + '.name'), description: M('mutation.' + option.type + '.desc') }));
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
    const t = scene.add.text(pos.x, pos.y - 40, String(text), {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '14px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    I.render(t, text, 'phaserText');
    scene.tweens.add({
      targets: t,
      y: pos.y - 90,
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => { I.unbind(t); t.destroy(); },
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
    const name = escapeHtml((p.name || I.t('pilot')).slice(0, 16));
    const score = p.score || 0;
    const rankClass = rank <= 3 ? `r${rank}` : '';
    const medalGlyph = rank === 1 ? '1' : rank === 2 ? '2' : rank === 3 ? '3' : String(rank);
    const titles = rank <= 5 ? (p.titles || []).filter(title => ['Space Terror', 'Leviathan Slayer', 'Dominator', 'Space Pirate', 'Untouchable'].includes(title)) : [];
    const titleHTML = titles.length ? `<small class="lb-title">${escapeHtml(titles.map(title =>
      `${title === 'Space Terror' ? '☠' : title === 'Leviathan Slayer' ? '✦' : '♛'} ${I.t('title.' + title)}`).join(' · '))}</small>` : '';
    return `
      <span class="lb-rank ${rankClass}">${rank}.</span>
      <span class="lb-medal ${rankClass}">${medalGlyph}</span>
      <span class="lb-name" title="${name}">${name}${titleHTML}</span>
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
    I.render(badge, `+${delta}`);
    badge.classList.add('show');
    clearTimeout(badge._t);
    badge._t = setTimeout(() => badge.classList.remove('show'), 900);
  }

  // ------------------------------------------------------------------
  // Configuración y arranque de Phaser
  // ------------------------------------------------------------------
  async function bootPhaser() {
    await window.AdManager?.ready;
    const parent = document.getElementById('game');
    const config = window.FleetRenderer.config(parent, [BootScene, window.FleetUIScene, GameScene]);
    window.FleetRenderer.installMetrics();

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

  window.FleetGame = { boot: bootPhaser, GameScene, BootScene };
})();

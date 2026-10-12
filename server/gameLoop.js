// ============================================================================
// FLEET.IO - Game Loop Autoritativo (Servidor)
// Bucle a 30 TPS que procesa movimientos, colisiones y sincroniza estado
// ============================================================================

const TICK_RATE = 30;
const TICK_INTERVAL = 1000 / TICK_RATE;
// Keep collision/input simulation at 30Hz while bounding snapshot bandwidth.
const SNAPSHOT_RATE = 20;
const { updateCombat, resolveObstacles } = require('./combat');
const Network = require('../client/js/network');
const RPG = require('./rpg');
const { InterestGrid, SIZE } = require('./interest');
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
    this._rankRows = null;
    this.clientFrames = new Map();
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
    this.clientFrames.clear();
    this.keyframe = null;
    this._rankRows = null;
    this._snapshotAccumulator = 0;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _tick() {
    if(this.state.destroyed)return;
    this.tickCount++;

    this.state.competitive.update();
    this.state.hazards.update();
    this.state.environment?.update();
    this.state.powerups?.update();
    this._updatePlayers();
    this.state.impacts = [];
    this.state.swarm.update();
    updateCombat(this.state, this.tickCount);
    this.state.extraction?.update();
    this._processDeaths();
    this._updateScrap();
    this._checkScrapCollection();
    this._maybeSpawnScrap();
    this.state.engagement.update();
    this._processDeaths();
    this.state.events.update();
    this._flushProgression();
    // All movement, hazards, combat and boss damage precede extraction validation.
    this.state.extractionGates?.update();
    this.state.playerExtraction?.update(1/TICK_RATE);
    if(this.state.destroyed)return; // The last solo player may evacuate and destroy the room.
    for(const p of this.state.players.values()){
      const count=require('./droneCounts').activeDroneCount(p);
      if(p._sentDroneCount===count)continue;
      p._sentDroneCount=count;p.droneCountRevision=(p.droneCountRevision || 0)+1;
      if(!p.isBot){
        const n=p.toNetwork();this.io.to(p.id).emit('drones:count-update',{roomId:this.state.roomId,playerId:p.id,deathId:p.deathId,
          motionRevision:p.motionRevision || 0,revision:p.droneCountRevision,activeDroneCount:count,
          drones:n.drones,tacticalDrones:n.tacticalDrones,orbitalDrones:n.orbitalDrones});
      }
    }

    for (const p of this.state.players.values()) p.account?.observe(false);
    this._snapshotAccumulator=(this._snapshotAccumulator || 0)+SNAPSHOT_RATE;
    if(this._snapshotAccumulator>=TICK_RATE){this._snapshotAccumulator-=TICK_RATE;this._broadcastState();}
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
        if (!options.length) {player.levelUpPending=false;player.invulnerable=false;}
        else if (player.isBot) player.chooseUpgrade(options);
        else {
          player.upgradeOptions = options.map(option => option.type);
          this.io.to(player.id).emit('showLevelUpOptions', { roomId: this.state.roomId, deathId: player.deathId, level: player.level, options });
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
      if (player.levelUpPending || player.evolutionPending) continue;

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
            roomId: this.state.roomId, deathId: player.deathId,
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
            if (!options.length) {player.levelUpPending=false;player.invulnerable=false;continue;}
            if (player.isBot) player.chooseUpgrade(options);
            else {
              player.upgradeOptions = options.map(option => option.type);
              this.io.to(pid).emit('showLevelUpOptions', {
                roomId: this.state.roomId, deathId: player.deathId,
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

  requestSnapshot(id) { this.clientFrames.delete(id); }

  _broadcastState() {
    const king = Array.from(this.state.players.values()).filter(p => p.alive).sort((a, b) => b.score - a.score)[0];
    const playersPayload = Array.from(this.state.players.values(), p => Network.packPlayer(p,!p.account));
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
        [b.id, +b.x.toFixed(1), +b.y.toFixed(1), b.color, +Math.atan2(b.vy, b.vx).toFixed(4), b.motionRevision || 0, b.ownerId, +b.vx.toFixed(3), +b.vy.toFixed(3), b.fireSeq || 0, b.deathId || 0, b.sourceId || b.ownerId]),
      o: Array.from(this.state.obstacles.values()),
      i: this.state.impacts || [],
      kingId: king?.id || null,
      king: king ? { id: king.id, x: king.x, y: king.y } : null,
      w: this.state.events.snapshot(),
      competitive: this.state.competitive.snapshot(),
      hazards: this.state.hazards.snapshot(),
      engagement: this.state.engagement.snapshot(),
      powerups:this.state.powerups?.snapshot() || [], environment:this.state.environment?.snapshot() || [],
      resources:this.state.extraction?.snapshot() || [],
    };

    // Pack once, index once. Only small global rankings/event markers cross AOI.
    if(!this._rankRows || this.tickCount-(this._rankTick || 0)>=30) {
      this._rankTick=this.tickCount;
      const ranked=[...this.state.players.values()].sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
      this._rankRows=ranked.slice(0,10).map(p=>({id:p.id,name:p.name,score:p.score,titles:p.titles}));
      for(let i=0;i<ranked.length;i++){
        const p=ranked[i];if(p.isBot || p._sentRoomRank===i+1)continue;p._sentRoomRank=i+1;
        this.io.to(p.id).emit('room:rank',{roomId:this.state.roomId,playerId:p.id,rank:i+1,tick:this.tickCount});
      }
    }
    snapshot.leaderboard=this._rankRows;
    const grids = {
      p: new InterestGrid(snapshot.p, p => [p[1],p[2]]),
      s: new InterestGrid(snapshot.s, p => [p[1],p[2]]),
      b: new InterestGrid(snapshot.b, p => [p[1],p[2]]),
      o: new InterestGrid(snapshot.o),
      i: new InterestGrid(snapshot.i, p => [p[1],p[2]]),
      g: new InterestGrid(snapshot.w.g || [], p => [p[1],p[2]]),
    };
    const sectorPackets = new Map(), humans = new Set();
    const baselines = new Map(), deltas = new WeakMap();
    for (const pilot of this.state.players.values()) {
      if (pilot.isBot) continue;
      humans.add(pilot.id);
      const sector = `${Math.floor(pilot.x/SIZE)}:${Math.floor(pilot.y/SIZE)}`;
      const reach = !pilot.radiation && (pilot.attributes.vision || 0) > 0 ? 2 : 1;
      const cacheKey = `${sector}:${reach}`;
      let current = sectorPackets.get(cacheKey);
      if (!current) {
        current = {...snapshot, aoi:sector, w:{...snapshot.w},gems:grids.g.query(pilot.x,pilot.y,reach)};
        delete current.w.g; // Gem changes use the same loss-tolerant delta protocol.
        for (const key of ['p','s','b','o','i']) current[key]=grids[key].query(pilot.x,pilot.y,reach);
        const cx=(Math.floor(pilot.x/SIZE)+.5)*SIZE,cy=(Math.floor(pilot.y/SIZE)+.5)*SIZE;
        const nearby=(row,padding=0)=>Math.abs(row[1]-cx)<=(reach+.5)*SIZE+padding && Math.abs(row[2]-cy)<=(reach+.5)*SIZE+padding;
        current.powerups=snapshot.powerups.filter(row=>nearby(row));
        current.resources=snapshot.resources.filter(row=>nearby(row));
        current.environment=snapshot.environment.filter(row=>nearby(row,row[3]));
        sectorPackets.set(cacheKey,current);
      }
      const rival = this.state.players.get(pilot.nemesisId);
      current = {...current, nemesis: rival?.alive ? {id:rival.id,name:rival.name,x:rival.x,y:rival.y,hp:rival.hp} : null};
      const previous = this.clientFrames.get(pilot.id);
      // A reliable fresh baseline on each sector transition avoids delta holes.
      if (!previous || previous.aoi !== sector || current.t-previous.t >= 30) {
        let shared=baselines.get(cacheKey);
        if(!shared){shared=JSON.parse(JSON.stringify({...current,keyframe:current.t}));baselines.set(cacheKey,shared);}
        const baseline = {...shared,nemesis:current.nemesis};
        this.clientFrames.set(pilot.id,baseline);
        this.io.to(pilot.id).emit('gameState',baseline);
      } else {
        let cache=deltas.get(previous.p);if(!cache){cache=new WeakMap();deltas.set(previous.p,cache);}
        let packet=cache.get(current.p);
        if(!packet){packet=Network.delta(previous,current);cache.set(current.p,packet);}
        this.io.to(pilot.id).volatile.emit('gameState',{...packet,nemesis:current.nemesis});
      }
    }
    for (const id of this.clientFrames.keys()) if (!humans.has(id)) this.clientFrames.delete(id);

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
  const shuffled = pool.slice();
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  return shuffled.slice(0, count).map((u) => ({
    type: u.type,
    icon: u.icon,
    name: u.name,
    desc: u.desc,
    rarity: u.rarity,
  }));
}

module.exports = { GameLoop, TICK_RATE, TICK_INTERVAL, generateRandomUpgrades, UPGRADE_CATALOG };

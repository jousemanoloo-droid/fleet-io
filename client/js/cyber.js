(function (global) {
  'use strict';
  const I = window.FleetI18n, M = I.m;
  const registered = new WeakSet();
  class Chromatic extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
      super({ game, renderTarget: true, fragShader: `precision mediump float;
        uniform sampler2D uMainSampler; uniform float amount;
        varying vec2 outTexCoord;
        void main(){ vec2 uv=outTexCoord; vec2 shift=(uv-.5)*amount;
          vec4 original=texture2D(uMainSampler,uv);
          gl_FragColor=vec4(texture2D(uMainSampler,clamp(uv+shift,0.,1.)).r,
            original.g,texture2D(uMainSampler,clamp(uv-shift,0.,1.)).b,original.a); }` });
      this.amount = 0;
    }
    onPreRender() { this.set1f('amount', this.amount); }
  }
  class Cyber {
    constructor(scene, C) {
      this.scene = scene; this.C = C; this.emitAt = 0; this.densityAt = 0; this.targetZoom = 1.2;
      this.pending = false; this.pendingRequest = null; this.cooldownUntil = 0; this.lastImpact = -Infinity;
      const camera = scene.cameras.main;
      // One camera bloom pass shares render targets across all luminous entities.
      this.bloom = camera.postFX.addBloom(0xffffff, 1, 1, 1.2, 1.35, 2);
      if (!registered.has(scene.game)) {
        registered.add(scene.game);
        scene.game.renderer.pipelines.addPostPipeline('FleetChromatic', Chromatic);
      }
      camera.setPostPipeline('FleetChromatic');
      this.chromatic = camera.getPostPipeline('FleetChromatic');
      this.gridTexture();
      this.grid = scene.add.tileSprite(0, 0, 1, 1, 'cyber-grid').setScrollFactor(0).setDepth(-7).setAlpha(0.28);
      this.trail = scene.add.particles(0, 0, 'fleet-plasma', { emitting: false, lifespan: 240,
        speed: { min: 0, max: 24 }, scale: { start: 0.38, end: 0 }, alpha: { start: 0.95, end: 0 },
        tint: [0x00ffff, 0xff37d7], blendMode: Phaser.BlendModes.ADD, maxParticles: 256, maxAliveParticles: 256 }).setDepth(4);
      this.button = document.createElement('button'); this.button.className = 'blitz-button';
      I.render(this.button, M('ability.swarm')); this.button.onclick = () => this.launch();
      document.body.append(this.button);
      this.key = event => { if (!event.repeat) this.launch(); };
      scene.input.keyboard.on('keydown-E', this.key);
      this.audio = new Audio('assets/audio/drone_launch.wav'); this.audio.preload = 'auto'; this.audio.volume = 0.25;
      this.handlers = {
        DRONE_STATE_SYNC: data => {
          if (data.roomId !== C.room?.roomId || C.playerStates.get(data.playerId)?.deathId !== data.deathId) return;
          if (data.playerId === C.myId) {
            this.cooldownUntil = performance.now() + data.cooldown;
            if (data.launched && !C.dead && !global.AdManager?.busy && !scene._features?.muted && !scene.sound?.mute) {
              this.audio.currentTime = 0; this.audio.play().catch(() => {});
            }
          }
          // Positions interpolate through normal snapshots; only update visual state.
          const states = new Map(data.drones.map(d => [d.id, d.state]));
          for (const d of C.renderState.get(data.playerId)?.drones || []) if (states.has(d.id)) d.state = states.get(d.id);
        },
        death_fx: data => { if (data.roomId === C.room?.roomId && data.killerId === C.myId) this.impact(); },
        welcome: () => { scene._decoder.reset(); this.reset(); }, disconnect: () => this.reset(), roomLeft: () => this.reset(),
      };
      for (const [event, handler] of Object.entries(this.handlers)) C.socket.on(event, handler);
      scene.events.once('shutdown', () => this.destroy());
    }
    gridTexture() {
      if (this.scene.textures.exists('cyber-grid')) return;
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      for (let y = 0, step = 10; y < 512; y += step, step *= 1.16) {
        g.lineStyle(1, y < 180 ? 0xe51bff : 0x00eaff, 0.7).lineBetween(0, y, 512, y);
      }
      for (let x = -512; x <= 1024; x += 64) {
        g.lineStyle(1, 0x00dfff, 0.65).lineBetween(256 + (x - 256) * 0.15, 0, x, 512);
      }
      g.generateTexture('cyber-grid', 512, 512); g.destroy();
    }
    launch() {
      const C = this.C, me = C.playerStates.get(C.myId), focus = document.activeElement;
      if (this.pending || !C.joined || !C.connected || C.dead || C.menuOpen || C.mutationsOpen ||
          this.scene._features?.blocking || global.AdManager?.busy || focus?.matches('input,textarea') ||
          performance.now() < this.cooldownUntil || !me) return;
      const roomId = C.room?.roomId, deathId = me.deathId;
      this.pending = true;
      const request = {}; this.pendingRequest = request;
      C.socket.timeout(5000).emit('TRIGGER_DRONE_SWARM', { roomId, deathId }, (error, result) => {
        if (this.pendingRequest !== request) return;
        this.pending = false; this.pendingRequest = null;
        if (roomId !== C.room?.roomId || deathId !== C.playerStates.get(C.myId)?.deathId) return;
        if (!error && result) this.cooldownUntil = performance.now() + result.cooldown;
      });
    }
    impact(now = performance.now()) {
      if (now - this.lastImpact < 150 || this.C.dead || this.C.menuOpen) return;
      this.lastImpact = now; this.scene._hitStopUntil = now + 30;
      this.scene.cameras.main.shake(150, 0.015);
    }
    update(now, delta, frozen) {
      this.adaptQuality(now, delta);
      const camera = this.scene.cameras.main, C = this.C;
      this.scene.tweens.timeScale = frozen ? 0 : 1;
      for (const object of this.scene.children.list) if (object.type === 'ParticleEmitter') object.timeScale = frozen ? 0 : 1;
      this.chromatic.amount = Math.max(0, 1 - (now - this.lastImpact) / 150) * 0.035;
      if (now >= this.densityAt) {
        this.densityAt = now + 100;
        let count = 0;
        for (const p of C.renderState.values()) if (camera.worldView.contains(p.x, p.y)) count += 1 + p.drones.length * 0.15;
        for (const rock of this.scene._obstacles) if (camera.worldView.contains(rock.x, rock.y)) count += rock.gold ? 2 : 0.5;
        this.targetZoom = 1.2 - 0.45 * Math.min(1, Math.max(0, count - 1) / 15);
      }
      if (!frozen) camera.setZoom(camera.zoom + (this.targetZoom - camera.zoom) * (1 - Math.exp(-Math.min(delta, 100) / 300)));
      this.scene.game?.events.emit('camera_zoom_updated', camera.zoom);
      this.grid.setVisible(!C.dead && !C.menuOpen).setPosition(camera.width / 2, camera.height / 2)
        .setSize(camera.width / camera.zoom, camera.height / camera.zoom);
      this.grid.tilePositionX = camera.scrollX * 0.15;
      this.grid.tilePositionY = camera.scrollY * 0.12;
      if (!frozen && now >= this.emitAt) {
        this.emitAt = now + 40;
        let budget = 32;
        for (const p of C.renderState.values()) for (const d of p.drones) {
          if (d.state === 'ATTACK' && budget > 0 && this.scene._effectVisible(d.x, d.y)) {
            this.trail.emitParticleAt(d.x, d.y, 2); budget--;
          }
        }
      }
      const me = C.playerStates.get(C.myId);
      if (!me?.hp) { this.cooldownUntil = 0; this.pending = false; this.pendingRequest = null; }
      else this.cooldownUntil = Math.max(this.cooldownUntil, (me.receivedAt || now) + (me.swarmCooldown || 0));
      const remaining = Math.max(0, this.cooldownUntil - now);
      this.button.hidden = !C.joined || C.dead || C.menuOpen;
      this.button.disabled = this.pending || remaining > 0;
      this.button.style.setProperty('--cooldown', `${remaining / 8000 * 360}deg`);
      I.render(this.button, remaining > 0 ? M('ability.swarmCooldown', { seconds: Math.ceil(remaining / 1000) }) : M('ability.swarm'));
    }
    adaptQuality(now, delta) {
      if (!this.scene.game || document.hidden || delta>150) return;
      this.qualityFrames=(this.qualityFrames||0)+1; this.qualityTime=(this.qualityTime||0)+delta;
      if (this.qualityTime<2000) return;
      const fps=this.qualityFrames*1000/this.qualityTime;
      this.qualityFrames=this.qualityTime=0;
      const camera=this.scene.cameras.main;
      if (fps<50 && !this.reducedFX) {
        camera.postFX.remove(this.bloom); camera.removePostPipeline('FleetChromatic');
        this.reducedFX=true; this.qualityRetry=now+20000;
      } else if (this.reducedFX && fps>=58 && now>=this.qualityRetry) {
        this.bloom=camera.postFX.addBloom(0xffffff,1,1,1.2,1.35,2);
        camera.setPostPipeline('FleetChromatic'); this.chromatic=camera.getPostPipeline('FleetChromatic');
        this.reducedFX=false;
      }
    }
    idle() { this.button.hidden = true; this.grid.setVisible(false); this.scene.tweens.timeScale = 1; this.chromatic.amount = 0;
      for (const object of this.scene.children.list) if (object.type === 'ParticleEmitter') object.timeScale = 1; }
    reset() {
      this.pending = false; this.pendingRequest = null; this.cooldownUntil = 0; this.lastImpact = -Infinity;
      this.scene._hitStopUntil = 0; this.trail.killAll(); this.audio.pause(); this.audio.currentTime = 0;
      this.idle();
    }
    destroy() {
      this.reset();
      for (const [event, handler] of Object.entries(this.handlers)) this.C.socket.off(event, handler);
      this.scene.input.keyboard.off('keydown-E', this.key);
      this.button.remove(); this.trail.destroy(); this.grid.destroy();
      this.scene.cameras.main.postFX.remove(this.bloom);
      this.scene.cameras.main.removePostPipeline('FleetChromatic');
    }
  }
  global.FleetCyber = { Cyber };
})(window);

(function (global) {
  'use strict';
  const I = global.FleetI18n, M = I.m;
  class Engagement {
    constructor(scene, C) {
      this.scene = scene; this.C = C; this.handlers = {}; this.lastUI = this.lastParticles = 0;
      this.lastOverdriveFX = -Infinity; this.phase = null; this.contract = null;
      this.card = document.createElement('div'); this.card.className = 'contract-card'; this.card.hidden = true;
      this.heading = document.createElement('strong'); this.detail = document.createElement('span');
      this.timer = document.createElement('span'); this.timer.className = 'contract-timer';
      this.card.append(this.heading, this.detail, this.timer);
      this.warning = document.createElement('div'); this.warning.className = 'frenzy-warning'; this.warning.hidden = true;
      document.body.append(this.card, this.warning);
      this.zone = scene.add.graphics().setDepth(0).setVisible(false);
      this.zone.fillStyle(0xff326c, .08).fillCircle(0, 0, 400).lineStyle(4, 0xff466e, .7).strokeCircle(0, 0, 400);
      this.core = scene.add.image(0, 0, 'energy-core').setTint(0xff6699).setDepth(3).setScale(2.5).setVisible(false);
      this.electric = scene.add.particles(0, 0, 'fleet-plasma', { emitting: false, lifespan: 350, speed: { min: 35, max: 80 },
        scale: { start: .65, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xff205d, 0xff83af], blendMode: 'ADD', maxParticles: 96 }).setDepth(5);
      this.plasma = scene.add.particles(0, 0, 'xp-gem', { emitting: false, lifespan: 400, speed: 180,
        scale: { start: .35, end: 0 }, alpha: { start: .8, end: 0 }, tint: [0xffca55, 0x00ffff], blendMode: 'ADD', maxParticles: 96 }).setDepth(4);
      this.skinTrails = new Map();
      for (const [skin, color] of [['cyber', 0x00ffff], ['void', 0xac66ff], ['solar', 0xffad32]]) {
        const key = 'skin-trail-' + skin;
        if (!scene.textures.exists(key)) {
          const g = scene.make.graphics({ x: 0, y: 0 }, false);
          g.lineStyle(2, 0xffffff, .9);
          if (skin === 'void') g.strokeCircle(12, 12, 8);
          else if (skin === 'cyber') g.lineBetween(4, 19, 12, 10).lineBetween(12, 10, 8, 10).lineBetween(8, 10, 19, 4);
          else g.fillStyle(0xffffff).fillTriangle(12, 2, 4, 20, 20, 20);
          g.generateTexture(key, 24, 24); g.destroy();
        }
        this.skinTrails.set(skin, scene.add.particles(0, 0, key, { emitting: false, lifespan: skin === 'void' ? 450 : 300,
          speed: { min: 5, max: 25 }, scale: { start: .5, end: 0 }, alpha: { start: .8, end: 0 }, tint: color,
          blendMode: 'ADD', maxParticles: 64 }).setDepth(3));
      }
      const on = (name, fn) => {
        const handler = data => { if (name === 'welcome' || name === 'disconnect' || data?.roomId === C.room?.roomId) fn(data); };
        this.handlers[name] = handler; C.socket.on(name, handler);
      };
      on('welcome', () => this.reset()); on('disconnect', () => this.reset());
      on('contract_progress', data => this.setContract(data));
      on('contract_complete', data => {
        if (data.deathId !== C.deathId || this.completedId === data.id) return;
        this.completedId = data.id; this.setContract(data);
        scene._features.announce(M('contract.reward', { xp: data.xp, credits: data.credits }), '#ffda6a', 28);
        scene.cameras.main.flash(180, 30, 200, 180, false);
        for (const pitch of [1, 1.5, 2]) scene._retention?.tone(pitch, .45);
      });
      on('supernova_warning', data => this.setPhase(data));
      on('supernova_frenzy', data => this.setPhase(data));
      on('supernova_frenzy_end', () => this.setPhase(null));
      on('overdrive_activate', data => { if (data.id === C.myId && data.deathId === C.deathId) this.overdriveFX(); });
      scene.events.once('shutdown', () => this.destroy());
    }
    setContract(data) {
      if (data?.deathId !== this.C.deathId) return;
      this.contract = data; this.contractAt = performance.now();
    }
    setPhase(data) {
      const key = data ? `${data.phase}:${data.ends}` : '';
      if (key !== this.phaseKey && data?.phase === 'WARNING') this.scene._retention?.tone(.4, .8);
      this.phaseKey = key; this.phase = data; this.phaseAt = performance.now();
    }
    snapshot(snap) {
      this.setPhase(snap.engagement || null);
      const me = snap.p?.find(p => p.id === this.C.myId);
      if (me?.contract) this.setContract(me.contract); else this.contract = null;
    }
    overdriveFX() {
      const now = performance.now(); if (now - this.lastOverdriveFX < 8000) return;
      this.lastOverdriveFX = now;
      this.scene.cameras.main.shake(100, .005);
      this.scene._features.announce(M('overdrive.active'), '#ff467d', 30);
      if (!global.AdManager?.busy && !this.scene.sound.mute && !this.scene._features.muted && this.scene.cache.audio.exists('overdrive-activate'))
        this.scene.sound.play('overdrive-activate', { volume: .3 });
    }
    update(now) {
      const C = this.C, active = C.joined && !C.dead && !C.menuOpen, me = C.playerStates.get(C.myId);
      const remaining = Math.max(0, (me?.overdriveRemaining || 0) - (now - (me?.receivedAt || now)));
      if (active && remaining) this.overdriveFX();
      // Reuse the existing full-screen vignette; no extra post-processing pass.
      if (active && remaining && this.scene._retention) this.scene._retention.vignette.setAlpha(.2 + Math.sin(now / 85) * .12);
      else if (this.wasOverdrive && !this.scene._retention?.pulse) this.scene._retention?.vignette.setAlpha(0);
      this.wasOverdrive = !!(active && remaining);
      const phase = this.phase, visible = active && phase && phase.remaining > now - this.phaseAt;
      this.warning.hidden = !visible || phase.phase !== 'WARNING';
      this.zone.setVisible(!!visible); this.core.setVisible(!!visible && phase.phase === 'ACTIVE');
      if (visible) {
        this.zone.setPosition(phase.x, phase.y).setScale(1 + Math.sin(now / 180) * .025).setAlpha(.5 + Math.sin(now / 160) * .25);
        this.core.setPosition(phase.x, phase.y).setRotation(now / 450).setScale(2.5 + Math.sin(now / 100) * .15);
      }
      if (now - this.lastParticles >= 50 && active) {
        this.lastParticles = now; let count = 0;
        for (const [id, pos] of C.renderState) {
          if (count >= 12 && id !== C.myId) continue;
          const p = C.playerStates.get(id); if (!p?.hp || !this.scene._effectVisible(pos.x, pos.y)) continue;
          count++;
          if (p.overdriveRemaining > 0) {
            this.electric.setEmitterAngle((pos.rotation || 0) * 180 / Math.PI + 180);
            this.electric.emitParticleAt(pos.x - Math.cos(pos.rotation || 0) * 24, pos.y - Math.sin(pos.rotation || 0) * 24, 2);
          }
          const trail = this.skinTrails.get(p.equippedSkin || p.skin);
          if (trail && Math.hypot(p.vx, p.vy) > .3) {
            trail.setEmitterAngle((pos.rotation || 0) * 180 / Math.PI + 180);
            trail.emitParticleAt(pos.x - Math.cos(pos.rotation || 0) * 26, pos.y - Math.sin(pos.rotation || 0) * 26, 1);
          }
          if (visible && phase.phase === 'ACTIVE' && Math.hypot(pos.x - phase.x, pos.y - phase.y) < phase.radius) {
            const a = Math.random() * Math.PI * 2, x = pos.x + Math.cos(a) * 65, y = pos.y + Math.sin(a) * 65;
            this.plasma.setEmitterAngle((a * 180 / Math.PI + 180) % 360); this.plasma.emitParticleAt(x, y, 2);
          }
        }
      }
      if (now - this.lastUI < 100) return; this.lastUI = now;
      const c = this.contract, left = c ? Math.max(0, c.remaining - (now - this.contractAt)) : 0;
      this.card.hidden = !active || !c || !left;
      if (c) {
        I.render(this.heading, M('contract.title'));
        I.render(this.detail, M('contract.' + c.type, { progress: c.progress, goal: c.goal }));
        I.render(this.timer, c.status === 'ACTIVE' ? M('contract.timer', { seconds: Math.ceil(left / 1000) }) : M('contract.' + c.status));
        this.timer.style.setProperty('--timer', `${left / c.duration * 360}deg`);
      }
      I.render(this.warning, M('frenzy.warning'));
    }
    reset() {
      this.contract = this.phase = null; this.phaseKey = ''; this.completedId = null; this.lastOverdriveFX = -Infinity;
      this.card.hidden = this.warning.hidden = true; this.zone.setVisible(false); this.core.setVisible(false);
      this.plasma.killAll(); this.electric.killAll();
      for (const emitter of this.skinTrails.values()) emitter.killAll();
    }
    destroy() {
      this.reset(); for (const [name, handler] of Object.entries(this.handlers)) this.C.socket.off(name, handler);
      for (const node of [this.heading, this.detail, this.timer, this.warning]) I.unbind(node);
      this.card.remove(); this.warning.remove(); this.zone.destroy(); this.core.destroy(); this.electric.destroy(); this.plasma.destroy();
      for (const emitter of this.skinTrails.values()) emitter.destroy(); this.skinTrails.clear();
    }
  }
  global.FleetEngagement = { Engagement };
})(window);

// Eventos de mundo y metajuego. El servidor decide premios/colisiones;
// este módulo interpola sus objetos y presenta efectos sin alterar la física.
(function (global) {
  'use strict';
  const I = window.FleetI18n, M = I.m;
  class Retention {
    constructor(scene, state) {
      this.scene = scene; this.C = state; this.world = { g: [], c: [], q: [], boss: null };
      this.objects = new Map(); this.pool = []; this.indicators = new Map(); this.handlers = {};
      this.comboPickupCount = 0; this.lastPickup = 0; this.voices = 0; this.fxSeen = new Set();
      this.timed = new Set(); this.textPool = []; this.activeTexts = new Set(); this.lastAura = 0;
      this.fxPool = []; this.spirals = new Set();
      this.rewards = new Map(); this.lastRewardFlush = 0;
      this.textures(); this.buildUI(); this.bind();
      scene.events.once('shutdown', () => this.destroy());
    }
    get features() { return this.scene._features; }
    textures() {
      const make = (key, size, draw) => {
        if (this.scene.textures.exists(key)) return;
        const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
        draw(g, size / 2); g.generateTexture(key, size, size); g.destroy();
      };
      make('xp-gem', 24, (g, c) => {
        g.fillStyle(0x35ffcc, 0.15).fillCircle(c, c, 12);
        g.fillStyle(0x83ffee).fillPoints([{ x: c, y: 3 }, { x: 19, y: c }, { x: c, y: 21 }, { x: 5, y: c }], true);
        g.lineStyle(1, 0xffffff).lineBetween(c, 4, c, 16);
      });
      make('energy-core', 64, (g, c) => {
        g.fillStyle(0xffc64b, 0.12).fillCircle(c, c, 31);
        g.lineStyle(4, 0xffd367).strokeCircle(c, c, 22);
        g.lineStyle(2, 0xffffff).strokeCircle(c, c, 14);
        g.fillStyle(0xffeaa8).fillCircle(c, c, 7);
      });
      make('neon-stencil', 128, (g, c) => {
        g.lineStyle(4, 0xff3bde).strokeTriangle(20, 20, 110, 64, 20, 108);
        g.lineStyle(3, 0x21eaff).strokeCircle(c, c, 48);
        g.lineBetween(35, 50, 90, 78).lineBetween(35, 78, 90, 50);
      });
      make('dark-void', 128, (g, c) => {
        g.fillStyle(0x2c135a, 0.25).fillCircle(c, c, 62);
        g.lineStyle(5, 0x9145cf, 0.8).strokeCircle(c, c, 48);
        g.fillStyle(0x010108).fillCircle(c, c, 45);
        g.lineStyle(2, 0x592f96, 0.8).strokeEllipse(c, c, 100, 48);
      });
      this.vignette = this.scene._ui.lowHpVignette;
      this.ice = this.scene.add.particles(0, 0, 'xp-gem', { emitting: false, lifespan: 650,
        speed: { min: 80, max: 220 }, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
        tint: 0x88cfff, blendMode: 'ADD', maxParticles: 160 }).setDepth(10);
      this.gold = this.scene.add.particles(0, 0, 'fleet-plasma', { emitting: false, lifespan: 400,
        speed: { min: 10, max: 30 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.8, end: 0 },
        tint: 0xffd050, blendMode: 'ADD', maxParticles: 100 }).setDepth(2);
    }
    buildUI() {
      this.banner = document.createElement('div'); this.banner.className = 'world-banner'; this.banner.setAttribute('role', 'status');
      this.bossBar = document.createElement('div'); this.bossBar.className = 'world-boss'; this.bossBar.hidden = true;
      this.bossLabel = document.createElement('span'); this.bossFill = document.createElement('progress');
      this.bossFill.max = 12000; this.bossBar.append(this.bossLabel, this.bossFill);
      document.body.append(this.banner, this.bossBar);
    }
    bind() {
      const on = (event, handler) => {
        const wrapped = data => {
          if (event === 'welcome' || event === 'disconnect' || data?.roomId === this.C.room?.roomId) handler(data);
        };
        this.handlers[event] = wrapped; this.C.socket.on(event, wrapped);
      };
      on('gem_collected', () => this.pickup());
      on('scrapCollected', () => this.pickup());
      on('core_collected', data => {
        this.pickup(); if (data.recovered) { this.features.announce(M('world.recovered'), '#ffd76c', 30); this.tone(2, 0.35); }
      });
      on('coin_reward', data => this.reward(data));
      on('profile_unlock', data => this.features.economy.unlockTitle(data.title));
      on('NARROW_ESCAPE', data => this.escape(data));
      on('BOUNTY_ANNOUNCEMENT', data => this.notify(M('world.bounty', { name: data.targetUsername })));
      on('BOUNTY_CLAIMED', data => this.features.announce(M('world.bountyClaimed', { name: data.username }), '#ffd56a', 30));
      on('METEOR_WARN', data => this.notify(M('world.meteorWarn', { seconds: Math.ceil(data.inMs / 1000) }), 15000, 2));
      on('METEOR_START', () => this.notify(M('world.meteor'), 7000));
      on('BOSS_SPAWN', data => this.notify(M('world.bossLocation',{x:Math.round(data.x || 0),y:Math.round(data.y || 0)}), 8000));
      on('BOSS_DEFEATED', data => { this.features.announce(M('world.bossDefeated', { name: data.username }), '#ffd56a', 30); this.ice.emitParticleAt(data.x, data.y, 40); });
      on('asteroid_destroyed', data => { if (this.scene._effectVisible(data.x, data.y)) this.gold.emitParticleAt(data.x, data.y, 20); });
      on('death_fx', data => this.killFX(data));
      on('welcome', () => this.reset());
      on('disconnect', () => this.reset());
      this.pageHideHandler = () => this.flushRewards();
      global.addEventListener('pagehide', this.pageHideHandler);
    }
    reward(data) {
      if (typeof data.id !== 'string' || !Number.isSafeInteger(data.coins) || data.coins < 0) return;
      this.rewards.set(data.id, { ...data, roomId: this.C.room?.roomId });
    }
    flushRewards() {
      if (!this.rewards.size) return;
      const rewards = [...this.rewards.values()]; this.rewards.clear();
      this.features.economy.creditBatch(rewards); this.features.currency();
      for (const reward of rewards) this.C.socket.emit('ackCoinReward', { id: reward.id, roomId: reward.roomId });
    }
    sync(me) {
      for (const reward of me.coinRewards || []) this.reward(reward);
      for (const title of me.titles || []) this.features.economy.unlockTitle(title);
      const low = me.hp > 0 && me.hp / me.maxHp < 0.1 && !me.overdriveRemaining;
      if (low && !this.pulse) {
        this.vignette.alpha = 0.2;
        this.pulse = this.scene.tweens.add({ targets: this.vignette, alpha: 0.6, duration: 450, yoyo: true, repeat: -1 });
      } else if (!low && this.pulse) this.stopPulse();
    }
    stopPulse() { this.pulse?.stop(); this.pulse = null; this.vignette.alpha = 0; }
    snapshot(snapshot) {
      const world = snapshot.w || {};
      this.world = { ...world, g: world.g || [], c: world.c || [], q: world.q || [], boss: world.boss || null };
      if (this.world.meteorIn <= 15000 && this.world.meteorIn > 0 && !this.banner.textContent)
        this.notify(M('world.meteorWarn', { seconds: Math.ceil(this.world.meteorIn / 1000) }), this.world.meteorIn, 2);
    }
    notify(text, duration = 5000, priority = 0) {
      const now = performance.now();
      if (now < this.bannerUntil && priority < (this.bannerPriority || 0)) return;
      I.render(this.banner, text); this.bannerUntil = now + duration; this.bannerPriority = priority;
    }
    pickup() {
      const now = performance.now();
      if (now - this.lastPickup > 1500) this.comboPickupCount = 0;
      this.lastPickup = now; this.comboPickupCount++;
      this.tone(Math.min(2.2, 1 + this.comboPickupCount * 0.05), 0.09);
    }
    tone(pitch, duration) {
      const features = this.features;
      if (features.muted || this.scene.sound?.mute || global.AdManager?.busy || this.voices >= 6) return;
      try {
        const Audio = global.AudioContext || global.webkitAudioContext; if (!Audio) return;
        features.audio ||= new Audio(); const context = features.audio;
        context.resume().catch(() => {});
        const oscillator = context.createOscillator(), gain = context.createGain(); this.voices++;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(480 * pitch, context.currentTime);
        gain.gain.setValueAtTime(0.025, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration);
        oscillator.onended = () => { this.voices--; oscillator.disconnect(); gain.disconnect(); };
      } catch { /* Audio bloqueado: mantener intacta la recogida autoritativa. */ }
    }
    escape(data) {
      this.slowUntil = performance.now() + 500;
      this.floatText(data.x, data.y, M('world.escape')); this.tone(2.2, 0.3);
    }
    floatText(x, y, message) {
      if (this.activeTexts.size >= 12) return;
      const text = this.textPool.pop() || this.scene.add.text(0, 0, '', { fontFamily: 'system-ui', fontSize: '24px',
        fontStyle: 'bold', color: '#ffe1a0', stroke: '#a36e09', strokeThickness: 5 }).setOrigin(0.5).setDepth(100);
      I.render(text, message, 'phaserText');
      text.setPosition(x, y - 40).setAlpha(1).setScale(0.2).setVisible(true);
      this.activeTexts.add(text);
      this.scene.tweens.add({ targets: text, scale: 1, y: y - 100, duration: 650, ease: 'Back.Out',
        onComplete: () => this.scene.tweens.add({ targets: text, alpha: 0, duration: 400,
          onComplete: () => { this.activeTexts.delete(text); I.unbind(text); text.setVisible(false); this.textPool.push(text); } }) });
    }
    // Pool común: las gemas y los núcleos reutilizan imágenes, no crean emisores
    // ni Graphics por frame. Desaparecer de un snapshot devuelve la imagen al pool.
    object(id, x, y, texture, scale, delta) {
      let image = this.objects.get(id);
      if (!image) {
        image = this.pool.pop() || this.scene.add.image(x, y, texture).setDepth(4);
        image.setPosition(x, y).setTexture(texture); this.objects.set(id, image);
      }
      const lerp = 1 - Math.exp(-delta / 45);
      image.x += (x - image.x) * lerp; image.y += (y - image.y) * lerp;
      image.setScale(scale).setVisible(this.scene._effectVisible(image.x, image.y, 100));
      return image;
    }
    indicator(id, target, label, color, always, now) {
      let node = this.indicators.get(id);
      if (!node) {
        node = document.createElement('div'); node.className = 'world-indicator';
        const arrow = document.createElement('span'), caption = document.createElement('small');
        node.append(arrow, caption); document.body.append(node); this.indicators.set(id, node);
      }
      const camera = this.scene.cameras.main, width = this.scene.scale.width, height = this.scene.scale.height;
      const sx = (target.x - camera.worldView.x) * camera.zoom, sy = (target.y - camera.worldView.y) * camera.zoom;
      const dx = sx - width / 2, dy = sy - height / 2;
      const factor = Math.min(Math.max(1, width / 2 - 60) / Math.max(1, Math.abs(dx)),
        Math.max(1, height / 2 - 65) / Math.max(1, Math.abs(dy)));
      node.hidden = this.C.dead || this.C.menuOpen || (!always && factor >= 1);
      node.style.left = `${width / 2 + dx * factor}px`; node.style.top = `${height / 2 + dy * factor}px`;
      node.style.color = color; node.style.opacity = String(always ? 0.65 + Math.sin(now / 150) * 0.3 : 1);
      I.render(node.firstChild, always ? '☠' : '➤');
      node.firstChild.style.transform = always ? '' : `rotate(${Math.atan2(dy, dx)}rad)`;
      const p = this.C.renderState.get(this.C.myId);
      I.render(node.lastChild, M('world.distance', { label, distance: Math.floor(Math.hypot(target.x - (p?.x || 0), target.y - (p?.y || 0)) / 10) }));
    }
    update(now, delta) {
      if (now - this.lastRewardFlush >= 100) { this.lastRewardFlush = now; this.flushRewards(); }
      if (now - this.lastPickup > 1500) this.comboPickupCount = 0;
      if (now > this.bannerUntil) I.render(this.banner, '');
      for (const spiral of this.spirals) {
        const fraction = Math.min(1, (now - spiral.start) / 700);
        spiral.images.forEach((image, index) => {
          const angle = index / spiral.images.length * Math.PI * 2 + fraction * Math.PI * 4;
          image.setPosition(spiral.x + Math.cos(angle) * 65 * (1 - fraction),
            spiral.y + Math.sin(angle) * 65 * (1 - fraction)).setAlpha(1 - fraction);
        });
        if (fraction === 1) {
          for (const image of spiral.images) this.releaseFX(image); this.spirals.delete(spiral);
        }
      }
      const active = new Set();
      for (const [id, x, y, xp, coins] of this.world.g) {
        active.add(id); this.object(id, x, y, 'xp-gem', coins ? 0.9 : 0.7, delta).setTint(coins ? 0xffd050 : 0xffffff);
      }
      const arrows = new Set();
      for (const [id, owner, x, y] of this.world.c) {
        active.add(id); this.object(id, x, y, 'energy-core', 0.8 + Math.sin(now / 200) * 0.1, delta).clearTint();
        if (owner === this.C.myId) { arrows.add(id); this.indicator(id, { x, y }, M('world.core'), '#ffcf55', false, now); }
      }
      for (const [id, name, x, y] of this.world.q) if (id !== this.C.myId) {
        const key = 'bounty:' + id; arrows.add(key); this.indicator(key, { x, y }, name, '#ff406e', true, now);
      }
      for (const [id, node] of this.indicators) if (!arrows.has(id)) { node.remove(); this.indicators.delete(id); }
      const b = this.world.boss;
      if (b) {
        active.add(b[0]); this.object(b[0], b[1], b[2], 'ship-red-4', 2.5, delta).setRotation(b[5]).setTint(0xffc95c);
      }
      const me = this.C.renderState.get(this.C.myId);
      this.bossBar.hidden = !b || !me || this.C.dead || this.C.menuOpen;
      if (b) { I.render(this.bossLabel, M('world.bossHP', { hp: Math.ceil(b[3]), maxHp: b[4], phase: M('world.' + b[6]) }));
        this.bossFill.max = b[4]; this.bossFill.value = b[3]; }
      for (const [id, image] of this.objects) if (!active.has(id)) {
        image.setVisible(false); this.objects.delete(id); this.pool.push(image);
      }
      if (now - this.lastAura > 150) {
        this.lastAura = now;
        for (const rock of this.scene._obstacles) if (rock.gold && this.scene._effectVisible(rock.x, rock.y)) this.gold.emitParticleAt(rock.x, rock.y, 2);
      }
    }
    killFX(data) {
      if (data.effect === 'default' || this.fxSeen.has(data.id)) return;
      this.fxSeen.add(data.id); if (this.fxSeen.size > 128) this.fxSeen.delete(this.fxSeen.values().next().value);
      if (!this.scene._effectVisible(data.x, data.y) || this.timed.size >= 40) return;
      const image = this.acquireFX(data.x, data.y, data.effect === 'NEON_GRAFFITI' ? 'neon-stencil' :
        data.effect === 'BLACK_HOLE' ? 'dark-void' : 'ship-red-1');
      const dispose = () => this.releaseFX(image);
      if (data.effect === 'FROST_SHATTER') {
        image.setTint(0x99eaff).setScale(0.7);
        this.scene.tweens.add({ targets: image, alpha: 0.5, duration: 180,
          onComplete: () => { this.ice.emitParticleAt(data.x, data.y, 28); dispose(); } });
      } else if (data.effect === 'BLACK_HOLE') {
        image.setScale(1.1);
        const images = [];
        for (let i = 0; i < 8 && this.timed.size < 80; i++) {
          images.push(this.acquireFX(data.x, data.y, 'xp-gem').setScale(0.5).setTint(0x8b59d5));
        }
        this.spirals.add({ x: data.x, y: data.y, start: performance.now(), images });
        this.scene.tweens.add({ targets: image, rotation: Math.PI * 4, scale: 0, alpha: 0, duration: 700, onComplete: dispose });
      } else {
        this.scene.tweens.add({ targets: image, alpha: 0, delay: 9000, duration: 1000, onComplete: dispose });
      }
    }
    acquireFX(x, y, texture) {
      const image = this.fxPool.pop() || this.scene.add.image(x, y, texture).setDepth(9);
      image.setTexture(texture).setPosition(x, y).setRotation(0).setScale(1).setAlpha(1).clearTint().setVisible(true);
      this.timed.add(image); return image;
    }
    releaseFX(image) {
      if (!this.timed.delete(image)) return;
      image.setVisible(false); this.fxPool.push(image);
    }
    reset() {
      this.flushRewards();
      this.world = { g: [], c: [], q: [], boss: null }; this.stopPulse(); this.comboPickupCount = 0;
      this.slowUntil = 0; I.render(this.banner, ''); this.bossBar.hidden = true;
      for (const node of this.indicators.values()) node.remove(); this.indicators.clear();
      for (const image of this.objects.values()) { image.setVisible(false); this.pool.push(image); } this.objects.clear();
      for (const image of this.timed) { this.scene.tweens.killTweensOf(image); image.setVisible(false); this.fxPool.push(image); }
      this.timed.clear(); this.spirals.clear();
      for (const text of this.activeTexts) { this.scene.tweens.killTweensOf(text); I.unbind(text); text.setVisible(false); this.textPool.push(text); } this.activeTexts.clear();
    }
    destroy() {
      this.reset(); for (const [event, handler] of Object.entries(this.handlers)) this.C.socket.off(event, handler);
      global.removeEventListener('pagehide', this.pageHideHandler);
      for (const image of this.pool) image.destroy(); for (const text of this.textPool) text.destroy();
      for (const image of this.fxPool) image.destroy();
      this.pool.length = this.textPool.length = this.fxPool.length = 0;
      this.ice.destroy(); this.gold.destroy(); this.stopPulse(); this.banner.remove(); this.bossBar.remove();
    }
  }
  global.FleetRetention = { Retention };
})(window);

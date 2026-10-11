// Orquestación de UX, habilidades y economía. Los cambios de combate se confirman
// siempre por Socket.IO; el navegador solo almacena monedas y cosméticos locales.
(function (global) {
  'use strict';
  const SKIN_COLORS = { default: 0xffffff, alien: 0x77ff99, gold: 0xffd260, chrome: 0xd9e3ed };
  const TRAIL_COLORS = { cyan: 0x20dfff, orange: 0xffa039, purple: 0xb16cff };
  const ATTRIBUTES = { speed: ['Velocidad +15 px/s', 10], shield: ['Escudo +50 HP', 10],
    damage: ['Daño +10%', 10], fireRate: ['Cadencia −15 ms', 20] };
  class Features {
    constructor(scene, state, track) {
      this.scene = scene; this.C = state; this.track = track; this.blocking = false;
      this.economy = new global.FleetEconomy.Economy();
      this.me = null; this.matchId = null; this.matchClosed = true; this.lastUI = 0;
      this.ghostAt = this.auraAt = 0; this.audio = null; this.muted = false;
      this.revenge = null; this.keys = {}; this.abilityPending = new Set();
      this.lastPointOffer = 0;
      this.buildUI(); this.bind();
      scene.events.once('shutdown', () => this.destroy());
      if (this.economy.canClaimDaily()) this.daily();
    }
    button(label, action) {
      const button = document.createElement('button'); button.className = 'feature-button';
      button.type = 'button'; button.textContent = label; button.onclick = action; return button;
    }
    buildUI() {
      this.bar = document.createElement('div'); this.bar.className = 'feature-bar';
      this.abilityButtons = {};
      for (const [type, label] of [['dash', 'SHIFT · TURBO'], ['shield', 'Q · ESCUDO'], ['emp', 'R · EMP'], ['parry', 'F · PARRY']]) {
        const button = this.button(label, () => this.ability(type));
        button.dataset.label = label; this.abilityButtons[type] = button; this.bar.append(button);
      }
      this.pointsButton = this.button('ATRIBUTOS · 0', () => this.attributes());
      this.shopButton = this.button('TIENDA · 0', () => this.shop());
      this.bar.append(this.pointsButton, this.shopButton); document.body.append(this.bar);
      this.menuShopButton = this.button('TIENDA DE COSMÉTICOS', () => this.shop());
      document.getElementById('singleplayer-btn')?.after(this.menuShopButton);
      this.modal = document.createElement('div'); this.modal.className = 'feature-modal hidden';
      this.modal.setAttribute('role', 'dialog'); this.modal.setAttribute('aria-modal', 'true');
      this.panel = document.createElement('div'); this.panel.className = 'feature-panel';
      this.modal.append(this.panel); document.body.append(this.modal);
      this.killer = document.createElement('div'); this.killer.className = 'killer-card hidden';
      const deathPanel = document.querySelector('#death-overlay .panel');
      deathPanel?.insertBefore(this.killer, document.getElementById('rewarded-respawn-btn'));
      this.revengeButton = this.button('REVENGE SPAWN · VENGANZA', () => this.requestRevenge());
      this.revengeButton.classList.add('hidden'); deathPanel?.append(this.revengeButton);
      this.currency();
    }
    open(title) {
      if (global.AdManager?.busy) return false;
      this.focusBefore = document.activeElement;
      this.blocking = true; this.modal.classList.remove('hidden'); this.track();
      this.panel.replaceChildren();
      const heading = document.createElement('h2'); heading.textContent = title;
      this.panel.append(heading); return true;
    }
    closeButton() {
      const button = this.button('CONTINUAR', () => this.close()); this.panel.append(button); button.focus();
    }
    close() {
      this.modal.classList.add('hidden'); this.blocking = false; this.track();
      if (this.focusBefore?.isConnected) this.focusBefore.focus();
    }
    currency() { this.shopButton.textContent = `TIENDA · ${this.economy.state.coins} ◈`; }
    daily() {
      if (!this.open('DAILY REWARD CLAIM')) return;
      const text = document.createElement('p');
      text.textContent = '+500 monedas y Carga Solar: velocidad +10% durante 15 s en tu primera partida.';
      this.panel.append(text, this.button('RECLAMAR +500 ◈', () => {
        if (this.economy.claimDaily()) this.currency();
        this.close();
        if (this.C.joined && !this.C.dead) this.applyBoost();
      }));
      this.closeButton();
    }
    shop() {
      if (!this.open(`TIENDA · ${this.economy.state.coins} ◈`)) return;
      for (const type of ['skins', 'trails', 'effects']) {
        const grid = document.createElement('div'); grid.className = 'feature-grid';
        for (const item of global.FleetEconomy.CATALOG[type]) {
          const owned = this.economy.state[type].includes(item.id);
          const card = document.createElement('div'); card.className = 'feature-card';
          const label = document.createElement('strong'); label.textContent = item.name;
          const selected = this.economy.state.equipped[type === 'skins' ? 'skin' : type === 'effects' ? 'killEffect' : 'trail'] === item.id;
          const buy = this.button(selected ? 'EQUIPADO' : owned ? 'EQUIPAR' : `${item.price} ◈ · COMPRAR`, () => {
            if (!this.economy.buy(type, item.id)) return;
            this.currency(); this.loadout(); this.shop();
          });
          buy.disabled = selected || (!owned && this.economy.state.coins < item.price);
          card.append(label, buy); grid.append(card);
        }
        this.panel.append(grid);
      }
      if (!this.economy.persistent) {
        const notice = document.createElement('p'); notice.textContent = 'El almacenamiento está bloqueado: esta sesión usa memoria temporal.';
        this.panel.append(notice);
      }
      this.closeButton();
    }
    attributes() {
      if (!this.me || this.C.dead || !this.open(`ATRIBUTOS · ${this.me.attributePoints || 0} puntos`)) return;
      const grid = document.createElement('div'); grid.className = 'feature-grid';
      for (const [key, [label, cap]] of Object.entries(ATTRIBUTES)) {
        const used = this.me.attributes?.[key] || 0;
        const button = this.button(`${label} · ${used}/${cap}`, () => {
          button.disabled = true;
          const roomId = this.C.room?.roomId, playerId = this.C.myId, deathId = this.me.deathId;
          this.C.socket.timeout(8000).emit('allocateAttribute', { roomId, deathId, attribute: key, points: 1 }, (error, result) => {
            if (this.C.dead || roomId !== this.C.room?.roomId || playerId !== this.C.myId || deathId !== this.me?.deathId) return;
            if (!error && result?.ok) { this.me = result.player; this.scene._syncLocalState(result.player); }
            if (this.blocking) {
              this.attributes();
              if (error || !result?.ok) {
                const status = document.createElement('p'); status.className = 'feature-status';
                status.textContent = 'No se pudo asignar el punto. Vuelve a intentarlo.'; this.panel.append(status);
              }
            }
          });
        });
        button.disabled = !this.me.attributePoints || used >= cap; grid.append(button);
      }
      this.panel.append(grid); this.closeButton();
    }
    bind() {
      for (const [key, type] of [['SHIFT', 'dash'], ['Q', 'shield'], ['R', 'emp'], ['F', 'parry']]) {
        const handler = event => { if (!event?.repeat) this.ability(type); };
        this.scene.input.keyboard.on('keydown-' + key, handler); this.keys[key] = handler;
      }
      this.pointerHandler = pointer => { if (pointer.rightButtonDown()) this.ability('dash'); };
      this.scene.input.on('pointerdown', this.pointerHandler);
      this.scene.input.mouse?.disableContextMenu();
      this.focusHandler = event => {
        if (!this.blocking) return;
        if (event.key === 'Escape') { this.close(); return; }
        if (event.key !== 'Tab') return;
        const buttons = [...this.panel.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      };
      document.addEventListener('keydown', this.focusHandler);
      // pagehide también cubre recarga y cierre: no depende de que Phaser emita shutdown.
      this.pageHideHandler = () => this.settle();
      this.pageShowHandler = event => {
        if (event.persisted && this.C.joined && !this.C.dead && this.me) {
          this.begin(this.me);
          // Una página restaurada desde BFCache solo liquida monedas nuevas.
          this.coinBaseline = Math.floor((this.me.score || 0) / 50) * 50;
        }
      };
      global.addEventListener('pagehide', this.pageHideHandler);
      global.addEventListener('pageshow', this.pageShowHandler);
      this.handlers = {
        level_up: data => {
          if (!this.inRoom(data)) return;
          this.offerAfter = performance.now() + 1200;
          this.announce(`NIVEL ${data.level} · +3 PUNTOS`, '#88efff', 28);
        },
        ability_used: data => { if (this.inRoom(data)) this.effect(data); },
        player_hit: data => {
          if (!this.inRoom(data)) return;
          this.scene.cameras.main.shake(50, 0.002);
          const now = performance.now();
          if (now - (this.hitAt || 0) > 150) { this.hitAt = now; if ((data.hp ?? this.me?.hp) / (data.maxHp ?? this.me?.maxHp) <= 0.25) this.scene._cyber?.impact(); }
        },
        kill_streak: data => {
          if (!this.inRoom(data) || data.id !== this.C.myId) return;
          const streak = data.streak;
          if (streak >= 5) { this.announce('UNSTOPPABLE!', '#ffd060', 48, '#ff406e'); this.scene.cameras.main.shake(200, 0.008); }
          else if (streak === 3) this.announce('DOMINATING!', '#ff9e40', 40);
          else if (streak === 2) this.announce('DOUBLE KILL!', '#20dfff', 32);
        },
      };
      for (const [event, handler] of Object.entries(this.handlers)) this.C.socket.on(event, handler);
    }
    inRoom(data) { return data.roomId === this.C.room?.roomId; }
    ability(type) {
      const focus = document.activeElement;
      if (focus?.matches('input, textarea') || !this.C.connected || !this.C.joined || this.C.dead ||
          this.C.menuOpen || this.C.mutationsOpen || this.blocking || global.AdManager?.busy || this.abilityPending.has(type)) return;
      if ((this.me?.cooldowns?.[type] || 0) > 0) return;
      this.abilityPending.add(type);
      const roomId = this.C.room?.roomId, playerId = this.C.myId, deathId = this.me?.deathId;
      this.C.socket.timeout(8000).emit('useAbility', { type, roomId, deathId }, (error, result) => {
        this.abilityPending.delete(type);
        if (this.C.dead || roomId !== this.C.room?.roomId || playerId !== this.C.myId || deathId !== this.me?.deathId) return;
        if (!error && result?.ok) {
          this.me = result.player;
          this.C.playerStates.set(this.C.myId, result.player);
          this.scene._prediction?.reconcile(result.player, this.C.world, this.scene._obstacles);
        }
      });
    }
    loadout() {
      if (this.C.connected && this.C.joined && !this.C.dead) this.C.socket.emit('setCosmetics', {
          ...this.economy.state.equipped, titles: this.economy.state.titles, roomId: this.C.room?.roomId });
    }
    applyBoost() {
      if (!this.economy.state.pendingBoost) return;
      this.C.socket.timeout(8000).emit('claimDailyBoost', {}, (error, result) => {
        if (!error && result?.ok) { this.economy.consumeBoost(); this.announce('CARGA SOLAR · +10% VELOCIDAD', '#ffd060', 24); }
      });
    }
    begin(me) {
      this.me = me; this.matchId = `${this.C.room?.roomId}:${me.id}:${me.deathId}:${Date.now()}`;
      this.matchClosed = false; this.coinBaseline = 0; this.lastPointOffer = 0; this.loadout(); this.applyBoost();
      this.revenge = me.revengeTarget ? { id: me.revengeTarget, until: performance.now() + 3000 } : null;
      this.revengeMarker?.destroy(); this.revengeMarker = null;
    }
    settle(me = this.me) {
      if (!this.matchId || this.matchClosed || !me) return 0;
      this.matchClosed = true;
      const score = me.deathState?.score ?? me.score ?? this.C._score;
      const earned = this.economy.settle(this.matchId, Math.max(0, score - (this.coinBaseline || 0)));
      this.currency(); return earned;
    }
    died(me) {
      if (this.blocking) this.close();
      const earned = this.settle(me); this.killer.replaceChildren();
      const attacker = me.killedBy;
      this.killer.classList.remove('hidden');
      if (attacker) {
        const image = document.createElement('img'); image.className = 'killer-avatar'; image.alt = 'Nave del rival';
        const key = `ship-red-${attacker.chassis || 1}`;
        image.src = this.scene.textures.getBase64(key);
        image.style.filter = attacker.skin === 'gold' ? 'sepia(1) saturate(3)' : attacker.skin === 'alien' ? 'hue-rotate(140deg)' : '';
        const text = document.createElement('span');
        text.textContent = `DESTRUIDO POR ${attacker.name} · HP ${attacker.hpPercent}% · Puntos ${attacker.score} · Racha ${attacker.streak}`;
        this.killer.append(image, text);
      } else this.killer.textContent = 'FLOTA DESTRUIDA';
      const reward = document.createElement('p');
      reward.textContent = `+${earned} monedas · Supervivencia ${Math.floor((me.deathState?.survivedMs || me.survivedMs || 0) / 1000)} s`;
      this.killer.append(reward); this.revengeButton.classList.toggle('hidden', !attacker);
    }
    requestRevenge() {
      if (!this.C.dead || this.C.respawnBusy || global.AdManager?.busy) return;
      this.scene._setRespawnBusy(true, 'Buscando al rival…'); this.revengeButton.disabled = true;
      const roomId = this.C.room?.roomId, playerId = this.C.myId, deathId = this.C.deathId;
      this.C.socket.timeout(8000).emit('requestRevengeRespawn', { deathId: this.C.deathId, roomId: this.C.room?.roomId }, (error, result) => {
        this.revengeButton.disabled = false;
        if (!this.C.dead || roomId !== this.C.room?.roomId || playerId !== this.C.myId || deathId !== this.C.deathId) return;
        if (error || !result?.ok) this.scene._setRespawnBusy(false, result?.error || 'No se pudo revivir.');
      });
    }
    sync(me) {
      this.me = me;
      this.scene._retention?.sync(me);
      this.pointsButton.textContent = `ATRIBUTOS · ${me.attributePoints || 0}`;
      if (me.hp > 0 && !this.matchClosed && me.level > this.lastPointOffer && (me.attributePoints || 0) > 0 &&
          performance.now() >= (this.offerAfter || 0) &&
          !this.C.menuOpen && !this.C.mutationsOpen && !this.blocking && !global.AdManager?.busy) {
        this.lastPointOffer = me.level; this.attributes();
      }
    }
    announce(message, color, size, bottomColor) {
      const scene = this.scene;
      const text = scene.add.text(scene.scale.width / 2, scene.scale.height * 0.32, message, {
        fontFamily: 'system-ui', fontStyle: 'bold', fontSize: size + 'px', color, stroke: '#050918', strokeThickness: 6,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setScale(0.3);
      if (bottomColor) {
        const gradient = text.context.createLinearGradient(0, 0, 0, text.height);
        gradient.addColorStop(0, color); gradient.addColorStop(1, bottomColor); text.setFill(gradient);
      }
      scene.tweens.add({ targets: text, scale: 1, duration: 350, ease: 'Back.Out',
        onComplete: () => scene.tweens.add({ targets: text, alpha: 0, y: text.y - 35, delay: 600,
          duration: 450, onComplete: () => text.destroy() }) });
    }
    ring(x, y, radius, color, duration) {
      if (!this.scene._effectVisible(x, y, radius)) return;
      const ring = this.scene.add.graphics().setDepth(12);
      ring.lineStyle(3, color, 0.9).strokeCircle(0, 0, radius);
      ring.x = x; ring.y = y; ring.setScale(0.05);
      this.scene.tweens.add({ targets: ring, scale: 1, alpha: 0, duration, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    }
    effect(data) {
      if (data.type === 'emp') this.ring(data.x, data.y, 350, 0xa879ff, 750);
      if (data.type === 'shield') this.ring(data.x, data.y, 65, 0x20dfff, 550);
      if (data.type === 'dash' && data.id === this.C.myId) this.thrusterSound();
    }
    thrusterSound() {
      if (this.muted || this.scene.sound?.mute || global.AdManager?.busy) return;
      try {
        const Audio = global.AudioContext || global.webkitAudioContext;
        if (!Audio) return;
        this.audio ||= new Audio(); this.audio.resume().catch(() => {});
        const oscillator = this.audio.createOscillator(), gain = this.audio.createGain();
        oscillator.type = 'sawtooth'; oscillator.frequency.setValueAtTime(160, this.audio.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(45, this.audio.currentTime + 0.2);
        gain.gain.setValueAtTime(0.035, this.audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.2);
        oscillator.connect(gain); gain.connect(this.audio.destination);
        oscillator.start(); oscillator.stop(this.audio.currentTime + 0.22);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      } catch { /* Un navegador sin audio no bloquea la habilidad. */ }
    }
    setMuted(muted) { this.muted = muted; if (muted) this.audio?.suspend().catch(() => {}); }
    update(now) {
      if (this.revenge && now < this.revenge.until) {
        const rival = this.C.renderState.get(this.revenge.id);
        if (rival) {
          if (!this.revengeMarker) {
            this.revengeMarker = this.scene.add.image(rival.x, rival.y, 'fleet-shield').setTint(0xff406e).setDepth(15);
          }
          this.revengeMarker.setPosition(rival.x, rival.y);
          this.revengeMarker.setScale(0.9 + Math.sin(now / 100) * 0.1);
        }
      } else if (this.revengeMarker) { this.revengeMarker.destroy(); this.revengeMarker = null; }
      const p = this.C.renderState.get(this.C.myId);
      if (p && this.me?.dashing && now - this.ghostAt > 35 && !this.C.dead) {
        this.ghostAt = now;
        const ghost = this.scene.add.image(p.x, p.y, `ship-blue-${this.me.chassis || 1}`)
          .setScale(0.55).setRotation(p.rotation || 0).setAlpha(0.35).setDepth(2);
        this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 250, onComplete: () => ghost.destroy() });
      }
      const king = this.C.renderState.get(this.C.kingId);
      if (king && now - this.auraAt > 80 && this.scene._effectVisible(king.x, king.y)) {
        this.auraAt = now;
        this.scene._royalAura?.emitParticleAt(king.x, king.y, 2);
      }
      if (now - this.lastUI < 100) return; this.lastUI = now;
      for (const [type, button] of Object.entries(this.abilityButtons)) {
        const remaining = this.me?.cooldowns?.[type] || 0;
        button.disabled = !this.C.joined || this.C.dead || remaining > 0 || this.abilityPending.has(type);
        button.textContent = button.dataset.label + (remaining > 0 ? ` ${Math.ceil(remaining / 1000)}s` : '');
      }
    }
    destroy() {
      this.settle();
      for (const [key, handler] of Object.entries(this.keys)) this.scene.input.keyboard.off('keydown-' + key, handler);
      this.scene.input.off('pointerdown', this.pointerHandler);
      for (const [event, handler] of Object.entries(this.handlers)) this.C.socket.off(event, handler);
      document.removeEventListener('keydown', this.focusHandler);
      global.removeEventListener('pagehide', this.pageHideHandler);
      global.removeEventListener('pageshow', this.pageShowHandler);
      this.audio?.close().catch(() => {}); this.modal.remove(); this.bar.remove(); this.killer.remove(); this.revengeButton.remove(); this.menuShopButton.remove();
    }
  }
  global.FleetFeatures = { Features, SKIN_COLORS, TRAIL_COLORS };
})(window);

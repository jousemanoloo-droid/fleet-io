// Orquestación de UX, habilidades y economía. Los cambios de combate se confirman
// siempre por Socket.IO; el navegador solo almacena monedas y cosméticos locales.
(function (global) {
  'use strict';
  const I = window.FleetI18n, M = I.m;
  const SKIN_COLORS = { default: 0xffffff, alien: 0x77ff99, gold: 0xffd260, chrome: 0xd9e3ed, cyber: 0x88eaff, void: 0xb193ff, solar: 0xffb84d, starlight:0xe8c8ff, void_stalker:0xc97aff };
  const TRAIL_COLORS = { cyan: 0x20dfff, orange: 0xffa039, purple: 0xb16cff };
  const ATTRIBUTES = { speed: ['attributes.speed', 10], fireRate: ['attributes.fireRate', 20],
    damage: ['attributes.damage', 10], regen: ['attributes.regen',10], vision: ['attributes.vision',10] };
  class Features {
    constructor(scene, state, track) {
      this.scene = scene; this.C = state; this.track = track; this.blocking = false;
      this.economy = new global.FleetEconomy.Economy();
      this.economy.bindAccount(state.socket,()=>{if(!this.destroyed && this.shopButton)this.currency();});
      this.me = null; this.matchId = null; this.matchClosed = true; this.lastUI = 0;
      this.ghostAt = this.auraAt = 0; this.audio = null; this.muted = false;
      this.revenge = null; this.keys = {}; this.abilityPending = new Set();
      this.lastPointOffer = 0;
      this.buildUI(); this.bind();
      if(global.FleetGarageUI) this.garage=new global.FleetGarageUI(this);
      if(this.C.connected) this.syncClock();
      global.FleetGarageLoadout=()=>({...this.economy.state.equipped});
      scene.events.once('shutdown', () => this.destroy());
      // Daily rewards remain accessible in the shop without blocking first play.
    }
    button(label, action) {
      const button = document.createElement('button'); button.className = 'feature-button';
      button.type = 'button'; I.render(button, label); button.onclick = action; return button;
    }
    buildUI() {
      this.bar = document.createElement('div'); this.bar.className = 'feature-bar';
      this.abilityButtons = {};
      for (const [type, label] of [['dash', 'ability.dash'], ['shield', 'ability.shield'], ['emp', 'ability.emp'], ['parry', 'ability.parry'], ['cloak','ability.cloak']]) {
        const button = this.button(M(label), () => this.ability(type));
        button.dataset.labelKey = label; this.abilityButtons[type] = button; this.bar.append(button);
      }
      this.pointsButton = this.button(M('attributes.button', { points: 0 }), () => this.attributes());
      this.shopButton = this.button(M('shop.title', { coins: 0 }), () => this.shop());
      this.bar.append(this.pointsButton, this.shopButton); document.body.append(this.bar);
      this.menuShopButton = this.button(M('shop.menu'), () => this.shop());
      document.getElementById('singleplayer-btn')?.after(this.menuShopButton);
      this.modal = document.createElement('div'); this.modal.className = 'feature-modal hidden';
      this.modal.setAttribute('role', 'dialog'); this.modal.setAttribute('aria-modal', 'true');
      this.panel = document.createElement('div'); this.panel.className = 'feature-panel';
      this.modal.append(this.panel); document.body.append(this.modal);
      this.killer = document.createElement('div'); this.killer.className = 'killer-card hidden';
      const deathPanel = document.querySelector('#death-overlay .panel');
      deathPanel?.insertBefore(this.killer, document.getElementById('rewarded-respawn-btn'));
      this.revengeButton = this.button(M('death.revenge'), () => this.requestRevenge());
      this.revengeButton.classList.add('hidden'); deathPanel?.append(this.revengeButton);
      this.currency();
    }
    open(title) {
      if (global.AdManager?.busy) return false;
      this.focusBefore = document.activeElement;
      this.blocking = true; this.modal.classList.remove('hidden'); this.track();
      this.panel.replaceChildren();
      const heading = document.createElement('h2'); I.render(heading, title);
      this.panel.append(heading); return true;
    }
    closeButton() {
      const button = this.button(M('continue'), () => this.close()); this.panel.append(button); button.focus();
    }
    close() {
      this.modal.classList.add('hidden'); this.blocking = false; this.track();
      if (this.focusBefore?.isConnected) this.focusBefore.focus();
    }
    currency() { I.render(this.shopButton, M('garage.title', { credits: this.economy.state.coins }));this.scene._stashUI?.refreshMenu();this.scene._mainMenu?.render(); }
    daily() {
      if(this.garage) {this.garage.open();return;}
      if (!this.open(M('daily.title'))) return;
      const text = document.createElement('p');
      I.render(text, M('daily.explain'));
      this.panel.append(text, this.button(M('daily.claim'), () => {
        if (this.economy.claimDaily()) this.currency();
        this.close();
        if (this.C.joined && !this.C.dead) this.applyBoost();
      }));
      this.closeButton();
    }
    shop() {
      if(this.garage) {this.garage.open();return;}
      if (!this.open(M('shop.title', { coins: this.economy.state.coins }))) return;
      if (this.economy.canClaimDaily()) this.panel.append(this.button(M('daily.title'),()=>this.daily()));
      for (const type of ['skins', 'trails', 'effects']) {
        const grid = document.createElement('div'); grid.className = 'feature-grid';
        for (const item of global.FleetEconomy.CATALOG[type]) {
          const owned = this.economy.state[type].includes(item.id);
          const card = document.createElement('div'); card.className = 'feature-card';
          const label = document.createElement('strong'); I.render(label, M(item.nameKey));
          const selected = this.economy.state.equipped[type === 'skins' ? 'skin' : type === 'effects' ? 'killEffect' : 'trail'] === item.id;
          const buy = this.button(selected ? M('shop.equipped') : owned ? M('shop.equip') : M('shop.buy', { price: item.price }), () => {
            if (!this.economy.buy(type, item.id)) return;
            this.currency(); this.loadout(); this.shop();
          });
          buy.disabled = selected || (!owned && this.economy.state.coins < item.price);
          card.append(label, buy); grid.append(card);
        }
        this.panel.append(grid);
      }
      const titles = document.createElement('h3'); I.render(titles, M('cosmetic.titles')); this.panel.append(titles);
      for (const title of [null, ...this.economy.state.titles]) {
        const button = this.button(title ? M('title.' + title) : M('cosmetic.noTitle'), () => {
          this.economy.state.equipped.title = title; this.economy.save(); this.loadout(); this.shop();
        });
        button.disabled = this.economy.state.equipped.title === title; this.panel.append(button);
      }
      if (!this.economy.persistent) {
        const notice = document.createElement('p'); I.render(notice, M('shop.storage'));
        this.panel.append(notice);
      }
      this.closeButton();
    }
    attributes() {
      if (!this.me || this.C.dead || !this.open(M('attributes.title', { points: this.me.attributePoints || 0 }))) return;
      const grid = document.createElement('div'); grid.className = 'feature-grid';
      for (const [key, [label, cap]] of Object.entries(ATTRIBUTES)) {
        const used = this.me.attributes?.[key] || 0;
        const button = this.button(M('attributes.item', { label: M(label), used, cap }), () => {
          button.disabled = true;
          const roomId = this.C.room?.roomId, playerId = this.C.myId, deathId = this.me.deathId;
          this.C.socket.timeout(8000).emit('allocateAttribute', { roomId, deathId, attribute: key, points: 1 }, (error, result) => {
            if (this.C.dead || roomId !== this.C.room?.roomId || playerId !== this.C.myId || deathId !== this.me?.deathId) return;
            if (!error && result?.ok) { this.me = result.player; this.scene._syncLocalState(result.player); }
            if (this.blocking) {
              this.attributes();
              if (error || !result?.ok) {
                const status = document.createElement('p'); status.className = 'feature-status';
                I.render(status, M('attributes.failed')); this.panel.append(status);
              }
            }
          });
        });
        button.disabled = !this.me.attributePoints || used >= cap; grid.append(button);
      }
      this.panel.append(grid); this.closeButton();
    }
    bind() {
      for (const [key, type] of [['SHIFT', 'dash'], ['Q', 'shield'], ['R', 'emp'], ['F', 'parry'], ['C','cloak']]) {
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
          this.announce(M('level.up', { level: data.level }), '#88efff', 28);
        },
        ability_used: data => { if (this.inRoom(data)) this.effect(data); },
        player_hit: data => {
          if (!this.inRoom(data)) return;
            const critical=data.damage>=20 || data.hp/data.maxHp<=.25;
            if(this.scene.screenShake)this.scene.screenShake(critical?.008:.002,critical?160:50);
          const now = performance.now();
          if (now - (this.hitAt || 0) > 150) { this.hitAt = now; if ((data.hp ?? this.me?.hp) / (data.maxHp ?? this.me?.maxHp) <= 0.25) this.scene._cyber?.impact(); }
        },
        kill_streak: data => {
          if (!this.inRoom(data) || data.id !== this.C.myId) return;
          const streak = data.streak;
          if (streak >= 5) { this.announce(M('streak.unstoppable'), '#ffd060', 48, '#ff406e'); this.scene.cameras.main.shake(200, 0.008); }
          else if (streak === 3) this.announce(M('streak.dominating'), '#ff9e40', 40);
          else if (streak === 2) this.announce(M('streak.double'), '#20dfff', 32);
        },
      };
      for (const [event, handler] of Object.entries(this.handlers)) this.C.socket.on(event, handler);
    }
    inRoom(data) { return data.roomId === this.C.room?.roomId; }
    ability(type) {
      const focus = document.activeElement;
      if (focus?.matches('input, textarea') || !this.C.connected || !this.C.joined || this.C.dead ||
          this.C.menuOpen || this.C.mutationsOpen || this.C.evolutionPaused || this.blocking || this.scene._stashUI?.opened || global.AdManager?.busy || this.abilityPending.has(type)) return;
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
          ...this.economy.state.equipped, roomId: this.C.room?.roomId, deathId: this.me?.deathId });
    }
    applyBoost() {
      if (!this.economy.state.pendingBoost) return;
      this.C.socket.timeout(8000).emit('claimDailyBoost', {}, (error, result) => {
        if (!error && result?.ok) { this.economy.consumeBoost(); this.announce(M('daily.boost'), '#ffd060', 24); }
      });
    }
    begin(me) {
      this.me = me; this.matchId = `${this.C.room?.roomId}:${me.id}:${me.deathId}:${Date.now()}`;
      this.matchClosed = false; this.coinBaseline = 0; this.lastPointOffer = 0; this.loadout(); this.applyBoost();
      this.revenge = me.revengeTarget ? { id: me.revengeTarget, until: performance.now() + 3000 } : null;
      this.revengeMarker?.destroy(); this.revengeMarker = null;
      this.playId=`${this.C.room?.roomId}:${me.id}:${me.deathId}`;
      if(this.garage) this.economy.recordPlay(this.playId,this.playValues(me),true);
    }
    playValues(me) {return {kills:Math.max(0,Math.floor(me.sessionKills || 0)),seconds:Math.max(0,Math.floor((me.deathState?.survivedMs ?? me.survivedMs ?? 0)/1000)),score:Math.max(0,Math.floor(me.deathState?.score ?? me.score ?? 0)),shipClass:me.shipClass};}
    recordPlay(me) {
      if(!this.garage || !this.playId || !me) return 0;
      const earned=this.economy.recordPlay(this.playId,this.playValues(me)); this.currency();return earned;
    }
    syncClock() {
      const socket=this.C.socket;
      if(!socket || !this.garage || this.clockPending || this.destroyed) return;
      if(this.economy.remote && !this.economy.accountReady) {
        this.clockPending=true;
        this.economy.openAccount().then(result=>{this.clockPending=false;if(result && !this.destroyed)this.garage.clockReady();});
        return;
      }
      this.clockPending=true;
      socket.timeout(8000).emit('getServerTime',{},(error,result)=>{
        this.clockPending=false;
        if(error || !result?.ok || !this.C.connected || this.garage.destroyed) return;
        if(this.economy.setServerTime(result.utc)) this.garage.clockReady();
      });
    }
    settle(me = this.me) {
      if (!this.matchId || this.matchClosed || !me) return 0;
      this.matchClosed = true;
      const score = me.deathState?.score ?? me.score ?? this.C._score;
      const earned = this.garage ? this.recordPlay(me) : this.economy.settle(this.matchId, Math.max(0, score - (this.coinBaseline || 0)));
      this.currency(); return earned;
    }
    died(me) {
      if (this.blocking) this.close();
      const earned = this.settle(me); this.killer.replaceChildren();
      const attacker = me.killedBy;
      this.killer.classList.remove('hidden');
      if (attacker) {
        const image = document.createElement('img'); image.className = 'killer-avatar'; I.render(image, M('death.avatar'), '@alt');
        const key = `ship-red-${attacker.chassis || 1}`;
        image.src = this.scene.textures.getBase64(key);
        image.style.filter = attacker.skin === 'gold' ? 'sepia(1) saturate(3)' : attacker.skin === 'alien' ? 'hue-rotate(140deg)' : '';
        const text = document.createElement('span');
        I.render(text, M('death.killer', { name: attacker.name, hp: attacker.hpPercent, score: attacker.score, streak: attacker.streak }));
        this.killer.append(image, text);
      } else {
        const text = document.createElement('span');
        I.render(text, M('death.title')); this.killer.append(text);
      }
      const reward = document.createElement('p');
      I.render(reward, M('death.reward', { coins: earned, seconds: Math.floor((me.deathState?.survivedMs || me.survivedMs || 0) / 1000) }));
      this.killer.append(reward); this.revengeButton.classList.add('hidden');
    }
    requestRevenge() {
      // All revenge actions share the SDK-completed reward path; no free shortcut.
      document.getElementById('rewarded-respawn-btn')?.click();
    }

    sync(me) {
      this.me = me;
      const now=performance.now();
      if(now-(this.creditAt || 0)>=1000) {this.creditAt=now;this.recordPlay(me);}
      this.scene._retention?.sync(me);
      I.render(this.pointsButton, M('attributes.button', { points: me.attributePoints || 0 }));
      if (me.hp > 0 && !me.evolutionPending && !this.matchClosed && me.level > this.lastPointOffer && (me.attributePoints || 0) > 0 &&
          performance.now() >= (this.offerAfter || 0) &&
          !this.C.menuOpen && !this.C.mutationsOpen && !this.blocking && !global.AdManager?.busy) {
        this.lastPointOffer = me.level; this.attributes();
      }
    }
    announce(message, color, size, bottomColor) {
      const scene = this.scene._ui || this.scene;
      const text = scene.add.text(scene.scale.width / 2, scene.scale.height * 0.32, String(message), {
        fontFamily: 'system-ui', fontStyle: 'bold', fontSize: size + 'px', color, stroke: '#050918', strokeThickness: 6,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setScale(0.3);
      I.render(text, message, 'phaserText');
      if (bottomColor) {
        const gradient = text.context.createLinearGradient(0, 0, 0, text.height);
        gradient.addColorStop(0, color); gradient.addColorStop(1, bottomColor); text.setFill(gradient);
      }
      scene.tweens.add({ targets: text, scale: 1, duration: 350, ease: 'Back.Out',
        onComplete: () => scene.tweens.add({ targets: text, alpha: 0, y: text.y - 35, delay: 600,
          duration: 450, onComplete: () => { I.unbind(text); text.destroy(); } }) });
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
      this.garage?.update(now);
      if(this.C.connected && now>=(this.clockAt || 0)) {this.clockAt=now+60000;this.syncClock();}
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
        if (type === 'cloak') button.hidden = this.me?.shipClass !== 'stealth';
        const remaining = this.me?.cooldowns?.[type] || 0;
        button.disabled = !this.C.joined || this.C.dead || remaining > 0 || this.abilityPending.has(type);
        I.render(button, remaining > 0 ? M('ability.cooldown', { label: M(button.dataset.labelKey), seconds: Math.ceil(remaining / 1000) }) : M(button.dataset.labelKey));
      }
    }
    destroy() {
      this.settle();
      this.destroyed=true;this.economy.destroy();
      this.garage?.destroy(); global.FleetGarageLoadout=null;
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

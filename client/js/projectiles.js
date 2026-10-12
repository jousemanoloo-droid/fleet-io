// Fixed 400-slot pool. Arcade bodies stay disabled: the server owns collisions.
(function (global) {
  'use strict';
  class Projectiles {
    constructor(scene, state) {
      this.scene = scene; this.C = state; this.active = new Map(); this.free = [];
      this.sequence = 0; this.deathId = null; this.nextAt = 0;
      scene.bulletGroup = scene.physics.add.group({ maxSize: 400, runChildUpdate: false, allowGravity: false });
      for (let i = 0; i < 400; i++) {
        const sprite = scene.bulletGroup.create(0, 0, 'fleet-laser').setDepth(5).setScale(.65)
          .setBlendMode(Phaser.BlendModes.ADD).setActive(false).setVisible(false);
        sprite.setOrigin?.(0,.5);
        sprite.body.stop(); sprite.body.enable = false;
        this.free.push({ sprite, key: null, predicted: false, x: 0, y: 0, vx: 0, vy: 0, seen: 0, expires: 0, revision: 0, correctionX: 0, correctionY: 0 });
      }
      scene.events.once('shutdown', () => this.reset());
    }
    acquire(key) {
      const slot = this.free.pop(); if (!slot) return null;
      slot.key = key; slot.seen=0; slot.correctionX=slot.correctionY=0; slot.sprite.setActive(true); this.scene._laserSprites.set(key,slot.sprite); this.active.set(key, slot); return slot;
    }
    release(slot) {
      this.active.delete(slot.key); this.scene._laserSprites.delete(slot.key); slot.sprite.setActive(false).setVisible(false);
      slot.sprite.body.stop(); slot.sprite.body.enable = false; slot.predicted = false; this.free.push(slot);
    }
    reset() { for (const slot of this.active.values()) this.release(slot); this.deathId = null; this.nextAt = 0; }
    snapshot(shots, me, now) {
      if (me && this.deathId !== me.deathId) {
        this.reset(); this.deathId = me.deathId; this.sequence = me.fireSeq || 0; this.nextAt = now;
      }
      for (const shot of shots) {
        const predictedKey = `local:${shot.deathId}:${shot.fireSeq}`;
        let slot = this.active.get(shot.id);
        let newShot=!slot;
        if (!slot && shot.ownerId === this.C.myId && shot.sourceId === this.C.myId && shot.fireSeq > 0) {
          slot = this.active.get(predictedKey);
          if (slot) {newShot=false; this.active.delete(predictedKey); this.scene._laserSprites.delete(predictedKey); slot.key = shot.id; this.active.set(shot.id, slot); this.scene._laserSprites.set(shot.id,slot.sprite); }
        }
        slot ||= this.acquire(shot.id); if (!slot) continue;
        const revision = shot.motionRevision || 0;
        // Only large corrections or a portal/reflection discontinuity move a predicted visual.
        if (!slot.seen || revision !== slot.revision) {
          slot.x = shot.x; slot.y = shot.y; slot.correctionX=slot.correctionY=0;
        } else if (Math.hypot(slot.x-shot.x,slot.y-shot.y)>20) {
          slot.correctionX=shot.x-slot.x; slot.correctionY=shot.y-slot.y;
        }
        slot.predicted = false; slot.revision = revision; slot.seen = now;
        slot.vx = (shot.vx || 0) * 30; slot.vy = (shot.vy || 0) * 30;
        slot.sprite.setTint(shot.c); slot.sprite.rotation = shot.rotation || 0;
        if(newShot && shot.fireSeq>0){
          const meta=this.C.playerStates.get(shot.sourceId),pos=this.C.renderState.get(shot.sourceId);
          if(meta && pos){const model={...pos,shipClass:meta.shipClass,chassis:meta.chassis,powerTripleRemaining:meta.powerTripleRemaining};
            const pattern=global.FleetShipClasses.pattern(model);this.scene.muzzleFlash?.(model,pattern[(shot.fireSeq-1)%pattern.length].gun,shot.c);}
        }
        if (shot.ownerId === this.C.myId) this.sequence = Math.max(this.sequence, shot.fireSeq || 0);
      }
      for (const slot of this.active.values()) if (!slot.predicted && slot.seen !== now) this.release(slot);
      if (me && Number.isFinite(me.nextFireTick)) {
        this.nextAt = Math.max(now, now + (me.nextFireTick - this.C.tick) * 1000 / 30);
      }
    }
    predict(now) {
      const C = this.C, me = C.playerStates.get(C.myId), pos = C.renderState.get(C.myId);
      if (!me || !pos || C.dead || !C.joined || C.menuOpen || me.levelUpPending || me.slowed ||
          global.AdManager?.busy || now < this.nextAt) return;
      let target = null, distance = 550;
      for (const other of C.playerStates.values()) {
        if (other.id === C.myId || other.hp <= 0 || other.invulnerable || other.isInvulnerable) continue;
        const p = C.renderState.get(other.id) || other, d = Math.hypot(p.x - pos.x, p.y - pos.y);
        if (d < distance) { target = p; distance = d; }
      }
      // Keep auto-mining compatible with the authoritative firing behavior.
      if (!target) for (const rock of this.scene._obstacles) {
        const d = Math.hypot(rock.x - pos.x, rock.y - pos.y);
        if (d < Math.min(distance, 400)) { target = rock; distance = d; }
      }
      if (!target) return;
      this.nextAt = now + (me.fireCooldown || 400);
      if (me.evolutionPending || me.cloakRemaining > 0) return;
      const model={x:pos.x,y:pos.y,rotation:pos.rotation,vx:pos.vx,vy:pos.vy,chassis:me.chassis,shipClass:me.shipClass,powerTripleRemaining:me.powerTripleRemaining};
      for (const shot of global.FleetShipClasses.pattern(model)) {
        const slot = this.acquire(`local:${me.deathId}:${++this.sequence}`); if (!slot) break;
        const launch = global.FleetBallistics.launch(model,{...global.FleetShipClasses.muzzle(model,shot.gun),spread:shot.spread},target);
        slot.x = launch.x; slot.y = launch.y; slot.vx = launch.vx * 30; slot.vy = launch.vy * 30;
        slot.predicted = true; slot.expires = now + 350; slot.seen = now; slot.revision = 0;
        const color = me.laserStyle === 'rainbow' ? [0xff3366,0xffcc33,0x00ff88,0x20dfff,0xcc66ff][this.sequence%5] : ({blue:0x20dfff,green:0x00ff88,red:0xff3366}[me.laserStyle] || me.color);
        slot.sprite.setTint(color); slot.sprite.rotation = launch.rotation;
        this.scene.muzzleFlash?.(model,shot.gun,color);
      }
    }
    update(now, delta) {
      this.predict(now);
      const dt = Math.min(delta, 100) / 1000;
      for (const slot of this.active.values()) {
        if (slot.predicted && now >= slot.expires) { this.release(slot); continue; }
        const blend=1-Math.exp(-dt/0.07);
        slot.x += slot.vx * dt + slot.correctionX*blend; slot.y += slot.vy * dt + slot.correctionY*blend;
        slot.correctionX*=1-blend; slot.correctionY*=1-blend;
        slot.sprite.setPosition(slot.x, slot.y).setVisible(this.scene._effectVisible(slot.x, slot.y));
      }
    }
  }
  global.FleetProjectiles = Projectiles;
})(window);
